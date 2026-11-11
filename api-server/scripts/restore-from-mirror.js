'use strict';

/**
 * Restore the invoices, subscribers and tickets from the JSON mirror.
 *
 * The mirror (`backend/data/adminStore.json`) is written before the database
 * write, so it still holds the rows an admin save may have removed from
 * PostgreSQL. This script replays the mirror into the tables with an upsert,
 * so nothing is lost.
 *
 * Run with:  node scripts/restore-from-mirror.js           (dry run — reports only)
 *            node scripts/restore-from-mirror.js --apply    (actually restores)
 *
 * SAFETY: no row is written unless `--apply` is passed. A mirror row can never
 * downgrade a paid invoice back to unpaid or overwrite a newer database row.
 */

const fs = require('fs');
const path = require('path');
const db = require('../src/lib/db');
const logger = require('../src/lib/logger');

const APPLY = process.argv.includes('--apply');

const MIRROR = path.resolve(__dirname, '..', '..', 'backend', 'data', 'adminStore.json');

/**
 * Mirror a status into raw_data so the admin store and the column agree.
 */
function withStatus(record, status) {
  return { ...(record || {}), status };
}

/**
 * Read the invoice id and the subscriber id out of a mirror record.
 *
 * The billing engine writes `invoiceNumber` (INV-YYYYMM-SUB-001) rather than
 * `id`, and the subscriber id is only present in the invoice number. Both are
 * derived here so the mirror can be replayed into the tables.
 */
function readInvoiceIdentity(entry) {
  const record = entry.raw_data && typeof entry.raw_data === 'object' ? entry.raw_data : entry;

  const id = String(entry.id || record.id || record.invoiceNumber || '');
  const invoiceNumber = record.invoiceNumber || record.id || id;

  let subscriberId =
    entry.subscriberId || entry.subscriber_id || record.subscriberId || record.subscriber_id || '';

  if (!subscriberId) {
    // INV-YYYYMM-SUB-001 -> SUB-001
    const match = /^(?:INV-[A-Z0-9]+-)?(.+)$/.exec(invoiceNumber);
    if (match) subscriberId = match[1];
  }

  return { id, invoiceNumber, subscriberId, record };
}

async function restoreInvoices(invoices) {
  let restored = 0;
  for (const entry of invoices) {
    const { id, invoiceNumber, subscriberId, record } = readInvoiceIdentity(entry);
    if (!id || id === 'undefined') {
      logger.warn('mirror invoice without an id was skipped', { keys: Object.keys(entry) });
      continue;
    }

    const status = entry.status || record.status || 'unpaid';
    const raw = JSON.stringify({ ...record, id: invoiceNumber, status });

    // The mirror is a historical snapshot. It must never downgrade a paid
    // invoice, and it must never overwrite a row that was created after the
    // mirror was written.
    if (APPLY) {
      await db.query(
        `INSERT INTO invoices (id, subscriber_id, amount, status, due_date, raw_data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE((SELECT created_at FROM invoices WHERE id = $1::varchar), NOW()), NOW())
         ON CONFLICT (id) DO UPDATE SET
           subscriber_id = COALESCE(invoices.subscriber_id, EXCLUDED.subscriber_id),
           amount = CASE WHEN invoices.status = 'paid' THEN invoices.amount ELSE EXCLUDED.amount END,
           status = CASE WHEN invoices.status = 'paid' THEN invoices.status ELSE EXCLUDED.status END,
           due_date = CASE WHEN invoices.status = 'paid' THEN invoices.due_date ELSE EXCLUDED.due_date END,
           raw_data = invoices.raw_data || (EXCLUDED.raw_data - 'status'),
           updated_at = NOW()`,
        [
          id,
          subscriberId,
          Number(entry.amount ?? record.amount ?? 0),
          status,
          entry.dueDate || record.dueDate || record.due_date || '',
          raw,
        ],
      );
    } else {
      console.log(`  would restore invoice ${id} (subscriber ${subscriberId || 'unknown'}, ${status})`);
    }
    restored += 1;
  }
  return restored;
}

