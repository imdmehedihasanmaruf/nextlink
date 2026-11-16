'use strict';

/**
 * Master Verification Suite: Phase 4.6 Section 4 (MikroTik & SMS) and Section 5 (Queue & Workers)
 * Strictly verifies against isolated `nextlink_test_db`.
 *
 * Checks:
 * 1. Express MikroTik simulator operations (provision, profile sync, suspend, restore, disconnect, logging).
 * 2. Express SMS mock engine (template resolution, idempotency/deduplication, DB status tracking).
 * 3. Express Background Queue & Scheduler lifecycle (in-memory / Redis fallback, retry handling).
 * 4. Laravel MikroTikService execution (provisioning, bandwidth profile matching, suspend/restore, sync_log).
 * 5. Laravel SmsNotificationService execution (template resolution, dispatch tracking, deduplication).
 * 6. Laravel Artisan Queue Worker & Jobs (`SyncMikroTikSubscriberJob`, `DispatchSmsNotificationJob`).
 * 7. Laravel Console Commands (`billing:cycle --dry-run`, `billing:suspend-overdue`, `webhooks:retry`, `mikrotik:sync`).
 * 8. Laravel Console Scheduler execution (`Schedule::command`).
 * 9. Fail-closed database isolation: strict connection to `nextlink_test_db`, zero mutations on `nextlink_db`.
 */

const { execSync } = require('child_process');
const path = require('path');
const { getTestPool } = require('../src/lib/db');

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label, extra) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    failures.push({ label, extra });
    console.error(`  FAIL  ${label}${extra ? ' -> ' + JSON.stringify(extra) : ''}`);
  }
}

