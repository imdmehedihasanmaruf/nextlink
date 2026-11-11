'use strict';

const config = require('../../config');
const logger = require('../../lib/logger');
const db = require('../../lib/db');

/**
 * SMS notification engine.
 *
 * Templates used across the product:
 *   bill_reminder   — upcoming / overdue bill notice
 *   bill_overdue    — final warning before auto-suspension
 *   payment_success — payment receipt confirmation
 *   service_suspended— line suspended because of unpaid bill
 *   service_restored — line restored after payment
 *   ticket_update   — support ticket status change
 *
 * In `mock` mode messages are persisted to `sms_messages` and logged, but not
 * sent to a real gateway. In `live` mode they are POSTed to the configured
 * provider URL.
 */

// SMS travels as GSM 7-bit, which does not contain the Taka sign, so the
// message body uses the plain currency code instead.
const money = (amount) =>
  `${config.billing.currencySymbolSms} ${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

const TEMPLATES = {
  bill_reminder: (ctx) =>
    `Dear ${ctx.name}, your NextLink bill of ${money(ctx.amount)} is due on ${ctx.dueDate}. Pay via the client portal to keep your service active. Thank you.`,
  bill_overdue: (ctx) =>
    `Dear ${ctx.name}, your NextLink bill of ${money(ctx.amount)} is overdue since ${ctx.dueDate}. Service will be suspended on ${ctx.suspendDate} unless payment is made.`,
  payment_success: (ctx) =>
    `Dear ${ctx.name}, we have received your payment of ${money(ctx.amount)} for invoice ${ctx.invoiceId}. Your account is up to date. Thank you.`,
  service_suspended: (ctx) =>
    `Dear ${ctx.name}, your NextLink service has been suspended because invoice ${ctx.invoiceId} (${money(ctx.amount)}) is unpaid. Pay now to reconnect automatically.`,
  service_restored: (ctx) =>
    `Dear ${ctx.name}, payment received. Your NextLink service has been restored and you will be reconnected shortly. Thank you.`,
  ticket_update: (ctx) =>
    `Dear ${ctx.name}, your support ticket ${ctx.ticketId} (${ctx.title}) is now ${ctx.status}. Thank you for contacting NextLink.`,
  maintenance_notice: (ctx) =>
    `Dear ${ctx.name}, NextLink will carry out maintenance in your area on ${ctx.date} between ${ctx.start} and ${ctx.end}. Service may be interrupted briefly.`,
};

/**
 * Render a template into a message body.
 */
function render(template, context) {
  const build = TEMPLATES[template];
  if (!build) {
    throw new Error(`Unknown SMS template: ${template}`);
  }
  return build(context);
}

/**
 * Send an SMS and persist the outcome.
 *
 * @param {object} options
 * @param {string} options.phone
 * @param {string} options.body
 * @param {string} [options.template]
 * @param {string} [options.subscriberId]
 * @returns {Promise<{success:boolean,id:number,status:string,error?:string}>}
 */
async function send({ phone, body, template = null, subscriberId = null, context = {} }) {
  if (!phone) {
    return { success: false, status: 'failed', error: 'Phone number is required' };
  }

  const message = body || (template ? render(template, context) : null);
  if (!message) {
    return { success: false, status: 'failed', error: 'Either body or template is required' };
  }

  // The gateway the operator configured in the admin panel takes precedence
  // over the environment file. The environment wins when it explicitly asks
  // for live mode, so a deployment is never downgraded by a stale value.
  const stored = (await require('../settings').getGroup('sms').catch(() => ({}))) || {};
  const envIsLive = config.sms.mode === 'live';
  const settings = {
    mode: envIsLive ? 'live' : stored.mode || config.sms.mode,
    providerUrl: stored.providerUrl || config.sms.providerUrl,
    apiKey: stored.apiKey || config.sms.apiKey,
    senderId: stored.senderId || config.sms.senderId,
  };

  const inserted = await db.query(
    `INSERT INTO sms_messages (subscriber_id, phone, body, template, status, provider)
     VALUES ($1, $2, $3, $4, 'queued', $5)
     RETURNING id`,
    [subscriberId, phone, message, template, settings.mode],
  );
  const messageId = inserted.rows[0].id;

  if (settings.mode !== 'live') {
    await db.query(
      `UPDATE sms_messages SET status = 'sent', provider_message_id = $2, sent_at = NOW() WHERE id = $1`,
      [messageId, `MOCK-${Date.now()}-${messageId}`],
    );
    logger.info('sms dispatched (mock mode)', { id: messageId, template, subscriberId });
    return { success: true, id: messageId, status: 'sent', mock: true };
  }

  try {
    const response = await fetch(settings.providerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        to: phone,
        message,
        sender_id: settings.senderId,
      }),
    });

    if (!response.ok) {
      throw new Error(`SMS gateway responded with ${response.status}`);
    }

    const result = await response.json().catch(() => ({}));
    const providerId = result.id || result.message_id || result.sid || null;

    await db.query(
      `UPDATE sms_messages SET status = 'sent', provider_message_id = $2, sent_at = NOW(), raw_data = $3 WHERE id = $1`,
      [messageId, providerId, JSON.stringify(result)],
    );

    return { success: true, id: messageId, status: 'sent', providerMessageId: providerId };
  } catch (error) {
    await db.query(
      `UPDATE sms_messages SET status = 'failed', error = $2 WHERE id = $1`,
      [messageId, error.message.slice(0, 500)],
    );
    logger.error('sms dispatch failed', { id: messageId, message: error.message });
    return { success: false, id: messageId, status: 'failed', error: error.message };
  }
}

/**
 * Send a templated message.
 */
async function sendTemplate(template, context, { subscriberId = null } = {}) {
  try {
    const body = render(template, context);
    return await send({ phone: context.phone, body, template, subscriberId });
  } catch (error) {
    logger.error('sms template render failed', { template, message: error.message });
    return { success: false, status: 'failed', error: error.message };
  }
}

/**
 * List recent SMS messages (admin panel).
 */
async function listMessages({ subscriberId = null, status = null, limit = 100 }) {
  const conditions = [];
  const params = [];
  if (subscriberId) {
    params.push(subscriberId);
    conditions.push(`subscriber_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Number(limit) || 100, 500));

  const result = await db.query(
    `SELECT * FROM sms_messages ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return result.rows;
}

module.exports = { TEMPLATES, render, send, sendTemplate, listMessages };
