'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../lib/db');
const config = require('../config');
const logger = require('../lib/logger');
const utils = require('../lib/utils');
const dates = require('../lib/dates');
const { asyncHandler } = require('../middleware/error');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole, requireSelfOrRole, ROLES, audit } = require('../middleware/auth');
const billing = require('../services/billing/engine');
const gateways = require('../services/payments/gateways');

const router = express.Router();

/**
 * Resolve the subscriber id of the authenticated principal.
 * Staff may pass ?subscriberId= to inspect a specific account.
 */
function resolveSubscriberId(req) {
  // The request may be anonymous, so the principal is checked first.
  if (!req.user) return null;
  if (req.user.type === 'subscriber') return req.user.subscriberId || req.user.id;
  return req.query.subscriberId ? String(req.query.subscriberId) : null;
}

/**
 * GET /api/billing/my-invoices
 * The authenticated subscriber's own invoices only (strict isolation).
 */
router.get(
  '/my-invoices',
  requireAuth,
  requireSelfOrRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  asyncHandler(async (req, res) => {
    const subscriberId = resolveSubscriberId(req);
    if (!subscriberId) {
      return res.status(400).json({ success: false, error: 'subscriberId is required' });
    }

    const result = await db.query(
      `SELECT i.id, i.subscriber_id, i.amount, i.status, i.due_date, i.raw_data, i.created_at, i.updated_at
         FROM invoices i
        WHERE i.subscriber_id = $1
        ORDER BY i.created_at DESC
        LIMIT 100`,
      [subscriberId],
    );

    const transactions = await db.query(
      `SELECT id, invoice_id, gateway, amount, status, gateway_txn_id, created_at
         FROM payment_transactions
        WHERE subscriber_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [subscriberId],
    );

    return res.json({
      success: true,
      invoices: result.rows,
      transactions: transactions.rows,
    });
  }),
);

/**
 * GET /api/billing/my-summary
 * Outstanding balance and next due date for the subscriber.
 */
router.get(
  '/my-summary',
  requireAuth,
  requireSelfOrRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  asyncHandler(async (req, res) => {
    const subscriberId = resolveSubscriberId(req);
    if (!subscriberId) {
      return res.status(400).json({ success: false, error: 'subscriberId is required' });
    }

    const totals = await db.queryOne(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE status = 'unpaid'), 0) AS outstanding,
         COUNT(*) FILTER (WHERE status = 'unpaid')                  AS unpaid_count,
         COUNT(*) FILTER (WHERE status = 'paid')                    AS paid_count,
         COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)    AS paid_total
       FROM invoices
      WHERE subscriber_id = $1`,
      [subscriberId],
    );

    const nextDue = await db.queryOne(
      `SELECT id, due_date, amount FROM invoices
        WHERE subscriber_id = $1 AND status = 'unpaid' AND due_date <> ''
        ORDER BY due_date::date ASC LIMIT 1`,
      [subscriberId],
    );

    const subscriber = await db.queryOne(
      'SELECT id, name, phone, email, status, package_id, raw_data FROM subscribers WHERE id = $1',
      [subscriberId],
    );

    return res.json({
      success: true,
      summary: {
        outstanding: Number(totals?.outstanding || 0),
        unpaidCount: Number(totals?.unpaid_count || 0),
        paidCount: Number(totals?.paid_count || 0),
        paidTotal: Number(totals?.paid_total || 0),
        nextInvoice: nextDue,
        subscriber: subscriber
          ? {
              id: subscriber.id,
              name: subscriber.name,
              phone: subscriber.phone,
              email: subscriber.email,
              status: subscriber.status,
              packageId: subscriber.package_id,
              packageName: (subscriber.raw_data || {}).packageName || '',
              creditBalance: Number((subscriber.raw_data || {}).credit_balance || 0),
              referralReward: Number((subscriber.raw_data || {}).referralReward || 0),
            }
          : null,
      },
    });
  }),
);

/**
 * POST /api/billing/pay
 * Pay an invoice through a gateway (bKash / Nagad / SSLCommerz / Rocket).
 */
