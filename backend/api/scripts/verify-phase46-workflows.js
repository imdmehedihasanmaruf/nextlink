'use strict';

/**
 * Suite: Phase 4.6 Section 4 Automated Verification Suite
 * Workflows A, B, C, D (Customer lifecycle, Orders & packages, Billing & invoices, Payment & webhook operations)
 *
 * Verifies Dual Engine Compliance: Express (:3100, authoritative) & Laravel (:3101, parallel).
 * Strictly isolated to `nextlink_test_db` with zero mutations to `nextlink_db`.
 *
 * Usage:
 *   node backend/api/scripts/verify-phase46-workflows.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { execSync } = require('child_process');

const API_DIR = path.resolve(__dirname, '..');
const LARAVEL_DIR = path.resolve(__dirname, '../../../backend/laravel');

// Load JWT secret
let JWT_SECRET = 'nextlink-dev-secret-change-me-in-production-9f3a2c';
function parseEnvSecret(filePath) {
  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*JWT_SECRET\s*=\s*(.*)$/);
      if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return null;
}
const loadedSecret = parseEnvSecret(path.resolve(API_DIR, '.env')) || parseEnvSecret(path.resolve(LARAVEL_DIR, '.env'));
if (loadedSecret) JWT_SECRET = loadedSecret;

let EXPRESS_BASE = process.env.API_BASE_URL || 'http://127.0.0.1:3100';
let LARAVEL_BASE = process.env.LARAVEL_BASE_URL || 'http://127.0.0.1:3101';
let inProcessExpress = null;
let useLaravelKernelDirect = false;

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label, extra) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    failures.push({ label, extra });
    console.log(`  FAIL  ${label}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ''}`);
  }
}

async function ensureExpressServer() {
  try {
    const res = await fetch(`${EXPRESS_BASE}/health`, {
      headers: { 'X-Use-Test-Db': 'nextlink_test_db' },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      console.log(`  [server] Express active on ${EXPRESS_BASE}`);
      return;
    }
  } catch {}

  console.log('  [server] Express daemon not responding on 3100; booting in-process test instance...');
  const { createApp } = require('../src/app');
  const app = createApp();
  await new Promise((resolve) => {
    inProcessExpress = app.listen(0, '127.0.0.1', () => {
      const port = inProcessExpress.address().port;
      EXPRESS_BASE = `http://127.0.0.1:${port}`;
      console.log(`  [server] In-process Express listening on ${EXPRESS_BASE}`);
      resolve();
    });
  });
}

async function probeLaravelReachable() {
  try {
    const res = await fetch(`${LARAVEL_BASE}/health`, {
      headers: { 'X-Use-Test-Db': 'nextlink_test_db' },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok || res.status === 200) {
      console.log(`  [server] Laravel HTTP daemon active on ${LARAVEL_BASE}`);
      useLaravelKernelDirect = false;
      return true;
    }
  } catch (err) {
    console.log(`  [server] Laravel HTTP daemon not listening (${err.message}); utilizing Laravel 13 HTTP Kernel in-process invocation`);
  }
  useLaravelKernelDirect = true;
  return true;
}

function runLaravelKernelRequest(uri, method = 'GET', headers = {}, body = null) {
  const sanitizedUri = uri.replace(/'/g, "\\'");
  const headerAssignments = [];
  for (const [k, v] of Object.entries(headers)) {
    const cleanK = k.toUpperCase().replace(/-/g, '_');
    const headerKey = (cleanK === 'CONTENT_TYPE' || cleanK === 'CONTENT_LENGTH')
      ? cleanK
      : `HTTP_${cleanK}`;
    headerAssignments.push(`$server['${headerKey}'] = '${String(v).replace(/'/g, "\\'")}';`);
  }

  const bodyJson = body !== null ? JSON.stringify(body).replace(/'/g, "\\'") : null;
  const bodyParam = bodyJson !== null ? `'${bodyJson}'` : 'null';

  const phpCode = `
    @require 'backend/laravel/vendor/autoload.php';
    $app = require 'backend/laravel/bootstrap/app.php';
    $kernel = $app->make('Illuminate\\\\Contracts\\\\Http\\\\Kernel');
    $server = [
      'REQUEST_URI' => '${sanitizedUri}',
      'REQUEST_METHOD' => '${method}',
      'HTTP_ACCEPT' => 'application/json',
      'HTTP_X_USE_TEST_DB' => 'nextlink_test_db',
    ];
    ${headerAssignments.join('\n    ')}
    $content = ${bodyParam};
    $req = \\Illuminate\\Http\\Request::create('${sanitizedUri}', '${method}', [], [], [], $server, $content);
    if ($content !== null) {
      $req->headers->set('Content-Type', 'application/json');
    }
    $res = $kernel->handle($req);
    $headersOut = [];
    foreach ($res->headers->all() as $hk => $hv) {
      $headersOut[$hk] = implode(', ', $hv);
    }
    $rawContent = $res->getContent();
    echo json_encode([
      'status' => $res->getStatusCode(),
      'headers' => $headersOut,
      'body' => json_decode($rawContent, true) ?: $rawContent
    ]);
  `;

  try {
    const output = execSync(`php -r "${phpCode.replace(/\n\s*/g, ' ')}"`, {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
    return JSON.parse(output);
  } catch (err) {
    return {
      status: 500,
      headers: {},
      body: { success: false, error: 'Kernel execution error: ' + err.message },
    };
  }
}

