'use strict';

/**
 * Backfill the mirrored status fields.
 *
 * The billing engine writes the status to the column, and the legacy admin
 * store rebuilds the table from `raw_data`. Both places have to agree, so the
 * status is mirrored into `raw_data` for every row that predates the change.
 *
 * Run with:  node scripts/backfill-status.js
 */

const db = require('../src/lib/db');
const logger = require('../src/lib/logger');

async function run() {
  const invoices = await db.query(
    `UPDATE invoices
        SET raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object('status', status::text),
            updated_at = NOW()
      WHERE COALESCE(raw_data->>'status', '') IS DISTINCT FROM status
      RETURNING id`,
  );
  logger.info('invoice status mirrored into raw_data', { rows: invoices.rowCount });

  const subscribers = await db.query(
    `UPDATE subscribers
        SET raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object('status', status::text),
            updated_at = NOW()
      WHERE COALESCE(raw_data->>'status', '') IS DISTINCT FROM status
      RETURNING id`,
  );
  logger.info('subscriber status mirrored into raw_data', { rows: subscribers.rowCount });

  const tickets = await db.query(
    `UPDATE tickets
        SET raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object('status', status::text),
            updated_at = NOW()
      WHERE COALESCE(raw_data->>'status', '') IS DISTINCT FROM status
      RETURNING id`,
  );
  logger.info('ticket status mirrored into raw_data', { rows: tickets.rowCount });

  // The plain-text password must not come back through the admin store.
  const passwords = await db.query(
    `UPDATE subscribers
        SET raw_data = jsonb_set(COALESCE(raw_data, '{}'::jsonb), '{password}', '""'::jsonb, true),
            updated_at = NOW()
      WHERE COALESCE(raw_data->>'password', '') <> ''
      RETURNING id`,
  );
  logger.info('plain-text passwords removed from raw_data', { rows: passwords.rowCount });

  console.log('');
  console.log(`Mirrored: ${invoices.rowCount} invoices, ${subscribers.rowCount} subscribers, ${tickets.rowCount} tickets`);
  console.log(`Plain-text passwords removed: ${passwords.rowCount}`);
}

run()
  .then(async () => {
    await db.close();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error('backfill failed', { message: error.message, stack: error.stack });
    await db.close();
    process.exit(1);
  });
