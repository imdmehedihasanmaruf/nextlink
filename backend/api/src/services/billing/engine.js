'use strict';

const config = require('../../config');
const logger = require('../../lib/logger');
const db = require('../../lib/db');
const utils = require('../../lib/utils');
const dates = require('../../lib/dates');
const mikrotik = require('../mikrotik');
const sms = require('../sms');
const referrals = require('../referrals');

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
    creditBalance: Number(raw.credit_balance || 0),
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
 *
 * @param {number} [lateFee]  The fixed late fee (USD) carried by this invoice —
 *                            added when a previous bill stayed unpaid past the
 *                            grace days. The caller decides when to levy it.
 */
async function generateInvoice({ subscriber, period, amount, dueDate, lateFee = 0 }) {
  const invoiceId = `${INVOICE_PREFIX}-${period.replace('-', '')}-${subscriber.id}`;
  const existing = await db.queryOne('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
  if (existing) {
    return { invoice: existing, created: false };
  }

  // Referral credits are consumed at invoice generation time. A customer with
  // credit is billed the reduced amount; the credit is deducted from the
  // account in the same transaction as the invoice insert, so an invoice can
  // never be created without its credit being consumed.
  const creditBalance = Number(subscriber.creditBalance || 0);
  const invoiceSubtotal = Number(amount) + Number(lateFee);
  const creditUsed = Math.min(creditBalance, invoiceSubtotal);
  const invoiceAmount = invoiceSubtotal - creditUsed;
  const subscriptionAmount = Number(amount);

  const rawData = {
    period,
    invoiceNumber: invoiceId,
    subscriberName: subscriber.name,
    subscriberPhone: subscriber.phone,
    packageId: subscriber.packageId,
    packageName: subscriber.packageName,
    amount: invoiceAmount,
    currency: config.billing.currency,
    dueDate,
    // The legacy admin store rewrites the whole invoices table from
    // `raw_data`, so the status has to live in both places. Without this the
    // admin panel would reset every invoice to "unpaid" on the next save.
    status: 'unpaid',
    generatedBy: 'billing-engine',
    generatedAt: utils.nowIso(),
    lateFee: Number(lateFee),
    lateFeeReason: lateFee > 0 ? 'Previous bill unpaid past the grace days' : null,
    subscriptionAmount,
    creditUsed,
    creditBalanceBefore: creditBalance,
    mikrotikUsername: subscriber.pppoeUsername || '',
  };

  // The conflict clause deliberately does NOT touch `status` and only fills an
  // empty `subscriber_id`.
  //
  // The previous version merged the whole raw_data, which carried
  // `status: 'unpaid'`. Because the legacy admin store rewrites the invoices
  // table from raw_data, re-running a cycle silently turned every already
  // paid invoice back into an unpaid one — 26 invoices in the live database.
  // The subscriber id was blanked in the same way, which meant a payment
  // could never find the account again and no overdue account was ever
  // suspended.
  const inserted = await db.queryOne(
    `INSERT INTO invoices (id, subscriber_id, amount, status, due_date, raw_data, created_at, updated_at)
     VALUES ($1, $2, $3, 'unpaid', $4, $5, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
        subscriber_id = COALESCE(invoices.subscriber_id, EXCLUDED.subscriber_id),
        amount = CASE WHEN invoices.status = 'paid' THEN invoices.amount ELSE EXCLUDED.amount END,
        due_date = CASE WHEN invoices.status = 'paid' THEN invoices.due_date ELSE EXCLUDED.due_date END,
        raw_data = invoices.raw_data || (EXCLUDED.raw_data - 'status'),
        updated_at = NOW()
     RETURNING *`,
    [invoiceId, subscriber.id, invoiceAmount, dueDate, JSON.stringify(rawData)],
  );

  // Decrement the consumption of the referral credit and record the ledger
  // entry. Done in a transaction so the invoice and the credit deduction
  // always land together.
  if (creditUsed > 0) {
    const deductClient = await db.getPool().connect();
    try {
      await deductClient.query('BEGIN');
      const sub = await deductClient.query('SELECT raw_data FROM subscribers WHERE id = $1 FOR UPDATE', [subscriber.id]);
      const currentCredit = Number((((sub.rows[0] || {}).raw_data || {})).credit_balance || 0);
      const nextCredit = Math.max(0, currentCredit - creditUsed);
      await deductClient.query(
        `UPDATE subscribers
            SET raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object('credit_balance', $2::numeric),
                updated_at = NOW()
          WHERE id = $1`,
        [subscriber.id, nextCredit],
      );
      await deductClient.query(
        `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message)
         VALUES ($1, $2, 'referral_credit_applied', $3, $4)`,
        [subscriber.id, invoiceId, creditUsed, `Referral credit of $${creditUsed.toFixed(2)} applied`],
      );
      await deductClient.query('COMMIT');
    } catch (error) {
      await deductClient.query('ROLLBACK').catch(() => {});
      logger.error('failed to deduct referral credit after invoice generation', {
        subscriberId: subscriber.id,
        error: error.message,
      });
      throw error;
    } finally {
      deductClient.release();
    }
  }

  if (inserted && !existing) {
    await db.query(
      `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message)
       VALUES ($1, $2, 'invoice_generated', $3, $4)`,
      [subscriber.id, invoiceId, invoiceAmount, `Invoice generated for ${period}`],
    );
    await db.query(
      `UPDATE subscriber_billing SET last_invoice_id = $2, updated_at = NOW() WHERE subscriber_id = $1`,
      [subscriber.id, invoiceId],
    );
  }

  return { invoice: inserted || existing, created: Boolean(inserted && !existing) };
}

/**
 * The advisory lock key for the monthly billing cycle.
 *
 * The cycle can be triggered by the cron, by the catch-up check and by a
 * manual run at the same time. Without a lock all three would generate the
 * same invoices and send the reminder SMS three times.
 */
const CYCLE_LOCK_KEY = 739_215_011;

/**
 * Run the monthly billing cycle.
 *
 * @param {object} options
 * @param {string} [options.period]  Period key, defaults to the current month.
 * @param {boolean} [options.dryRun]  Generate nothing, only report what would happen.
 * @param {boolean} [options.force]   Run even when another cycle holds the lock.
 */
async function runMonthlyCycle({ period = dates.currentPeriodKey(), dryRun = false, force = false } = {}) {
  const cycleId = `CYCLE-${period.replace('-', '')}`;
  const startedAt = new Date();

  logger.info('billing cycle started', { period, dryRun });

  // Only one cycle may run at a time. The lock is taken on a dedicated
  // connection, because the session-level advisory lock belongs to the
  // connection that took it.
  let lockClient = null;
  if (!dryRun) {
    lockClient = await db.getPool().connect();
    const lock = await lockClient.query('SELECT pg_try_advisory_lock($1) AS locked', [
      CYCLE_LOCK_KEY,
    ]);

    if (!lock.rows[0].locked) {
      lockClient.release();
      lockClient = null;
      logger.info('billing cycle skipped — another cycle is already running', { period });
      return {
        cycleId,
        period,
        dryRun,
        skipped: [],
        reason: 'another_cycle_is_running',
        invoiceCount: 0,
        createdCount: 0,
        totalAmount: 0,
        failures: [],
        dueDate: '',
      };
    }
  }

  try {
    return await executeCycle({ period, dryRun, cycleId, startedAt });
  } finally {
    if (lockClient) {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [CYCLE_LOCK_KEY]).catch(() => {});
      lockClient.release();
    }
  }
}

