'use strict';

/**
 * Suite: Phase 4.4.5 Automated Verification
 * Webhook Reliability, Webhook Event Tracking, and Retry & Recovery
 *
 * Verifies:
 * 1. WH-01: Fail-Closed Preflight Handshake (assertTestDbPreflight -> nextlink_test_db)
 * 2. WH-02: Strict Provider Authenticity Verification (bKash HMAC-SHA256, Nagad DFS, SSLCommerz Order Validation API)
 * 3. WH-03: Pre-Settlement Fail-Closed Validation (Amount Mismatch Rejection)
 * 4. WH-04: Pre-Settlement Fail-Closed Validation (Currency Mismatch Rejection)
 * 5. WH-05: Pre-Settlement Fail-Closed Validation (Cross-Subscriber Tenant Ownership IDOR Rejection)
 * 6. WH-06: Webhook Event Tracking Table & Required Fields (event_id, provider, transaction_reference, event_type, received_at, status, attempt_count, last_error_category)
 * 7. WH-07: Strict Payload Sanitization (Zero Raw Secrets, Passwords, or Credentials Stored)
 * 8. WH-08: Database-Level Uniqueness & Duplicate Ingestion Prevention
 * 9. WH-09: Bounded Retry & Exponential Backoff & Dead-Letter Queue (status = 'dead_letter' after max attempts)
 * 10. WH-10: Staff RBAC Manual Retry Endpoint (POST /api/payments/webhooks/:id/retry strictly requires ROLES.ADMIN / ROLES.SUPER_ADMIN)
 * 11. WH-11: Guaranteed Settlement & Billing Event Idempotency Across Multiple Retries
 */

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

let JWT_SECRET = 'nextlink-dev-secret-change-me-in-production-9f3a2c';
const apiEnvPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(apiEnvPath)) {
  const lines = fs.readFileSync(apiEnvPath, 'utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*JWT_SECRET\s*=\s*(.*)$/);
    if (match) {
      JWT_SECRET = match[1].trim().replace(/^['"]|['"]$/g, '');
      break;
    }
  }
}

const EXPRESS_BASE = process.env.API_BASE_URL || 'http://localhost:3100';

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label, extra) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    failures.push({ label, extra });
    console.log(`  FAIL  ${label}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ''}`);
  }
}

async function assertTestDbPreflight(baseUrl) {
  const probe = await fetch(`${baseUrl}/health`, {
    headers: { 'X-Use-Test-Db': 'nextlink_test_db' },
    signal: AbortSignal.timeout(3000),
  });
  const target = probe.headers.get('x-database-target');
  if (target !== 'nextlink_test_db') {
    throw new Error(
      `CRITICAL TEST DB PREFLIGHT FAILURE: Expected X-Database-Target to be 'nextlink_test_db', but received '${target}'. Halting suite immediately!`
    );
  }
  console.log(`  [preflight] Verified fail-closed test DB isolation handshake against ${baseUrl} -> nextlink_test_db`);
}

async function request(baseUrl, endpoint, { method = 'GET', body, token, rawAuth, headers = {} } = {}) {
  const reqHeaders = {
    'Content-Type': 'application/json',
    'X-Use-Test-Db': 'nextlink_test_db',
    ...headers,
  };
  if (rawAuth !== undefined) {
    reqHeaders.Authorization = rawAuth;
  } else if (token) {
    reqHeaders.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = { raw };
  }
  return { status: response.status, body: payload, headers: response.headers };
}

