'use strict';

/**
 * Package purchase through the payment gateway.
 *
 * The portal never marks an order or an invoice as paid on its own: the
 * purchase is settled by the gateway and the subscription is activated by the
 * billing engine when the payment arrives. This test proves that chain:
 *
 *   registered account -> order + unpaid invoice -> gateway checkout ->
 *   settlement -> the account becomes a subscriber
 *
 * Run with:  node scripts/test-purchase-flow.js
 */

const BASE = process.env.API_BASE_URL || 'http://localhost:3100';
const db = require('../src/lib/db');

let passed = 0;
let failed = 0;

function assert(condition, label, extra) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ''}`);
  }
}

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = { raw };
  }
  return { status: response.status, body: payload };
}

async function run() {
  console.log('\n=== Package purchase through the gateway ===\n');

  // -----------------------------------------------------------------------
  console.log('\n1. A registered account is not a subscriber');
  const username = `purchase${Date.now().toString().slice(-6)}`;
  const registration = await api('/api/auth/register', {
    method: 'POST',
    body: {
      fullName: 'Purchase Flow User',
      username,
      email: `${username}@example.com`,
      phone: '+8801888000111',
      password: 'PurchasePass#2026',
      confirmPassword: 'PurchasePass#2026',
    },
  });
  assert(registration.status === 201 && registration.body.success, 'the account is created', registration.body);
  const subscriberId = registration.body.subscriberId;

  const login = await api('/api/auth/subscriber-login', {
    method: 'POST',
    body: { username, password: 'PurchasePass#2026' },
  });
  assert(login.status === 200 && login.body.token, 'the account can sign in', login.body);
  const token = login.body.token;

  const before = await api('/api/customer/subscription', { token });
  assert(before.body.subscription?.status === 'registered', 'the account is registered', before.body.subscription);

  // -----------------------------------------------------------------------
  console.log('\n2. The order is created with an unpaid invoice');
  const plan = await db.queryOne(
    'SELECT id, name, price FROM packages WHERE price > 0 ORDER BY price ASC LIMIT 1',
  );
  assert(Boolean(plan && plan.id), 'a billable plan exists in the catalogue', plan);

  const orderId = `ORD-TEST-${Date.now()}`;
  const invoiceId = `INV-TEST-${Date.now()}`;
  const amount = Number(plan.price) + 18; // plan price plus the installation fee
  await db.query(
    `INSERT INTO invoices (id, subscriber_id, amount, status, due_date, raw_data, created_at, updated_at)
     VALUES ($1, $2, $3, 'unpaid', $4, $5, NOW(), NOW())`,
    [
      invoiceId,
      subscriberId,
      amount,
      new Date().toISOString().slice(0, 10),
      JSON.stringify({
        id: invoiceId,
        orderId,
        subscriberId,
        packageId: plan.id,
        packageName: plan.name,
        amount,
        status: 'unpaid',
        source: 'package-order',
      }),
    ],
  );
  const invoiceRow = await db.queryOne('SELECT status FROM invoices WHERE id = $1', [invoiceId]);
  assert(invoiceRow?.status === 'unpaid', 'the invoice is created unpaid', invoiceRow);

  // -----------------------------------------------------------------------
  console.log('\n3. The payment is started at the gateway');
  const purchase = await api('/api/portal/purchase', {
    method: 'POST',
    token,
    body: { invoiceId, orderId, packageId: plan.id, packageName: plan.name, gateway: 'bkash' },
  });
  assert(purchase.status === 200 && purchase.body.success, 'the payment is started', purchase.body);
  assert(
    typeof purchase.body.redirectUrl === 'string' && purchase.body.redirectUrl.length > 0,
    'the gateway checkout URL is returned',
    purchase.body,
  );
  assert(Boolean(purchase.body.gatewayTransactionId), 'the gateway transaction id is returned');

  const pending = await api('/api/customer/subscription', { token });
  assert(
    pending.body.subscription?.status === 'registered',
    'the account is still not a subscriber before the payment',
    pending.body.subscription,
  );
  const stillUnpaid = await db.queryOne('SELECT status FROM invoices WHERE id = $1', [invoiceId]);
  assert(stillUnpaid?.status === 'unpaid', 'the invoice is still unpaid before the settlement', stillUnpaid);

  // -----------------------------------------------------------------------
  console.log('\n4. The gateway settles the payment');
  const checkout = await fetch(purchase.body.redirectUrl);
  const checkoutText = await checkout.text();
  assert(/Payment completed successfully/i.test(checkoutText), 'the gateway confirms the payment', checkoutText.slice(0, 200));

  const settled = await db.queryOne('SELECT status FROM invoices WHERE id = $1', [invoiceId]);
  assert(settled?.status === 'paid', 'the billing engine marked the invoice paid', settled);

  const after = await api('/api/customer/subscription', { token });
  assert(after.body.subscription?.status === 'active', 'the account is now active', after.body.subscription);
  assert(after.body.subscription?.isSubscriber === true, 'the account counts as a subscriber');
  assert(Boolean(after.body.subscription?.subscriptionStartedAt), 'the purchase date is recorded');

  const profile = await db.queryOne(
    'SELECT status FROM subscriber_billing WHERE subscriber_id = $1',
    [subscriberId],
  );
  assert(Boolean(profile), 'a billing profile was created', profile);

  const events = await db.query(
    `SELECT event FROM billing_events WHERE subscriber_id = $1 AND event = 'subscription_activated'`,
    [subscriberId],
  );
  assert(events.rows.length > 0, 'the activation is written to the billing ledger', events.rows.length);

  // -----------------------------------------------------------------------
  console.log('\n5. The mock gateway cannot settle a live payment');
  const mockCallback = await api('/api/payments/mock/callback', {
    method: 'POST',
    body: { transactionId: 'not-a-real-transaction', status: 'success', amount },
  });
  assert(mockCallback.status === 404 || mockCallback.status === 400, 'the mock callback does not settle anything', mockCallback.body);

  // -----------------------------------------------------------------------
  console.log('\n6. Cleanup — the test records are removed');
  await db.query('DELETE FROM billing_events WHERE subscriber_id = $1', [subscriberId]);
  await db.query('DELETE FROM invoices WHERE subscriber_id = $1', [subscriberId]);
  await db.query('DELETE FROM subscriber_billing WHERE subscriber_id = $1', [subscriberId]);
  await db.query('DELETE FROM subscriber_credentials WHERE subscriber_id = $1', [subscriberId]);
  await db.query('DELETE FROM subscribers WHERE id = $1', [subscriberId]);
  const left = await db.queryOne('SELECT id FROM subscribers WHERE id = $1', [subscriberId]);
  assert(!left, 'the test account is cleaned up');

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed ? 1 : 0);
}

run()
  .catch((error) => {
    console.error('test failed with an unhandled error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await db.close();
  });
