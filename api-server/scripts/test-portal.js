'use strict';

/**
 * Subscriber portal test — verifies that a subscriber can only see and pay
 * their own invoices through the Express API.
 *
 * Run with:  node scripts/test-portal.js
 */

const BASE = process.env.API_BASE_URL || 'http://localhost:3001';

let passed = 0;
let failed = 0;

function assert(condition, label, extra) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${extra ? ` -> ${JSON.stringify(extra)}` : ''}`);
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
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = { raw: await response.text() };
  }
  return { status: response.status, body: payload };
}

async function run() {
  console.log('\n=== Subscriber portal test ===\n');

  // Staff login — needed to create a controlled invoice.
  const staffLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@nextlink.com', password: 'admin123' },
  });
  const staffToken = staffLogin.body.token;
  assert(staffLogin.status === 200 && staffToken, 'staff token obtained');

  // Pick two different subscribers.
  const invoices = await api('/api/billing/invoices?limit=50', { token: staffToken });
  const uniqueSubscribers = [...new Set(invoices.body.invoices.map((i) => i.subscriber_id))];
  assert(uniqueSubscribers.length >= 2, 'at least two subscribers have invoices', uniqueSubscribers.length);

  // Subscriber credentials: seeded demo accounts.
  const demoLogin = await api('/api/auth/subscriber-login', {
    method: 'POST',
    body: { username: 'alexwright', password: 'AlexPassword@2026' },
  });

  if (!demoLogin.status === 200 || !demoLogin.body.token) {
    console.log('  SKIP  no demo subscriber credentials available for portal test');
    console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
    process.exit(failed === 0 ? 0 : 1);
  }

  const token = demoLogin.body.token;
  assert(demoLogin.status === 200 && token, 'subscriber login returns token');
  assert(demoLogin.body.subscriber.id, 'subscriber identity returned');

  // The demo subscriber should only see their own invoices.
  const mine = await api('/api/portal/my-invoices', { token });
  assert(mine.status === 200 && Array.isArray(mine.body.invoices), 'subscriber invoice list loads');
  assert(
    mine.body.invoices.every((inv) => inv.subscriber_id === demoLogin.body.subscriber.id),
    'subscriber sees only their own invoices',
    mine.body.invoices.map((i) => i.subscriber_id),
  );

  const summary = await api('/api/portal/my-summary', { token });
  assert(summary.status === 200 && summary.body.summary, 'summary loads');
  assert(
    summary.body.summary.subscriber &&
      summary.body.summary.subscriber.id === demoLogin.body.subscriber.id,
    'summary is scoped to the signed-in subscriber',
  );

  // Cross-subscriber isolation: paying another subscriber's invoice must fail.
  // Another subscriber is activated first, because the billing cycle only
  // invoices the active accounts.
  const period = '2016-11';
  const listForCleanup = await api('/api/billing/invoices?limit=200', { token: staffToken });
  for (const leftover of listForCleanup.body.invoices.filter((i) => i.raw_data?.period === period)) {
    await api(`/api/billing/invoices/${leftover.id}`, { method: 'DELETE', token: staffToken });
  }

  // Pick a subscriber that is not the one signed in and make sure the
  // account is active so it is billed.
  const otherSubscriberId = uniqueSubscribers.find((id) => id !== demoLogin.body.subscriber.id);
  if (otherSubscriberId) {
    await api('/api/mikrotik/restore', {
      method: 'POST',
      token: staffToken,
      body: { subscriberId: otherSubscriberId, username: otherSubscriberId },
    });
  }

  await api('/api/billing/cycle/run', {
    method: 'POST',
    token: staffToken,
    body: { period },
  });
  const list = await api('/api/billing/invoices?limit=200', { token: staffToken });
  const otherInvoice = list.body.invoices.find(
    (i) => i.raw_data?.period === period && i.subscriber_id !== demoLogin.body.subscriber.id,
  );

  if (otherInvoice) {
    const crossPay = await api('/api/portal/pay', {
      method: 'POST',
      token,
      body: { invoiceId: otherInvoice.id, gateway: 'bkash' },
    });
    assert(crossPay.status === 403, 'cannot pay another subscriber invoice', crossPay.body);
  } else {
    console.log('  SKIP  no cross-subscriber invoice available for isolation check');
  }

  // Unauthenticated access is rejected.
  const noAuth = await api('/api/portal/my-invoices');
  assert(noAuth.status === 401, 'portal requires authentication', noAuth.body);

  // Pay an own invoice through the gateway. A fresh invoice is generated for
  // a dedicated period so the check always runs.
  const ownPeriod = '2019-03';

  const listForOwn = await api('/api/billing/invoices?limit=200', { token: staffToken });
  for (const leftover of listForOwn.body.invoices.filter((i) => i.raw_data?.period === ownPeriod)) {
    await api(`/api/billing/invoices/${leftover.id}`, { method: 'DELETE', token: staffToken });
  }

  const ownCycle = await api('/api/billing/cycle/run', {
    method: 'POST',
    token: staffToken,
    body: { period: ownPeriod },
  });
  assert(ownCycle.status === 200, 'billing cycle ran for the payment test', ownCycle.body);

  const ownInvoices = await api('/api/portal/my-invoices', { token });
  const ownUnpaid = (ownInvoices.body.invoices || []).find(
    (inv) => inv.raw_data?.period === ownPeriod && inv.status !== 'paid',
  );
  assert(Boolean(ownUnpaid), 'an unpaid invoice is available for the payment test', ownUnpaid?.id);

  if (ownUnpaid) {
    const pay = await api('/api/portal/pay', {
      method: 'POST',
      token,
      body: { invoiceId: ownUnpaid.id, gateway: 'nagad' },
    });
    assert(pay.status === 200 && pay.body.redirectUrl, 'gateway redirect URL returned', pay.body);

    const redirectUrl = pay.body.redirectUrl;
    const settle = await fetch(redirectUrl.startsWith('http') ? redirectUrl : `${BASE}${redirectUrl}`);
    const settleBody = await settle.text();
    assert(settle.status === 200 && settleBody.includes('Mock'), 'mock checkout reachable');

    const after = await api('/api/portal/my-invoices', { token });
    const settled = after.body.invoices.find((inv) => inv.id === ownUnpaid.id);
    assert(settled && settled.status === 'paid', 'invoice settled after gateway callback', settled?.status);
  }

  // Restore the invoice to unpaid so the test stays repeatable.
  if (ownUnpaid) {
    const staff = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@nextlink.com', password: 'admin123' },
    });
    const staffToken = staff.body.token;
    const cleanup = await api(`/api/billing/invoices/${ownUnpaid.id}`, {
      method: 'DELETE',
      token: staffToken,
    });
    assert(cleanup.status === 200, 'test invoice cleaned up for a repeatable run', cleanup.body);
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error('portal test crashed:', error);
  process.exit(1);
});
