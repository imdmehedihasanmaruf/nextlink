'use strict';

/**
 * Phase 4.3.2 — Isolated PostgreSQL Test Database Provisioner & Baseline Auditor
 *
 * 1. Records exact baseline row counts in `nextlink_db` (READ-ONLY on `nextlink_db`).
 * 2. Creates `nextlink_test_db` if it does not exist.
 * 3. Applies `backend/api/schema.sql` to `nextlink_test_db`.
 * 4. Clones all baseline rows from `nextlink_db` into `nextlink_test_db` in FK-safe order
 *    without altering or deleting any row in `nextlink_db`.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('../src/config');

const ORDERED_TABLES = [
  'roles',
  'packages',
  'admin_users',
  'api_users',
  'app_settings',
  'system_settings',
  'coverage_areas',
  'technicians',
  'network_devices',
  'subscribers',
  'subscriber_credentials',
  'subscriber_billing',
  'user_preferences',
  'connection_requests',
  'orders',
  'invoices',
  'cancellations',
  'billing_cycles',
  'payment_transactions',
  'payment_webhooks',
  'billing_events',
  'tickets',
  'ticket_details',
  'ticket_messages',
  'mikrotik_sync_log',
  'sms_messages',
  'referral_codes',
  'referrals',
  'referral_rewards',
  'turbo_boost_requests',
  'notifications',
  'audit_log',
];

const KEY_BASELINE_TABLES = [
  'packages',
  'subscribers',
  'subscriber_credentials',
  'subscriber_billing',
  'connection_requests',
  'coverage_areas',
  'orders',
  'invoices',
  'cancellations',
  'tickets',
  'billing_events',
  'audit_log',
];

function getTestConnectionString(prodConnStr) {
  const url = new URL(prodConnStr);
  url.pathname = '/nextlink_test_db';
  return url.toString();
}

async function getRowCounts(pool, tables) {
  const counts = {};
  for (const tbl of tables) {
    const reg = await pool.query(`SELECT to_regclass($1) AS oid`, [`public.${tbl}`]);
    if (!reg.rows[0] || !reg.rows[0].oid) {
      counts[tbl] = null;
      continue;
    }
    const res = await pool.query(`SELECT COUNT(*)::int AS cnt FROM "${tbl}"`);
    counts[tbl] = res.rows[0].cnt;
  }
  return counts;
}

async function setupTestDatabase({ reset = false } = {}) {
  const prodConnStr = config.db.connectionString;
  const testConnStr = getTestConnectionString(prodConnStr);

  const prodPool = new Pool({ connectionString: prodConnStr, max: 4 });

  try {
    // 1. Record baseline counts in nextlink_db (strictly read-only)
    const baselineCounts = await getRowCounts(prodPool, ORDERED_TABLES);

    // 2. Create nextlink_test_db if it does not exist
    const dbCheck = await prodPool.query(
      `SELECT 1 FROM pg_database WHERE datname = 'nextlink_test_db'`
    );
    const createdNew = dbCheck.rowCount === 0;
    if (createdNew) {
      await prodPool.query(`CREATE DATABASE nextlink_test_db`);
    }

    const testPool = new Pool({ connectionString: testConnStr, max: 4 });
    try {
      // 3. Apply schema.sql to nextlink_test_db
      const schemaPath = path.join(__dirname, '..', 'schema.sql');
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await testPool.query(schemaSql);

      // Ensure user_preferences table also exists in nextlink_test_db
      await testPool.query(`
        CREATE TABLE IF NOT EXISTS user_preferences (
          user_id VARCHAR(100) PRIMARY KEY,
          theme VARCHAR(30) DEFAULT 'system',
          theme_color VARCHAR(50) DEFAULT 'blue',
          font_size VARCHAR(30) DEFAULT 'medium',
          language VARCHAR(20) DEFAULT 'en',
          auto_save BOOLEAN DEFAULT TRUE,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      if (reset) {
        const truncateList = ORDERED_TABLES.slice().reverse().map((t) => `"${t}"`).join(', ');
        await testPool.query(`TRUNCATE TABLE ${truncateList} RESTART IDENTITY CASCADE`);
      }

      // 4. Clone rows from nextlink_db into nextlink_test_db in FK order
      for (const tbl of ORDERED_TABLES) {
        const colTypeRes = await prodPool.query(
          `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
          [tbl]
        );
        const jsonCols = new Set(
          colTypeRes.rows
            .filter((r) => r.data_type === 'jsonb' || r.data_type === 'json')
            .map((r) => r.column_name)
        );

        const prodRowsRes = await prodPool.query(`SELECT * FROM "${tbl}"`);
        const rows = prodRowsRes.rows;
        if (!rows || rows.length === 0) continue;

        const cols = Object.keys(rows[0]);
        const colList = cols.map((c) => `"${c}"`).join(', ');

        for (const row of rows) {
          const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(', ');
          const values = cols.map((c) => {
            const val = row[c];
            if (val !== null && jsonCols.has(c)) {
              return typeof val === 'string' ? val : JSON.stringify(val);
            }
            return val;
          });
          await testPool.query(
            `INSERT INTO "${tbl}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
            values
          );
        }
      }

      // Fix sequences for all tables with serial columns in nextlink_test_db
      const serialTables = [
        'audit_log',
        'billing_events',
        'payment_transactions',
        'payment_webhooks',
        'tickets',
        'ticket_details',
        'ticket_messages',
        'sms_messages',
        'notifications',
        'referrals',
        'referral_rewards',
        'turbo_boost_requests',
      ];
      for (const t of serialTables) {
        await testPool.query(`
          DO $$
          DECLARE
            seq text;
            max_val bigint;
          BEGIN
            seq := pg_get_serial_sequence('${t}', 'id');
            IF seq IS NOT NULL THEN
              EXECUTE format('SELECT COALESCE(MAX(id), 0) FROM %I', '${t}') INTO max_val;
              IF max_val > 0 THEN
                PERFORM setval(seq, max_val, true);
              END IF;
            END IF;
          END $$;
        `).catch(() => {});
      }

      const testCounts = await getRowCounts(testPool, ORDERED_TABLES);
      const afterProdCounts = await getRowCounts(prodPool, ORDERED_TABLES);

      const report = {
        timestamp: new Date().toISOString(),
        createdNewDatabase: createdNew,
        keyTablesBaseline: Object.fromEntries(
          KEY_BASELINE_TABLES.map((t) => [
            t,
            {
              nextlink_db_before: baselineCounts[t],
              nextlink_db_after: afterProdCounts[t],
              nextlink_test_db: testCounts[t],
            },
          ])
        ),
        allTablesBaseline: Object.fromEntries(
          ORDERED_TABLES.map((t) => [
            t,
            {
              nextlink_db: baselineCounts[t],
              nextlink_test_db: testCounts[t],
            },
          ])
        ),
      };

      const outPath = path.join(__dirname, 'test-db-baseline.json');
      fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
      return report;
    } finally {
      await testPool.end();
    }
  } finally {
    await prodPool.end();
  }
}

if (require.main === module) {
  const reset = process.argv.includes('--reset');
  setupTestDatabase({ reset })
    .then((report) => {
      console.log('[setup-test-db] Completed successfully.');
      console.log(JSON.stringify(report.keyTablesBaseline, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('[setup-test-db] Failed:', err.message);
      process.exit(1);
    });
}

module.exports = { setupTestDatabase, ORDERED_TABLES, KEY_BASELINE_TABLES, getTestConnectionString };
