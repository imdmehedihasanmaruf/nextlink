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

const router = express.Router();

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
      gateway: z.enum(['bkash', 'nagad', 'sslcommerz', 'rocket']),
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
    const body = req.validatedBody;

    const invoice = await db.queryOne('SELECT * FROM invoices WHERE id = $1', [body.invoiceId]);
    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }
    if (invoice.status === 'paid') {
      return res.status(409).json({ success: false, error: 'Invoice is already paid' });
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
 * Resolves with `{ status, body }` so the caller decides how to respond.
 */
async function handleCallback(gatewayName, req) {
  const body = { ...req.body, ...req.query };
  const gateway = gateways.resolveGateway(gatewayName);

  let parsed;
  try {
    parsed = gateway.parseWebhook(body);
  } catch (error) {
    return { status: 400, body: { success: false, error: `Unsupported callback payload: ${error.message}` } };
  }

  await db.query(
    `INSERT INTO payment_webhooks (gateway, event_type, gateway_txn_id, payload, status)
     VALUES ($1, $2, $3, $4, 'received')`,
    [gatewayName, body.status || body.event_type || 'callback', parsed.transactionId || null, JSON.stringify(body)],
  );

  // The mock gateway reuses the transaction created under the real gateway
  // name (bkash/nagad/...), so look the transaction up by its gateway id.
  const transaction = parsed.transactionId
    ? await db.queryOne(
        'SELECT * FROM payment_transactions WHERE gateway_txn_id = $1 ORDER BY created_at DESC LIMIT 1',
        [parsed.transactionId],
      )
    : null;

  if (!transaction) {
    await db.query(
      `UPDATE payment_webhooks SET status = 'unmatched', processed_at = NOW() WHERE id = (
         SELECT id FROM payment_webhooks WHERE gateway_txn_id = $1 ORDER BY created_at DESC LIMIT 1
       )`,
      [parsed.transactionId || null],
    );
    return { status: 404, body: { success: false, error: 'No matching payment transaction found' } };
  }

  // A callback may only settle the transaction it belongs to.
  if (transaction.gateway !== gatewayName && gatewayName !== 'mock') {
    await db.query(
      `UPDATE payment_webhooks SET status = 'gateway_mismatch', processed_at = NOW() WHERE id = (
         SELECT id FROM payment_webhooks WHERE gateway_txn_id = $1 ORDER BY created_at DESC LIMIT 1
       )`,
      [parsed.transactionId],
    );
    return {
      status: 400,
      body: {
        success: false,
        error: `This transaction belongs to ${transaction.gateway}, not ${gatewayName}`,
      },
    };
  }

  // The callback must be authentic. Each gateway verifies the callback in its
  // own way — a signature for bKash, a server side lookup for the others.
  let verification = { verified: true, reason: 'no verification available' };
  try {
    if (typeof gateway.verifyWebhook === 'function') {
      verification = await gateway.verifyWebhook(body);
    }
  } catch (error) {
    verification = { verified: false, reason: error.message };
  }

  if (!verification.verified) {
    await db.query(
      `UPDATE payment_webhooks SET status = 'unverified', error = $2, processed_at = NOW() WHERE id = (
         SELECT id FROM payment_webhooks WHERE gateway_txn_id = $1 ORDER BY created_at DESC LIMIT 1
       )`,
      [parsed.transactionId, String(verification.reason || 'verification failed').slice(0, 500)],
    );
    logger.warn('payment callback rejected', {
      gateway: gatewayName,
      transactionId: parsed.transactionId,
      reason: verification.reason,
    });
    return {
      status: 401,
      body: { success: false, error: `The callback could not be verified: ${verification.reason}` },
    };
  }

  if (parsed.status !== 'success') {
    await db.query(
      `UPDATE payment_transactions SET status = $2, updated_at = NOW() WHERE id = $1`,
      [transaction.id, parsed.status || 'failed'],
    );
    await db.query(
      `UPDATE payment_webhooks SET status = $2, processed_at = NOW() WHERE id = (
         SELECT id FROM payment_webhooks WHERE gateway_txn_id = $1 ORDER BY created_at DESC LIMIT 1
       )`,
      [parsed.transactionId, 'not_settled'],
    );
    return {
      status: 200,
      body: { success: false, status: parsed.status, message: 'Payment was not completed' },
    };
  }

  // The settled amount has to match the invoice. A callback carrying a
  // different amount must never mark the invoice as paid.
  const settledAmount = Number(parsed.amount || verification.amount || transaction.amount || 0);
  const expectedAmount = Number(transaction.amount || 0);

  if (expectedAmount > 0 && Math.abs(settledAmount - expectedAmount) > 0.01) {
    await db.query(
      `UPDATE payment_webhooks SET status = 'amount_mismatch', error = $2, processed_at = NOW() WHERE id = (
         SELECT id FROM payment_webhooks WHERE gateway_txn_id = $1 ORDER BY created_at DESC LIMIT 1
       )`,
      [
        parsed.transactionId,
        `settled ${settledAmount} but the invoice is for ${expectedAmount}`,
      ],
    );
    logger.warn('payment callback amount mismatch', {
      gateway: gatewayName,
      transactionId: parsed.transactionId,
      settledAmount,
      expectedAmount,
    });
    return {
      status: 400,
      body: {
        success: false,
        error: `The settled amount (${settledAmount}) does not match the invoice (${expectedAmount})`,
      },
    };
  }

  const result = await billing.applyPayment({
    invoiceId: transaction.invoice_id,
    transactionId: parsed.transactionId,
    gateway: transaction.gateway,
    amount: settledAmount || transaction.amount,
    raw: parsed.raw,
  });

  await db.query(
    `UPDATE payment_transactions SET status = 'success', updated_at = NOW() WHERE id = $1`,
    [transaction.id],
  );
  await db.query(
    `UPDATE payment_webhooks SET status = 'processed', processed_at = NOW() WHERE id = (
       SELECT id FROM payment_webhooks WHERE gateway_txn_id = $1 ORDER BY created_at DESC LIMIT 1
     )`,
    [parsed.transactionId],
  );

  await audit({
    actorId: transaction.subscriber_id,
    actorRole: ROLES.SUBSCRIBER,
    action: 'payment.settled',
    entityType: 'invoice',
    entityId: transaction.invoice_id,
    details: { gateway: transaction.gateway, transactionId: parsed.transactionId },
    ip: req.ip,
  });

  return {
    status: 200,
    body: {
      success: true,
      status: 'success',
      invoiceId: transaction.invoice_id,
      alreadyPaid: result.alreadyPaid,
    },
  };
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
    const gatewayName = String(req.params.gateway).toLowerCase();
    if (!['bkash', 'nagad', 'sslcommerz', 'rocket', 'mock'].includes(gatewayName)) {
      return res.status(404).json({ success: false, error: `Unknown gateway: ${gatewayName}` });
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
    if (config.payments.mode !== 'mock') {
      return res.status(404).json({ success: false, error: 'Mock checkout is disabled' });
    }

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
      gateway: z.enum(['bkash', 'nagad', 'sslcommerz', 'rocket']),
      transactionId: z.string().min(1),
      payload: z.record(z.any()).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
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
 * GET /api/payments/webhooks
 * Raw webhook log (admin).
 */
router.get(
  '/webhooks',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const result = await db.query('SELECT * FROM payment_webhooks ORDER BY created_at DESC LIMIT $1', [limit]);
    res.json({ success: true, webhooks: result.rows });
  }),
);

module.exports = router;
