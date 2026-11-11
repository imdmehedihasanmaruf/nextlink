'use strict';

/**
 * Remove the duplicated invoice rows.
 *
 * The restore script can create a second row for the same billing period
 * when the mirror record carries the invoice number but not the id. This
 * script keeps the oldest row of every (subscriber, period) pair.
 *
 * SAFETY: this script deletes rows. By default it only REPORTS what it would
 * delete. Nothing is deleted unless `--apply` is passed. The duplicate key is
 * (subscriber_id, period), except that an empty subscriber id falls back to
 * the invoice id — otherwise every invoice with a blank subscriber id (35 of
 * 71 in the live database) would collapse into one group and an arbitrary
 * paid invoice would be deleted.
 *
 * Run with:  node scripts/dedupe-invoices.js           (report only)
 *            node scripts/dedupe-invoices.js --apply    (actually delete)
 */

const db = require('../src/lib/db');
const logger = require('../src/lib/logger');

const APPLY = process.argv.includes('--apply');

async function run() {
  const duplicates = await db.query(
    `SELECT id, subscriber_id, amount, status, created_at,
            COALESCE(raw_data->>'period', '') AS period
       FROM invoices`,
  );

  // An invoice without a subscriber id could belong to anyone, so it is never
  // grouped with another invoice. Its id is used as the key instead, which
  // means such an invoice is never a "duplicate".
  const seen = new Map();
  const toDelete = [];

  // A paid invoice always wins over an unpaid one of the same period.
  const rows = [...duplicates.rows].sort((a, b) => {
    const aPaid = a.status === 'paid' ? 0 : 1;
    const bPaid = b.status === 'paid' ? 0 : 1;
    if (aPaid !== bPaid) return aPaid - bPaid;
    return new Date(a.created_at) - new Date(b.created_at);
  });

  for (const row of rows) {
    const key =
      row.subscriber_id && row.subscriber_id !== ''
        ? `${row.subscriber_id}|${row.period || ''}`
        : `invoice|${row.id}`;
    if (!seen.has(key)) {
      seen.set(key, row.id);
      continue;
    }
    toDelete.push(row.id);
  }

  if (toDelete.length === 0) {
    console.log('No duplicate invoices found.');
    return;
  }

  console.log('');
  console.log(`The following ${toDelete.length} invoice row(s) would be deleted:`);
  for (const id of toDelete) console.log(`  ${id}`);

  if (!APPLY) {
    console.log('');
    console.log('Nothing was deleted. Re-run with --apply to delete them.');
    return;
  }

  await db.query('DELETE FROM invoices WHERE id = ANY($1::varchar[])', [toDelete]);
  logger.info('duplicate invoices removed', { count: toDelete.length });

  const counts = await db.query(
    `SELECT status, COUNT(*)::int AS count FROM invoices GROUP BY status ORDER BY status`,
  );
  console.log('');
  console.log(`Removed ${toDelete.length} duplicate invoice(s).`);
  counts.rows.forEach((row) => console.log(`  ${row.status}: ${row.count}`));
}

run()
  .then(async () => {
    await db.close();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error('dedupe failed', { message: error.message });
    await db.close();
    process.exit(1);
  });
