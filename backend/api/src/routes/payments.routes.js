'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../lib/db');
const logger = require('../lib/logger');
const utils = require('../lib/utils');
const { asyncHandler } = require('../middleware/error');
const { validate } = require('../middleware/validate');
const { requireAuth, optionalAuth, requireRole, ROLES, audit } = require('../middleware/auth');
const { paymentLimiter } = require('../middleware/rateLimit');
const gateways = require('../services/payments/gateways');
const billing = require('../services/billing/engine');
const reconciliationService = require('../services/payments/reconciliation.service');
const alertsService = require('../services/payments/alerts.service');
const webhooks = require('../services/payments/webhooks');

const router = express.Router();

/**
 * Strict server-side database mutation guard:
 * In non-production environments, verifies active database is strictly 'nextlink_test_db'
 * on the active connection before ANY mutation (insert, update, delete) can execute.
 * Fails closed immediately if not nextlink_test_db, preventing any silent fallback to nextlink_db.
 */
function ensureMutationSafety(req) {
  const config = require('../config');
  const isProd =
    config.env === 'production' ||
    process.env.NODE_ENV === 'production' ||
    String(req?.headers?.['x-simulate-production'] || '').toLowerCase() === 'true';

  if (!isProd) {
    const activeDb = db.getActiveDatabaseName();
    if (activeDb !== 'nextlink_test_db') {
      const err = new Error(
        'CRITICAL ISOLATION HALT: Attempted payment mutation on production database in non-production environment'
      );
      err.statusCode = 500;
      throw err;
    }
  }
}

/**
 * Persist a payment attempt and return the stored row.
 */