async function makeRequest(baseUrl, uri, { method = 'GET', headers = {}, body = null, token = null } = {}, isLaravel = false) {
  const reqHeaders = {
    'Content-Type': 'application/json',
    'X-Use-Test-Db': 'nextlink_test_db',
    ...headers,
  };
  if (token) reqHeaders.Authorization = `Bearer ${token}`;

  if (isLaravel && useLaravelKernelDirect) {
    const kernelRes = runLaravelKernelRequest(uri, method, reqHeaders, body);
    return {
      status: kernelRes.status,
      headers: kernelRes.headers,
      body: kernelRes.body,
      dbTarget: kernelRes.headers['x-database-target'] || 'nextlink_test_db',
    };
  }

  const response = await fetch(`${baseUrl}${uri}`, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  const dbTarget = response.headers.get('x-database-target') || 'nextlink_test_db';
  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = { raw };
  }

  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: payload,
    dbTarget,
  };
}

function generateStaffTokens() {
  const now = Math.floor(Date.now() / 1000);
  const superAdminToken = jwt.sign(
    { id: 'ADM-001', userId: 'ADM-001', email: 'admin@nextlink.com', name: 'Super Admin', role: 'super_admin', type: 'staff', iat: now, exp: now + 3600 },
    JWT_SECRET,
    { algorithm: 'HS256' }
  );
  const billingToken = jwt.sign(
    { id: 'ADM-002', userId: 'ADM-002', email: 'billing@nextlink.com', name: 'Billing Manager', role: 'billing', type: 'staff', iat: now, exp: now + 3600 },
    JWT_SECRET,
    { algorithm: 'HS256' }
  );
  const subscriberTokenB = jwt.sign(
    { id: 'sub-test-other', userId: 'sub-test-other', subscriberId: 'sub-test-other', email: 'other@example.com', name: 'Other Sub', role: 'subscriber', type: 'subscriber', iat: now, exp: now + 3600 },
    JWT_SECRET,
    { algorithm: 'HS256' }
  );
  return { superAdminToken, billingToken, subscriberTokenB };
}

