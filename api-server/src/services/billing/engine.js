'use strict';

const config = require('../../config');
const logger = require('../../lib/logger');
const db = require('../../lib/db');
const utils = require('../../lib/utils');
const dates = require('../../lib/dates');
const mikrotik = require('../mikrotik');
const sms = require('../sms');

/**
 * Automated billing engine.
 *
 * Responsibilities:
 *   1. Generate the monthly invoice for every active subscriber (recurring).
 *   2. Send bill reminders (SMS) before and after the due date.
 *   3. Auto-suspend service (MikroTik PPPoE disable) when the bill stays
 *      unpaid past the grace period.
 *   4. Auto-restore service (MikroTik PPPoE enable) the moment payment lands.
 *
 * Invoices are written to the existing `invoices` table (so the current admin
 * panel keeps working) with the billing metadata stored in `raw_data` — the
 * column that `saveAdminSection` already round-trips. New bookkeeping lives in
 * the dedicated Phase 3 tables, so no legacy table schema is altered.
 */

const INVOICE_PREFIX = 'INV';

/**
 * Read the billing-relevant fields of a subscriber row.
 * The subscriber table stores extra fields inside `raw_data` JSONB.
 */
function readSubscriber(row) {
  const raw = row.raw_data || {};
  return {
    id: row.id,
    name: row.name || raw.name || '',
    phone: row.phone || raw.phone || '',
    email: row.email || raw.email || '',
    packageId: row.package_id || raw.packageId || '',
    packageName: raw.packageName || raw.package || '',
    status: row.status || 'active',
    balance: Number(raw.balance || 0),
    dueDate: raw.dueDate || '',
    pppoeUsername: raw.pppoeUsername || raw.username || raw.connectionUsername || '',
    pppoePassword: raw.pppoePassword || raw.connectionPassword || '',
    ipAddress: raw.ipAddress || '',
    macAddress: raw.macAddress || '',
    connectionType: raw.connectionType || 'pppoe',
    zone: raw.zone || '',
  };
}

/**
 * Ensure a billing profile row exists for a subscriber.
 */
