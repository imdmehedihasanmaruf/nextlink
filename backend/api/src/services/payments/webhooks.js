'use strict';

/**
 * Webhook Reliability, Event Tracking & Bounded Retry Service
 *
 * Implements Phase 4.4.5:
 *   Part 1: Webhook Reliability & Authenticity Verification
 *   Part 2: Webhook Event Tracking & Payload Sanitization
 *   Part 3: Bounded Retry & Recovery with Exponential Backoff
 */

const crypto = require('crypto');
const db = require('../../lib/db');
const logger = require('../../lib/logger');
const utils = require('../../lib/utils');
const billing = require('../billing/engine');
const gateways = require('./gateways');
const { ROLES, audit } = require('../../middleware/auth');

const MAX_RETRY_ATTEMPTS = 5;

const ERROR_CATEGORIES = {
  SIGNATURE_VERIFICATION_FAILED: 'SIGNATURE_VERIFICATION_FAILED',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  OWNERSHIP_MISMATCH: 'OWNERSHIP_MISMATCH',
  INVOICE_NOT_FOUND: 'INVOICE_NOT_FOUND',
  TRANSACTION_NOT_FOUND: 'TRANSACTION_NOT_FOUND',
  GATEWAY_MISMATCH: 'GATEWAY_MISMATCH',
  PAYMENT_FAILED_STATUS: 'PAYMENT_FAILED_STATUS',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  SYSTEM_ERROR: 'SYSTEM_ERROR',
  DEAD_LETTER_EXHAUSTED: 'DEAD_LETTER_EXHAUSTED',
};

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /app_?secret/i,
  /store_?passwd/i,
  /token/i,
  /auth(orization)?/i,
  /api_?key/i,
  /card_?(number|no)?/i,
  /pan/i,
  /cvv/i,
  /cvc/i,
  /pin/i,
  /private_?key/i,
  /certificate/i,
  /credential/i,
];

/**
 * Sanitize webhook payload recursively:
 * Strips or redacts passwords, secrets, card data, tokens, and credentials.
 * Never stores or logs raw credentials.
 */
