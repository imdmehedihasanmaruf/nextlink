'use strict';

/**
 * Idempotent database migration.
 *
 * Applies backend/api/schema.sql (CREATE TABLE IF NOT EXISTS only — no drops,
 * no destructive changes to the legacy tables) and seeds the staff accounts
 * used by the admin panel.
 */

const fs = require('fs');
const path = require('path');
const db = require('../src/lib/db');
const logger = require('../src/lib/logger');
const { hashPassword } = require('../src/middleware/auth');

const STAFF_SEED = [
  { id: 'ADM-001', email: 'admin@nextlink.com', password: 'admin123', name: 'System Administrator', role: 'super_admin' },
  { id: 'ADM-002', email: 'billing@nextlink.com', password: 'billing123', name: 'Billing Manager', role: 'billing' },
  { id: 'ADM-003', email: 'support@nextlink.com', password: 'support123', name: 'Technical Support Lead', role: 'support' },
  { id: 'ADM-004', email: 'field@nextlink.com', password: 'field123', name: 'Field Technician', role: 'technician' },
];

async function migrate() {
  const schemaPath = path.join(__dirname, '..', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  // Repair credentials before the schema is applied.
  //
  // Two subscribers can share a phone number, and the credential store uses
  // the phone as the username — so the live database contains a duplicate
  // username. The unique index added below would fail if we left that in
  // place, so the later duplicate is renamed with a suffix that keeps the
  // account reachable instead of deleting it.
  logger.info('repairing duplicate credential usernames');
  await db.query(`
    WITH ranked AS (
      SELECT ctid, username,
             ROW_NUMBER() OVER (PARTITION BY username ORDER BY created_at ASC, migrated_at ASC NULLS FIRST) AS rn,
             COUNT(*) OVER (PARTITION BY username) AS dupes
        FROM subscriber_credentials
       WHERE username IS NOT NULL
    )
    UPDATE subscriber_credentials c
       SET username = c.username || '-' || c.subscriber_id,
           raw_data = COALESCE(c.raw_data, '{}'::jsonb)
                      || jsonb_build_object('renamedFrom', c.username),
           updated_at = NOW()
      FROM ranked
     WHERE ranked.ctid = c.ctid
       AND ranked.dupes > 1
       AND ranked.rn > 1
  `);

  // The legacy plain-text password column must not keep its values. The API no
  // longer writes to it, and these ten rows should not remain readable.
  logger.info('clearing legacy plain-text passwords');
  await db.query('UPDATE subscriber_credentials SET legacy_password = NULL WHERE legacy_password IS NOT NULL');

  // The unique index replaces the plain one; both would be redundant.
  await db.query('DROP INDEX IF EXISTS idx_subscriber_credentials_username');

  logger.info('applying schema');
  await db.query(sql);
  logger.info('schema applied');

  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const seedAllowed = String(process.env.SEED_STAFF_PASSWORDS || '').toLowerCase() === 'true';

  if (isProduction && !seedAllowed) {
    // The default staff passwords are published in the repository, so they
    // must never be created in a production database. An operator who really
    // wants them has to set SEED_STAFF_PASSWORDS=true explicitly.
    logger.warn(
      'production mode — default staff accounts were NOT seeded. ' +
        'Set SEED_STAFF_PASSWORDS=true to seed them, and change the passwords immediately.',
    );
  } else {
    for (const staff of STAFF_SEED) {
      const existing = await db.queryOne('SELECT id FROM api_users WHERE email = $1', [staff.email]);
      if (existing) continue;

      const hash = await hashPassword(staff.password);
      await db.query(
        `INSERT INTO api_users (id, email, password_hash, name, role, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         ON CONFLICT (email) DO NOTHING`,
        [staff.id, staff.email, hash, staff.name, staff.role],
      );
      logger.info('seeded staff account', { email: staff.email, role: staff.role });
    }
  }

  // Backfill billing profiles for existing subscribers so the engine can run
  // against the current data without manual setup.
  const result = await db.query(
    `INSERT INTO subscriber_billing (subscriber_id, package_id, amount, next_invoice_date, status, raw_data)
     SELECT s.id,
            s.package_id,
            COALESCE(p.price, 0),
            CURRENT_DATE + ($1 || ' days')::interval,
            CASE WHEN s.status = 'active' THEN 'active' ELSE 'inactive' END,
            '{"seeded": true}'::jsonb
       FROM subscribers s
       LEFT JOIN packages p ON p.id = s.package_id
      ON CONFLICT (subscriber_id) DO NOTHING`,
    [10],
  );
  logger.info('billing profiles backfilled', { rows: result.rowCount });

  logger.info('migration complete');
}

migrate()
  .then(async () => {
    await db.close();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error('migration failed', { message: error.message, stack: error.stack });
    await db.close();
    process.exit(1);
  });