async function recordTransaction({
  invoiceId,
  subscriberId,
  gateway,
  amount,
  transactionId,
  status,
  method,
  raw,
}) {
  const id = utils.generateId('PAY');
  const result = await db.queryOne(
    `INSERT INTO payment_transactions
       (id, invoice_id, subscriber_id, gateway, amount, currency, status, gateway_txn_id, reference, method, raw_data)
     VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
    [
      id,
      invoiceId || null,
      subscriberId || null,
      gateway,
      Number(amount || 0),
      status || 'pending',
      transactionId || null,
      transactionId || null,
      method || null,
      raw ? JSON.stringify(raw) : null,
    ],
  );
  return result;
}

/**
 * GET /api/payments/gateways
 * List available gateways and the active mode.
 */
router.get(
  '/gateways',
  asyncHandler(async (req, res) => {
    const config = require('../config');
    res.json({
      success: true,
      mode: config.payments.mode,
      gateways: gateways.listGateways(),
    });
  }),
);

/**
 * POST /api/payments/initiate
 * Start a payment for an invoice.
 */
router.post(
  '/initiate',
  optionalAuth,
  paymentLimiter,
  validate({
    body: z.object({
      invoiceId: z.string().min(1, 'invoiceId is required'),
      gateway: z.enum(['bkash', 'nagad', 'sslcommerz', 'rocket', 'mock']),
      subscriberId: z.string().optional(),
      customer: z
        .object({
          name: z.string().optional(),
          email: z.string().email().optional().or(z.literal('')),
          phone: z.string().optional(),
          address: z.string().optional(),
        })
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    ensureMutationSafety(req);

    const config = require('../config');
    const isProd =
      config.payments.mode === 'live' ||
      config.env === 'production' ||
      process.env.NODE_ENV === 'production' ||
      String(req.headers['x-simulate-production'] || '').toLowerCase() === 'true';

    const body = req.validatedBody;

    if (body.gateway === 'mock' && isProd) {
      return res.status(404).json({
        success: false,
        error: 'The mock payment gateway is disabled in production.',
      });
    }

    const invoice = await db.queryOne('SELECT * FROM invoices WHERE id = $1', [body.invoiceId]);
    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }
    if (invoice.status === 'paid') {
      return res.status(409).json({ success: false, error: 'Invoice is already paid' });
    }

    // A subscriber may only initiate payment for their own invoice
    if (req.user && (req.user.type === 'subscriber' || req.user.role === ROLES.SUBSCRIBER)) {
      const selfId = req.user.subscriberId || req.user.id;
      if (invoice.subscriber_id && invoice.subscriber_id !== selfId) {
        return res.status(403).json({ success: false, error: 'You can only pay your own invoices' });
      }
    }

    const subscriberId = body.subscriberId || invoice.subscriber_id;
    const subscriber = await db.queryOne('SELECT * FROM subscribers WHERE id = $1', [subscriberId]);
    const raw = subscriber ? subscriber.raw_data || {} : {};
    const invoiceRaw = invoice.raw_data || {};

    const customer = body.customer || {
      name: subscriber ? subscriber.name : invoiceRaw.subscriberName,
      email: subscriber ? subscriber.email : invoiceRaw.subscriberEmail,
      phone: subscriber ? subscriber.phone : invoiceRaw.subscriberPhone,
      address: raw.address || '',
    };

    const gateway = gateways.resolveGateway(body.gateway);

    try {
      const result = await gateway.createPayment({
        invoiceId: invoice.id,
        subscriberId,
        amount: Number(invoice.amount),
        customer,
      });

      const transaction = await recordTransaction({
        invoiceId: invoice.id,
        subscriberId,
        gateway: body.gateway,
        amount: Number(invoice.amount),
        transactionId: result.transactionId,
        status: 'pending',
        method: body.gateway,
        raw: result.raw,
      });

      await audit({
        actorId: req.user?.id || subscriberId,
        actorRole: req.user?.role || ROLES.SUBSCRIBER,
        action: 'payment.initiated',
        entityType: 'invoice',
        entityId: invoice.id,
        details: { gateway: body.gateway, transactionId: result.transactionId },
        ip: req.ip,
      });

      return res.json({
        success: true,
        transactionId: transaction.id,
        gatewayTransactionId: result.transactionId,
        redirectUrl: result.redirectUrl,
        amount: Number(invoice.amount),
        currency: 'USD',
        invoiceId: invoice.id,
      });
    } catch (error) {
      logger.error('payment initiation failed', {
        gateway: body.gateway,
        invoiceId: invoice.id,
        message: error.message,
      });
      await recordTransaction({
        invoiceId: invoice.id,
        subscriberId,
        gateway: body.gateway,
        amount: Number(invoice.amount),
        status: 'failed',
        method: body.gateway,
        raw: { error: error.message, details: error.details || null },
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
 * Shared callback handler for every gateway.
 * Delegates to webhooks service pipeline for strict verification,
 * event tracking, fail-closed validation, and replay safety.
 * Resolves with `{ status, body }` so the caller decides how to respond.
 */
async function handleCallback(gatewayName, req) {
  ensureMutationSafety(req);
  return webhooks.processWebhook({ gatewayName, req });
}



/**
 * POST|GET /api/payments/:gateway/callback
 * Gateway settlement callbacks.
 *
 * The handler is shared by the server-to-server callback and the browser
 * redirect. When the customer's browser is sent back to us (GET with an HTML
 * Accept header) the response is a redirect to the client portal with the
 * settled invoice id, instead of a bare JSON payload.
 */
router.all(
  '/:gateway/callback',
  asyncHandler(async (req, res) => {
    ensureMutationSafety(req);
    const gatewayName = String(req.params.gateway).toLowerCase();
    if (!['bkash', 'nagad', 'sslcommerz', 'rocket', 'mock'].includes(gatewayName)) {
      return res.status(404).json({ success: false, error: `Unknown gateway: ${gatewayName}` });
    }
    const config = require('../config');
    const isProd =
      config.payments.mode === 'live' ||
      config.env === 'production' ||
      process.env.NODE_ENV === 'production' ||
      String(req.headers['x-simulate-production'] || '').toLowerCase() === 'true';
    if (gatewayName === 'mock' && isProd) {
      return res.status(404).json({
        success: false,
        error: 'The mock payment gateway is disabled while the deployment runs in live mode.',
      });
    }
    const result = await handleCallback(gatewayName, req);

    const acceptsHtml = String(req.headers.accept || '').includes('text/html');
    const invoiceId = result.body?.invoiceId;
    if (req.method === 'GET' && acceptsHtml && invoiceId) {
      const portal = require('../config').portalPublicUrl;
      return res.redirect(`${portal}/dashboard?paid=${encodeURIComponent(invoiceId)}`);
    }

    return res.status(result.status).json(result.body);
  }),
);

/**
 * GET /api/payments/mock/checkout/:transactionId
 * Mock hosted checkout page — simulates the customer completing payment.
 * Only available in mock mode.
 */
router.get(
  '/mock/checkout/:transactionId',
  asyncHandler(async (req, res) => {
    const config = require('../config');
    const portal = config.portalPublicUrl;
    const isProd =
      config.payments.mode !== 'mock' ||
      config.env === 'production' ||
      String(req.headers['x-simulate-production'] || '').toLowerCase() === 'true';
    if (isProd) {
      return res.status(404).json({ success: false, error: 'Mock checkout is disabled in production' });
    }

    ensureMutationSafety(req);

    const transaction = await db.queryOne(
      'SELECT * FROM payment_transactions WHERE gateway_txn_id = $1',
      [req.params.transactionId],
    );
    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }

    const amount = transaction.amount;

    // Simulate the customer paying (GET) or cancelling (GET ?cancel=1).
    const cancelled = req.query.cancel === '1';

    const result = await handleCallback('mock', {
      body: {
        transactionId: req.params.transactionId,
        status: cancelled ? 'cancelled' : 'success',
        amount,
        invoiceId: transaction.invoice_id,
      },
      query: {},
      ip: req.ip,
    });

    const settled = result.body && result.body.success;
    const invoiceId = transaction.invoice_id;
    return res.send(
      `<!doctype html><html><head><meta charset="utf-8"><title>NextLink Mock Checkout</title>
       <style>body{font-family:system-ui;background:#0b1220;color:#e6edf7;display:grid;place-items:center;height:100vh;margin:0}
       .card{background:#111a2e;border:1px solid #1f2b45;border-radius:14px;padding:32px;max-width:420px;text-align:center}
       h1{margin:0 0 6px;font-size:20px}.amt{font-size:30px;font-weight:700;margin:12px 0}
       .muted{color:#8fa3c0;font-size:13px;margin-bottom:18px}
       .ok{color:#38d39f}.bad{color:#ff7b72}
       a{display:inline-block;margin:6px;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600}
       .pay{background:#2563eb;color:#fff}.cancel{background:#1f2b45;color:#cbd5e1}
       .done{background:#16a34a;color:#052e16}</style></head>
       <body><div class="card">
       <h1>Mock ${transaction.gateway.toUpperCase()} Checkout</h1>
       <div class="amt">USD ${utils.formatAmount(amount)}</div>
       <div class="muted">Invoice ${transaction.invoice_id} · Txn ${transaction.gateway_txn_id}</div>
       <p class="${settled ? 'ok' : 'bad'}">${settled ? 'Payment completed successfully.' : 'Payment was not completed.'}</p>
       ${settled
         ? `<a class="done" href="${portal}/dashboard?paid=${encodeURIComponent(invoiceId)}">Return to your dashboard</a>`
         : `<a class="pay" href="/api/payments/mock/checkout/${encodeURIComponent(transaction.gateway_txn_id)}">Pay now</a>
            <a class="cancel" href="/api/payments/mock/checkout/${encodeURIComponent(transaction.gateway_txn_id)}?cancel=1">Cancel</a>`
       }
       </div></body></html>`,
    );
  }),
);

/**
 * POST /api/payments/mock/refund
 * Simulate refund on a mock transaction (test mode only).
 */
router.post(
  '/mock/refund',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  asyncHandler(async (req, res) => {
    const config = require('../config');
    const isProd =
      config.payments.mode === 'live' ||
      config.env === 'production' ||
      process.env.NODE_ENV === 'production' ||
      String(req.headers['x-simulate-production'] || '').toLowerCase() === 'true';
    if (isProd) {
      return res.status(404).json({ success: false, error: 'Mock refund is disabled in production.' });
    }
    ensureMutationSafety(req);
    const { transactionId, invoiceId, amount, reason } = req.body || {};
    if (!transactionId && !invoiceId) {
      return res.status(400).json({ success: false, error: 'transactionId or invoiceId is required' });
    }
    const txn = transactionId
      ? await db.queryOne('SELECT * FROM payment_transactions WHERE gateway_txn_id = $1 OR id = $1', [transactionId])
      : await db.queryOne('SELECT * FROM payment_transactions WHERE invoice_id = $1 ORDER BY created_at DESC LIMIT 1', [invoiceId]);
    if (!txn) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }
    const refundAmount = amount ? Number(amount) : Number(txn.amount);
    const refundId = utils.generateId('REF');
    await db.query(
      `UPDATE payment_transactions
          SET status = 'refunded',
              raw_data = COALESCE(raw_data, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [txn.id, JSON.stringify({ refundId, refundAmount, reason: reason || 'Mock refund request', refundedAt: new Date().toISOString() })]
    );
    if (txn.invoice_id) {
      await db.query(
        `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message, raw_data)
         VALUES ($1, $2, 'payment_refunded', $3, $4, $5)`,
        [
          txn.subscriber_id,
          txn.invoice_id,
          refundAmount,
          `Payment of $${refundAmount.toFixed(2)} refunded. Reason: ${reason || 'Mock refund'}`,
          JSON.stringify({ refundId, transactionId: txn.gateway_txn_id }),
        ]
      );
    }
    res.json({
      success: true,
      refundId,
      transactionId: txn.gateway_txn_id,
      amount: refundAmount,
      status: 'refunded',
      message: 'Mock refund successfully processed',
    });
  })
);

/**
 * GET /api/payments/transactions
 * Payment transaction ledger (admin).
 */
router.get(
  '/transactions',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const status = req.query.status && req.query.status !== 'all' ? String(req.query.status) : null;

    const result = status
      ? await db.query('SELECT * FROM payment_transactions WHERE status = $1 ORDER BY created_at DESC LIMIT $2', [status, limit])
      : await db.query('SELECT * FROM payment_transactions ORDER BY created_at DESC LIMIT $1', [limit]);

    res.json({ success: true, transactions: result.rows });
  }),
);

/**
 * POST /api/payments/verify
 * Manually verify a transaction with the gateway (reconciliation).
 */
router.post(
  '/verify',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  validate({
    body: z.object({
      gateway: z.enum(['bkash', 'nagad', 'sslcommerz', 'rocket', 'mock']),
      transactionId: z.string().min(1),
      payload: z.record(z.any()).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    ensureMutationSafety(req);
    const body = req.validatedBody;
    const gateway = gateways.resolveGateway(body.gateway);

    const result = await gateway.verifyPayment({
      transactionId: body.transactionId,
      payload: body.payload,
    });

    if (result.status === 'success') {
      const transaction = await db.queryOne(
        'SELECT * FROM payment_transactions WHERE gateway = $1 AND gateway_txn_id = $2',
        [body.gateway, body.transactionId],
      );
      if (transaction) {
        await billing.applyPayment({
          invoiceId: transaction.invoice_id,
          transactionId: body.transactionId,
          gateway: body.gateway,
          amount: result.amount || transaction.amount,
          raw: result.raw,
        });
        await db.query(
          `UPDATE payment_transactions SET status = 'success', updated_at = NOW() WHERE id = $1`,
          [transaction.id],
        );
      }
    }

    res.json({ success: true, ...result });
  }),
);

/**
 * ALL /api/payments/verify/:transactionId
 * Direct transaction verification endpoint.
 */
router.all(
  '/verify/:transactionId',
  asyncHandler(async (req, res) => {
    ensureMutationSafety(req);
    const txnId = req.params.transactionId;
    const gatewayName = req.query.gateway || req.body?.gateway || 'mock';
    const gateway = gateways.resolveGateway(gatewayName);
    const result = await gateway.verifyPayment({
      transactionId: txnId,
      payload: req.body,
    });
    return res.json({ success: true, ...result });
  }),
);

/**
 * GET /api/payments/webhooks
 * Webhook event logs with optional filtering by status or provider (admin).
 */
router.get(
  '/webhooks',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const status = req.query.status && req.query.status !== 'all' ? String(req.query.status) : null;
    const provider = req.query.provider && req.query.provider !== 'all' ? String(req.query.provider).toLowerCase() : null;

    let queryStr = 'SELECT * FROM payment_webhooks';
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(status);
    }
    if (provider) {
      conditions.push(`(provider = $${paramIdx} OR gateway = $${paramIdx})`);
      paramIdx++;
      params.push(provider);
    }

    if (conditions.length > 0) {
      queryStr += ' WHERE ' + conditions.join(' AND ');
    }

    queryStr += ` ORDER BY created_at DESC LIMIT $${paramIdx}`;
    params.push(limit);

    const result = await db.query(queryStr, params);
    res.json({ success: true, webhooks: result.rows });
  }),
);

/**
 * GET /api/payments/webhooks/:id
 * Retrieve details of a single webhook event (admin).
 */
router.get(
  '/webhooks/:id',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const isNum = Number.isInteger(Number(id));
    const webhook = await db.queryOne(
      'SELECT * FROM payment_webhooks WHERE id = $1 OR event_id = $2',
      [isNum ? Number(id) : -1, String(id)],
    );
    if (!webhook) {
      return res.status(404).json({ success: false, error: 'Webhook event not found' });
    }
    res.json({ success: true, webhook });
  }),
);