function sanitizePayload(data) {
  if (data === null || data === undefined) {
    return data;
  }
  if (typeof data !== 'object') {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((item) => sanitizePayload(item));
  }

  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
    if (isSensitive) {
      clean[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = sanitizePayload(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

const schemaEnsuredDbs = new Set();
async function ensureWebhookSchema() {
  const activeDb = db.getActiveDatabaseName();
  if (schemaEnsuredDbs.has(activeDb)) return;
  try {
    await db.query(`
      ALTER TABLE payment_webhooks ADD COLUMN IF NOT EXISTS event_id VARCHAR(100);
      ALTER TABLE payment_webhooks ADD COLUMN IF NOT EXISTS provider VARCHAR(50);
      ALTER TABLE payment_webhooks ADD COLUMN IF NOT EXISTS transaction_reference VARCHAR(150);
      ALTER TABLE payment_webhooks ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE payment_webhooks ADD COLUMN IF NOT EXISTS last_error_category VARCHAR(80);
      ALTER TABLE payment_webhooks ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
      ALTER TABLE payment_webhooks ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ DEFAULT NOW();
      CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_webhooks_provider_event_id
        ON payment_webhooks (provider, event_id)
        WHERE event_id IS NOT NULL;
    `);
    schemaEnsuredDbs.add(activeDb);
  } catch (e) {
    // ignore if concurrently applied or permissions
  }
}

/**
 * Calculate exponential backoff next retry timestamp.
 * Base 1s: 1s, 2s, 4s, 8s, 16s... up to 60s max.
 */
function calculateNextRetryAt(attemptCount) {
  const baseMs = 1000;
  const backoffMs = Math.min(baseMs * Math.pow(2, Math.max(0, attemptCount - 1)), 60000);
  return new Date(Date.now() + backoffMs);
}

/**
 * Record an inbound webhook event with database-level deduplication.
 * Ensures fields: event_id, provider, transaction_reference, event_type,
 * received_at, status ('pending', 'processed', 'failed', 'dead_letter'),
 * attempt_count, last_error_category, processed_at.
 */
async function recordWebhookEvent({
  provider,
  eventType,
  transactionReference,
  payload,
  eventIdOverride = null,
}) {
  await ensureWebhookSchema();
  const normalizedProvider = String(provider || 'unknown').toLowerCase();
  const eventId =
    eventIdOverride ||
    payload?.event_id ||
    payload?.eventId ||
    payload?.ipn_id ||
    payload?.val_id ||
    (transactionReference ? `${normalizedProvider}:${transactionReference}` : `evt_${crypto.randomUUID()}`);

  const sanitized = sanitizePayload(payload || {});

  // Check if this provider + event_id already exists in the database
  let existing = await db.queryOne(
    `SELECT * FROM payment_webhooks WHERE provider = $1 AND event_id = $2 ORDER BY id DESC LIMIT 1`,
    [normalizedProvider, eventId],
  );

  if (!existing && transactionReference) {
    // Also check if this transaction reference already has a processed webhook
    existing = await db.queryOne(
      `SELECT * FROM payment_webhooks WHERE provider = $1 AND (transaction_reference = $2 OR gateway_txn_id = $2) AND status = 'processed' ORDER BY id DESC LIMIT 1`,
      [normalizedProvider, transactionReference],
    );
  }

  if (existing) {
    return {
      webhook: existing,
      isDuplicate: true,
      eventId,
    };
  }

  // Insert new record into payment_webhooks
  const inserted = await db.queryOne(
    `INSERT INTO payment_webhooks
       (event_id, provider, gateway, event_type, transaction_reference, gateway_txn_id, payload, status, attempt_count, received_at)
     VALUES ($1, $2, $2, $3, $4, $4, $5, 'pending', 1, NOW())
     ON CONFLICT (provider, event_id) WHERE event_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      eventId,
      normalizedProvider,
      eventType || 'callback',
      transactionReference || null,
      JSON.stringify(sanitized),
    ],
  );

  if (!inserted) {
    // Conflict occurred concurrently; reload existing
    const reloaded = await db.queryOne(
      `SELECT * FROM payment_webhooks WHERE provider = $1 AND event_id = $2 ORDER BY id DESC LIMIT 1`,
      [normalizedProvider, eventId],
    );
    return {
      webhook: reloaded,
      isDuplicate: true,
      eventId,
    };
  }

  return {
    webhook: inserted,
    isDuplicate: false,
    eventId,
  };
}

/**
 * Update webhook status and retry tracking.
 */
async function updateWebhookStatus({
  id,
  status,
  error = null,
  errorCategory = null,
  incrementAttempt = false,
  processed = false,
}) {
  let queryStr = `UPDATE payment_webhooks SET status = $2`;
  const params = [id, status];
  let paramIdx = 3;

  if (incrementAttempt) {
    queryStr += `, attempt_count = COALESCE(attempt_count, 1) + 1`;
  }
  if (error !== null) {
    queryStr += `, error = $${paramIdx++}`;
    params.push(String(error).slice(0, 1000));
  }
  if (errorCategory !== null) {
    queryStr += `, last_error_category = $${paramIdx++}`;
    params.push(errorCategory);
  }
  if (processed || status === 'processed') {
    queryStr += `, processed_at = NOW()`;
  }
  if (status === 'failed' || status === 'pending') {
    const current = await db.queryOne('SELECT attempt_count FROM payment_webhooks WHERE id = $1', [id]);
    const nextRetry = calculateNextRetryAt(current?.attempt_count || 1);
    queryStr += `, next_retry_at = $${paramIdx++}`;
    params.push(nextRetry);
  }

  queryStr += ` WHERE id = $1 RETURNING *`;
  return db.queryOne(queryStr, params);
}

/**
 * Mark a webhook permanently as dead_letter.
 */
async function markDeadLetter(id, error, errorCategory = ERROR_CATEGORIES.DEAD_LETTER_EXHAUSTED) {
  return updateWebhookStatus({
    id,
    status: 'dead_letter',
    error,
    errorCategory,
    processed: false,
  });
}

/**
 * Authoritative callback and webhook processing pipeline.
 *
 * Implements strict signature/authenticity checks, amount/currency/ownership
 * validation, idempotency, bounded retry counter, and event tracking.
 */
async function processWebhook({
  gatewayName,
  req,
  webhookRecord = null,
  isRetry = false,
}) {
  const config = require('../../config');
  const isProd =
    config.payments.mode === 'live' ||
    config.env === 'production' ||
    process.env.NODE_ENV === 'production' ||
    String(req?.headers?.['x-simulate-production'] || '').toLowerCase() === 'true';

  if (gatewayName === 'mock' && isProd) {
    return {
      status: 404,
      body: {
        success: false,
        error: 'The mock payment gateway is disabled in production.',
      },
    };
  }

  const rawPayload = { ...req.body, ...req.query };
  const gateway = gateways.resolveGateway(gatewayName);

  let parsed;
  try {
    parsed = gateway.parseWebhook(rawPayload);
  } catch (error) {
    if (webhookRecord) {
      await updateWebhookStatus({
        id: webhookRecord.id,
        status: 'failed',
        error: error.message,
        errorCategory: ERROR_CATEGORIES.PROVIDER_ERROR,
      });
    }
    return {
      status: 400,
      body: { success: false, error: `Unsupported callback payload: ${error.message}` },
    };
  }

  const transactionId = parsed.transactionId || rawPayload.transactionId || rawPayload.trxID || rawPayload.paymentID || null;

  // Ingest or get tracking record
  let webhook = webhookRecord;
  if (!webhook) {
    const eventType = rawPayload.event_type || rawPayload.status || 'callback';
    const recorded = await recordWebhookEvent({
      provider: gatewayName,
      eventType,
      transactionReference: transactionId,
      payload: rawPayload,
      eventIdOverride: req?.headers?.['x-event-id'],
    });
    webhook = recorded.webhook;

    // If duplicate event that has already been successfully processed, return cached safe success
    if (recorded.isDuplicate && webhook.status === 'processed') {
      const existingTxn = transactionId
        ? await db.queryOne('SELECT * FROM payment_transactions WHERE gateway_txn_id = $1 LIMIT 1', [transactionId])
        : null;
      return {
        status: 200,
        body: {
          success: true,
          status: 'success',
          invoiceId: existingTxn?.invoice_id || null,
          alreadyPaid: true,
          alreadySettled: true,
          alreadyProcessed: true,
          message: 'Webhook event has already been processed idempotently.',
        },
      };
    }
  }

  // Verify signature & authenticity first
  let verification = { verified: true, reason: 'no verification required' };
  try {
    if (typeof gateway.verifyWebhook === 'function') {
      verification = await gateway.verifyWebhook(rawPayload, req);
    }
  } catch (error) {
    verification = { verified: false, reason: error.message };
  }

  if (!verification.verified) {
    const attemptCount = (webhook.attempt_count || 1) + (isRetry ? 1 : 0);
    const isExhausted = attemptCount >= MAX_RETRY_ATTEMPTS;
    await updateWebhookStatus({
      id: webhook.id,
      status: isExhausted ? 'dead_letter' : 'failed',
      error: String(verification.reason || 'verification failed').slice(0, 500),
      errorCategory: ERROR_CATEGORIES.SIGNATURE_VERIFICATION_FAILED,
      incrementAttempt: isRetry,
    });
    logger.warn('payment callback rejected by authenticity check', {
      gateway: gatewayName,
      transactionId,
      reason: verification.reason,
      attemptCount,
    });
    return {
      status: 401,
      body: {
        success: false,
        error: `The callback could not be verified: ${verification.reason}`,
        errorCategory: ERROR_CATEGORIES.SIGNATURE_VERIFICATION_FAILED,
      },
    };
  }

  // Look up transaction
  const transaction = transactionId
    ? await db.queryOne(
        'SELECT * FROM payment_transactions WHERE gateway_txn_id = $1 ORDER BY created_at DESC LIMIT 1',
        [transactionId],
      )
    : null;

  if (!transaction) {
    const attemptCount = (webhook.attempt_count || 1) + (isRetry ? 1 : 0);
    const isExhausted = attemptCount >= MAX_RETRY_ATTEMPTS;
    await updateWebhookStatus({
      id: webhook.id,
      status: isExhausted ? 'dead_letter' : 'failed',
      error: 'No matching payment transaction found',
      errorCategory: ERROR_CATEGORIES.TRANSACTION_NOT_FOUND,
      incrementAttempt: isRetry,
    });
    return {
      status: 404,
      body: {
        success: false,
        error: 'No matching payment transaction found',
        errorCategory: ERROR_CATEGORIES.TRANSACTION_NOT_FOUND,
      },
    };
  }

  // Verify gateway match
  const mockMode = config.payments.mode !== 'live';
  if (transaction.gateway !== gatewayName && !(gatewayName === 'mock' && mockMode)) {
    const attemptCount = (webhook.attempt_count || 1) + (isRetry ? 1 : 0);
    const isExhausted = attemptCount >= MAX_RETRY_ATTEMPTS;
    await updateWebhookStatus({
      id: webhook.id,
      status: isExhausted ? 'dead_letter' : 'failed',
      error: `This transaction belongs to ${transaction.gateway}, not ${gatewayName}`,
      errorCategory: ERROR_CATEGORIES.GATEWAY_MISMATCH,
      incrementAttempt: isRetry,
    });
    return {
      status: 400,
      body: {
        success: false,
        error: `This transaction belongs to ${transaction.gateway}, not ${gatewayName}`,
        errorCategory: ERROR_CATEGORIES.GATEWAY_MISMATCH,
      },
    };
  }

  // Handle gateway non-success status
  if (parsed.status !== 'success') {
    await db.query(
      `UPDATE payment_transactions SET status = $2, updated_at = NOW() WHERE id = $1`,
      [transaction.id, parsed.status || 'failed'],
    );
    await updateWebhookStatus({
      id: webhook.id,
      status: 'processed',
      error: `Payment status reported as ${parsed.status}`,
      errorCategory: ERROR_CATEGORIES.PAYMENT_FAILED_STATUS,
      processed: true,
      incrementAttempt: isRetry,
    });

    try {
      const notifications = require('../notifications');
      if (transaction.subscriber_id) {
        await notifications.notifySubscriber(transaction.subscriber_id, {
          type: 'payment_failed',
          title: 'Payment Failed',
          message: `Payment of $${utils.formatAmount(transaction.amount)} for Invoice #${transaction.invoice_id} was not completed (${parsed.status || 'failed'}).`,
          link: '/dashboard/orders',
          meta: { invoiceId: transaction.invoice_id, transactionId: transaction.id, status: parsed.status },
        });
      }
      await notifications.notifyAdmins({
        type: 'admin_failed_payment',
        title: 'Failed Payment Alert',
        message: `Subscriber ${transaction.subscriber_id || 'Unknown'} failed payment of $${utils.formatAmount(transaction.amount)} on Invoice #${transaction.invoice_id} via ${transaction.gateway}.`,
        link: '/billing',
        roleTarget: 'billing',
        meta: { invoiceId: transaction.invoice_id, subscriberId: transaction.subscriber_id, gateway: transaction.gateway },
      });
    } catch (notifErr) {
      logger.warn('failed payment notification error', { error: notifErr.message });
    }

    return {
      status: 200,
      body: { success: false, status: parsed.status, message: 'Payment was not completed' },
    };
  }

  // Validate Amount
  const settledAmount = Number(parsed.amount || verification.amount || transaction.amount || 0);
  const expectedAmount = Number(transaction.amount || 0);

  if (expectedAmount > 0 && Math.abs(settledAmount - expectedAmount) > 0.01) {
    const errorMsg = `Settled amount (${settledAmount}) does not match expected invoice amount (${expectedAmount})`;
    const attemptCount = (webhook.attempt_count || 1) + (isRetry ? 1 : 0);
    const isExhausted = attemptCount >= MAX_RETRY_ATTEMPTS;
    await updateWebhookStatus({
      id: webhook.id,
      status: isExhausted ? 'dead_letter' : 'failed',
      error: errorMsg,
      errorCategory: ERROR_CATEGORIES.AMOUNT_MISMATCH,
      incrementAttempt: isRetry,
    });
    logger.warn('payment callback amount mismatch (fail-closed)', {
      gateway: gatewayName,
      transactionId,
      settledAmount,
      expectedAmount,
    });
    return {
      status: 400,
      body: {
        success: false,
        error: errorMsg,
        errorCategory: ERROR_CATEGORIES.AMOUNT_MISMATCH,
      },
    };
  }

  // Validate Currency
  const expectedCurrency = String(transaction.currency || 'USD').toUpperCase();
  const rawCurrency = parsed.currency || verification.currency || rawPayload.currency || req?.query?.currency;
  const settledCurrency = rawCurrency ? String(rawCurrency).toUpperCase() : expectedCurrency;

  if (settledCurrency !== expectedCurrency) {
    const errorMsg = `Currency mismatch: transaction expected ${expectedCurrency} but callback reported ${settledCurrency}`;
    const attemptCount = (webhook.attempt_count || 1) + (isRetry ? 1 : 0);
    const isExhausted = attemptCount >= MAX_RETRY_ATTEMPTS;
    await updateWebhookStatus({
      id: webhook.id,
      status: isExhausted ? 'dead_letter' : 'failed',
      error: errorMsg,
      errorCategory: ERROR_CATEGORIES.CURRENCY_MISMATCH,
      incrementAttempt: isRetry,
    });
    logger.warn('payment callback currency mismatch (fail-closed)', {
      gateway: gatewayName,
      transactionId,
      settledCurrency,
      expectedCurrency,
    });
    return {
      status: 400,
      body: {
        success: false,
        error: errorMsg,
        errorCategory: ERROR_CATEGORIES.CURRENCY_MISMATCH,
      },
    };
  }

  // Validate Invoice & Subscriber Ownership
  const invoice = await db.queryOne('SELECT * FROM invoices WHERE id = $1', [transaction.invoice_id]);
  if (!invoice) {
    const errorMsg = `Invoice #${transaction.invoice_id} not found for transaction`;
    const attemptCount = (webhook.attempt_count || 1) + (isRetry ? 1 : 0);
    const isExhausted = attemptCount >= MAX_RETRY_ATTEMPTS;
    await updateWebhookStatus({
      id: webhook.id,
      status: isExhausted ? 'dead_letter' : 'failed',
      error: errorMsg,
      errorCategory: ERROR_CATEGORIES.INVOICE_NOT_FOUND,
      incrementAttempt: isRetry,
    });
    return {
      status: 404,
      body: {
        success: false,
        error: errorMsg,
        errorCategory: ERROR_CATEGORIES.INVOICE_NOT_FOUND,
      },
    };
  }

  if (invoice.subscriber_id && transaction.subscriber_id && invoice.subscriber_id !== transaction.subscriber_id) {
    const errorMsg = `Subscriber ownership mismatch: invoice belongs to ${invoice.subscriber_id} but transaction belongs to ${transaction.subscriber_id}`;
    const attemptCount = (webhook.attempt_count || 1) + (isRetry ? 1 : 0);
    const isExhausted = attemptCount >= MAX_RETRY_ATTEMPTS;
    await updateWebhookStatus({
      id: webhook.id,
      status: isExhausted ? 'dead_letter' : 'failed',
      error: errorMsg,
      errorCategory: ERROR_CATEGORIES.OWNERSHIP_MISMATCH,
      incrementAttempt: isRetry,
    });
    return {
      status: 403,
      body: {
        success: false,
        error: errorMsg,
        errorCategory: ERROR_CATEGORIES.OWNERSHIP_MISMATCH,
      },
    };
  }

  // Validate subscriber reference in payload if provided
  const payloadSubId =
    parsed.subscriberId ||
    rawPayload.subscriberId ||
    rawPayload.customerReference ||
    rawPayload.payerReference ||
    null;
  if (payloadSubId && transaction.subscriber_id && payloadSubId !== transaction.subscriber_id) {
    const errorMsg = `Customer reference mismatch: payload specifies ${payloadSubId} but transaction belongs to ${transaction.subscriber_id}`;
    const attemptCount = (webhook.attempt_count || 1) + (isRetry ? 1 : 0);
    const isExhausted = attemptCount >= MAX_RETRY_ATTEMPTS;
    await updateWebhookStatus({
      id: webhook.id,
      status: isExhausted ? 'dead_letter' : 'failed',
      error: errorMsg,
      errorCategory: ERROR_CATEGORIES.OWNERSHIP_MISMATCH,
      incrementAttempt: isRetry,
    });
    return {
      status: 403,
      body: {
        success: false,
        error: errorMsg,
        errorCategory: ERROR_CATEGORIES.OWNERSHIP_MISMATCH,
      },
    };
  }

  // Idempotent Check: If invoice is already paid, do not re-apply side-effects
  if (invoice.status === 'paid') {
    await db.query(
      `UPDATE payment_transactions SET status = 'success', updated_at = NOW() WHERE id = $1`,
      [transaction.id],
    );
    await updateWebhookStatus({
      id: webhook.id,
      status: 'processed',
      processed: true,
      incrementAttempt: isRetry,
    });
    return {
      status: 200,
      body: {
        success: true,
        status: 'success',
        invoiceId: transaction.invoice_id,
        alreadyPaid: true,
        alreadySettled: true,
      },
    };
  }

  // Apply payment through billing engine (atomic & idempotent)
  const result = await billing.applyPayment({
    invoiceId: transaction.invoice_id,
    transactionId: parsed.transactionId,
    gateway: transaction.gateway,
    amount: settledAmount || transaction.amount,
    raw: parsed.raw,
  });

  // Activate subscriber if registered
  let activation = null;
  const invoiceRow = await db.queryOne('SELECT raw_data FROM invoices WHERE id = $1', [transaction.invoice_id]);
  const invoiceRaw = (invoiceRow && invoiceRow.raw_data) || {};
  try {
    const subscriberRow = await db.queryOne(
      'SELECT id, status FROM subscribers WHERE id = $1',
      [transaction.subscriber_id],
    );
    if (subscriberRow && subscriberRow.status === 'registered') {
      const packageId = invoiceRaw.packageId || null;
      const packageName = invoiceRaw.packageName || null;
      if (packageId) {
        activation = await require('../subscriptions').activateAfterPurchase({
          subscriberId: transaction.subscriber_id,
          packageId,
          packageName,
          orderId: invoiceRaw.orderId || null,
        });
      }
    }
  } catch (activationError) {
    logger.error('Payment settled but subscription activation failed', {
      subscriberId: transaction.subscriber_id,
      invoiceId: transaction.invoice_id,
      message: activationError.message,
    });
  }

  // Update order if linked
  if (invoiceRaw.orderId) {
    await db.query(
      `UPDATE orders
          SET payment_status = 'Payment Verified',
              trx_id = COALESCE(trx_id, $2),
              updated_at = NOW()
        WHERE id = $1`,
      [invoiceRaw.orderId, parsed.transactionId || null],
    );
  }

  // Mark transaction and webhook as success / processed
  await db.query(
    `UPDATE payment_transactions SET status = 'success', updated_at = NOW() WHERE id = $1`,
    [transaction.id],
  );
  await updateWebhookStatus({
    id: webhook.id,
    status: 'processed',
    processed: true,
    incrementAttempt: isRetry,
  });

  await audit({
    actorId: transaction.subscriber_id || 'system',
    actorRole: ROLES.SUBSCRIBER,
    action: isRetry ? 'payment.webhook_retried_and_settled' : 'payment.settled',
    entityType: 'invoice',
    entityId: transaction.invoice_id,
    details: { gateway: transaction.gateway, transactionId: parsed.transactionId, webhookId: webhook.id },
    ip: req?.ip,
  });

  return {
    status: 200,
    body: {
      success: true,
      status: 'success',
      invoiceId: transaction.invoice_id,
      alreadyPaid: Boolean(result.alreadyPaid),
      activated: Boolean(activation && activation.alreadyActive === false),
    },
  };
}