router.post(
  '/pay',
  requireAuth,
  requireSelfOrRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  validate({
    body: z.object({
      invoiceId: z.string().min(1, 'invoiceId is required'),
      gateway: z.enum(['bkash', 'nagad', 'sslcommerz', 'rocket']),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.validatedBody;
    const principalSubscriberId = resolveSubscriberId(req);

    const invoice = await db.queryOne('SELECT * FROM invoices WHERE id = $1', [body.invoiceId]);
    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    // A subscriber may only pay their own invoice. Staff are limited by
    // requireSelfOrRole to the roles that may act on other accounts.
    if (req.user.type === 'subscriber' && invoice.subscriber_id !== principalSubscriberId) {
      return res.status(403).json({ success: false, error: 'You can only pay your own invoices' });
    }

    if (invoice.status === 'paid') {
      return res.status(409).json({ success: false, error: 'This invoice has already been paid' });
    }

    // The payment window is enforced here, on the server. The portal also
    // hides the button outside the window, but that is only a convenience —
    // the rule has to hold regardless of what the client sends.
    const window = config.billing.paymentWindow;
    if (window.enabled) {
      const day = dates.dayOfMonth();
      if (day < window.startDay || day > window.endDay) {
        return res.status(400).json({
          success: false,
          error: `Payments are only accepted between the ${window.startDay}th and the ${window.endDay}th of each month. Today is the ${day}th.`,
          code: 'PAYMENT_WINDOW_CLOSED',
          windowStart: window.startDay,
          windowEnd: window.endDay,
        });
      }
    }

    const subscriber = await db.queryOne('SELECT * FROM subscribers WHERE id = $1', [invoice.subscriber_id]);
    const raw = subscriber ? subscriber.raw_data || {} : {};
    const invoiceRaw = invoice.raw_data || {};

    const gateway = gateways.resolveGateway(body.gateway);

    try {
      const result = await gateway.createPayment({
        invoiceId: invoice.id,
        subscriberId: invoice.subscriber_id,
        amount: Number(invoice.amount),
        customer: {
          name: subscriber ? subscriber.name : invoiceRaw.subscriberName,
          email: subscriber ? subscriber.email : invoiceRaw.subscriberEmail,
          phone: subscriber ? subscriber.phone : invoiceRaw.subscriberPhone,
          address: raw.address || '',
        },
      });

      const transactionId = utils.generateId('PAY');
      await db.query(
        `INSERT INTO payment_transactions
           (id, invoice_id, subscriber_id, gateway, amount, currency, status, gateway_txn_id, reference, method, raw_data)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $7, $4, $8)`,
        [
          transactionId,
          invoice.id,
          invoice.subscriber_id,
          body.gateway,
          Number(invoice.amount),
          require('../config').billing.currency,
          result.transactionId,
          JSON.stringify(result.raw),
        ],
      );

      await audit({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'payment.initiated',
        entityType: 'invoice',
        entityId: invoice.id,
        details: { gateway: body.gateway, transactionId: result.transactionId },
        ip: req.ip,
      });

      return res.json({
        success: true,
        transactionId,
        gatewayTransactionId: result.transactionId,
        redirectUrl: result.redirectUrl,
        invoiceId: invoice.id,
        amount: Number(invoice.amount),
        currency: require('../config').billing.currency,
      });
    } catch (error) {
      logger.error('subscriber payment failed', {
        gateway: body.gateway,
        invoiceId: invoice.id,
        message: error.message,
      });
      return res.status(502).json({
        success: false,
        error: `Payment gateway error: ${error.message}`,
        code: error.code,
      });
    }
  }),
);

/**
 * GET /api/billing/my-events
 * Billing history for the subscriber (invoices + suspensions + restorations).
 */
router.get(
  '/my-events',
  requireAuth,
  requireSelfOrRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  asyncHandler(async (req, res) => {
    const subscriberId = resolveSubscriberId(req);
    if (!subscriberId) {
      return res.status(400).json({ success: false, error: 'subscriberId is required' });
    }

    const events = await db.query(
      'SELECT * FROM billing_events WHERE subscriber_id = $1 ORDER BY created_at DESC LIMIT 50',
      [subscriberId],
    );

    const mikrotik = await db.query(
      'SELECT * FROM mikrotik_sync_log WHERE subscriber_id = $1 ORDER BY created_at DESC LIMIT 50',
      [subscriberId],
    );

    return res.json({ success: true, events: events.rows, routerOperations: mikrotik.rows });
  }),
);

module.exports = router;
