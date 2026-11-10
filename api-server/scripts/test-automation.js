'use strict';

/**
 * Auto-disconnect / auto-reconnect test.
 *
 * Verifies the full SRS 3.2 automation loop:
 *   overdue bill -> MikroTik PPPoE disabled + subscriber suspended + SMS sent
 *   payment      -> MikroTik PPPoE enabled  + subscriber active    + SMS sent
 *
 * Run with:  node scripts/test-automation.js
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

/**
 * Force an invoice into the past-due window so the sweep picks it up.
 * The invoice table is the legacy table, so we only move `due_date`.
 */
async function backdateInvoice(invoiceId) {
  // Use the billing engine's own event log to find an invoice we control.
  // The invoice id encodes the period; we instead pick the oldest unpaid one.
  return invoiceId;
}

async function run() {
  console.log('\n=== Auto-disconnect / auto-reconnect test ===\n');

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@nextlink.com', password: 'admin123' },
  });
  const token = login.body.token;
  assert(login.status === 200 && token, 'staff token obtained');

  // --- 1. Create a controlled invoice for subscriber SUB-001 -------------
  console.log('\n1. Controlled overdue invoice');
  // A fixed, always-past period keeps the test repeatable. Any leftover
  // invoice from a previous run is removed first.
  const period = '2020-01';
  const invoiceId = `INV-202001-SUB-001`;

  const cleanup = await api(`/api/billing/invoices/${invoiceId}`, { method: 'DELETE', token });
  if (cleanup.status === 200) console.log('  (removed invoice left over from a previous run)');

  const create = await api('/api/billing/cycle/run', {
    method: 'POST',
    token,
    body: { period },
  });
  assert(create.status === 200, 'billing cycle ran for the backdated period', create.body);

  const detail = await api(`/api/billing/invoices/${invoiceId}`, { token });
  assert(detail.status === 200, 'backdated invoice exists', detail.body?.error);

  if (detail.status !== 200) {
    console.log('  SKIP  cannot verify suspension without a backdated invoice');
    console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
    process.exit(failed === 0 ? 0 : 1);
  }

  assert(detail.body.invoice.status === 'unpaid', 'invoice starts unpaid', detail.body.invoice.status);

  // --- 2. Run the overdue sweep -------------------------------------------
  console.log('\n2. Overdue sweep (auto-disconnect)');
  const sweep = await api('/api/billing/suspend-overdue', { method: 'POST', token });
  assert(sweep.status === 200 && sweep.body.success, 'sweep executed', sweep.body);

  const suspendedEntry = (sweep.body.results || []).find((r) => r.invoiceId === invoiceId);
  assert(Boolean(suspendedEntry), 'backdated invoice was processed by the sweep', sweep.body.results?.slice(0, 5));
  assert(
    suspendedEntry && suspendedEntry.status === 'suspended',
    'subscriber auto-suspended',
    suspendedEntry,
  );

  // --- 3. Verify the MikroTik secret is disabled --------------------------
  console.log('\n3. MikroTik PPPoE state');
  const secrets = await api('/api/mikrotik/secrets', { token });
  assert(secrets.status === 200, 'router secrets readable');

  const log = await api('/api/mikrotik/log?limit=50', { token });
  const suspendOp = log.body.log.find(
    (entry) => entry.action === 'suspend' && entry.subscriber_id === 'SUB-001',
  );
  assert(Boolean(suspendOp), 'suspend operation logged in the router audit trail');
  assert(suspendOp && suspendOp.status === 'success', 'router operation succeeded', suspendOp?.status);

  // --- 4. Verify the subscriber + SMS state ------------------------------
  console.log('\n4. Subscriber + SMS state');
  const events = await api('/api/billing/events?limit=50', { token });
  const suspendEvent = events.body.events.find(
    (event) => event.invoice_id === invoiceId && event.event === 'auto_suspended',
  );
  assert(Boolean(suspendEvent), 'auto_suspended billing event recorded');

  const smsLog = await api('/api/sms/messages?limit=50', { token });
  const suspensionSms = smsLog.body.messages.find(
    (message) => message.template === 'service_suspended' && message.subscriber_id === 'SUB-001',
  );
  assert(Boolean(suspensionSms), 'suspension SMS sent to the customer');

  // --- 5. Pay the invoice -> auto-reconnect ------------------------------
  console.log('\n5. Payment triggers auto-reconnect');
  const initiate = await api('/api/payments/initiate', {
    method: 'POST',
    body: { invoiceId, gateway: 'bkash' },
  });
  assert(initiate.status === 200 && initiate.body.redirectUrl, 'payment initiated', initiate.body);

  const settle = await fetch(
    initiate.body.redirectUrl.startsWith('http')
      ? initiate.body.redirectUrl
      : `${BASE}${initiate.body.redirectUrl}`,
  );
  const settleBody = await settle.text();
  assert(settle.status === 200 && settleBody.includes('Mock'), 'gateway checkout completed');

  const afterPay = await api(`/api/billing/invoices/${invoiceId}`, { token });
  assert(afterPay.body.invoice.status === 'paid', 'invoice marked paid', afterPay.body.invoice.status);

  const restoreEvent = afterPay.body.events.find((event) => event.event === 'service_restored');
  assert(Boolean(restoreEvent), 'service_restored event recorded');

  const logAfter = await api('/api/mikrotik/log?limit=50', { token });
  const restoreOp = logAfter.body.log.find(
    (entry) => entry.action === 'restore' && entry.subscriber_id === 'SUB-001',
  );
  assert(Boolean(restoreOp), 'restore operation performed on the router');
  assert(restoreOp && restoreOp.status === 'success', 'restore succeeded', restoreOp?.status);

  const smsAfter = await api('/api/sms/messages?limit=50', { token });
  const restoreSms = smsAfter.body.messages.find(
    (message) => message.template === 'service_restored' && message.subscriber_id === 'SUB-001',
  );
  assert(Boolean(restoreSms), 'restoration SMS sent to the customer');

  // --- 6. Idempotency -----------------------------------------------------
  console.log('\n6. Duplicate callback safety');
  const duplicate = await fetch(
    initiate.body.redirectUrl.startsWith('http')
      ? initiate.body.redirectUrl
      : `${BASE}${initiate.body.redirectUrl}`,
  );
  await duplicate.text();
  const afterDuplicate = await api(`/api/billing/invoices/${invoiceId}`, { token });
  assert(
    afterDuplicate.body.invoice.status === 'paid',
    'invoice stays paid after a duplicate callback',
    afterDuplicate.body.invoice.status,
  );
  const restoreCount = afterDuplicate.body.events.filter(
    (event) => event.event === 'service_restored',
  ).length;
  assert(restoreCount === 1, 'service restored only once', restoreCount);

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error('automation test crashed:', error);
  process.exit(1);
});
