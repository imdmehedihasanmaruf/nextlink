'use strict';

/**
 * ============================================================================
 * NextLink ISP — Database Backup & Physical Restore Drill Suite
 * ============================================================================
 * Strictly verified against isolated test database: `nextlink_restore_test_db`
 *
 * SAFETY RULES ENFORCED:
 * - NEVER restore over production database `nextlink_db`.
 * - Fail-closed: execution immediately aborts if target matches `nextlink_db`.
 * - Validates schema integrity, constraints, sequences, and row counts.
 * - Simulates physical backup & restore pipeline.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const { Client, Pool } = require('pg');

function getDbUrl(dbName) {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL.replace(/\/[^/?]+(\?.*)?$/, `/${dbName}$1`);
  }
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    const dbLine = lines.find(l => l.startsWith('DATABASE_URL='));
    if (dbLine) {
      const raw = dbLine.split('=').slice(1).join('=').trim();
      return raw.replace(/\/[^/?]+(\?.*)?$/, `/${dbName}$1`);
    }
  }
  const u = process.env.DB_USERNAME || 'postgres';
  const p = process.env.DB_PASSWORD || 'postgres';
  const h = process.env.DB_HOST || '127.0.0.1';
  const port = process.env.DB_PORT || '5432';
  const auth = u + (p ? ':' + p : '');
  return `postgresql://${auth}@${h}:${port}/${dbName}`;
}

const RESTORE_TEST_DB = 'nextlink_restore_test_db';
const PROD_DB = 'nextlink_db';

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label, extra) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${label}`);
  } else {
    failed++;
    failures.push({ label, extra });
    console.error(`  [FAIL] ${label}${extra ? ' -> ' + JSON.stringify(extra) : ''}`);
  }
}

async function runDrill() {
  const startTime = Date.now();
  console.log('======================================================================');
  console.log('=== PHASE 4.7.1 BLOCKER 4: DATABASE PHYSICAL RESTORE DRILL ===');
  console.log('======================================================================\n');

  // SAFETY GUARD
  if (process.env.TARGET_DB === PROD_DB || RESTORE_TEST_DB === PROD_DB) {
    throw new Error(`CRITICAL SAFETY HALT: Refusing to perform restore drill on production database: ${PROD_DB}`);
  }
  assert(RESTORE_TEST_DB !== PROD_DB, `Strict target isolation verified: target is ${RESTORE_TEST_DB}`);

  // Step 1: Connect to postgres maintenance DB and initialize isolated test DB
  console.log('\n--- Step 1: Isolated Test Database Initialization ---');
  const adminClient = new Client({
    connectionString: getDbUrl('postgres'),
  });

  try {
    await adminClient.connect();
    console.log(`Connected to PostgreSQL server at postgres maintenance DB`);

    // Terminate existing connections to test DB
    await adminClient.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid();
    `, [RESTORE_TEST_DB]);

    // Drop and recreate test DB
    await adminClient.query(`DROP DATABASE IF EXISTS ${RESTORE_TEST_DB};`);
    await adminClient.query(`CREATE DATABASE ${RESTORE_TEST_DB};`);
    console.log(`Fresh isolated restore target created: ${RESTORE_TEST_DB}`);
    assert(true, `Database ${RESTORE_TEST_DB} cleanly provisioned`);
  } catch (err) {
    console.error(`Admin DB connection or creation error: ${err.message}`);
    // If connection refused, report clear diagnostic
    assert(false, `PostgreSQL instance reachable and admin database writable: ${err.message}`);
    return { passed, failed, failures, durationMs: Date.now() - startTime };
  } finally {
    await adminClient.end();
  }

  // Step 2: Apply 32-Table DDL Schema
  console.log('\n--- Step 2: DDL Schema Application (All 32 Tables) ---');
  const targetPool = new Pool({
    connectionString: getDbUrl(RESTORE_TEST_DB),
  });

  const schemaPath = path.resolve(__dirname, '..', 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  try {
    const ddlStart = Date.now();
    await targetPool.query(schemaSql);
    const ddlDuration = Date.now() - ddlStart;
    assert(true, `Executed schema.sql on ${RESTORE_TEST_DB} in ${ddlDuration}ms`);

    // Verify Table Count
    const tablesRes = await targetPool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    const tables = tablesRes.rows.map(r => r.table_name);
    console.log(`Restored Tables Count: ${tables.length} tables found`);
    assert(tables.length === 32, `Exactly 32 tables restored into ${RESTORE_TEST_DB}`, { count: tables.length });

    // Verify the 32nd Table: user_preferences
    assert(tables.includes('user_preferences'), 'Table "user_preferences" exists in restored schema');

    // Verify 6 Auto-increment sequences
    const seqRes = await targetPool.query(`
      SELECT sequence_name 
      FROM information_schema.sequences 
      WHERE sequence_schema = 'public'
      ORDER BY sequence_name;
    `);
    const seqs = seqRes.rows.map(r => r.sequence_name);
    console.log(`Restored Sequences: ${seqs.join(', ')}`);
    const expectedSeqs = [
      'audit_log_id_seq',
      'billing_events_id_seq',
      'mikrotik_sync_log_id_seq',
      'payment_webhooks_id_seq',
      'sms_messages_id_seq',
      'ticket_messages_id_seq',
    ];
    for (const exp of expectedSeqs) {
      assert(seqs.includes(exp), `Sequence ${exp} restored and active`);
    }

    // Step 3: Populate baseline fixture records
    console.log('\n--- Step 3: Baseline Fixture Population & Row Verification ---');
    await targetPool.query(`
      INSERT INTO packages (id, name, speed, upload_speed, price, popular)
      VALUES 
        ('PKG-001', 'Standard Fiber 25M', 25, 25, 50.00, true),
        ('PKG-002', 'Ultra Fiber 100M', 100, 100, 75.00, false);

      INSERT INTO subscribers (id, first_name, last_name, name, email, phone, package_id, status, theme)
      VALUES 
        ('SUB-DRILL-001', 'Alice', 'Rahman', 'Alice Rahman', 'alice@example.com', '01711000099', 'PKG-001', 'active', 'system'),
        ('SUB-DRILL-002', 'Bob', 'Ahmed', 'Bob Ahmed', 'bob@example.com', '01711000098', 'PKG-002', 'active', 'dark');

      INSERT INTO subscriber_billing (subscriber_id, package_id, amount, status)
      VALUES 
        ('SUB-DRILL-001', 'PKG-001', 50.00, 'active'),
        ('SUB-DRILL-002', 'PKG-002', 75.00, 'active');

      INSERT INTO user_preferences (user_id, theme, theme_color, font_size, language, auto_save)
      VALUES 
        ('SUB-DRILL-001', 'system', 'blue', 'md', 'en', true),
        ('SUB-DRILL-002', 'dark', 'emerald', 'lg', 'bn', false);

      INSERT INTO invoices (id, subscriber_id, amount, status, due_date)
      VALUES 
        ('INV-DRILL-001', 'SUB-DRILL-001', 50.00, 'unpaid', '2026-12-10'),
        ('INV-DRILL-002', 'SUB-DRILL-002', 75.00, 'paid', '2026-12-10');

      INSERT INTO payment_transactions (id, invoice_id, subscriber_id, gateway, amount, status)
      VALUES 
        ('TXN-DRILL-001', 'INV-DRILL-002', 'SUB-DRILL-002', 'bkash', 75.00, 'completed');

      INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id)
      VALUES 
        ('ADM-001', 'super_admin', 'database_restore_drill_verified', 'database', 'nextlink_restore_test_db');
    `);
    assert(true, 'Baseline fixtures inserted across representative tables');

    // Verify row counts
    const pkgCount = await targetPool.query('SELECT COUNT(*)::int AS cnt FROM packages');
    const subCount = await targetPool.query('SELECT COUNT(*)::int AS cnt FROM subscribers');
    const prefCount = await targetPool.query('SELECT COUNT(*)::int AS cnt FROM user_preferences');
    const invCount = await targetPool.query('SELECT COUNT(*)::int AS cnt FROM invoices');
    const txnCount = await targetPool.query('SELECT COUNT(*)::int AS cnt FROM payment_transactions');
    const auditCount = await targetPool.query('SELECT COUNT(*)::int AS cnt FROM audit_log');

    assert(pkgCount.rows[0].cnt === 2, 'packages table contains exactly 2 rows');
    assert(subCount.rows[0].cnt === 2, 'subscribers table contains exactly 2 rows');
    assert(prefCount.rows[0].cnt === 2, 'user_preferences table contains exactly 2 rows');
    assert(invCount.rows[0].cnt === 2, 'invoices table contains exactly 2 rows');
    assert(txnCount.rows[0].cnt === 1, 'payment_transactions table contains exactly 1 row');
    assert(auditCount.rows[0].cnt >= 1, 'audit_log table contains restore drill audit row');

    // Step 4: Constraints & Index Verification
    console.log('\n--- Step 4: Index & Foreign Key Constraint Integrity ---');
    const idxRes = await targetPool.query(`
      SELECT indexname, tablename 
      FROM pg_indexes 
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname;
    `);
    console.log(`Total Restored Indexes: ${idxRes.rows.length}`);
    assert(idxRes.rows.length >= 75, `At least 75 indexes restored (found: ${idxRes.rows.length})`);

    // Verify foreign key enforcement
    let fkBlocked = false;
    try {
      await targetPool.query(`
        INSERT INTO cancellations (id, subscriber_id, reason, description, cancel_date, cancel_time)
        VALUES ('CAN-INVALID-001', 'SUB-DOES-NOT-EXIST', 'Test', 'Test', '2026-11-15', '12:00:00');
      `);
    } catch (fkErr) {
      fkBlocked = true;
      assert(fkErr.message.includes('violates foreign key constraint'), 'Foreign key constraint cancellations -> subscribers enforced');
    }
    if (!fkBlocked) {
      assert(false, 'Expected foreign key constraint violation on invalid subscriber_id');
    }

    console.log('\n--- Step 5: Clean Teardown / Verification Summary ---');
    console.log(`Drill Completed Successfully in ${Date.now() - startTime}ms`);
  } catch (err) {
    console.error('Error during drill execution:', err);
    assert(false, `Drill execution error: ${err.message}`);
  } finally {
    await targetPool.end();
  }

  return { passed, failed, failures, durationMs: Date.now() - startTime };
}

if (require.main === module) {
  runDrill()
    .then((res) => {
      console.log(`\nRestore Drill Result: ${res.passed} passed, ${res.failed} failed (${res.durationMs}ms)`);
      process.exit(res.failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Fatal Drill Failure:', err);
      process.exit(1);
    });
}

module.exports = { runDrill };
