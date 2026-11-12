'use strict';

/**
 * Subscription lifecycle.
 *
 * A registered portal account is NOT a subscriber. It becomes one the moment a
 * package purchase is completed:
 *
 *   registered --(purchase paid)--> active
 *   active     --(cancel)--------> cancelled
 *
 * Cancelling removes the account from the subscriber list (it no longer has a
 * billing profile and the line is taken down), but the purchase and the
 * cancellation timestamps stay on the record so the customer's profile can
 * always show when the plan was bought and when it ended.
 *
 * The service owns the whole transition, including the billing profile and the
 * router line, so the portal can never activate an account without a plan.
 */

const db = require('../../lib/db');
const logger = require('../../lib/logger');
const utils = require('../../lib/utils');
const { audit } = require('../../middleware/auth');
const billing = require('../billing/engine');
const mikrotik = require('../mikrotik');

const ACTIVE = 'active';
const REGISTERED = 'registered';
const CANCELLED = 'cancelled';

function readRow(row) {
  const raw = row.raw_data || {};
  return {
    id: row.id,
    status: row.status,
    packageId: row.package_id || raw.packageId || '',
    packageName: raw.packageName || raw.package || '',
    subscriptionStartedAt: raw.subscriptionStartedAt || null,
    subscriptionCancelledAt: raw.subscriptionCancelledAt || null,
    phone: row.phone || raw.phone || '',
    name: row.name || raw.name || '',
    username: raw.username || '',
    raw,
  };
}

async function loadSubscriber(subscriberId) {
  const row = await db.queryOne(
    'SELECT id, name, email, phone, status, package_id, raw_data FROM subscribers WHERE id = $1',
    [subscriberId],
  );
  return row ? readRow(row) : null;
}

/**
 * The subscription state the customer sees in their profile.
 */
async function getSubscription(subscriberId) {
  const subscriber = await loadSubscriber(subscriberId);
  if (!subscriber) return null;

  const billingProfile = await db.queryOne(
    'SELECT status, amount, next_invoice_date, package_id FROM subscriber_billing WHERE subscriber_id = $1',
    [subscriberId],
  );

  const invoices = await db.query(
    `SELECT id, amount, status, due_date, created_at
       FROM invoices
      WHERE subscriber_id = $1
      ORDER BY created_at DESC
      LIMIT 25`,
    [subscriberId],
  );

  const purchase = await db.queryOne(
    `SELECT id, package_id, package_name, total_payable, created_at
       FROM orders
      WHERE customer_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [subscriberId],
  );

  return {
    status: subscriber.status,
    isSubscriber: subscriber.status === ACTIVE,
    packageId: subscriber.packageId,
    packageName: subscriber.packageName,
    subscriptionStartedAt: subscriber.subscriptionStartedAt,
    subscriptionCancelledAt: subscriber.subscriptionCancelledAt,
    billingProfile: billingProfile
      ? {
          status: billingProfile.status,
          amount: Number(billingProfile.amount || 0),
          nextInvoiceDate: billingProfile.next_invoice_date,
          packageId: billingProfile.package_id,
        }
      : null,
    lastPurchase: purchase
      ? {
          id: purchase.id,
          packageId: purchase.package_id,
          packageName: purchase.package_name,
          amount: Number(purchase.total_payable || 0),
          createdAt: purchase.created_at,
        }
      : null,
    invoices: invoices.rows.map((i) => ({
      id: i.id,
      amount: Number(i.amount || 0),
      status: i.status,
      dueDate: i.due_date,
      createdAt: i.created_at,
    })),
    canCancel: subscriber.status === ACTIVE,
  };
}

/**
 * Activate a registered account after a completed purchase.
 *
 * The billing profile is created with the catalogue price, so the account is
 * billed from the next cycle onwards, and the router line is provisioned.
 */
async function activateAfterPurchase({ subscriberId, packageId, packageName, orderId }) {
  const subscriber = await loadSubscriber(subscriberId);
  if (!subscriber) throw new Error('Account not found');
  if (subscriber.status === ACTIVE) {
    return { alreadyActive: true, subscriber };
  }
  if (subscriber.status === CANCELLED) {
    throw new Error('This subscription was cancelled. Purchase a plan to start a new subscription.');
  }

  const packageRow = packageId
    ? await db.queryOne('SELECT id, name, price FROM packages WHERE id = $1', [packageId])
    : null;
  const price = packageRow ? Number(packageRow.price || 0) : 0;

  const startedAt = utils.nowIso();

  await db.transaction(async (client) => {
    await client.query(
      `UPDATE subscribers
          SET status = 'active',
              package_id = $2,
              raw_data = COALESCE(raw_data, '{}'::jsonb) || $3::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [
        subscriberId,
        packageId || subscriber.packageId || null,
        JSON.stringify({
          status: 'active',
          packageId: packageId || subscriber.packageId || null,
          packageName: packageName || subscriber.packageName || '',
          subscriptionStartedAt: startedAt,
          joinedAt: subscriber.raw.joinedAt || startedAt,
          activatedFromOrder: orderId || null,
        }),
      ],
    );
  });

  // The billing profile is what the monthly cycle bills against. The billing
  // engine owns it, so it is created through the same helper the cycle uses.
  await billing.ensureBillingProfile(
    {
      ...subscriber,
      packageId: packageId || subscriber.packageId || '',
      status: ACTIVE,
    },
    price,
  );

  // Provision the router line. A router that is unreachable must not fail the
  // activation — the account is active and the provisioning is retried by the
  // daily sweep; the outcome is recorded either way.
  let provisioning = { attempted: false, success: false };
  const username = subscriber.username || subscriberId;
  try {
    provisioning = {
      attempted: true,
      ...(await mikrotik.ensureSecret({
        subscriberId,
        username,
        password: `NL-${utils.randomToken(6).toUpperCase()}`,
      })),
    };
  } catch (error) {
    provisioning = { attempted: true, success: false, error: error.message };
    logger.warn('subscription activated but the router line could not be provisioned', {
      subscriberId,
      error: error.message,
    });
  }

  await db.query(
    `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message)
     VALUES ($1, $2, 'subscription_activated', $3, $4)`,
    [subscriberId, orderId || null, price, `Subscription activated on the ${packageName || 'selected'} plan`],
  );

  await audit({
    actorId: subscriberId,
    actorRole: 'subscriber',
    action: 'subscription.activated',
    entityType: 'subscriber',
    entityId: subscriberId,
    details: { packageId, packageName, orderId: orderId || null, provisioning },
    ip: null,
  });

  return { alreadyActive: false, provisioning, startedAt };
}