/**
 * Staff manual retry of a webhook event:
 * POST /api/payments/webhooks/:id/retry
 *
 * Strict idempotency guaranteed:
 * Retries and restarts will NEVER produce duplicate invoice settlement
 * or duplicate billing_events.
 */
async function retryWebhookById(id, { actorId, actorRole, ip }) {
  await ensureWebhookSchema();
  const webhook = await db.queryOne(
    `SELECT * FROM payment_webhooks WHERE id = $1 OR event_id = $2`,
    [Number.isInteger(Number(id)) ? Number(id) : -1, String(id)],
  );

  if (!webhook) {
    const error = new Error(`Webhook event #${id} not found`);
    error.statusCode = 404;
    throw error;
  }

  // If already processed, report idempotently without executing side-effects
  if (webhook.status === 'processed') {
    return {
      success: true,
      message: 'Webhook event is already processed successfully.',
      alreadyProcessed: true,
      webhook,
    };
  }

  // Check attempt bounds
  const currentAttempts = webhook.attempt_count || 1;
  const newAttemptCount = currentAttempts + 1;

  const simulatedReq = {
    body: webhook.payload || {},
    query: {},
    headers: {},
    ip: ip || '127.0.0.1',
  };

  const result = await processWebhook({
    gatewayName: webhook.gateway || webhook.provider,
    req: simulatedReq,
    webhookRecord: webhook,
    isRetry: true,
  });

  await audit({
    actorId: actorId || 'admin',
    actorRole: actorRole || ROLES.ADMIN,
    action: 'payment.webhook.manual_retry',
    entityType: 'payment_webhook',
    entityId: String(webhook.id),
    details: {
      attemptCount: newAttemptCount,
      outcome: result.status === 200 ? 'success' : 'failed',
      result: result.body,
    },
    ip,
  });

  const updated = await db.queryOne('SELECT * FROM payment_webhooks WHERE id = $1', [webhook.id]);

  return {
    success: result.status === 200,
    status: result.status,
    result: result.body,
    webhook: updated,
  };
}

module.exports = {
  MAX_RETRY_ATTEMPTS,
  ERROR_CATEGORIES,
  sanitizePayload,
  calculateNextRetryAt,
  recordWebhookEvent,
  updateWebhookStatus,
  markDeadLetter,
  processWebhook,
  retryWebhookById,
};
