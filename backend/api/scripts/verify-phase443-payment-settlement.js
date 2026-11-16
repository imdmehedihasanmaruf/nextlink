'use strict';

/**
 * PHASE 4.4.3.1 VERIFICATION SUITE: Payment Gateway & Settlement Migration
 *
 * Verifies:
 * 1. Database Isolation & Fail-Closed Preflight Handshake
 * 2. Gateway Listing & Operating Mode Parity
 * 3. Checkout Initiation, Validation & Tenant IDOR Defense
 * 4. Webhook Security: Signature, Gateway Match, Transaction Match, Amount Match
 * 5. Mock Payment Checkout & Atomic Settlement
 * 6. Concurrency Protection: Simultaneous Callbacks & Race-Condition Defense
 * 7. Idempotency & Replay Attack Protection (Zero Duplicate Mutations)
 * 8. Payment Ledger & Webhooks Audit Logs RBAC Enforcement
 * 9. Reconciliation / Verify Endpoint
 */

const assert = require('assert');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../src/lib/db');

const JWT_SECRET = 'nextlink-dev-secret-change-me-in-production-9f3a2c';

function makeToken(payload) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ ...payload, iat: now, exp: now + 3600 }, JWT_SECRET, { algorithm: 'HS256' });
}

const staffToken = makeToken({
  id: 'ADM-001',
  userId: 'ADM-001',
  email: 'admin@nextlink.com',
  name: 'Super Admin',
  role: 'super_admin',
  type: 'staff',
});

const subToken1 = makeToken({
  id: 'SUB-001',
  userId: 'SUB-001',
  role: 'subscriber',
  type: 'subscriber',
  subscriberId: 'SUB-001',
});

const subToken2 = makeToken({
  id: 'SUB-2FDC18C9',
  userId: 'SUB-2FDC18C9',
  role: 'subscriber',
  type: 'subscriber',
  subscriberId: 'SUB-2FDC18C9',
});

let totalAssertions = 0;
let passedAssertions = 0;

function check(condition, message) {
  totalAssertions++;
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  passedAssertions++;
  console.log(`  [PASS] ${message}`);
}

async function api(baseUrl, reqPath, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Use-Test-Db': options.dbHeader || 'nextlink_test_db',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${baseUrl}${reqPath}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const dbTarget = res.headers.get('x-database-target');
  if (!options.allowNoTarget && dbTarget !== 'nextlink_test_db') {
    throw new Error(`CRITICAL ISOLATION FAILURE: ${reqPath} returned target '${dbTarget}' instead of 'nextlink_test_db'`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    const text = await res.text();
    return { status: res.status, body: text, isHtml: true, headers: res.headers };
  }

  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text), isHtml: false, headers: res.headers };
  } catch {
    return { status: res.status, body: text, isHtml: false, headers: res.headers };
  }
}

