'use strict';

/**
 * Restore the DEMO environment to a healthy state.
 *
 * Every test in this suite triggers the overdue sweep, which suspends every
 * past-due account — that is what the sweep is for. The seeded demo data is
 * all past-due, so running the suites suspends the whole demo population.
 * This script resets the demo subscribers to active so the dashboard, the
 * portal and the billing screens show a live operator, not an ISP where
 * everything is disconnected.
 *
 * It only flips status flags: no invoice, ticket or payment record is
 * altered. It is idempotent.
 *
 * Run with:  node scripts/restore-demo-state.js
 */

const db = require('../src/lib/db');
const logger = require('../src/lib/logger');

const SUBSCRIBERS_SQL = `
  UPDATE subscribers
     SET status = 'active',
         raw_data = COALESCE(raw_data, '{}'::jsonb) || '{"status":"active"}'::jsonb,
         updated_at = NOW()
   WHERE status = 'suspended'
`;

const BILLING_SQL = `
  UPDATE subscriber_billing
     SET status = 'active',
         updated_at = NOW()
   WHERE status = 'suspended'
`;

async function run() {
  const subscribers = await db.query(SUBSCRIBERS_SQL);
  const billing = await db.query(BILLING_SQL);

  const counts = await db.query(
    `SELECT status, COUNT(*)::int AS count FROM subscribers GROUP BY status ORDER BY status`,
  );
  logger.info('demo state restored', {
    subscribers: subscribers.rowCount,
    billing: billing.rowCount,
    active: counts.rows.find((r) => r.status === 'active')?.count || 0,
  });

  console.log('');
  console.log(`Restored ${subscribers.rowCount} subscriber(s) and ${billing.rowCount} billing profile(s) to active.`);
  console.log('Note: the next overdue sweep (03:00 daily) or the next test run will re-suspend them,');
  console.log('because the seeded demo invoices are all past due — that is the sweep doing its job.');
}

run()
  .then(async () => {
    await db.close();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error('demo restore failed', { message: error.message });
    await db.close();
    process.exit(1);
  });