/**
 * The body of the monthly billing cycle.
 */
async function executeCycle({ period, dryRun, cycleId, startedAt }) {
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

  // The due day is clamped to the length of the month. A due day of 31 would
  // otherwise produce "2026-02-31", which is not a date at all and made the
  // invoice fall back to the "never due" branch.
  const dueDate = dates.dueDateForPeriod(period, config.billing.dueDay);
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

    // A late fee is carried onto this bill when the previous bill(s) stayed
    // unpaid past the grace days. The fee is taken from the configured amount
    // (default $5) and only once per invoice.
    const overdue = await db.queryOne(
      `SELECT COUNT(*)::int AS count
         FROM invoices
        WHERE subscriber_id = $1
          AND status = 'unpaid'
          AND due_date <> ''
          AND due_date::date < (NOW() - ($2 || ' days')::interval)::date`,
      [subscriber.id, config.billing.lateGraceDays],
    );
    const lateFee =
      Number(overdue?.count || 0) > 0 ? Number(config.billing.lateFee || 0) : 0;

    if (dryRun) {
      invoiceCount += 1;
      totalAmount += price + lateFee;
      continue;
    }

    try {
      await ensureBillingProfile(subscriber, price);
      const { invoice, created } = await generateInvoice({
        subscriber,
        period,
        amount: price,
        dueDate,
        lateFee,
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
      const totalAmount = subscriberInvoices.reduce(
        (sum, invoice) => sum + Number(invoice.amount || 0),
        0,
      );
      const invoiceIds = subscriberInvoices.map((invoice) => invoice.id).join(', ');

      // The subscriber suspension and the invoice log entries are one logical
      // change — a partial write would suspend the account without recording
      // why, or log the suspension without changing the account.
      await db.transaction(async (client) => {
        // The legacy admin store rewrites the subscribers table from
        // raw_data, so the status has to be kept in both places.
        await client.query(
          `UPDATE subscribers
              SET status = 'suspended',
                  raw_data = COALESCE(raw_data, '{}'::jsonb) || '{"status":"suspended"}'::jsonb,
                  updated_at = NOW()
            WHERE id = $1`,
          [subscriber.id],
        );
        await client.query(
          `UPDATE subscriber_billing SET status = 'suspended', updated_at = NOW() WHERE subscriber_id = $1`,
          [subscriber.id],
        );

        for (const invoice of subscriberInvoices) {
          await client.query(
            `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message)
             VALUES ($1, $2, 'auto_suspended', $3, $4)`,
            [
              subscriber.id,
              invoice.id,
              Number(invoice.amount),
              `Service auto-suspended for unpaid invoice (outstanding: ${subscriberInvoices
    .map((i) => i.id)
    .join(', ')})`,
            ],
          );
        }
      });

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
        // The three writes are one logical change — either the service is
        // restored everywhere or not at all. A partial restore left the
        // invoice paid while the subscriber was still marked suspended.
        await db.transaction(async (client) => {
          await client.query(
            `UPDATE subscribers
                SET status = 'active',
                    raw_data = COALESCE(raw_data, '{}'::jsonb) || '{"status":"active"}'::jsonb,
                    updated_at = NOW()
              WHERE id = $1`,
            [subscriber.id],
          );
          await client.query(
            `UPDATE subscriber_billing SET status = 'active', updated_at = NOW() WHERE subscriber_id = $1`,
            [subscriber.id],
          );
          await client.query(
            `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message)
             VALUES ($1, $2, 'service_restored', $3, $4)`,
            [subscriber.id, invoiceId, settledAmount, 'Service restored after payment'],
          );
        });

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

  // A settled payment is the moment a referrer's reward becomes earned.
  if (subscriber) {
    try {
      await referrals.onPaymentSettled({ subscriberId: subscriber.id, invoiceId });
    } catch (error) {
      logger.error('referral qualification failed', {
        subscriberId: subscriber.id,
        invoiceId,
        error: error.message,
      });
    }
  }

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
