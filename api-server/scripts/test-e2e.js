'use strict';

/**
 * End-to-end smoke test for the Phase 3 pipeline:
 *   login -> run billing cycle -> generate invoice -> initiate payment
 *   -> settle via mock gateway -> verify service restored + SMS sent.
 *
 * Run with:  node scripts/test-e2e.js
 * The API must be running on http://localhost:3001.
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
  console.log('\n=== NextLink API — Phase 3 end-to-end test ===\n');

  // 1. Health
  console.log('1. Health check');
  const health = await api('/health');
  assert(health.status === 200 && health.body.database === 'connected', 'API healthy + DB connected', health.body);

  // 2. Login
  console.log('\n2. Staff authentication');
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@nextlink.com', password: 'admin123' },
  });
  assert(login.status === 200 && login.body.token, 'login returns JWT', login.body);
  assert(login.body.user && login.body.user.role === 'super_admin', 'role is super_admin', login.body.user);
  const token = login.body.token;

  const badLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@nextlink.com', password: 'wrong-pass' },
  });
  assert(badLogin.status === 401, 'wrong password rejected', badLogin.body);

  // 3. Unauthenticated access must be rejected
  console.log('\n3. Route protection');
  const noAuth = await api('/api/billing/invoices');
  assert(noAuth.status === 401, 'billing invoices require auth', noAuth.body);

  // 4. Billing cycle (dry run)
  console.log('\n4. Billing cycle');
  const dry = await api('/api/billing/cycle/run', {
    method: 'POST',
    token,
    body: { dryRun: true },
  });
  assert(dry.status === 200 && dry.body.dryRun === true, 'dry-run cycle executes', dry.body);
  assert(typeof dry.body.invoiceCount === 'number', 'dry-run reports invoice count', dry.body);

  const period = new Date().toISOString().slice(0, 7);
  const real = await api('/api/billing/cycle/run', {
    method: 'POST',
    token,
    body: { period },
  });
  assert(real.status === 200 && real.body.invoiceCount > 0, 'real cycle generated invoices', real.body);

  // 5. Invoices
  console.log('\n5. Invoice registry');
  const invoices = await api('/api/billing/invoices?status=unpaid&limit=50', { token });
  assert(invoices.status === 200 && Array.isArray(invoices.body.invoices), 'invoice list returned', invoices.body);
  assert(invoices.body.invoices.length > 0, 'at least one unpaid invoice exists');
  // Use the invoice belonging to the period we just billed, so the
  // assertions are not affected by invoices from other periods.
  const invoice = invoices.body.invoices.find((inv) => inv.raw_data?.period === period) || invoices.body.invoices[0];
  assert(invoice.raw_data && invoice.raw_data.period === period, 'invoice carries billing period in raw_data', invoice.raw_data?.period);

  const detail = await api(`/api/billing/invoices/${invoice.id}`, { token });
  assert(detail.status === 200 && detail.body.invoice.id === invoice.id, 'invoice detail + events loaded');

  // 6. PDF
  console.log('\n6. PDF invoice');
  const pdfResponse = await fetch(`${BASE}/api/billing/invoices/${invoice.id}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
  assert(pdfResponse.status === 200, 'PDF endpoint returns 200');
  assert(pdfBuffer.slice(0, 4).toString() === '%PDF', 'response is a valid PDF', pdfBuffer.slice(0, 8).toString());
  assert(pdfBuffer.length > 1000, `PDF has content (${pdfBuffer.length} bytes)`);

  // 7. Payment initiation
  console.log('\n7. Payment gateway');
  const gateways = await api('/api/payments/gateways');
  assert(gateways.status === 200 && gateways.body.gateways.length >= 4, 'gateway list available', gateways.body.gateways?.length);

  const initiate = await api('/api/payments/initiate', {
    method: 'POST',
    body: { invoiceId: invoice.id, gateway: 'bkash' },
  });
  assert(initiate.status === 200 && initiate.body.redirectUrl, 'bKash payment initiated', initiate.body);
  assert(initiate.body.gatewayTransactionId, 'gateway transaction id returned');

  // 8. Settle via the mock checkout page
  console.log('\n8. Settlement + auto restore');
  const beforeStatus = invoice.status;
  const checkout = await fetch(`${BASE}/api/payments/mock/checkout/${initiate.body.gatewayTransactionId}`);
  const checkoutBody = await checkout.text();
  assert(checkout.status === 200 && checkoutBody.includes('Mock'), 'mock checkout page rendered');

  const after = await api(`/api/billing/invoices/${invoice.id}`, { token });
  assert(after.body.invoice.status === 'paid', 'invoice marked paid after settlement', after.body.invoice.status);
  assert(
    after.body.events.some((event) => event.event === 'payment_received'),
    'payment_received billing event recorded',
  );

  const txns = await api('/api/payments/transactions', { token });
  assert(
    txns.body.transactions.some((t) => t.status === 'success' && t.invoice_id === invoice.id),
    'payment transaction marked success',
  );

  const webhooks = await api('/api/payments/webhooks', { token });
  assert(webhooks.body.webhooks.length > 0, 'webhook payload logged');

  // 9. SMS
  console.log('\n9. SMS notifications');
  const messages = await api('/api/sms/messages?limit=100', { token });
  assert(messages.status === 200 && messages.body.messages.length > 0, 'SMS messages logged', messages.body.messages?.length);
  assert(
    messages.body.messages.some((m) => m.template === 'bill_reminder'),
    'bill reminder SMS generated by billing cycle',
  );

  // 9b. The reminder must be addressed to a real subscriber.
  const reminder = messages.body.messages.find((m) => m.template === 'bill_reminder');
  assert(Boolean(reminder && reminder.phone), 'reminder carries the subscriber phone number', reminder?.phone);
  assert(
    messages.body.messages.every((m) => ['sent', 'queued', 'failed'].includes(m.status)),
    'every SMS has a delivery status',
  );

  // 10. MikroTik
  console.log('\n10. MikroTik RouterOS (simulator)');
  const status = await api('/api/mikrotik/status', { token });
  assert(status.status === 200 && status.body.success === true, 'router reachable', status.body);
  assert(status.body.mode === 'simulator', 'running in simulator mode');

  const secrets = await api('/api/mikrotik/secrets', { token });
  assert(secrets.status === 200 && secrets.body.secrets.length > 0, 'PPPoE secrets listed', secrets.body.secrets?.length);

  const subscriberId = invoice.subscriber_id;
  const suspend = await api('/api/mikrotik/suspend', {
    method: 'POST',
    token,
    body: { subscriberId },
  });
  assert(suspend.status === 200 && suspend.body.success === true, 'suspend succeeds', suspend.body);

  const secretsAfter = await api('/api/mikrotik/secrets', { token });
  const suspendedSecret = secretsAfter.body.secrets.find((s) => s.name === suspend.body.username);
  assert(suspendedSecret && suspendedSecret.disabled === true, 'PPPoE secret now disabled', suspendedSecret);

  const restore = await api('/api/mikrotik/restore', {
    method: 'POST',
    token,
    body: { subscriberId },
  });
  assert(restore.status === 200 && restore.body.success === true, 'restore succeeds', restore.body);

  const secretsFinal = await api('/api/mikrotik/secrets', { token });
  const restoredSecret = secretsFinal.body.secrets.find((s) => s.name === restore.body.username);
  assert(restoredSecret && restoredSecret.disabled === false, 'PPPoE secret re-enabled', restoredSecret);

  const log = await api(`/api/mikrotik/log?subscriberId=${subscriberId}`, { token });
  assert(log.body.log.length >= 2, 'router operations logged for audit', log.body.log?.length);

  // 11. Audit trail
  console.log('\n11. Audit log');
  const auditLog = await api('/api/audit?limit=50', { token });
  assert(auditLog.status === 200 && auditLog.body.entries.length > 0, 'audit entries recorded', auditLog.body.entries?.length);
  assert(
    auditLog.body.entries.some((entry) => entry.action === 'auth.login'),
    'login audited',
  );

  // 12. Role enforcement
  console.log('\n12. Role based access control');
  const billingLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'billing@nextlink.com', password: 'billing123' },
  });
  const billingToken = billingLogin.body.token;
  assert(billingLogin.status === 200, 'billing user can log in');

  const billingAllowed = await api('/api/billing/invoices', { token: billingToken });
  assert(billingAllowed.status === 200, 'billing role can read invoices');

  const billingDenied = await api('/api/audit', { token: billingToken });
  assert(billingDenied.status === 403, 'billing role cannot read the audit log', billingDenied.body);

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error('E2E test crashed:', error);
  process.exit(1);
});