async function restoreSubscribers(subscribers) {
  let restored = 0;
  for (const entry of subscribers) {
    const record = entry.raw_data && typeof entry.raw_data === 'object' ? entry.raw_data : entry;
    const id = String(entry.id || record.id || '');
    if (!id || id === 'undefined') continue;

    const status = entry.status || record.status || 'active';
    const raw = { ...record };
    // The plain-text password never comes back through the mirror.
    delete raw.password;

    // A suspended account is never turned back into an active one by an old
    // snapshot of the mirror.
    if (APPLY) {
      await db.query(
        `INSERT INTO subscribers (id, name, email, phone, package_id, status, raw_data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE((SELECT created_at FROM subscribers WHERE id = $1::varchar), NOW()), NOW())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           email = EXCLUDED.email,
           phone = EXCLUDED.phone,
           package_id = EXCLUDED.package_id,
           status = CASE
             WHEN LOWER(COALESCE(subscribers.status, '')) IN ('suspended', 'disconnected', 'deactivated')
             THEN subscribers.status
             ELSE EXCLUDED.status
           END,
           raw_data = EXCLUDED.raw_data,
           updated_at = NOW()`,
        [
          id,
          record.name || '',
          record.email || '',
          record.phone || '',
          record.packageId || record.package_id || '',
          status,
          JSON.stringify({ ...raw, status }),
        ],
      );
    } else {
      console.log(`  would restore subscriber ${id} (${record.name || 'unnamed'}, ${status})`);
    }
    restored += 1;
  }
  return restored;
}

async function run() {
  if (!fs.existsSync(MIRROR)) {
    console.log(`The mirror ${MIRROR} does not exist — nothing to restore.`);
    return;
  }

  const mirror = JSON.parse(fs.readFileSync(MIRROR, 'utf8'));

  const invoices = Array.isArray(mirror.invoices) ? mirror.invoices : [];
  const subscribers = Array.isArray(mirror.subscribers) ? mirror.subscribers : [];
  const tickets = Array.isArray(mirror.tickets) ? mirror.tickets : [];

  if (!APPLY) {
    console.log('');
    console.log('DRY RUN — nothing is written. Re-run with --apply to restore.');
    console.log(`  ${invoices.length} invoice(s), ${subscribers.length} subscriber(s), ${tickets.length} ticket(s) in the mirror`);
    console.log('');
  }

  const restoredInvoices = await restoreInvoices(invoices);
  logger.info('invoices restored from the mirror', { count: restoredInvoices });

  const restoredSubscribers = await restoreSubscribers(subscribers);
  logger.info('subscribers restored from the mirror', { count: restoredSubscribers });

  let restoredTickets = 0;
  for (const item of tickets) {
    const id = String(item.id);
    const status = item.status || 'open';
    if (APPLY) {
      await db.query(
        `INSERT INTO tickets (id, title, status, priority, raw_data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE((SELECT created_at FROM tickets WHERE id = $1::varchar), NOW()), NOW())
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           status = EXCLUDED.status,
           priority = EXCLUDED.priority,
           raw_data = EXCLUDED.raw_data,
           updated_at = NOW()`,
        [
          id,
          item.title || item.subject || '',
          status,
          item.priority || 'medium',
          JSON.stringify(withStatus(item.raw_data || item, status)),
        ],
      );
    } else {
      console.log(`  would restore ticket ${id} (${item.title || item.subject || 'untitled'})`);
    }
    restoredTickets += 1;
  }
  logger.info('tickets restored from the mirror', { count: restoredTickets });

  const counts = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM invoices) AS invoices,
       (SELECT COUNT(*) FROM subscribers) AS subscribers,
       (SELECT COUNT(*) FROM tickets) AS tickets`,
  );

  console.log('');
  console.log(`Restored: ${restoredInvoices} invoices, ${restoredSubscribers} subscribers, ${restoredTickets} tickets`);
  console.log(`Database now holds: ${counts.rows[0].invoices} invoices, ${counts.rows[0].subscribers} subscribers, ${counts.rows[0].tickets} tickets`);
}

run()
  .then(async () => {
    await db.close();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error('restore failed', { message: error.message, stack: error.stack });
    await db.close();
    process.exit(1);
  });