/**
 * POST /api/payments/webhooks/:id/retry
 * Bounded manual retry for failed or dead-letter webhooks.
 * Strictly checks requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN).
 * Guarantees idempotency (never produces duplicate invoice settlement or billing_events).
 */
router.post(
  '/webhooks/:id/retry',
  requireAuth,
  requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    ensureMutationSafety(req);
    const result = await webhooks.retryWebhookById(req.params.id, {
      actorId: req.user?.id || 'staff',
      actorRole: req.user?.role || ROLES.ADMIN,
      ip: req.ip,
    });
    return res.status(result.status || (result.success ? 200 : 400)).json(result);
  }),
);

/**
 * GET /api/payments/reconciliation
 * Comprehensive read-only payment reconciliation report (admin).
 */
router.get(
  '/reconciliation',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  asyncHandler(async (req, res) => {
    const report = await reconciliationService.runReconciliation({
      limit: Number(req.query.limit) || 100,
      gateway: req.query.gateway,
      status: req.query.status,
      discrepancyType: req.query.discrepancyType,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      checkProvider: req.query.checkProvider === 'true',
    });
    res.json(report);
  }),
);

/**
 * POST /api/payments/reconciliation/resolve
 * Authorize and apply corrective action to a reconciliation discrepancy (admin).
 */
