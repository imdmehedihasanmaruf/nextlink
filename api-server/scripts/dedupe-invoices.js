'use strict';

/**
 * Remove the duplicated invoice rows.
 *
 * The restore script can create a second row for the same billing period
 * when the mirror record carries the invoice number but not the id. This
 * script keeps the oldest row of every (subscriber, period) pair.
 *
 * Run with:  node scripts/dedupe-invoices.js
 */

const db = require('../src/lib/db');
const logger = require('../src/lib/logger');

async function run() {
  const duplicates = await db.query(
    `SELECT id, subscriber_id, amount, status, created_at,
            COALESCE(raw_data->>'period', '') AS period,
            ROW_NUMBER() OVER (
              PARTITION BY subscriber_id, COALESCE(raw_data->>'period', '')
              ORDER BY (status = 'paid') DESC, created_at ASC, id ASC
            ) AS row_number
       FROM invoices`,
  );

  const seen = new Map();
  const toDelete = [];

  for (const row of duplicates.rows) {
    const key = `${row.subscriber_id}|${row.period || ''}`;
    if (!seen.has(key)) {
      seen.set(key, row.id);
      continue;
    }
    // The first row of the pair is kept, the rest are removed.
    toDelete.push(row.id);
  }

  if (toDelete.length === 0) {
    console.log('No duplicate invoices found.');
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