async function run() {
  console.log('========================================================================');
  console.log('  PHASE 4.4.3.1: PAYMENT GATEWAY & SETTLEMENT MIGRATION VERIFICATION  ');
  console.log('========================================================================\n');

  const testPool = db.getTestPool();
  const prodPool = db.getProdPool();

  // Capture baseline counts of production database nextlink_db
  const initialProdTxn = await prodPool.query('SELECT COUNT(*)::int AS count FROM payment_transactions');
  const initialProdWebhooks = await prodPool.query('SELECT COUNT(*)::int AS count FROM payment_webhooks');
  const initialProdInvoices = await prodPool.query('SELECT COUNT(*)::int AS count FROM invoices');

  // Helper to create an isolated test invoice
  async function createTestInvoice(subId, amount = 29.99) {
    const invId = `INV-TESTPAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await testPool.query(
      `INSERT INTO invoices (id, subscriber_id, amount, status, due_date, raw_data, created_at, updated_at)
       VALUES ($1, $2, $3, 'unpaid', '2026-12-10', $4, NOW(), NOW())`,
      [invId, subId, amount, JSON.stringify({ period: '2026-12', baseAmount: amount })]
    );
    return invId;
  }

  // -----------------------------------------------------------------
  // 1. Database Isolation Preflight Handshake
  // -----------------------------------------------------------------
  console.log('--- 1. Database Isolation Preflight Handshake ---');
  for (const [name, url] of [['Express (:3100)', 'http://127.0.0.1:3100'], ['Laravel (:3101)', 'http://127.0.0.1:3101']]) {
    const h = await api(url, '/health');
    check(h.status === 200, `${name} health responded 200 OK`);
    check(h.headers.get('x-database-target') === 'nextlink_test_db', `${name} preflight validated target 'nextlink_test_db'`);
  }

  // -----------------------------------------------------------------
  // 2. Gateway Listing & Mode Verification
  // -----------------------------------------------------------------
  console.log('\n--- 2. Gateway Listing & Operating Mode Parity ---');
  const expGateways = await api('http://127.0.0.1:3100', '/api/payments/gateways');
  const larGateways = await api('http://127.0.0.1:3101', '/api/payments/gateways');

  check(expGateways.status === 200, 'Express /api/payments/gateways responded 200');
  check(larGateways.status === 200, 'Laravel /api/payments/gateways responded 200');
  check(larGateways.body.mode === 'mock', "Laravel mode is 'mock'");
  check(Array.isArray(larGateways.body.gateways), 'Laravel gateways is array');
  check(larGateways.body.gateways.length === 5, 'Laravel reports 5 gateway options');
  check(JSON.stringify(expGateways.body.gateways) === JSON.stringify(larGateways.body.gateways), 'Gateway catalogue matches Express 1:1');

  // -----------------------------------------------------------------
  // 3. Checkout Initiation & Validation
  // -----------------------------------------------------------------
  console.log('\n--- 3. Checkout Initiation, Validation & IDOR Protection ---');

  // A: Non-existent invoice
  const notFoundInit = await api('http://127.0.0.1:3101', '/api/payments/initiate', {
    method: 'POST',
    body: { invoiceId: 'INV-NON-EXISTENT-XYZ', gateway: 'bkash' },
  });
  check(notFoundInit.status === 404, 'Non-existent invoice checkout returns 404');

  // B: Create a paid invoice and attempt checkout
  const paidInvId = await createTestInvoice('SUB-001', 50.00);
  await testPool.query("UPDATE invoices SET status = 'paid' WHERE id = $1", [paidInvId]);

  const alreadyPaidInit = await api('http://127.0.0.1:3101', '/api/payments/initiate', {
    method: 'POST',
    body: { invoiceId: paidInvId, gateway: 'bkash' },
  });
  check(alreadyPaidInit.status === 409, 'Already-paid invoice checkout rejected with 409 Conflict');

  // C: Tenant IDOR Defense: Subscriber SUB-2FDC18C9 cannot initiate checkout on SUB-001's invoice
  const sub1InvoiceId = await createTestInvoice('SUB-001', 25.00);
  const idorInit = await api('http://127.0.0.1:3101', '/api/payments/initiate', {
    method: 'POST',
    token: subToken2, // Authenticated as SUB-2FDC18C9
    body: { invoiceId: sub1InvoiceId, gateway: 'bkash' },
  });
  check(idorInit.status === 403, 'Cross-subscriber checkout rejected with 403 Forbidden');

  // D: Valid checkout initiation
  const validInit = await api('http://127.0.0.1:3101', '/api/payments/initiate', {
    method: 'POST',
    token: subToken1, // Authenticated as owner SUB-001
    body: { invoiceId: sub1InvoiceId, gateway: 'bkash' },
  });
  check(validInit.status === 200, 'Valid checkout initiation returns 200 OK');
  check(validInit.body.success === true, 'Response reports success: true');
  check(typeof validInit.body.transactionId === 'string' && validInit.body.transactionId.startsWith('PAY-'), 'Generated PAY- transaction ID');
  check(typeof validInit.body.gatewayTransactionId === 'string' && validInit.body.gatewayTransactionId.startsWith('BKASH-'), 'Generated BKASH- gateway transaction ID');
  check(typeof validInit.body.redirectUrl === 'string' && validInit.body.redirectUrl.includes('/api/payments/mock/checkout/'), 'Valid mock redirect URL generated');
  check(validInit.body.amount === 25.00, 'Server-side amount verified from invoice record');

  // -----------------------------------------------------------------
  // 4. Webhook Security & Validation
  // -----------------------------------------------------------------
  console.log('\n--- 4. Webhook Security & Callback Validation ---');

  // A: Non-matching transaction reference
  const unmatchedCb = await api('http://127.0.0.1:3101', '/api/payments/bkash/callback', {
    method: 'POST',
    body: { transactionId: 'BKASH-UNKNOWN-FAKE-TXN', status: 'success', amount: 25.00 },
  });
  check(unmatchedCb.status === 404, 'Unmatched transaction reference rejected with 404');

  // B: Gateway mismatch: transaction initiated for 'bkash' called on 'nagad' callback
  const mismatchCb = await api('http://127.0.0.1:3101', '/api/payments/nagad/callback', {
    method: 'POST',
    body: { transactionId: validInit.body.gatewayTransactionId, status: 'success', amount: 25.00 },
  });
  check(mismatchCb.status === 400, 'Gateway mismatch rejected with 400 Bad Request');

  // C: Invalid signature rejection
  const badSigCb = await api('http://127.0.0.1:3101', '/api/payments/bkash/callback', {
    method: 'POST',
    body: {
      transactionId: validInit.body.gatewayTransactionId,
      status: 'success',
      amount: 25.00,
      signature: 'deadbeefbadsignature0000000000000000000000000000000000000000000000',
    },
  });
  check(badSigCb.status === 401, 'Invalid HMAC callback signature rejected with 401 Unauthorized');

  // D: Amount mismatch rejection
  const amountMismatchCb = await api('http://127.0.0.1:3101', '/api/payments/bkash/callback', {
    method: 'POST',
    body: { transactionId: validInit.body.gatewayTransactionId, status: 'success', amount: 999.00 },
  });
  check(amountMismatchCb.status === 400, 'Amount mismatch rejected with 400 Bad Request');

  // -----------------------------------------------------------------
  // 5. Failed and Cancelled Payment Handling
  // -----------------------------------------------------------------
  console.log('\n--- 5. Failed and Cancelled Callback Handling ---');
  const cancelInvoiceId = await createTestInvoice('SUB-001', 30.00);
  const cancelInit = await api('http://127.0.0.1:3101', '/api/payments/initiate', {
    method: 'POST',
    body: { invoiceId: cancelInvoiceId, gateway: 'rocket' },
  });

  const cancelledCb = await api('http://127.0.0.1:3101', '/api/payments/rocket/callback', {
    method: 'POST',
    body: { transactionId: cancelInit.body.gatewayTransactionId, status: 'cancelled', amount: 30.00 },
  });
  check(cancelledCb.status === 200, 'Cancelled callback responded 200 OK');
  check(cancelledCb.body.success === false, 'Cancelled callback reports success: false');

  const checkCancelledInv = await testPool.query('SELECT status FROM invoices WHERE id = $1', [cancelInvoiceId]);
  check(checkCancelledInv.rows[0].status === 'unpaid', 'Invoice remains unpaid upon payment cancellation');

  const checkCancelledTxn = await testPool.query('SELECT status FROM payment_transactions WHERE id = $1', [cancelInit.body.transactionId]);
  check(checkCancelledTxn.rows[0].status === 'cancelled', "Payment transaction transitioned to 'cancelled'");

  // -----------------------------------------------------------------
  // 6. Mock Hosted Checkout & Successful Atomic Settlement
  // -----------------------------------------------------------------
  console.log('\n--- 6. Mock Hosted Checkout & Atomic Settlement ---');
  const settleInvoiceId = await createTestInvoice('SUB-001', 45.00);
  const settleInit = await api('http://127.0.0.1:3101', '/api/payments/initiate', {
    method: 'POST',
    body: { invoiceId: settleInvoiceId, gateway: 'nagad' },
  });

  // Call mock hosted checkout page (which simulates settlement)
  const mockCheckoutRes = await api('http://127.0.0.1:3101', `/api/payments/mock/checkout/${settleInit.body.gatewayTransactionId}`);
  check(mockCheckoutRes.status === 200, 'Mock hosted checkout returns 200 OK');
  check(mockCheckoutRes.isHtml === true, 'Mock hosted checkout renders HTML page');
  check(mockCheckoutRes.body.includes('Payment completed successfully.'), 'HTML confirms payment completion');

  // Verify invoice state
  const settledInv = await testPool.query('SELECT status, raw_data FROM invoices WHERE id = $1', [settleInvoiceId]);
  check(settledInv.rows[0].status === 'paid', "Invoice transitioned to 'paid'");
  check(settledInv.rows[0].raw_data?.paidVia === 'nagad', 'Invoice raw_data records paidVia: nagad');
  check(settledInv.rows[0].raw_data?.transactionId === settleInit.body.gatewayTransactionId, 'Invoice raw_data records gateway transaction ID');

  // Verify payment transaction record
  const settledTxn = await testPool.query('SELECT status FROM payment_transactions WHERE id = $1', [settleInit.body.transactionId]);
  check(settledTxn.rows[0].status === 'success', "Payment transaction status transitioned to 'success'");

  // Verify billing event created
  const billingEvt = await testPool.query("SELECT * FROM billing_events WHERE invoice_id = $1 AND event = 'payment_received'", [settleInvoiceId]);
  check(billingEvt.rows.length === 1, "Exactly one 'payment_received' event recorded");

  // Verify audit log created
  const auditRec = await testPool.query("SELECT * FROM audit_log WHERE entity_id = $1 AND action = 'payment.settled'", [settleInvoiceId]);
  check(auditRec.rows.length >= 1, "Audit log records 'payment.settled' action");

  // -----------------------------------------------------------------
  // 7. Duplicate Callback & Replay Attack Defense
  // -----------------------------------------------------------------
  console.log('\n--- 7. Duplicate Callback & Replay Attack Protection ---');
  const duplicateCb = await api('http://127.0.0.1:3101', '/api/payments/nagad/callback', {
    method: 'POST',
    body: { transactionId: settleInit.body.gatewayTransactionId, status: 'success', amount: 45.00 },
  });
  check(duplicateCb.status === 200, 'Duplicate callback responded 200 OK');
  check(duplicateCb.body.alreadyPaid === true, 'Duplicate callback handled idempotently (alreadyPaid: true)');

  const dupEvents = await testPool.query("SELECT COUNT(*)::int AS count FROM billing_events WHERE invoice_id = $1 AND event = 'payment_received'", [settleInvoiceId]);
  check(dupEvents.rows[0].count === 1, 'Zero duplicate billing events created on duplicate callback');

  // -----------------------------------------------------------------
  // 8. Genuine Concurrency Protection (Simultaneous Callbacks)
  // -----------------------------------------------------------------
  console.log('\n--- 8. Concurrency Audit: Simultaneous Callbacks for Same Transaction ---');
  const concInvoiceId = await createTestInvoice('SUB-001', 35.00);
  const concInit = await api('http://127.0.0.1:3101', '/api/payments/initiate', {
    method: 'POST',
    body: { invoiceId: concInvoiceId, gateway: 'sslcommerz' },
  });

  const [callA, callB] = await Promise.all([
    api('http://127.0.0.1:3101', '/api/payments/sslcommerz/callback', {
      method: 'POST',
      body: { transactionId: concInit.body.gatewayTransactionId, status: 'success', amount: 35.00 },
    }),
    api('http://127.0.0.1:3101', '/api/payments/sslcommerz/callback', {
      method: 'POST',
      body: { transactionId: concInit.body.gatewayTransactionId, status: 'success', amount: 35.00 },
    }),
  ]);

  check(callA.status === 200, 'Concurrent callback A responded 200');
  check(callB.status === 200, 'Concurrent callback B responded 200');

  // One thread performs the primary settlement; the second thread detects already settled
  const aFirst = (callA.body.alreadyPaid === false && callB.body.alreadyPaid === true);
  const bFirst = (callB.body.alreadyPaid === false && callA.body.alreadyPaid === true);
  check(aFirst || bFirst, 'Exactly one concurrent callback performs settlement; the other resolves alreadyPaid: true');

  const concEvents = await testPool.query("SELECT COUNT(*)::int AS count FROM billing_events WHERE invoice_id = $1 AND event = 'payment_received'", [concInvoiceId]);
  check(concEvents.rows[0].count === 1, 'Zero duplicate billing events under simultaneous race condition');

  // -----------------------------------------------------------------
  // 9. Payment Transactions & Webhooks Ledger RBAC
  // -----------------------------------------------------------------
  console.log('\n--- 9. Payment Ledger & Webhooks RBAC Protection ---');

  // Subscriber cannot access transactions
  const subTxnRes = await api('http://127.0.0.1:3101', '/api/payments/transactions', { token: subToken1 });
  check(subTxnRes.status === 403, 'Subscriber accessing /api/payments/transactions rejected with 403 Forbidden');

  // Staff can access transactions
  const staffTxnRes = await api('http://127.0.0.1:3101', '/api/payments/transactions', { token: staffToken });
  check(staffTxnRes.status === 200, 'Staff accessing /api/payments/transactions responded 200 OK');
  check(Array.isArray(staffTxnRes.body.transactions), 'Staff received transactions array');

  // Subscriber cannot access webhooks log
  const subWebhookRes = await api('http://127.0.0.1:3101', '/api/payments/webhooks', { token: subToken1 });
  check(subWebhookRes.status === 403, 'Subscriber accessing /api/payments/webhooks rejected with 403 Forbidden');

  // Staff can access webhooks log
  const staffWebhookRes = await api('http://127.0.0.1:3101', '/api/payments/webhooks', { token: staffToken });
  check(staffWebhookRes.status === 200, 'Staff accessing /api/payments/webhooks responded 200 OK');
  check(Array.isArray(staffWebhookRes.body.webhooks), 'Staff received webhooks array');

  // -----------------------------------------------------------------
  // 10. Manual Verify / Reconciliation Endpoint
  // -----------------------------------------------------------------
  console.log('\n--- 10. Payment Reconciliation / Verify Endpoint ---');
  const verifyInvId = await createTestInvoice('SUB-001', 15.00);
  const verifyInit = await api('http://127.0.0.1:3101', '/api/payments/initiate', {
    method: 'POST',
    body: { invoiceId: verifyInvId, gateway: 'bkash' },
  });

  const reconRes = await api('http://127.0.0.1:3101', '/api/payments/verify', {
    method: 'POST',
    token: staffToken,
    body: { gateway: 'bkash', transactionId: verifyInit.body.gatewayTransactionId },
  });
  check(reconRes.status === 200, 'Staff /api/payments/verify responded 200 OK');
  check(reconRes.body.success === true, 'Reconciliation reports success: true');

  const checkReconInv = await testPool.query('SELECT status FROM invoices WHERE id = $1', [verifyInvId]);
  check(checkReconInv.rows[0].status === 'paid', "Invoice transitioned to 'paid' after reconciliation");

  // -----------------------------------------------------------------
  // 11. Production Database Forensic Comparison
  // -----------------------------------------------------------------
  console.log('\n--- 11. Production Database Forensic Verification ---');
  const prodCheck = await prodPool.query(`
    SELECT
      COUNT(*)::int AS count,
      md5(string_agg(id || ':' || status || ':' || amount::text, '|' ORDER BY id)) AS fingerprint
    FROM invoices
  `);
  check(prodCheck.rows[0].count === 469, 'Production invoice count strictly unchanged at 469');
  check(prodCheck.rows[0].fingerprint === '655bd2ef2416933dc4c72f4fd8104d03', 'Production invoice fingerprint strictly unchanged');

  const prodTxnCount = await prodPool.query('SELECT COUNT(*)::int AS count FROM payment_transactions');
  const prodWebhookCount = await prodPool.query('SELECT COUNT(*)::int AS count FROM payment_webhooks');
  check(prodTxnCount.rows[0].count === initialProdTxn.rows[0].count, `Production payment_transactions count strictly unchanged (${initialProdTxn.rows[0].count})`);
  check(prodWebhookCount.rows[0].count === initialProdWebhooks.rows[0].count, `Production payment_webhooks count strictly unchanged (${initialProdWebhooks.rows[0].count})`);

  // -----------------------------------------------------------------
  // 12. Cleanup Test Records from nextlink_test_db
  // -----------------------------------------------------------------
  console.log('\n--- 12. Cleanup Test Records ---');
  await testPool.query("DELETE FROM payment_webhooks WHERE payload::text LIKE '%TESTPAY%' OR gateway_txn_id LIKE '%TESTPAY%'");
  await testPool.query("DELETE FROM payment_transactions WHERE invoice_id LIKE 'INV-TESTPAY-%'");
  await testPool.query("DELETE FROM billing_events WHERE invoice_id LIKE 'INV-TESTPAY-%'");
  await testPool.query("DELETE FROM audit_log WHERE entity_id LIKE 'INV-TESTPAY-%'");
  const cleaned = await testPool.query("DELETE FROM invoices WHERE id LIKE 'INV-TESTPAY-%'");
  console.log(`  [cleanup] Removed ${cleaned.rowCount} temporary test invoices from nextlink_test_db`);

  console.log('\n========================================================================');
  console.log(`  PHASE 4.4.3.1 VERIFICATION COMPLETE: ${passedAssertions}/${totalAssertions} CHECKS PASSED`);
  console.log('========================================================================\n');

  await testPool.end();
  await prodPool.end();
}

run().catch((err) => {
  console.error('\nVERIFICATION FAILED:', err);
  process.exit(1);
});