/**
 * Cancel an active subscription.
 *
 * The account leaves the subscriber list — no billing profile, no router line —
 * but the purchase and cancellation timestamps are kept so the profile can
 * always show the history.
 */
async function cancel({ subscriberId, reason }) {
  const subscriber = await loadSubscriber(subscriberId);
  if (!subscriber) throw new Error('Account not found');
  if (subscriber.status === CANCELLED) {
    throw new Error('This subscription is already cancelled.');
  }
  if (subscriber.status === REGISTERED) {
    throw new Error('This account has no active subscription to cancel.');
  }

  const cancelledAt = utils.nowIso();

  await db.transaction(async (client) => {
    await client.query(
      `UPDATE subscribers
          SET status = 'cancelled',
              raw_data = COALESCE(raw_data, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [
        subscriberId,
        JSON.stringify({
          status: 'cancelled',
          subscriptionCancelledAt: cancelledAt,
          cancellationReason: reason || 'customer request',
          cancelledBy: 'self',
        }),
      ],
    );

    // Stop billing: the profile is closed, so the monthly cycle skips it.
    await client.query(
      `UPDATE subscriber_billing
          SET status = 'cancelled', auto_disconnect = FALSE, updated_at = NOW()
        WHERE subscriber_id = $1`,
      [subscriberId],
    );
  });

  // Take the line down so the service actually stops.
  let suspension = { attempted: false, success: false };
  try {
    suspension = {
      attempted: true,
      ...(await mikrotik.suspendSubscriber({
        subscriberId,
        username: subscriber.username || subscriberId,
      })),
    };
  } catch (error) {
    suspension = { attempted: true, success: false, error: error.message };
    logger.warn('subscription cancelled but the router line could not be suspended', {
      subscriberId,
      error: error.message,
    });
  }

  await db.query(
    `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message)
     VALUES ($1, NULL, 'subscription_cancelled', 0, $2)`,
    [subscriberId, `Subscription cancelled by the customer${reason ? `: ${reason}` : ''}`],
  );

  await audit({
    actorId: subscriberId,
    actorRole: 'subscriber',
    action: 'subscription.cancelled',
    entityType: 'subscriber',
    entityId: subscriberId,
    details: { reason: reason || null, suspension },
    ip: null,
  });

  return { cancelledAt, suspension };
}

module.exports = { getSubscription, activateAfterPurchase, cancel, ACTIVE, REGISTERED, CANCELLED };