async function ensureBillingProfile(subscriber, packagePrice) {
  const existing = await db.queryOne(
    'SELECT * FROM subscriber_billing WHERE subscriber_id = $1',
    [subscriber.id],
  );

  if (existing) {
    if (packagePrice !== undefined && Number(existing.amount) !== Number(packagePrice)) {
      await db.query(
        `UPDATE subscriber_billing SET amount = $2, package_id = $3, updated_at = NOW() WHERE subscriber_id = $1`,
        [subscriber.id, Number(packagePrice), subscriber.packageId || null],
      );
      existing.amount = Number(packagePrice);
    }
    return existing;
  }

  const created = await db.queryOne(
    `INSERT INTO subscriber_billing
       (subscriber_id, package_id, amount, currency, billing_start, next_invoice_date, auto_disconnect, status, raw_data)
     VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, TRUE, $6, $7)
     ON CONFLICT (subscriber_id) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [
      subscriber.id,
      subscriber.packageId || null,
      Number(packagePrice || 0),
      config.billing.currency,
      dates.addDays(new Date(), config.billing.dueDay),
      subscriber.status === 'active' ? 'active' : 'inactive',
      JSON.stringify({ createdBy: 'billing-engine' }),
    ],
  );
  return created;
}

/**
 * Get the package price for a subscriber (from the `packages` table).
 * @returns {Promise<number|null>} null when the package does not exist.
 */
async function getPackagePrice(packageId) {
  if (!packageId) return null;
  const row = await db.queryOne('SELECT price FROM packages WHERE id = $1', [packageId]);
  return row ? Number(row.price || 0) : null;
}

/**
 * Generate one invoice for a subscriber for a given period.
 *
 * Idempotent: re-running for the same period will not create duplicates.
 */
async function generateInvoice({ subscriber, period, amount, dueDate }) {
  const invoiceId = `${INVOICE_PREFIX}-${period.replace('-', '')}-${subscriber.id}`;
  const existing = await db.queryOne('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
  if (existing) {
    return { invoice: existing, created: false };
  }

  const rawData = {
    period,
    invoiceNumber: invoiceId,
    subscriberName: subscriber.name,
    subscriberPhone: subscriber.phone,
    packageId: subscriber.packageId,
    packageName: subscriber.packageName,
    amount: Number(amount),
    currency: config.billing.currency,
    dueDate,
    // The legacy admin store rewrites the whole invoices table from
    // `raw_data`, so the status has to live in both places. Without this the
    // admin panel would reset every invoice to "unpaid" on the next save.
    status: 'unpaid',
    generatedBy: 'billing-engine',
    generatedAt: utils.nowIso(),
    lateFee: 0,
    mikrotikUsername: subscriber.pppoeUsername || '',
  };

  const inserted = await db.queryOne(
    `INSERT INTO invoices (id, subscriber_id, amount, status, due_date, raw_data, created_at, updated_at)
     VALUES ($1, $2, $3, 'unpaid', $4, $5, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
        raw_data = invoices.raw_data || EXCLUDED.raw_data,
        updated_at = NOW()
     RETURNING *`,
    [invoiceId, subscriber.id, Number(amount), dueDate, JSON.stringify(rawData)],
  );

  if (inserted && !existing) {
    await db.query(
      `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message)
       VALUES ($1, $2, 'invoice_generated', $3, $4)`,
      [subscriber.id, invoiceId, Number(amount), `Invoice generated for ${period}`],
    );
    await db.query(
      `UPDATE subscriber_billing SET last_invoice_id = $2, updated_at = NOW() WHERE subscriber_id = $1`,
      [subscriber.id, invoiceId],
    );
  }

  return { invoice: inserted || existing, created: Boolean(inserted && !existing) };
}

/**
 * Run the monthly billing cycle.
 *
 * @param {object} options
 * @param {string} [options.period]  Period key, defaults to the current month.
 * @param {boolean} [options.dryRun]  Generate nothing, only report what would happen.
 */
async function runMonthlyCycle({ period = dates.currentPeriodKey(), dryRun = false } = {}) {
  const cycleId = `CYCLE-${period.replace('-', '')}`;
  const startedAt = new Date();

  logger.info('billing cycle started', { period, dryRun });

  if (!dryRun) {
    await db.query(
      `INSERT INTO billing_cycles (id, period, status, started_at)
       VALUES ($1, $2, 'running', NOW())
       ON CONFLICT (id) DO UPDATE SET status = 'running', started_at = NOW()`,
      [cycleId, period],
    );
  }

  const subscribersResult = await db.query(
    `SELECT * FROM subscribers WHERE status IN ('active', 'pending') ORDER BY id`,
  );

  const dueDate = `${period}-${String(config.billing.dueDay).padStart(2, '0')}`;
  let invoiceCount = 0;
  let createdCount = 0;
  let totalAmount = 0;
  const failures = [];
  const skipped = [];

  for (const row of subscribersResult.rows) {
    const subscriber = readSubscriber(row);
    if (!subscriber.packageId) {
      skipped.push({ subscriberId: subscriber.id, reason: 'no_package_assigned' });
      continue;
    }

    const price = await getPackagePrice(subscriber.packageId);
    if (price === null) {
      failures.push({ subscriberId: subscriber.id, reason: 'package_not_found' });
      continue;
    }
    if (price === 0) {
      // A zero-price package (free/trial tier) is legitimately not billable.
      skipped.push({ subscriberId: subscriber.id, reason: 'zero_price_package' });
      continue;
    }

    if (dryRun) {
      invoiceCount += 1;
      totalAmount += price;
      continue;
    }

    try {
      await ensureBillingProfile(subscriber, price);
      const { invoice, created } = await generateInvoice({
        subscriber,
        period,
        amount: price,
        dueDate,
      });

      // Count every invoice covered by this cycle, but only notify for the
      // ones that were newly created (re-runs stay idempotent).
      invoiceCount += 1;
      totalAmount += Number(invoice.amount || 0);

      if (created) {
        createdCount += 1;

        await sms.sendTemplate(
          'bill_reminder',
          {
            name: subscriber.name || 'Customer',
            phone: subscriber.phone,
            amount: utils.formatAmount(invoice.amount),
            dueDate,
            invoiceId: invoice.id,
          },
          { subscriberId: subscriber.id },
        );

        await db.query(
          `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message)
           VALUES ($1, $2, 'reminder_sent', $3, $4)`,
          [subscriber.id, invoice.id, Number(invoice.amount), `Reminder sent for ${period}`],
        );
      }
    } catch (error) {
      failures.push({ subscriberId: subscriber.id, reason: error.message });
      logger.error('billing cycle failed for subscriber', {
        subscriberId: subscriber.id,
        message: error.message,
      });
    }
  }

  if (!dryRun) {
    await db.query(
      `UPDATE billing_cycles
         SET status = $2, invoice_count = $3, total_amount = $4, completed_at = NOW(), details = $5
       WHERE id = $1`,
      [
        cycleId,
        failures.length ? 'completed_with_errors' : 'completed',
        invoiceCount,
        totalAmount,
        JSON.stringify({ failures, skipped, createdCount, durationMs: Date.now() - startedAt.getTime() }),
      ],
    );
  }

  logger.info('billing cycle finished', {
    period,
    invoiceCount,
    createdCount,
    totalAmount,
    failures: failures.length,
    skipped: skipped.length,
  });

  return {
    cycleId,
    period,
    dryRun,
    invoiceCount,
    createdCount,
    totalAmount,
    failures,
    skipped,
    dueDate,
  };
}

/**
 * List invoices that are overdue and eligible for auto-suspension.
 */
async function findSuspendableInvoices() {
  const graceCutoff = dates.addDays(new Date(), -config.billing.lateGraceDays);
  const result = await db.query(
    `SELECT * FROM invoices
      WHERE status = 'unpaid'
        AND due_date <> ''
        AND due_date::date < $1::date
      ORDER BY due_date::date ASC`,
    [graceCutoff],
  );
  return result.rows;
}

/**
 * Auto-suspend overdue subscribers: disable the MikroTik PPPoE secret and
 * notify the customer.
 */
async function autoSuspendOverdue() {
  const invoices = await findSuspendableInvoices();
  const results = [];

  // A subscriber can have several overdue invoices. The service is cut once
  // and the customer is notified once, so the work is grouped per subscriber.
  const bySubscriber = new Map();
  for (const invoice of invoices) {
    if (!bySubscriber.has(invoice.subscriber_id)) {
      bySubscriber.set(invoice.subscriber_id, []);
    }
    bySubscriber.get(invoice.subscriber_id).push(invoice);
  }

  for (const [subscriberId, subscriberInvoices] of bySubscriber.entries()) {
    const subscriberRow = await db.queryOne('SELECT * FROM subscribers WHERE id = $1', [subscriberId]);
    if (!subscriberRow) continue;
    const subscriber = readSubscriber(subscriberRow);

    if (subscriber.status === 'suspended' || subscriber.status === 'disconnected') {
      for (const invoice of subscriberInvoices) {
        results.push({ subscriberId, invoiceId: invoice.id, status: 'already_suspended' });
      }
      continue;
    }

    const username = subscriber.pppoeUsername || subscriber.id;
    const routerResult = await mikrotik.suspendSubscriber({
      subscriberId: subscriber.id,
      username,
    });

    if (routerResult.success) {
      // The legacy admin store rewrites the subscribers table from raw_data,
      // so the status has to be kept in both places.
      await db.query(
        `UPDATE subscribers
            SET status = 'suspended',
                raw_data = COALESCE(raw_data, '{}'::jsonb) || '{"status":"suspended"}'::jsonb,
                updated_at = NOW()
          WHERE id = $1`,
        [subscriber.id],
      );
      await db.query(
        `UPDATE subscriber_billing SET status = 'suspended', updated_at = NOW() WHERE subscriber_id = $1`,
        [subscriber.id],
      );

      // The oldest invoice represents the account; the rest are listed too.
      const totalAmount = subscriberInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
      const invoiceIds = subscriberInvoices.map((invoice) => invoice.id).join(', ');

      for (const invoice of subscriberInvoices) {
        await db.query(
          `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message)
           VALUES ($1, $2, 'auto_suspended', $3, $4)`,
          [
            subscriber.id,
            invoice.id,
            Number(invoice.amount),
            `Service auto-suspended for unpaid invoice (outstanding: ${invoiceIds})`,
          ],
        );
      }

      await sms.sendTemplate(
        'service_suspended',
        {
          name: subscriber.name || 'Customer',
          phone: subscriber.phone,
          amount: utils.formatAmount(totalAmount),
          invoiceId: invoiceIds,
        },
        { subscriberId: subscriber.id },
      );
    }

    for (const invoice of subscriberInvoices) {
      results.push({
        subscriberId: subscriber.id,
        invoiceId: invoice.id,
        status: routerResult.success ? 'suspended' : 'router_error',
        error: routerResult.error,
      });
    }
  }

  return { processed: results.length, results };
}

/**
 * Reconcile a settled payment: mark the invoice paid, restore the service
 * and send the receipt SMS. This is the single entry point used by every
 * gateway callback.
 */
async function applyPayment({ invoiceId, transactionId, gateway, amount, raw = {} }) {
  const invoice = await db.queryOne('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
  if (!invoice) {
    const error = new Error(`Invoice not found: ${invoiceId}`);
    error.code = 'INVOICE_NOT_FOUND';
    throw error;
  }

  if (invoice.status === 'paid') {
    // Idempotent — a duplicate callback must not double-charge or double-restore.
    return { invoice, alreadyPaid: true };
  }

  // The settled amount has to cover the invoice. A partial payment must not
  // mark the invoice as paid.
  const expectedAmount = Number(invoice.amount || 0);
  const settledAmount = Number(amount || expectedAmount || 0);
  if (expectedAmount > 0 && settledAmount + 0.01 < expectedAmount) {
    const error = new Error(
      `The settled amount (${settledAmount}) does not cover the invoice (${expectedAmount})`,
    );
    error.code = 'AMOUNT_MISMATCH';
    throw error;
  }

  const paidAt = utils.nowIso();

  // The status lives in the column *and* in raw_data: the legacy admin store
  // rewrites the whole table from raw_data, so a mismatch there would undo
  // this payment on the next admin save.
  await db.query(
    `UPDATE invoices
        SET status = 'paid',
            updated_at = NOW(),
            raw_data = COALESCE(raw_data, '{}'::jsonb) || $2::jsonb
      WHERE id = $1`,
    [
      invoiceId,
      JSON.stringify({
        status: 'paid',
        paidAt,
        paidVia: gateway,
        transactionId,
        paidAmount: settledAmount,
      }),
    ],
  );

  const subscriberRow = await db.queryOne('SELECT * FROM subscribers WHERE id = $1', [invoice.subscriber_id]);
  const subscriber = subscriberRow ? readSubscriber(subscriberRow) : null;

  if (subscriber) {
    // The service is only restored when the account has no other unpaid
    // invoice. Otherwise the customer would be cut again the next morning.
    const outstanding = await db.queryOne(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0) AS total
         FROM invoices
        WHERE subscriber_id = $1 AND status <> 'paid'`,
      [subscriber.id],
    );
    const hasOutstanding = Number(outstanding?.count || 0) > 0;

    if (!hasOutstanding) {
      const username = subscriber.pppoeUsername || subscriber.id;
      const routerResult = await mikrotik.restoreSubscriber({
        subscriberId: subscriber.id,
        username,
      });

      if (routerResult.success && subscriber.status !== 'active') {
        await db.query(
          `UPDATE subscribers
              SET status = 'active',
                  raw_data = COALESCE(raw_data, '{}'::jsonb) || '{"status":"active"}'::jsonb,
                  updated_at = NOW()
            WHERE id = $1`,
          [subscriber.id],
        );
        await db.query(
          `UPDATE subscriber_billing SET status = 'active', updated_at = NOW() WHERE subscriber_id = $1`,
          [subscriber.id],
        );
        await db.query(
          `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message)
           VALUES ($1, $2, 'service_restored', $3, $4)`,
          [subscriber.id, invoiceId, settledAmount, 'Service restored after payment'],
        );

        await sms.sendTemplate(
          'service_restored',
          {
            name: subscriber.name || 'Customer',
            phone: subscriber.phone,
            amount: utils.formatAmount(settledAmount),
            invoiceId,
          },
          { subscriberId: subscriber.id },
        );
      }
    } else {
      await db.query(
        `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message)
         VALUES ($1, $2, 'payment_received_outstanding', $3, $4)`,
        [
          subscriber.id,
          invoiceId,
          settledAmount,
          `Payment received, but ${outstanding.count} invoice(s) worth ${utils.formatAmount(outstanding.total)} are still unpaid — the service stays suspended`,
        ],
      );
    }

    // The receipt is always sent, even when the service stays suspended.
    await sms.sendTemplate(
      'payment_success',
      {
        name: subscriber.name || 'Customer',
        phone: subscriber.phone,
        amount: utils.formatAmount(settledAmount),
        invoiceId,
      },
      { subscriberId: subscriber.id },
    );
  }

  await db.query(
    `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message)
     VALUES ($1, $2, 'payment_received', $3, $4)`,
    [invoice.subscriber_id, invoiceId, settledAmount, `Payment via ${gateway} (${transactionId})`],
  );

  const updated = await db.queryOne('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
  return { invoice: updated, alreadyPaid: false };
}

