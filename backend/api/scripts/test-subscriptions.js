'use strict';

/**
 * Subscription lifecycle test.
 *
 * A registered portal account is not a subscriber. It becomes one only after a
 * package purchase, and it can be cancelled afterwards. Cancelling removes it
 * from the subscriber list while the purchase and cancellation dates stay on
 * the profile.
 *
 * Run with:  node scripts/test-subscriptions.js
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
  console.log('\n=== Subscription lifecycle test ===\n');

  const staffLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@nextlink.com', password: 'admin123' },
  });
  const staffToken = staffLogin.body.token;
  assert(staffLogin.status === 200 && staffToken, 'staff token obtained');

  // -----------------------------------------------------------------------
  console.log('\n1. Registering creates a portal account, not a subscriber');
  const username = `lifecycle${Date.now().toString().slice(-6)}`;
  const registration = await api('/api/auth/register', {
    method: 'POST',
    body: {
      fullName: 'Lifecycle Test User',
      username,
      email: `${username}@example.com`,
      phone: '+8801999000111',
      password: 'LifecyclePass#2026',
      confirmPassword: 'LifecyclePass#2026',
    },
  });
  assert(registration.status === 201 && registration.body.success, 'the account is created', registration.body);
  const subscriberId = registration.body.subscriberId;
  assert(Boolean(subscriberId), 'the account id is returned');

  const login = await api('/api/auth/subscriber-login', {
    method: 'POST',
    body: { username, password: 'LifecyclePass#2026' },
  });
  assert(login.status === 200 && login.body.success, 'the new account can sign in', login.body);
  assert(login.body.subscriber.status === 'registered', 'the account is registered, not an active subscriber', login.body.subscriber);

  const subscriberToken = login.body.token;

  // -----------------------------------------------------------------------
  console.log('\n2. The subscription is not active before a purchase');
  const before = await api('/api/customer/subscription', { token: subscriberToken });
  assert(before.status === 200 && before.body.success, 'the subscription state is readable', before.body);
  assert(before.body.subscription.status === 'registered', 'the status is registered', before.body.subscription);
  assert(before.body.subscription.isSubscriber === false, 'the account is not a subscriber yet');
  assert(before.body.subscription.canCancel === false, 'there is nothing to cancel yet');
  assert(!before.body.subscription.subscriptionStartedAt, 'no purchase date exists yet');

  const profileBefore = await db.queryOne(
    'SELECT status FROM subscriber_billing WHERE subscriber_id = $1',
    [subscriberId],
  );
  assert(!profileBefore, 'a registered account has no billing profile', profileBefore);

  // -----------------------------------------------------------------------
  console.log('\n3. Buying a plan makes the account a subscriber');
  const plan = await db.queryOne(
    "SELECT id, name, price FROM packages WHERE price > 0 ORDER BY price ASC LIMIT 1",
  );
  assert(Boolean(plan && plan.id), 'a billable plan exists in the catalogue', plan);

  const activation = await api('/api/customer/subscription/activate', {
    method: 'POST',
    token: subscriberToken,
    body: { packageId: plan.id, packageName: plan.name, orderId: `ORD-TEST-${Date.now()}` },
  });
  assert(activation.status === 200 && activation.body.success, 'the subscription is activated', activation.body);

  const after = await api('/api/customer/subscription', { token: subscriberToken });
  assert(after.body.subscription.status === 'active', 'the account is now an active subscriber', after.body.subscription);
  assert(after.body.subscription.isSubscriber === true, 'the account counts as a subscriber');
  assert(after.body.subscription.canCancel === true, 'the plan can be cancelled');
  assert(Boolean(after.body.subscription.subscriptionStartedAt), 'the purchase date is recorded');
  assert(Boolean(after.body.subscription.billingProfile), 'a billing profile was created', after.body.subscription.billingProfile);

  const relogin = await api('/api/auth/subscriber-login', {
    method: 'POST',
    body: { username, password: 'LifecyclePass#2026' },
  });
  assert(relogin.body.subscriber.status === 'active', 'the sign-in payload reports the active status');

  // -----------------------------------------------------------------------
  console.log('\n4. Cancelling removes it from the subscriber list but keeps the dates');
  const cancel = await api('/api/customer/subscription/cancel', {
    method: 'POST',
    token: subscriberToken,
    body: { reason: 'lifecycle test' },
  });
  assert(cancel.status === 200 && cancel.body.success, 'the subscription is cancelled', cancel.body);
  assert(Boolean(cancel.body.cancelledAt), 'the cancellation date is returned');

  const afterCancel = await api('/api/customer/subscription', { token: subscriberToken });
  assert(afterCancel.body.subscription.status === 'cancelled', 'the status is cancelled', afterCancel.body.subscription);
  assert(afterCancel.body.subscription.isSubscriber === false, 'the account is no longer a subscriber');
  assert(afterCancel.body.subscription.canCancel === false, 'there is nothing left to cancel');
  assert(Boolean(afterCancel.body.subscription.subscriptionStartedAt), 'the purchase date is still on the profile');
  assert(Boolean(afterCancel.body.subscription.subscriptionCancelledAt), 'the cancellation date is on the profile');

  const cancelAgain = await api('/api/customer/subscription/cancel', {
    method: 'POST',
    token: subscriberToken,
    body: {},
  });
  assert(cancelAgain.status === 400, 'cancelling twice is refused', cancelAgain.body);

  // The billing profile must be closed so the cycle stops billing them.
  const profile = await db.queryOne(
    'SELECT status, auto_disconnect FROM subscriber_billing WHERE subscriber_id = $1',
    [subscriberId],
  );
  assert(profile && profile.status === 'cancelled', 'the billing profile is closed', profile);

  // The monthly cycle must skip a cancelled subscriber.
  const cycleRow = await db.queryOne(
    "SELECT COUNT(*)::int AS count FROM subscribers WHERE id = $1 AND status IN ('active','pending')",
    [subscriberId],
  );
  assert(Number(cycleRow?.count || 0) === 0, 'the cancelled account is not billed by the cycle');

  // -----------------------------------------------------------------------
  console.log('\n5. A subscriber can only cancel their own account');
  // The cancel route takes the account from the token, never from the body.
  // Sending someone else's id in the body must have no effect.
  const cancelledBefore = await db.queryOne(
    'SELECT raw_data->>\'subscriptionCancelledAt\' AS cancelled FROM subscribers WHERE id = $1',
    [subscriberId],
  );
  const crossCancel = await api('/api/customer/subscription/cancel', {
    method: 'POST',
    token: subscriberToken,
    body: { subscriberId: 'SUB-001', reason: 'should be ignored' },
  });
  assert(crossCancel.status === 400, 'a cancelled account cannot be cancelled again', crossCancel.body);
  const cancelledAfter = await db.queryOne(
    'SELECT raw_data->>\'subscriptionCancelledAt\' AS cancelled FROM subscribers WHERE id = $1',
    [subscriberId],
  );
  assert(
    cancelledBefore?.cancelled === cancelledAfter?.cancelled,
    'the account id in the body is ignored',
    { before: cancelledBefore, after: cancelledAfter },
  );

  // A second, unrelated subscriber cancels their own account — the first
  // account must be untouched.
  const username2 = `lifecycleB${Date.now().toString().slice(-5)}`;
  const secondRegistration = await api('/api/auth/register', {
    method: 'POST',
    body: {
      fullName: 'Lifecycle Test User B',
      username: username2,
      email: `${username2}@example.com`,
      phone: '+8801999000222',
      password: 'LifecyclePass#2026',
      confirmPassword: 'LifecyclePass#2026',
    },
  });
  const secondId = secondRegistration.body.subscriberId;
  const secondLogin = await api('/api/auth/subscriber-login', {
    method: 'POST',
    body: { username: username2, password: 'LifecyclePass#2026' },
  });
  const secondCancel = await api('/api/customer/subscription/cancel', {
    method: 'POST',
    token: secondLogin.body.token,
    body: {},
  });
  assert(secondCancel.status === 400, 'a registered account has no subscription to cancel', secondCancel.body);
  const firstStillCancelled = await db.queryOne(
    'SELECT status FROM subscribers WHERE id = $1',
    [subscriberId],
  );
  assert(firstStillCancelled?.status === 'cancelled', 'the first account is unaffected', firstStillCancelled);

  // -----------------------------------------------------------------------
  console.log('\n6. Cleanup — the test accounts are removed');
  for (const id of [subscriberId, secondId].filter(Boolean)) {
    await db.query('DELETE FROM subscriber_billing WHERE subscriber_id = $1', [id]);
    await db.query('DELETE FROM subscriber_credentials WHERE subscriber_id = $1', [id]);
    await db.query('DELETE FROM subscribers WHERE id = $1', [id]);
  }
  const left = await db.queryOne('SELECT id FROM subscribers WHERE id = $1', [subscriberId]);
  assert(!left, 'the test accounts are cleaned up');

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed ? 1 : 0);
}

run()
  .catch((error) => {
    console.error('test failed with an unhandled error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await db.close().catch(() => {});
  });