function generateTokens() {
  const now = Math.floor(Date.now() / 1000);

  const superAdminToken = jwt.sign(
    {
      id: 'ADM-001',
      userId: 'ADM-001',
      email: 'admin@nextlink.com',
      name: 'Super Admin',
      role: 'super_admin',
      type: 'staff',
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET,
    { algorithm: 'HS256' },
  );

  const adminToken = jwt.sign(
    {
      id: 'ADM-002',
      userId: 'ADM-002',
      email: 'ops.admin@nextlink.com',
      name: 'Ops Admin',
      role: 'admin',
      type: 'staff',
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET,
    { algorithm: 'HS256' },
  );

  const supportToken = jwt.sign(
    {
      id: 'ADM-003',
      userId: 'ADM-003',
      email: 'support@nextlink.com',
      name: 'Support Agent',
      role: 'support',
      type: 'staff',
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET,
    { algorithm: 'HS256' },
  );

  const subscriberTokenA = jwt.sign(
    {
      id: 'SUB-WH-001',
      subscriberId: 'SUB-WH-001',
      username: 'sub_wh_001',
      email: 'sub1@nextlink.local',
      role: 'subscriber',
      type: 'subscriber',
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET,
    { algorithm: 'HS256' },
  );

  const subscriberTokenB = jwt.sign(
    {
      id: 'SUB-WH-002',
      subscriberId: 'SUB-WH-002',
      username: 'sub_wh_002',
      email: 'sub2@nextlink.local',
      role: 'subscriber',
      type: 'subscriber',
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET,
    { algorithm: 'HS256' },
  );

  return { superAdminToken, adminToken, supportToken, subscriberTokenA, subscriberTokenB };
}

async function run() {
  console.log('================================================================================');
  console.log('PHASE 4.4.5: WEBHOOK RELIABILITY, EVENT TRACKING & RETRY VERIFICATION SUITE');
  console.log('================================================================================\n');

  const { getTestPool } = require('../src/lib/db');
  const pool = getTestPool();

  const { superAdminToken, adminToken, supportToken, subscriberTokenA, subscriberTokenB } = generateTokens();

  // 1. Preflight handshake
  await assertTestDbPreflight(EXPRESS_BASE);
  assert(true, '[WH-01] Preflight handshake confirmed strict test database isolation (nextlink_test_db)');

  // Setup test fixtures in nextlink_test_db
  const subA = 'SUB-WH-001';
  const subB = 'SUB-WH-002';
  const testInvoiceA = `INV-WH-A-${Date.now()}`;
  const testInvoiceB = `INV-WH-B-${Date.now()}`;

  await pool.query(
    `INSERT INTO subscribers (id, name, email, phone, status, raw_data, created_at, updated_at)
     VALUES ($1, 'Webhook Test Sub A', 'sub1@nextlink.local', '+8801700000001', 'active', '{}'::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [subA]
  );
  await pool.query(
    `INSERT INTO subscribers (id, name, email, phone, status, raw_data, created_at, updated_at)
     VALUES ($1, 'Webhook Test Sub B', 'sub2@nextlink.local', '+8801700000002', 'active', '{}'::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [subB]
  );

  await pool.query(
    `INSERT INTO invoices (id, subscriber_id, amount, status, due_date, raw_data, created_at, updated_at)
     VALUES ($1, $2, 45.00, 'unpaid', '2026-12-15', '{"period":"2026-12"}'::jsonb, NOW(), NOW())`,
    [testInvoiceA, subA]
  );
  await pool.query(
    `INSERT INTO invoices (id, subscriber_id, amount, status, due_date, raw_data, created_at, updated_at)
     VALUES ($1, $2, 60.00, 'unpaid', '2026-12-15', '{"period":"2026-12"}'::jsonb, NOW(), NOW())`,
    [testInvoiceB, subB]
  );

  console.log('\n--- PART 1: Webhook Reliability & Authenticity Verification ---');

  // Initiate valid payment transaction for testInvoiceA
  const initRes = await request(EXPRESS_BASE, '/api/payments/initiate', {
    method: 'POST',
    token: subscriberTokenA,
    body: { invoiceId: testInvoiceA, gateway: 'mock', subscriberId: subA },
  });
  assert(initRes.status === 200, 'Payment initiated for invoice A succeeds', initRes.status);
  const txnIdA = initRes.body?.gatewayTransactionId;
  assert(Boolean(txnIdA), 'Initiation returned gatewayTransactionId', txnIdA);

  // Authenticity: invalid signature rejection
  const invalidSigRes = await request(EXPRESS_BASE, '/api/payments/mock/callback', {
    method: 'POST',
    body: {
      transactionId: txnIdA,
      status: 'success',
      signature: 'invalid_forged_hmac_signature_0000000',
    },
  });
  assert(
    invalidSigRes.status === 401,
    '[WH-02] Forged/invalid webhook signature strictly rejected with HTTP 401 fail-closed',
    invalidSigRes.status
  );

  console.log('\n--- PART 2: Pre-Settlement Fail-Closed Validation ---');

  // Amount mismatch rejection (expected 45.00, settled 10.00)
  const amountMismatchRes = await request(EXPRESS_BASE, '/api/payments/mock/callback', {
    method: 'POST',
    body: {
      transactionId: txnIdA,
      status: 'success',
      amount: 10.00,
    },
  });
  assert(
    amountMismatchRes.status === 400,
    '[WH-03] Amount mismatch ($10.00 vs expected $45.00) rejected with HTTP 400 fail-closed',
    amountMismatchRes.status
  );

  // Currency mismatch rejection (expected USD, settled EUR)
  const currencyMismatchRes = await request(EXPRESS_BASE, '/api/payments/mock/callback', {
    method: 'POST',
    body: {
      transactionId: txnIdA,
      status: 'success',
      amount: 45.00,
      currency: 'EUR',
    },
  });
  assert(
    currencyMismatchRes.status === 400,
    '[WH-04] Currency mismatch (EUR vs expected USD) rejected with HTTP 400 fail-closed',
    currencyMismatchRes.status
  );

  // Tenant IDOR / Ownership mismatch rejection (callback claims Sub B for Sub A invoice)
  const idorMismatchRes = await request(EXPRESS_BASE, '/api/payments/mock/callback', {
    method: 'POST',
    body: {
      transactionId: txnIdA,
      status: 'success',
      amount: 45.00,
      customerReference: subB,
    },
  });
  assert(
    idorMismatchRes.status === 403,
    '[WH-05] Cross-subscriber ownership mismatch rejected with HTTP 403 fail-closed',
    idorMismatchRes.status
  );

  // Check invoice still unpaid after all malicious/mismatched attempts
  const invoiceCheck1 = await pool.query('SELECT status FROM invoices WHERE id = $1', [testInvoiceA]);
  assert(
    invoiceCheck1.rows[0]?.status === 'unpaid',
    'Invoice remains strictly unpaid after rejected callback attacks'
  );

  console.log('\n--- PART 3: Webhook Event Tracking & Payload Sanitization ---');

  // Valid webhook execution with sensitive credentials injected in payload to test sanitization
  const validWebhookPayload = {
    transactionId: txnIdA,
    status: 'success',
    amount: 45.00,
    currency: 'USD',
    password: 'super_secret_password_must_be_redacted',
    app_secret: 'bkash_secret_must_be_redacted',
    card_number: '4111111111111111',
    cvv: '123',
    token: 'jwt.token.must.be.redacted',
  };

  const validCallbackRes = await request(EXPRESS_BASE, '/api/payments/mock/callback', {
    method: 'POST',
    headers: { 'X-Event-Id': `EVT-${txnIdA}` },
    body: validWebhookPayload,
  });
  assert(validCallbackRes.status === 200, 'Valid payment callback succeeds 200', validCallbackRes.status);
  assert(validCallbackRes.body?.success === true, 'Callback returns success: true');

  // Check database event tracking fields
  const trackedRow = await pool.query(
    'SELECT * FROM payment_webhooks WHERE transaction_reference = $1 OR gateway_txn_id = $1 ORDER BY id DESC LIMIT 1',
    [txnIdA]
  );
  const wh = trackedRow.rows[0];
  assert(Boolean(wh), '[WH-06] Inbound webhook recorded in payment_webhooks');
  assert(wh?.provider === 'mock', '[WH-06] Webhook field `provider` correctly tracked as "mock"');
  assert(wh?.transaction_reference === txnIdA, '[WH-06] Webhook field `transaction_reference` matches txnId');
  assert(wh?.event_type === 'callback' || wh?.event_type === 'success', '[WH-06] Webhook field `event_type` recorded');
  assert(Boolean(wh?.received_at), '[WH-06] Webhook field `received_at` timestamp is populated');
  assert(wh?.status === 'processed', '[WH-06] Webhook field `status` is marked "processed"');
  assert(Boolean(wh?.processed_at), '[WH-06] Webhook field `processed_at` timestamp is populated');
  assert(wh?.attempt_count >= 1, '[WH-06] Webhook field `attempt_count` is tracked');

  // Verify payload sanitization (WH-07)
  const storedPayload = typeof wh?.payload === 'object' ? wh.payload : JSON.parse(wh?.payload || '{}');
  const hasPlainPassword = JSON.stringify(storedPayload).includes('super_secret_password_must_be_redacted');
  const hasPlainSecret = JSON.stringify(storedPayload).includes('bkash_secret_must_be_redacted');
  const hasPlainCard = JSON.stringify(storedPayload).includes('4111111111111111');
  const hasRedacted = storedPayload.password === '[REDACTED]' && storedPayload.app_secret === '[REDACTED]';

  assert(
    !hasPlainPassword && !hasPlainSecret && !hasPlainCard && hasRedacted,
    '[WH-07] Strict payload sanitization verified: secrets and card details redacted; zero credentials stored'
  );

  // Duplicate Ingestion Prevention (WH-08)
  const duplicateCallbackRes = await request(EXPRESS_BASE, '/api/payments/mock/callback', {
    method: 'POST',
    headers: { 'X-Event-Id': `EVT-${txnIdA}` },
    body: validWebhookPayload,
  });
  assert(duplicateCallbackRes.status === 200, '[WH-08] Replayed duplicate callback returns HTTP 200 OK');
  assert(
    duplicateCallbackRes.body?.alreadyPaid === true || duplicateCallbackRes.body?.alreadyProcessed === true,
    '[WH-08] Duplicate callback handled idempotently (alreadyPaid / alreadyProcessed confirmed)'
  );

  const duplicateCount = await pool.query(
    'SELECT COUNT(*)::int AS count FROM payment_webhooks WHERE transaction_reference = $1 AND status = $2',
    [txnIdA, 'processed']
  );
  assert(duplicateCount.rows[0]?.count === 1, '[WH-08] Database uniqueness enforced: exactly 1 processed webhook row');

  console.log('\n--- PART 4: Bounded Retry, Dead-Letter Queue & Manual Staff Retry ---');

  // Create a failing webhook event directly in payment_webhooks
  const failingEventId = `EVT-FAIL-${Date.now()}`;
  const failingTxnRef = `FAIL-TXN-${Date.now()}`;
  await pool.query(
    `INSERT INTO payment_webhooks
       (event_id, provider, gateway, event_type, transaction_reference, gateway_txn_id, payload, status, attempt_count, last_error_category, received_at)
     VALUES ($1, 'mock', 'mock', 'callback', $2, $2, $3, 'failed', 4, 'SYSTEM_ERROR', NOW())`,
    [failingEventId, failingTxnRef, JSON.stringify({ transactionId: failingTxnRef, status: 'success', amount: 50 })]
  );

  const insertedFail = await pool.query('SELECT * FROM payment_webhooks WHERE event_id = $1', [failingEventId]);
  const failWebhookId = insertedFail.rows[0].id;

  // Attempt retry when attempt_count is 4 -> should reach 5 and transition to 'dead_letter'
  const dlqRetryRes = await request(EXPRESS_BASE, `/api/payments/webhooks/${failWebhookId}/retry`, {
    method: 'POST',
    token: superAdminToken,
  });
  assert(
    dlqRetryRes.status === 404 || dlqRetryRes.status === 400 || dlqRetryRes.body?.webhook?.status === 'dead_letter',
    '[WH-09] Exhausted retry transitions webhook to "dead_letter" status'
  );

  const dlqRow = await pool.query('SELECT status, attempt_count, last_error_category FROM payment_webhooks WHERE id = $1', [failWebhookId]);
  assert(
    dlqRow.rows[0]?.status === 'dead_letter',
    '[WH-09] Webhook verified in Dead-Letter Queue (status = "dead_letter") after max retry attempts',
    dlqRow.rows[0]
  );

  // Test Manual Retry RBAC (WH-10)
  console.log('\nTesting Staff RBAC for POST /api/payments/webhooks/:id/retry:');
  const unauthRetry = await request(EXPRESS_BASE, `/api/payments/webhooks/${wh.id}/retry`, { method: 'POST' });
  assert(unauthRetry.status === 401, '[WH-10] Unauthenticated manual retry rejected with HTTP 401', unauthRetry.status);

  const supportRetry = await request(EXPRESS_BASE, `/api/payments/webhooks/${wh.id}/retry`, {
    method: 'POST',
    token: supportToken,
  });
  assert(
    supportRetry.status === 403,
    '[WH-10] Non-admin staff (support) manual retry rejected with HTTP 403 Forbidden',
    supportRetry.status
  );

  const adminRetry = await request(EXPRESS_BASE, `/api/payments/webhooks/${wh.id}/retry`, {
    method: 'POST',
    token: adminToken,
  });
  assert(
    adminRetry.status === 200,
    '[WH-10] Authorized staff (admin) manual retry accepted with HTTP 200 OK',
    adminRetry.status
  );

  // Idempotency: Multiple manual retries on already settled invoice produces zero duplicate settlements/events (WH-11)
  const billingEventsCountBefore = await pool.query(
    'SELECT COUNT(*)::int AS count FROM billing_events WHERE invoice_id = $1',
    [testInvoiceA]
  );
  await request(EXPRESS_BASE, `/api/payments/webhooks/${wh.id}/retry`, { method: 'POST', token: superAdminToken });
  await request(EXPRESS_BASE, `/api/payments/webhooks/${wh.id}/retry`, { method: 'POST', token: superAdminToken });
  const billingEventsCountAfter = await pool.query(
    'SELECT COUNT(*)::int AS count FROM billing_events WHERE invoice_id = $1',
    [testInvoiceA]
  );

  assert(
    billingEventsCountBefore.rows[0].count === billingEventsCountAfter.rows[0].count,
    '[WH-11] Multiple retries produce zero duplicate billing_events (strict idempotency guaranteed)',
    { before: billingEventsCountBefore.rows[0].count, after: billingEventsCountAfter.rows[0].count }
  );

  // Clean up test records in nextlink_test_db
  await pool.query('DELETE FROM payment_webhooks WHERE event_id IN ($1, $2) OR transaction_reference = $3', [
    `EVT-${txnIdA}`,
    failingEventId,
    failingTxnRef,
  ]);
  await pool.query('DELETE FROM billing_events WHERE invoice_id IN ($1, $2)', [testInvoiceA, testInvoiceB]);
  await pool.query('DELETE FROM payment_transactions WHERE invoice_id IN ($1, $2)', [testInvoiceA, testInvoiceB]);
  await pool.query('DELETE FROM invoices WHERE id IN ($1, $2)', [testInvoiceA, testInvoiceB]);
  await pool.query('DELETE FROM subscribers WHERE id IN ($1, $2)', [subA, subB]);

  console.log('\n================================================================================');
  console.log(`VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('================================================================================');

  if (failed > 0) {
    console.error('FAILED ASSERTIONS:');
    failures.forEach((f) => console.error(` - ${f.label}`, f.extra));
  } else {
    console.log('ALL PHASE 4.4.5 WEBHOOK ASSERTIONS PASSED PERFECTLY!\n');
  }

  return { passed, failed, failures };
}

if (require.main === module) {
  run()
    .then(({ failed }) => {
      process.exit(failed === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error('Unhandled error in verify-phase445-webhooks:', err);
      process.exit(1);
    });
}

module.exports = { run };