/**
 * Billing overview for the admin dashboard.
 */
async function getOverview() {
  const totals = await db.queryOne(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'unpaid')                          AS unpaid_count,
       COALESCE(SUM(amount) FILTER (WHERE status = 'unpaid'), 0)           AS unpaid_amount,
       COUNT(*) FILTER (WHERE status = 'paid')                            AS paid_count,
       COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)             AS paid_amount,
       COALESCE(SUM(amount), 0)                                            AS total_amount,
       COUNT(*)                                                             AS total_count
     FROM invoices`,
  );

  const cycles = await db.query(
    'SELECT * FROM billing_cycles ORDER BY started_at DESC LIMIT 12',
  );

  const overdue = await db.query(
    `SELECT COUNT(*) AS count FROM invoices
      WHERE status = 'unpaid' AND due_date <> '' AND due_date::date < CURRENT_DATE`,
  );

  const recentEvents = await db.query(
    'SELECT * FROM billing_events ORDER BY created_at DESC LIMIT 20',
  );

  return {
    totals,
    cycles: cycles.rows,
    overdueCount: Number(overdue.rows[0]?.count || 0),
    recentEvents: recentEvents.rows,
  };
}

module.exports = {
  runMonthlyCycle,
  autoSuspendOverdue,
  applyPayment,
  getOverview,
  ensureBillingProfile,
  generateInvoice,
  readSubscriber,
};
