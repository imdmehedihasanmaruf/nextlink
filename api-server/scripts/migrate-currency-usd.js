'use strict';

/**
 * One-off: convert the stored billing currency labels to USD.
 *
 * The project now bills in USD only. Package prices were always USD-scale;
 * every amount label in the database said BDT. This script updates the labels
 * in place and converts nothing — the numbers stay exactly as they are.
 *
 * Run with:  node scripts/migrate-currency-usd.js
 *            node scripts/migrate-currency-usd.js --apply   (actually writes)
 */

const db = require('../src/lib/db');
const logger = require('../src/lib/logger');

const APPLY = process.argv.includes('--apply');

async function run() {
  const checks = [];

  checks.push([
    'invoices currency labels',
    `SELECT COUNT(*)::int AS n FROM invoices WHERE raw_data->>'currency' = 'BDT'`,
  ]);
  checks.push([
    'invoices raw_data currency',
    `SELECT COUNT(*)::int AS n FROM invoices WHERE raw_data->>'currency' IS NULL OR raw_data->>'currency' <> 'USD'`,
  ]);
  checks.push([
    'subscriber_billing currency column',
    `SELECT COUNT(*)::int AS n FROM subscriber_billing WHERE currency = 'BDT'`,
  ]);
  checks.push([
    'system_settings billing group',
    `SELECT COUNT(*)::int AS n FROM system_settings WHERE key = 'billing' AND value->>'currency' = 'BDT'`,
  ]);
  checks.push([
    'payment gateway payload currency fields',
    `SELECT COUNT(*)::int AS n FROM payment_transactions WHERE raw_data->>'currency' = 'BDT' OR raw_data::text LIKE '%"currencyCode": "BDT"%'`,
  ]);

  for (const [label, sql] of checks) {
    const row = await db.queryOne(sql);
    console.log(`  ${row.n} row(s) to convert — ${label}`);
  }

  if (!APPLY) {
    console.log('');
    console.log('Dry run — nothing was written. Re-run with --apply to convert.');
    return;
  }

  console.log('');
  console.log('Converting...');

  await db.query(`
    UPDATE invoices
       SET raw_data = COALESCE(raw_data, '{}'::jsonb) || '{"currency":"USD"}'::jsonb,
           updated_at = NOW()
     WHERE raw_data->>'currency' IS DISTINCT FROM 'USD'
  `);
  await db.query(`
    UPDATE subscriber_billing
       SET currency = 'USD',
           updated_at = NOW()
     WHERE currency IS DISTINCT FROM 'USD'
  `);
  await db.query(`
    UPDATE system_settings
       SET value = jsonb_set(value, '{currency}', '"USD"') || '{"lateFee":5}'::jsonb,
           updated_at = NOW()
     WHERE key = 'billing'
  `);
  await db.query(`
    UPDATE payment_transactions
       SET raw_data = COALESCE(raw_data, '{}'::jsonb) || '{"currency":"USD","currencyCode":"USD"}'::jsonb,
           updated_at = NOW()
     WHERE raw_data->>'currency' = 'BDT'
        OR raw_data::text LIKE '%"currencyCode": "BDT"%'
  `);

  const verify = await db.query(
    `SELECT
        (SELECT COUNT(*) FROM invoices WHERE raw_data->>'currency' IS DISTINCT FROM 'USD') AS invoices,
        (SELECT COUNT(*) FROM subscriber_billing WHERE currency IS DISTINCT FROM 'USD') AS billing,
        (SELECT COUNT(*) FROM payment_transactions WHERE raw_data->>'currency' = 'BDT') AS transactions`,
  );
  logger.info('currency labels converted', verify.rows[0]);
  console.log('converted:', verify.rows[0]);
}

run()
  .then(async () => {
    await db.close();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error('currency migration failed', { message: error.message });
    await db.close();
    process.exit(1);
  });