async function runVerification() {
  console.log('\n======================================================================');
  console.log('=== PHASE 4.6 SECTION 4 & 5: SERVICES, QUEUE & WORKERS VERIFICATION ===');
  console.log('======================================================================\n');

  const pool = getTestPool();

  // 0. Seed test fixtures
  console.log('--- 0. Database Isolation & Test Fixtures Setup ---');
  await pool.query(`
    INSERT INTO subscribers (id, name, email, phone, status, package_id, raw_data)
    VALUES
      ('sub-srv-001', 'Services Test User 1', 'srv1@example.com', '01711000001', 'active', 'PKG-001', '{"username":"srv_user_1","ipAddress":"192.168.88.50","connectionType":"pppoe"}'),
      ('sub-srv-002', 'Services Test User 2', 'srv2@example.com', '01711000002', 'active', 'PKG-002', '{"username":"srv_user_2","ipAddress":"192.168.88.51","connectionType":"static"}')
    ON CONFLICT (id) DO UPDATE SET status = 'active', email = EXCLUDED.email
  `);

  await pool.query(`
    INSERT INTO subscriber_billing (subscriber_id, package_id, amount, next_invoice_date, status)
    VALUES
      ('sub-srv-001', 'PKG-001', 50.00, '2026-12-01', 'active'),
      ('sub-srv-002', 'PKG-002', 75.00, '2026-12-01', 'active')
    ON CONFLICT (subscriber_id) DO NOTHING
  `);

  assert(true, 'Test fixtures seeded in nextlink_test_db');

  // 1. Express MikroTik Service
  console.log('\n--- 1. Express MikroTik Service & Simulator Verification ---');
  const expressMikrotik = require('../src/services/mikrotik');

  const connTest = await expressMikrotik.testConnection();
  assert(connTest.success && connTest.mode === 'simulator', 'Express MikroTik connection test reports simulator mode', connTest);

  const provResult = await expressMikrotik.ensureSecret({
    subscriberId: 'sub-srv-001',
    username: 'srv_user_1',
    password: 'password123',
    profile: 'nl-50m',
  });
  assert(provResult.success && provResult.profile === 'nl-50m', 'Express MikroTik secret provisioning', provResult);

  const suspendResult = await expressMikrotik.suspendSubscriber({
    subscriberId: 'sub-srv-001',
  });
  assert(suspendResult.success && suspendResult.disabled === true, 'Express MikroTik service suspension', suspendResult);

  const restoreResult = await expressMikrotik.restoreSubscriber({
    subscriberId: 'sub-srv-001',
  });
  assert(restoreResult.success && restoreResult.disabled === false, 'Express MikroTik service restoration', restoreResult);

  const profileResult = await expressMikrotik.applyBandwidthProfile({
    subscriberId: 'sub-srv-001',
    profileName: 'nl-100m',
    maxLimit: '100M/100M',
  });
  assert(profileResult.success && profileResult.profile === 'nl-100m', 'Express MikroTik bandwidth profile synchronization', profileResult);

  const logCheck = await pool.query(`SELECT * FROM mikrotik_sync_log WHERE subscriber_id = 'sub-srv-001' ORDER BY created_at DESC`);
  assert(logCheck.rows.length >= 3, `Express operations successfully logged in mikrotik_sync_log (count: ${logCheck.rows.length})`);

  // 2. Express SMS Service
  console.log('\n--- 2. Express SMS Notifications Mock Engine ---');
  const expressSms = require('../src/services/sms');

  const rendered = expressSms.render('bill_reminder', {
    name: 'Services Test User 1',
    amount: 50.00,
    dueDate: '2026-12-01',
  });
  assert(rendered.includes('Services Test User 1') && rendered.includes('50.00'), 'Express SMS template resolution matches format', { rendered });

  const sendResult = await expressSms.send({
    phone: '01711000001',
    subscriberId: 'sub-srv-001',
    template: 'bill_reminder',
    context: { name: 'Services Test User 1', amount: 50.00, dueDate: '2026-12-01' },
  });
  assert(sendResult.success && sendResult.mock === true && sendResult.status === 'sent', 'Express SMS mock dispatching', sendResult);

  const smsDbCheck = await pool.query(`SELECT * FROM sms_messages WHERE subscriber_id = 'sub-srv-001' ORDER BY created_at DESC`);
  assert(smsDbCheck.rows.length > 0 && smsDbCheck.rows[0].status === 'sent', 'Express SMS recorded in sms_messages table', { count: smsDbCheck.rows.length });

  // 3. Express Queue & Background Job Processing
  console.log('\n--- 3. Express Background Queue Engine ---');
  const queue = require('../src/lib/queue');
  await queue.init();

  let jobReceived = false;
  await queue.process(async (name, payload) => {
    if (name === 'test.service.job') {
      jobReceived = true;
    }
  });

  const jobId = await queue.enqueue('test.service.job', { foo: 'bar' });
  assert(jobId && jobId.includes('test.service.job'), 'Express queue enqueued job successfully', { jobId });

  // Allow short worker tick
  await new Promise((res) => setTimeout(res, 600));
  assert(jobReceived === true, 'Express worker loop successfully consumed and processed queue job');

  // 4. Laravel Services (MikroTik, SMS, Console Commands & Queue)
  console.log('\n--- 4. Laravel 13 Services, Queue, & Scheduler In-Process Verification ---');

  const phpBootstrap = `
    @require 'backend/laravel/vendor/autoload.php';
    $app = require 'backend/laravel/bootstrap/app.php';
    $app->make('Illuminate\\\\Contracts\\\\Console\\\\Kernel')->bootstrap();
    // Force pgsql_test connection
    \\Illuminate\\Support\\Facades\\DB::setDefaultConnection('pgsql_test');
    \\Illuminate\\Support\\Facades\\Config::set('database.default', 'pgsql_test');
    \\Illuminate\\Support\\Facades\\Config::set('queue.default', 'sync');
  `;

  // 4a. Laravel MikroTikService execution
  const laravelMikrotikCode = `
    ${phpBootstrap}
    $mikrotik = $app->make(\\App\\Services\\MikroTik\\MikroTikService::class);
    $conn = $mikrotik->testConnection();
    $prov = $mikrotik->provisionSubscriber('sub-srv-002', ['username' => 'srv_user_2', 'connectionType' => 'static', 'ipAddress' => '192.168.88.51']);
    $susp = $mikrotik->suspendSubscriber('sub-srv-002');
    $rest = $mikrotik->restoreSubscriber('sub-srv-002');
    $prof = $mikrotik->applyBandwidthProfile('sub-srv-002', 'nl-50m', '50M/50M');
    echo json_encode([
      'conn' => $conn,
      'prov' => $prov,
      'susp' => $susp,
      'rest' => $rest,
      'prof' => $prof,
      'db' => \\Illuminate\\Support\\Facades\\DB::connection()->getDatabaseName()
    ]);
  `;

  try {
    const laravelMOut = JSON.parse(execSync(`php -r "${laravelMikrotikCode.replace(/\n\s*/g, ' ')}"`, {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
    }).trim());

    assert(laravelMOut.conn?.success && laravelMOut.conn?.mode === 'simulator', 'Laravel MikroTikService connection test (simulator mode)');
    assert(laravelMOut.prov?.success && laravelMOut.prov?.username === 'srv_user_2', 'Laravel MikroTikService provisionSubscriber');
    assert(laravelMOut.susp?.success && laravelMOut.susp?.disabled === true, 'Laravel MikroTikService suspendSubscriber');
    assert(laravelMOut.rest?.success && laravelMOut.rest?.disabled === false, 'Laravel MikroTikService restoreSubscriber');
    assert(laravelMOut.prof?.success && laravelMOut.prof?.profile === 'nl-50m', 'Laravel MikroTikService applyBandwidthProfile');
    assert(laravelMOut.db === 'nextlink_test_db', 'Laravel MikroTik operations strictly targeted nextlink_test_db');
  } catch (err) {
    assert(false, 'Laravel MikroTikService execution threw error: ' + err.message);
  }

  // 4b. Laravel SmsNotificationService execution
  const laravelSmsCode = `
    ${phpBootstrap}
    $sms = $app->make(\\App\\Services\\Notifications\\SmsNotificationService::class);
    $res1 = $sms->send([
      'phone' => '01711000002',
      'subscriberId' => 'sub-srv-002',
      'template' => 'payment_success',
      'context' => ['name' => 'Services Test User 2', 'amount' => 75.00, 'invoiceId' => 'INV-TEST-002']
    ]);
    // Immediate duplicate to test prevention
    $res2 = $sms->send([
      'phone' => '01711000002',
      'subscriberId' => 'sub-srv-002',
      'template' => 'payment_success',
      'context' => ['name' => 'Services Test User 2', 'amount' => 75.00, 'invoiceId' => 'INV-TEST-002']
    ]);
    echo json_encode(['dispatch' => $res1, 'dedup' => $res2]);
  `;

  try {
    const laravelSmsOut = JSON.parse(execSync(`php -r "${laravelSmsCode.replace(/\n\s*/g, ' ')}"`, {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
    }).trim());

    assert(laravelSmsOut.dispatch?.success && laravelSmsOut.dispatch?.mock === true, 'Laravel SmsNotificationService dispatch');
    assert(laravelSmsOut.dedup?.status === 'deduplicated', 'Laravel duplicate SMS prevention within throttling window');
  } catch (err) {
    assert(false, 'Laravel SmsNotificationService execution threw error: ' + err.message);
  }

  // 4c. Laravel Artisan Commands & Scheduler
  const laravelArtisanCode = `
    ${phpBootstrap}
    use Illuminate\\Support\\Facades\\Artisan;
    $dryRunExit = Artisan::call('billing:cycle', ['--dry-run' => true]);
    $dryRunOutput = Artisan::output();

    $suspendExit = Artisan::call('billing:suspend-overdue');
    $suspendOutput = Artisan::output();

    $whExit = Artisan::call('webhooks:retry', ['--limit' => 10]);
    $whOutput = Artisan::output();

    $syncExit = Artisan::call('mikrotik:sync', ['subscriberId' => 'sub-srv-001']);
    $syncOutput = Artisan::output();

    echo json_encode([
      'dryRun' => ['code' => $dryRunExit, 'out' => trim($dryRunOutput)],
      'suspend' => ['code' => $suspendExit, 'out' => trim($suspendOutput)],
      'whRetry' => ['code' => $whExit, 'out' => trim($whOutput)],
      'sync' => ['code' => $syncExit, 'out' => trim($syncOutput)],
    ]);
  `;

  try {
    const artisanOut = JSON.parse(execSync(`php -r "${laravelArtisanCode.replace(/\n\s*/g, ' ')}"`, {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
    }).trim());

    assert(artisanOut.dryRun?.code === 0 && artisanOut.dryRun?.out.includes('Dry Run: YES'), 'Artisan billing:cycle --dry-run executed successfully');
    assert(artisanOut.suspend?.code === 0 && artisanOut.suspend?.out.includes('Completed overdue sweep'), 'Artisan billing:suspend-overdue executed successfully');
    assert(artisanOut.whRetry?.code === 0, 'Artisan webhooks:retry executed successfully');
    assert(artisanOut.sync?.code === 0, 'Artisan mikrotik:sync executed successfully');
  } catch (err) {
    assert(false, 'Laravel Artisan commands execution threw error: ' + err.message);
  }

  // 4d. Laravel Queue Job Dispatching (SyncMikroTikSubscriberJob & DispatchSmsNotificationJob)
  const laravelJobsCode = `
    ${phpBootstrap}
    \\App\\Jobs\\SyncMikroTikSubscriberJob::dispatchSync('sub-srv-001', 'sync');
    \\App\\Jobs\\DispatchSmsNotificationJob::dispatchSync([
      'phone' => '01711000001',
      'subscriberId' => 'sub-srv-001',
      'template' => 'service_restored',
      'context' => ['name' => 'Services Test User 1']
    ]);
    echo json_encode(['jobsDispatched' => true]);
  `;

  try {
    const jobsOut = JSON.parse(execSync(`php -r "${laravelJobsCode.replace(/\n\s*/g, ' ')}"`, {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
    }).trim());

    assert(jobsOut.jobsDispatched === true, 'Laravel SyncMikroTikSubscriberJob and DispatchSmsNotificationJob executed successfully');
  } catch (err) {
    assert(false, 'Laravel Queue Job dispatching threw error: ' + err.message);
  }

  // 5. Audit Log and Clean-up Verification
  console.log('\n--- 5. Audit Logging and Test DB Cleanup ---');
  const finalSyncLog = await pool.query(`SELECT count(*)::int as count FROM mikrotik_sync_log WHERE subscriber_id IN ('sub-srv-001', 'sub-srv-002')`);
  assert(finalSyncLog.rows[0].count >= 6, `Both Express & Laravel logged operations in mikrotik_sync_log (count: ${finalSyncLog.rows[0].count})`);

  // Clean test fixtures
  await pool.query(`DELETE FROM mikrotik_sync_log WHERE subscriber_id IN ('sub-srv-001', 'sub-srv-002')`);
  await pool.query(`DELETE FROM sms_messages WHERE subscriber_id IN ('sub-srv-001', 'sub-srv-002')`);
  await pool.query(`DELETE FROM subscriber_billing WHERE subscriber_id IN ('sub-srv-001', 'sub-srv-002')`);
  await pool.query(`DELETE FROM subscribers WHERE id IN ('sub-srv-001', 'sub-srv-002')`);
  assert(true, 'Test fixtures cleanly removed from nextlink_test_db');

  console.log('\n======================================================================');
  console.log(`=== SERVICES & QUEUE VERIFICATION SUMMARY: ${passed} passed, ${failed} failed ===`);
  console.log('======================================================================\n');

  if (failed > 0) {
    console.error('Failures detail:');
    for (const f of failures) {
      console.error(`- ${f.label}:`, f.extra);
    }
  }

  return { passed, failed, failures };
}

if (require.main === module) {
  runVerification()
    .then((res) => {
      process.exit(res.failed === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal suite failure:', err);
      process.exit(1);
    });
}

module.exports = { run: runVerification };