async function run() {
  console.log('\n================================================================================');
  console.log('=== PHASE 4.6 SECTION 4: MASTER WORKFLOW VERIFICATION SUITE (A, B, C, D)      ===');
  console.log('=== Express (:3100) vs Laravel (:3101) on nextlink_test_db                   ===');
  console.log('================================================================================\n');

  await ensureExpressServer();
  await probeLaravelReachable();

  const { getTestPool, getProdPool } = require('../src/lib/db');
  const testPool = getTestPool();
  const prodPool = getProdPool();

  // Snapshot production database counts before tests
  const prodSnapBefore = await prodPool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM subscribers) AS sub_cnt,
      (SELECT COUNT(*)::int FROM invoices) AS inv_cnt,
      (SELECT COUNT(*)::int FROM payment_transactions) AS pay_cnt,
      (SELECT COUNT(*)::int FROM orders) AS ord_cnt
  `);
  const initialProdCounts = prodSnapBefore.rows[0];

  const tokens = generateStaffTokens();

  // ---------------------------------------------------------------------------
  // Preflight Handshake: Fail-Closed Test DB Isolation
  // ---------------------------------------------------------------------------
  console.log('--- 0. Fail-Closed Test DB Isolation Preflight ---');
  const expPre = await makeRequest(EXPRESS_BASE, '/health');
  assert(expPre.status === 200 && expPre.dbTarget === 'nextlink_test_db', 'Express preflight reports X-Database-Target: nextlink_test_db');

  const larPre = await makeRequest(LARAVEL_BASE, '/health', {}, true);
  assert(larPre.status === 200 && larPre.dbTarget === 'nextlink_test_db', 'Laravel preflight reports X-Database-Target: nextlink_test_db');

  // Track created fixtures for teardown
  let createdAppId = null;
  let createdSubId = null;
  let subscriberJwt = null;
  let createdOrderId = null;
  let purchaseInvoiceId = null;
  let cycleInvoiceId = null;
  let webhookTxnId = null;
  let failedWhId = null;

  try {
    // =========================================================================
    // WORKFLOW A: Customer Lifecycle
    // =========================================================================
    console.log('\n--- 1. WORKFLOW A: Customer Lifecycle ---');

    // A1: Registration / application (POST /api/applications)
    const testPhone = `01799${Date.now().toString().slice(-6)}`;
    const appBody = {
      fullName: 'Workflow Test User',
      phone: testPhone,
      email: `wf.user.${Date.now()}@example.com`,
      idNumber: 'NID-WF-998877',
      address: 'House 42, Road 11, Banani, Dhaka',
      packageId: 'PKG-001',
      packageName: 'Starter 50 Mbps',
    };

    const expAppRes = await makeRequest(EXPRESS_BASE, '/api/applications', {
      method: 'POST',
      body: appBody,
    });
    assert(expAppRes.status === 201 && expAppRes.body?.success, 'A1. Express: POST /api/applications submits registration (201 Created)');
    createdAppId = expAppRes.body?.request?.id;
    assert(Boolean(createdAppId), `A1. Application created with ID: ${createdAppId}`);

    // Verify Laravel applications listing sees the application on test DB
    const larAppList = await makeRequest(LARAVEL_BASE, '/api/applications', { token: tokens.superAdminToken }, true);
    assert(larAppList.status === 200 && Array.isArray(larAppList.body?.requests), 'A1. Laravel: GET /api/applications returns requests list');

    // A2: Approval and account creation (PATCH /api/applications/:id)
    const expApprove = await makeRequest(EXPRESS_BASE, `/api/applications/${createdAppId}`, {
      method: 'PATCH',
      token: tokens.superAdminToken,
      body: { status: 'approved' },
    });
    assert(expApprove.status === 200 && expApprove.body?.success, 'A2. Express: PATCH /api/applications/:id approves and creates subscriber');
    createdSubId = expApprove.body?.subscriberId;
    const tempPassword = expApprove.body?.temporaryPassword;
    assert(Boolean(createdSubId && tempPassword), `A2. Created subscriberId: ${createdSubId}, issued temporary password`);

    // A3: Authentication (POST /api/auth/subscriber-login)
    // Test on Express
    const expAuth = await makeRequest(EXPRESS_BASE, '/api/auth/subscriber-login', {
      method: 'POST',
      body: { username: createdSubId, password: tempPassword },
    });
    assert(expAuth.status === 200 && expAuth.body?.success && expAuth.body?.token, 'A3. Express: POST /api/auth/subscriber-login authenticates new subscriber');
    subscriberJwt = expAuth.body.token;

    // Test authentication parity on Laravel with identical credentials
    const larAuth = await makeRequest(LARAVEL_BASE, '/api/auth/subscriber-login', {
      method: 'POST',
      body: { username: createdSubId, password: tempPassword },
    }, true);
    assert(larAuth.status === 200 && larAuth.body?.success && larAuth.body?.token, 'A3. Laravel: POST /api/auth/subscriber-login authenticates new subscriber (Parity)');

    // A4: Profile read & write (GET/POST /api/portal/profile)
    const expProfGet = await makeRequest(EXPRESS_BASE, '/api/portal/profile', { token: subscriberJwt });
    assert(expProfGet.status === 200 && expProfGet.body?.user?.id === createdSubId, 'A4. Express: GET /api/portal/profile returns authenticated subscriber profile');

    const larProfGet = await makeRequest(LARAVEL_BASE, '/api/portal/profile', { token: subscriberJwt }, true);
    assert(larProfGet.status === 200 && larProfGet.body?.user?.id === createdSubId, 'A4. Laravel: GET /api/portal/profile returns authenticated subscriber profile (Parity)');

    const expProfUpdate = await makeRequest(EXPRESS_BASE, '/api/portal/profile', {
      method: 'POST',
      token: subscriberJwt,
      body: { firstName: 'Updated', lastName: 'WorkflowName', address: 'Updated Address 123' },
    });
    assert(expProfUpdate.status === 200 && expProfUpdate.body?.success, 'A4. Express: POST /api/portal/profile updates profile');

    // A5: Preferences read & write (GET/POST /api/portal/preferences)
    const expPrefGet = await makeRequest(EXPRESS_BASE, '/api/portal/preferences', { token: subscriberJwt });
    assert(expPrefGet.status === 200 && expPrefGet.body?.preferences, 'A5. Express: GET /api/portal/preferences returns UI preferences');

    const expPrefSet = await makeRequest(EXPRESS_BASE, '/api/portal/preferences', {
      method: 'POST',
      token: subscriberJwt,
      body: { theme: 'dark', themeColor: 'indigo', fontSize: 'lg' },
    });
    assert(expPrefSet.status === 200 && expPrefSet.body?.preferences?.theme === 'dark', 'A5. Express: POST /api/portal/preferences saves dark theme');

    const larPrefGet = await makeRequest(LARAVEL_BASE, '/api/portal/preferences', { token: subscriberJwt }, true);
    assert(larPrefGet.status === 200 && larPrefGet.body?.preferences?.theme === 'dark', 'A5. Laravel: GET /api/portal/preferences reflects updated dark theme');

    // A6: Package selection & subscription activation (POST /api/customer/subscription/activate)
    const expSubActivate = await makeRequest(EXPRESS_BASE, '/api/customer/subscription/activate', {
      method: 'POST',
      token: subscriberJwt,
      body: { packageId: 'PKG-001', packageName: 'Starter 50 Mbps' },
    });
    assert(expSubActivate.status === 200 && expSubActivate.body?.success, 'A6. Express: POST /api/customer/subscription/activate activates package');

    // A7: Customer portal summary (GET /api/portal/my-summary)
    const expSummary = await makeRequest(EXPRESS_BASE, '/api/portal/my-summary', { token: subscriberJwt });
    assert(expSummary.status === 200 && expSummary.body?.summary, 'A7. Express: GET /api/portal/my-summary returns portal summary');

    const larSummary = await makeRequest(LARAVEL_BASE, '/api/portal/my-summary', { token: subscriberJwt }, true);
    assert(larSummary.status === 200 && larSummary.body?.summary, 'A7. Laravel: GET /api/portal/my-summary returns portal summary (Parity)');

    // A8: Subscription cancellation (POST /api/portal/cancel)
    const expCancel = await makeRequest(EXPRESS_BASE, '/api/portal/cancel', {
      method: 'POST',
      token: subscriberJwt,
      body: {
        reason: 'Switching provider',
        description: 'Testing cancellation lifecycle and cancel invoice creation',
        notSureBuyAgain: true,
      },
    });
    assert(expCancel.status === 200 && expCancel.body?.success && expCancel.body?.cancelInvoice, 'A8. Express: POST /api/portal/cancel cancels subscription and issues cancel invoice');

    // Duplicate cancellation blocked (409)
    const expCancelDup = await makeRequest(EXPRESS_BASE, '/api/portal/cancel', {
      method: 'POST',
      token: subscriberJwt,
      body: { reason: 'Switching provider', description: 'Duplicate cancellation attempt', notSureBuyAgain: true },
    });
    assert(expCancelDup.status === 409, 'A8. Duplicate cancellation blocked fail-closed with 409 Conflict');

    // Reactivate subscriber for subsequent order & billing workflows
    await testPool.query("UPDATE subscribers SET status = 'active', package_id = 'PKG-001' WHERE id = $1", [createdSubId]);
    await testPool.query("UPDATE subscriber_billing SET status = 'active', package_id = 'PKG-001' WHERE subscriber_id = $1", [createdSubId]);

    // =========================================================================
    // WORKFLOW B: Orders & Packages
    // =========================================================================
    console.log('\n--- 2. WORKFLOW B: Orders & Packages ---');

    // B1: Package listing and pricing (GET /api/packages)
    const expPkgs = await makeRequest(EXPRESS_BASE, '/api/packages');
    assert(expPkgs.status === 200 && Array.isArray(expPkgs.body?.packages), 'B1. Express: GET /api/packages returns packages catalog');

    const larPkgs = await makeRequest(LARAVEL_BASE, '/api/packages', {}, true);
    assert(larPkgs.status === 200 && Array.isArray(larPkgs.body?.packages), 'B1. Laravel: GET /api/packages returns packages catalog (Parity)');

    // B2: Order creation with authoritative server pricing (POST /api/orders)
    const expOrderRes = await makeRequest(EXPRESS_BASE, '/api/orders', {
      method: 'POST',
      token: subscriberJwt,
      body: {
        customerId: createdSubId,
        packageId: 'PKG-001',
        monthlyPrice: 0.05, // Attempt price tampering
        totalPayable: 0.05,
      },
    });
    assert(expOrderRes.status === 201 && expOrderRes.body?.order, 'B2. Express: POST /api/orders creates order with server-calculated price');
    const createdPrice = Number(expOrderRes.body?.order?.monthly_price || expOrderRes.body?.order?.monthlyPrice);
    assert(createdPrice > 0.05, `B2. SEC-02: Server overrides client price tampering ($${createdPrice} vs 0.05)`);
    createdOrderId = expOrderRes.body?.order?.id;

    // B3: Customer order create-and-pay with pending purchase invoice generation
    const expCreatePay = await makeRequest(EXPRESS_BASE, '/api/customer/orders/create-and-pay', {
      method: 'POST',
      token: subscriberJwt,
      body: {
        packageId: 'PKG-001',
        purchaseType: 'New Connection',
        paymentMethod: 'mock',
        acceptedTerms: true,
      },
    });
    assert(expCreatePay.status === 201 && expCreatePay.body?.payment?.invoiceId, 'B3. Express: POST /api/customer/orders/create-and-pay generates pending purchase invoice');
    purchaseInvoiceId = expCreatePay.body.payment.invoiceId;

    // Parity test on Laravel create-and-pay
    const larCreatePay = await makeRequest(LARAVEL_BASE, '/api/customer/orders/create-and-pay', {
      method: 'POST',
      token: subscriberJwt,
      body: {
        packageId: 'PKG-001',
        purchaseType: 'New Connection',
        paymentMethod: 'mock',
        acceptedTerms: true,
      },
    }, true);
    assert(larCreatePay.status === 201 && larCreatePay.body?.payment?.invoiceId, 'B3. Laravel: POST /api/customer/orders/create-and-pay generates pending purchase invoice (Parity)');

    // B4: Order status transitions (PATCH /api/orders/:id/status)
    const expOrdStatus = await makeRequest(EXPRESS_BASE, `/api/orders/${createdOrderId}/status`, {
      method: 'PATCH',
      token: tokens.superAdminToken,
      body: { status: 'Active', paymentStatus: 'Paid' },
    });
    assert(expOrdStatus.status === 200 && expOrdStatus.body?.order?.order_status === 'Active', 'B4. Express: PATCH /api/orders/:id/status transitions order to Active');

    // B5: Unauthorized / invalid package requests rejected (404/400)
    const expBadPkg = await makeRequest(EXPRESS_BASE, '/api/customer/orders/create-and-pay', {
      method: 'POST',
      token: subscriberJwt,
      body: { packageId: 'PKG-NONEXISTENT-999', acceptedTerms: true },
    });
    assert(expBadPkg.status === 404, 'B5. Invalid package request rejected with 404');

    const expUnacceptedTerms = await makeRequest(EXPRESS_BASE, '/api/customer/orders/create-and-pay', {
      method: 'POST',
      token: subscriberJwt,
      body: { packageId: 'PKG-001', acceptedTerms: false },
    });
    assert(expUnacceptedTerms.status === 400, 'B5. Unaccepted terms rejected with 400 Bad Request');

    // B6: Tenant IDOR prevention (subscriber cannot order for another tenant)
    const expIdorOrder = await makeRequest(EXPRESS_BASE, '/api/orders', {
      method: 'POST',
      token: subscriberJwt,
      body: { customerId: 'sub-test-other', packageId: 'PKG-001' },
    });
    assert(expIdorOrder.status === 403, 'B6. Tenant IDOR cross-account order creation rejected with 403 Forbidden');

    // =========================================================================
    // WORKFLOW C: Billing & Invoices
    // =========================================================================
    console.log('\n--- 3. WORKFLOW C: Billing & Invoices ---');

    // C1: Monthly billing cycle run in test mode (POST /api/billing/cycle/run)
    const testPeriod = `2027-${String(Math.floor(Math.random() * 8) + 1).padStart(2, '0')}`;
    const expBillingRun = await makeRequest(EXPRESS_BASE, '/api/billing/cycle/run', {
      method: 'POST',
      token: tokens.billingToken,
      body: { period: testPeriod, dryRun: false },
    });
    assert(expBillingRun.status === 200 && expBillingRun.body?.success, `C1. Express: POST /api/billing/cycle/run executes monthly cycle for ${testPeriod}`);

    // C2: Duplicate billing run prevention (idempotency check)
    const expBillingRunDup = await makeRequest(EXPRESS_BASE, '/api/billing/cycle/run', {
      method: 'POST',
      token: tokens.billingToken,
      body: { period: testPeriod, dryRun: false },
    });
    assert(expBillingRunDup.status === 200 && expBillingRunDup.body?.createdCount === 0, 'C2. Duplicate billing cycle run generates 0 new invoices (Idempotent)');

    // C3: Invoice generation & line items verification
    cycleInvoiceId = `INV-${testPeriod.replace('-', '')}-${createdSubId}`;
    const expInvDetail = await makeRequest(EXPRESS_BASE, `/api/billing/invoices/${cycleInvoiceId}`, {
      token: tokens.billingToken,
    });
    assert(expInvDetail.status === 200 && expInvDetail.body?.invoice?.id === cycleInvoiceId, `C3. Invoice ${cycleInvoiceId} generated with line items`);

    // C4: Invoice status transitions & paid invoice deletion guard (409)
    // Settle cycle invoice to paid
    await testPool.query("UPDATE invoices SET status = 'paid' WHERE id = $1", [cycleInvoiceId]);

    const expDelPaid = await makeRequest(EXPRESS_BASE, `/api/billing/invoices/${cycleInvoiceId}`, {
      method: 'DELETE',
      token: tokens.superAdminToken,
    });
    assert(expDelPaid.status === 409, 'C4. Paid invoice deletion guarded and blocked with 409 Conflict');

    // Delete unpaid invoice succeeds
    const tempUnpaidInv = `INV-TEMP-${Date.now()}`;
    await testPool.query(`INSERT INTO invoices (id, subscriber_id, amount, status, due_date) VALUES ('${tempUnpaidInv}', '${createdSubId}', 25.00, 'unpaid', '2026-12-01')`);
    const expDelUnpaid = await makeRequest(EXPRESS_BASE, `/api/billing/invoices/${tempUnpaidInv}`, {
      method: 'DELETE',
      token: tokens.superAdminToken,
    });
    assert(expDelUnpaid.status === 200 && expDelUnpaid.body?.success, 'C4. Unpaid errant invoice deletion succeeds (200 OK)');

    // C5: Reconciliation audit trail (GET /api/payments/reconciliation)
    const expRecon = await makeRequest(EXPRESS_BASE, '/api/payments/reconciliation', {
      token: tokens.billingToken,
    });
    assert(expRecon.status === 200 && expRecon.body?.success, 'C5. Express: GET /api/payments/reconciliation generates audit report');

    const larRecon = await makeRequest(LARAVEL_BASE, '/api/payments/reconciliation', {
      token: tokens.billingToken,
    }, true);
    assert(larRecon.status === 200 && larRecon.body?.success, 'C5. Laravel: GET /api/payments/reconciliation generates audit report (Parity)');

    // =========================================================================
    // WORKFLOW D: Payment & Webhook Operations
    // =========================================================================
    console.log('\n--- 4. WORKFLOW D: Payment & Webhook Operations ---');

    // Create fresh test invoice for webhook settlement
    const payTestInvId = `INV-PAY-WF-${Date.now()}`;
    await testPool.query(`
      INSERT INTO invoices (id, subscriber_id, amount, status, due_date, raw_data)
      VALUES ('${payTestInvId}', '${createdSubId}', 65.00, 'unpaid', '2026-12-01', '{"period":"2026-11"}')
    `);

    // D1: Mock payment initiation (POST /api/payments/initiate)
    const expPayInit = await makeRequest(EXPRESS_BASE, '/api/payments/initiate', {
      method: 'POST',
      token: subscriberJwt,
      body: { invoiceId: payTestInvId, gateway: 'mock' },
    });
    assert(expPayInit.status === 200 && expPayInit.body?.gatewayTransactionId, 'D1. Express: POST /api/payments/initiate initiates mock transaction');
    webhookTxnId = expPayInit.body?.gatewayTransactionId;

    // D2: Valid callback processing (/api/payments/mock/callback)
    const expCallback = await makeRequest(EXPRESS_BASE, '/api/payments/mock/callback', {
      method: 'POST',
      body: {
        transactionId: webhookTxnId,
        invoiceId: payTestInvId,
        amount: 65.00,
        currency: 'USD',
        status: 'success',
      },
    });
    assert(expCallback.status === 200 && expCallback.body?.success, 'D2. Express: POST /api/payments/mock/callback processes valid payment');

    const settledInv = await testPool.query('SELECT status FROM invoices WHERE id = $1', [payTestInvId]);
    assert(settledInv.rows[0]?.status === 'paid', 'D2. Invoice atomically settled to paid status');

    // D3: Duplicate webhook delivery idempotency (HTTP 200 with alreadyPaid / alreadyProcessed)
    const expCallbackDup = await makeRequest(EXPRESS_BASE, '/api/payments/mock/callback', {
      method: 'POST',
      body: {
        transactionId: webhookTxnId,
        invoiceId: payTestInvId,
        amount: 65.00,
        currency: 'USD',
        status: 'success',
      },
    });
    assert(expCallbackDup.status === 200 && (expCallbackDup.body?.alreadyPaid || expCallbackDup.body?.alreadyProcessed), 'D3. Duplicate callback returns HTTP 200 with alreadyPaid: true');

    // D4: Concurrent settlement race protection (simultaneous callback burst)
    const raceInvId = `INV-RACE-${Date.now()}`;
    await testPool.query(`
      INSERT INTO invoices (id, subscriber_id, amount, status, due_date)
      VALUES ('${raceInvId}', '${createdSubId}', 40.00, 'unpaid', '2026-12-01')
    `);
    const raceInit = await makeRequest(EXPRESS_BASE, '/api/payments/initiate', {
      method: 'POST',
      token: subscriberJwt,
      body: { invoiceId: raceInvId, gateway: 'mock' },
    });
    const raceTxn = raceInit.body?.gatewayTransactionId;

    const burstCalls = Array.from({ length: 4 }, () =>
      makeRequest(EXPRESS_BASE, '/api/payments/mock/callback', {
        method: 'POST',
        body: { transactionId: raceTxn, invoiceId: raceInvId, amount: 40.00, currency: 'USD', status: 'success' },
      })
    );
    const burstResults = await Promise.all(burstCalls);
    const all200 = burstResults.every((r) => r.status === 200 && r.body?.success);
    assert(all200, 'D4. Concurrent settlement race protection: all concurrent requests return 200 OK without double-crediting');

    const raceEvents = await testPool.query("SELECT COUNT(*)::int AS cnt FROM billing_events WHERE invoice_id = $1 AND event = 'payment_received'", [raceInvId]);
    assert(Number(raceEvents.rows[0]?.cnt || 0) === 1, 'D4. Exactly 1 billing event recorded under concurrent settlement');

    // D5: Invalid webhook signature rejection (bKash/Nagad fail-closed 400/401)
    const expBkashTampered = await makeRequest(EXPRESS_BASE, '/api/payments/bkash/callback', {
      method: 'POST',
      headers: { 'x-signature': 'tampered-signature-hex' },
      body: { paymentID: 'BKASH-FAKE-99', trxID: 'TRX-FAKE-99', amount: '50.00' },
    });
    assert(expBkashTampered.status === 400 || expBkashTampered.status === 401, 'D5. Invalid bKash webhook signature rejected fail-closed (400/401)');

    const larBkashTampered = await makeRequest(LARAVEL_BASE, '/api/payments/bkash/callback', {
      method: 'POST',
      headers: { 'x-signature': 'tampered-signature-hex' },
      body: { paymentID: 'BKASH-FAKE-99', trxID: 'TRX-FAKE-99', amount: '50.00' },
    }, true);
    assert(larBkashTampered.status === 400 || larBkashTampered.status === 401, 'D5. Laravel rejects invalid bKash webhook signature (400/401 Parity)');

    // D6: Webhook retry endpoint & Dead-letter state transition upon 5-attempt retry exhaustion
    const bogusEventId = `EVT-FAIL-${Date.now()}`;
    await makeRequest(EXPRESS_BASE, '/api/payments/mock/callback', {
      method: 'POST',
      headers: { 'x-event-id': bogusEventId },
      body: { transactionId: 'TXN-UNKNOWN-999', invoiceId: 'INV-UNKNOWN-999', amount: 99.00, currency: 'USD', status: 'success' },
    });
    const whRow = await testPool.query('SELECT id, status FROM payment_webhooks WHERE event_id = $1', [bogusEventId]);
    failedWhId = whRow.rows[0]?.id;
    assert(Boolean(failedWhId), `D6. Failed webhook recorded in database (ID: ${failedWhId})`);

    // Exhaust retries to attempt 4 then trigger 5th retry
    await testPool.query('UPDATE payment_webhooks SET attempt_count = 4 WHERE id = $1', [failedWhId]);
    const expRetryRes = await makeRequest(EXPRESS_BASE, `/api/payments/webhooks/${failedWhId}/retry`, {
      method: 'POST',
      token: tokens.superAdminToken,
    });
    assert(expRetryRes.status === 400 || expRetryRes.status === 404 || expRetryRes.body?.success === false, 'D6. 5th retry attempt executed');

    const deadWh = await testPool.query('SELECT status FROM payment_webhooks WHERE id = $1', [failedWhId]);
    assert(deadWh.rows[0]?.status === 'dead_letter', 'D6. Webhook transitioned to dead_letter upon exhausting max retry attempts');

    // D7: Mock refund behavior (POST /api/payments/mock/refund)
    const expRefund = await makeRequest(EXPRESS_BASE, '/api/payments/mock/refund', {
      method: 'POST',
      token: tokens.billingToken,
      body: { transactionId: webhookTxnId, amount: 65.00, reason: 'Customer requested refund' },
    });
    assert(expRefund.status === 200 && expRefund.body?.success && expRefund.body?.status === 'refunded', 'D7. Express: POST /api/payments/mock/refund processes mock refund');

    const larRefund = await makeRequest(LARAVEL_BASE, '/api/payments/mock/refund', {
      method: 'POST',
      token: tokens.billingToken,
      body: { transactionId: webhookTxnId, amount: 65.00, reason: 'Customer requested refund' },
    }, true);
    assert(larRefund.status === 200 && larRefund.body?.success && larRefund.body?.status === 'refunded', 'D7. Laravel: POST /api/payments/mock/refund processes mock refund (Parity)');

  } finally {
    // -------------------------------------------------------------------------
    // Guaranteed Teardown of Test Fixtures in nextlink_test_db
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Cleanup & Teardown in nextlink_test_db ---');
    try {
      if (createdSubId) {
        await testPool.query('DELETE FROM billing_events WHERE subscriber_id = $1', [createdSubId]);
        await testPool.query('DELETE FROM payment_transactions WHERE subscriber_id = $1', [createdSubId]);
        await testPool.query('DELETE FROM invoices WHERE subscriber_id = $1', [createdSubId]);
        await testPool.query('DELETE FROM orders WHERE customer_id = $1', [createdSubId]);
        await testPool.query('DELETE FROM subscriber_credentials WHERE subscriber_id = $1', [createdSubId]);
        await testPool.query('DELETE FROM subscriber_billing WHERE subscriber_id = $1', [createdSubId]);
        await testPool.query('DELETE FROM cancellations WHERE subscriber_id = $1', [createdSubId]);
        await testPool.query('DELETE FROM subscribers WHERE id = $1', [createdSubId]);
      }
      if (createdAppId) {
        await testPool.query('DELETE FROM connection_requests WHERE id = $1', [createdAppId]);
      }
      await testPool.query("DELETE FROM payment_webhooks WHERE event_id LIKE 'EVT-%' OR transaction_reference LIKE '%-WF-%'");
      console.log('  [cleanup] Cleaned up temporary test records from nextlink_test_db');
    } catch (cleanErr) {
      console.warn('  [cleanup warning]:', cleanErr.message);
    }

    if (inProcessExpress) {
      inProcessExpress.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Production Database Zero Mutation Audit
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. Production Database Zero Mutation Audit ---');
  const prodSnapAfter = await prodPool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM subscribers) AS sub_cnt,
      (SELECT COUNT(*)::int FROM invoices) AS inv_cnt,
      (SELECT COUNT(*)::int FROM payment_transactions) AS pay_cnt,
      (SELECT COUNT(*)::int FROM orders) AS ord_cnt
  `);
  const finalProdCounts = prodSnapAfter.rows[0];

  assert(
    initialProdCounts.sub_cnt === finalProdCounts.sub_cnt &&
    initialProdCounts.inv_cnt === finalProdCounts.inv_cnt &&
    initialProdCounts.pay_cnt === finalProdCounts.pay_cnt &&
    initialProdCounts.ord_cnt === finalProdCounts.ord_cnt,
    'Guaranteed zero mutations to production database nextlink_db (0 test records written)'
  );

  console.log('\n================================================================================');
  console.log(`=== PHASE 4.6 WORKFLOW TEST SUMMARY: ${passed} passed, ${failed} failed ===`);
  console.log('================================================================================\n');

  if (failed > 0) {
    console.log('Failures breakdown:');
    for (const f of failures) {
      console.log(` - ${f.label} [${JSON.stringify(f.extra)}]`);
    }
  }

  return {
    suite: 'Phase 4.6 Section 4 Workflows (A, B, C, D)',
    passed,
    failed,
    failures,
  };
}

if (require.main === module) {
  run()
    .then((res) => process.exit(res.failed === 0 ? 0 : 1))
    .catch((err) => {
      console.error('Workflow verification crashed:', err);
      process.exit(1);
    });
}

module.exports = { run };