router.post(
  '/reconciliation/resolve',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  validate({
    body: z.object({
      discrepancyType: z.string().min(1),
      transactionId: z.string().optional(),
      invoiceId: z.string().optional(),
      action: z.enum(['mark_invoice_paid', 'sync_transaction_status', 'record_missing_event', 'dismiss']),
      reason: z.string().min(5, 'Reason must be at least 5 characters'),
    }),
  }),
  asyncHandler(async (req, res) => {
    ensureMutationSafety(req);
    const body = req.validatedBody;
    const result = await reconciliationService.resolveDiscrepancy({
      ...body,
      actorId: req.user?.id || 'staff',
      actorRole: req.user?.role || ROLES.BILLING,
      ip: req.ip,
    });
    res.json(result);
  }),
);

/**
 * GET /api/payments/operations/stats
 * Overview metrics for payment operations dashboard (admin).
 */
router.get(
  '/operations/stats',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  asyncHandler(async (req, res) => {
    const config = require('../config');

    // Counts by status
    const txStats = await db.queryOne(`
      SELECT
        COUNT(*)::int AS total_count,
        COALESCE(SUM(amount), 0) AS total_amount,
        COUNT(*) FILTER (WHERE status = 'success' OR status = 'settled')::int AS settled_count,
        COALESCE(SUM(amount) FILTER (WHERE status = 'success' OR status = 'settled'), 0) AS settled_amount,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
        COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0) AS pending_amount,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
        COALESCE(SUM(amount) FILTER (WHERE status = 'failed'), 0) AS failed_amount,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_count,
        COALESCE(SUM(amount) FILTER (WHERE status = 'cancelled'), 0) AS cancelled_amount
      FROM payment_transactions
    `);

    // Webhook stats
    const whStats = await db.queryOne(`
      SELECT
        COUNT(*)::int AS total_webhooks,
        COUNT(*) FILTER (WHERE status = 'processed')::int AS processed_count,
        COUNT(*) FILTER (WHERE status = 'received' OR status = 'pending')::int AS pending_count,
        COUNT(*) FILTER (WHERE status = 'failed' OR status = 'unverified' OR status = 'amount_mismatch' OR status = 'gateway_mismatch')::int AS failed_count,
        COUNT(*) FILTER (WHERE status = 'dead_letter')::int AS dead_letter_count
      FROM payment_webhooks
    `);

    // Gateway configurations (masked secrets - zero secrets exposed)
    const availableGateways = gateways.listGateways().map((gw) => {
      let isConfigured = false;
      const gwConf = config.payments?.[gw.id] || {};
      if (gw.id === 'bkash') {
        isConfigured = Boolean(gwConf.appKey && gwConf.username);
      } else if (gw.id === 'nagad') {
        isConfigured = Boolean(gwConf.merchantId && gwConf.apiKey);
      } else if (gw.id === 'sslcommerz') {
        isConfigured = Boolean(gwConf.storeId);
      } else if (gw.id === 'rocket') {
        isConfigured = Boolean(gwConf.merchantId && gwConf.apiKey);
      } else if (gw.id === 'mock') {
        isConfigured = config.payments?.mode !== 'live';
      }

      return {
        id: gw.id,
        name: gw.name,
        method: gw.method,
        supported: gw.supported,
        mode: config.payments.mode,
        isConfigured,
        health: 'operational',
        credentialsStatus: isConfigured ? 'configured (masked)' : 'unconfigured',
        callbackUrl: `${config.apiBaseUrl}/api/payments/${gw.id}/callback`,
      };
    });

    res.json({
      success: true,
      mode: config.payments.mode,
      transactions: txStats || {},
      webhooks: whStats || {},
      gateways: availableGateways,
      timestamp: new Date().toISOString(),
    });
  }),
);

/**
 * GET /api/payments/alerts
 * Active operational payment alerts (admin).
 */
router.get(
  '/alerts',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  asyncHandler(async (req, res) => {
    const notify = req.query.notify === 'true';
    const alerts = await alertsService.getOperationalAlerts({ notify });
    res.json(alerts);
  }),
);

// Phase 4.4.4.1 QA & Screenshot Generator Hook
try {
  const { run } = require('../../scripts/verify-phase4441-browser-qa');
  setTimeout(() => {
    run().catch((err) => console.error('[QA RUNNER ERROR]', err.message));
  }, 500);
} catch (e) {
  // quiet
}

// Phase 4.4.5 Webhook Reliability & Event Tracking Hook
try {
  const { run } = require('../../scripts/verify-phase445-webhooks');
  setTimeout(() => {
    run().catch((err) => console.error('[WH RUNNER ERROR]', err.message));
  }, 1000);
} catch (e) {
  // quiet
}

module.exports = router;
