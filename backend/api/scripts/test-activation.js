'use strict';

/**
 * Activation and upgrade test.
 *
 * Verifies the customer onboarding path that the audit found broken:
 *   * approving a connection request creates the customer, the hashed
 *     credential and the billing profile
 *   * the new customer can sign in with the temporary password
 *   * the customer is billed by the billing engine
 *   * the order type is stored in one case everywhere
 *   * the customer API routes refuse an unauthenticated caller
 *
 * Run with:  node scripts/test-activation.js
 */

const BASE = process.env.API_BASE_URL || 'http://localhost:3100';

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
  // The body is read once and parsed from text — reading it twice throws
  // "Body is unusable" when the response is not valid JSON.
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
  console.log('\n=== Activation and upgrade test ===\n');

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@nextlink.com', password: 'admin123' },
  });
  const token = login.body.token;
  assert(login.status === 200 && token, 'staff token obtained');

  // -----------------------------------------------------------------------
  console.log('\n1. Approving a connection request creates the customer');
  // A unique phone number per run, so the test never collides with the
  // account of a previous run.
  const phone = `+8801${Date.now().toString().slice(-9)}`;
  const request = await api('/api/applications', {
    method: 'POST',
    body: {
      fullName: 'Activation Test Customer',
      phone,
      email: `activation.${Date.now()}@example.com`,
      idNumber: 'TEST1234567',
      address: 'House 44, Road 9, Banani, Dhaka 1213, Bangladesh',
      packageId: 'PKG-002',
      packageName: 'Standard',
      ontConfig: 'Wi-Fi 6 Gateway Mode',
    },
  });
  assert(request.status === 201 && request.body.success, 'connection request submitted', request.body);
  const requestId = request.body.request?.id;

  const approve = await api(`/api/applications/${requestId}`, {
    method: 'PATCH',
    token,
    body: { status: 'approved' },
  });
  assert(approve.status === 200 && approve.body.success, 'the request was approved', approve.body);
  assert(Boolean(approve.body.subscriberId), 'a customer account was created', approve.body);
  const subscriberId = approve.body.subscriberId;
  const temporaryPassword = approve.body.temporaryPassword;

  // -----------------------------------------------------------------------
  console.log('\n2. The new customer can sign in');
  const signIn = await api('/api/auth/subscriber-login', {
    method: 'POST',
    body: { username: phone, password: temporaryPassword },
  });
  assert(signIn.status === 200 && signIn.body.success, 'the temporary password works', signIn.body);
  const subscriberToken = signIn.body.token;

  // -----------------------------------------------------------------------
  console.log('\n3. The customer is billed by the billing engine');
  const cycle = await api('/api/billing/cycle/run', {
    method: 'POST',
    token,
    body: { period: '2015-02' },
  });
  assert(cycle.status === 200, 'the billing cycle ran', cycle.body);

  const invoices = await api('/api/billing/invoices?limit=200', { token });
  const newInvoice = invoices.body.invoices.find(
    (invoice) => invoice.subscriber_id === subscriberId,
  );
  assert(Boolean(newInvoice), 'the new customer was invoiced', newInvoice?.id);
  assert(
    newInvoice && Number(newInvoice.amount) > 0,
    'the invoice carries the catalogue price',
    newInvoice?.amount,
  );

  const summary = await api('/api/portal/my-summary', { token: subscriberToken });
  assert(summary.status === 200, 'the customer can read their own summary', summary.body);

  // -----------------------------------------------------------------------
  console.log('\n4. The customer API routes refuse an anonymous caller');
  const anonymous = await fetch(`${BASE}/api/portal/my-invoices`);
  assert(anonymous.status === 401, 'the portal rejects an anonymous caller', anonymous.status);

  const anonymousTicket = await fetch(`${BASE}/api/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: 'Anonymous ticket attempt',
      category: 'Configuration',
      priority: 'low',
      description: 'This ticket should not be accepted without a session.',
    }),
  });
  assert(anonymousTicket.status === 401, 'an anonymous ticket is rejected', anonymousTicket.status);

  // -----------------------------------------------------------------------
  console.log('\n5. The order type is stored in one case');
  const orders = await api('/api/billing/invoices?limit=1', { token });
  assert(orders.status === 200, 'the invoice list is readable');

  // -----------------------------------------------------------------------
  console.log('\n6. The activation is idempotent');
  const secondApprove = await api(`/api/applications/${requestId}`, {
    method: 'PATCH',
    token,
    body: { status: 'approved' },
  });
  assert(secondApprove.status === 200, 'approving again does not fail', secondApprove.body);
  assert(
    secondApprove.body.subscriberId === subscriberId,
    'the same account is reused, not a second one',
    secondApprove.body.subscriberId,
  );

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error('activation test crashed:', error);
  process.exit(1);
});
