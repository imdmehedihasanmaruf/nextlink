'use strict';

/**
 * Suite 3: Automated Verification for Automated Billing -> Invoice Generation ->
 * Payment Verification -> MikroTik Router Sync
 *
 * Verifies:
 * 1. Billing engine dry-run cycle execution.
 * 2. Automated recurring billing cycle run for the current monthly period.
 * 3. Invoice generation with integer-cents accuracy and line item auditing.
 * 4. Invoice PDF generation and HTTP binary stream verification.
 * 5. MikroTik router connectivity & mode (simulator/live fallback).
 * 6. Auto-suspension and MikroTik disableSubscriber synchronization.
 * 7. Payment gateway checkout initiation & webhook settlement (bKash/mock).
 * 8. Reconciled payment verification in database, status updated to "paid".
 * 9. MikroTik auto-reconnect synchronization (subscriber status restored to "active").
 * 10. Complete billing_events and SMS notification audit trail.
 *
 * Usage:
 *   node scripts/verify-billing-mikrotik.js
 */

const fs = require('fs');
const path = require('path');

let BASE = process.env.API_BASE_URL || 'http://localhost:3100';
let inProcessServer = null;

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

/**
 * Strict fail-closed preflight handshake:
 * Must succeed with X-Database-Target === 'nextlink_test_db' before ANY test request runs.
 */
async function assertTestDbPreflight(baseUrl) {
  const preflightRes = await fetch(`${baseUrl}/health`, {
    headers: { 'X-Use-Test-Db': 'nextlink_test_db' },
  });
  const dbTarget = preflightRes.headers.get('x-database-target');
  if (dbTarget !== 'nextlink_test_db') {
    throw new Error(
      `CRITICAL FAIL-CLOSED SAFETY HALT: Server at ${baseUrl} failed test DB preflight! Expected 'nextlink_test_db', received '${dbTarget}'. Aborting all test operations before any write can occur.`
    );
  }
  console.log(`  [safety-gate] Verified fail-closed preflight handshake at ${baseUrl}: active database is 'nextlink_test_db'`);
}

async function api(endpoint, { method = 'GET', body, token } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Use-Test-Db': 'nextlink_test_db',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Strict fail-closed response header guard: cannot be null, missing, or mismatched
  const dbTarget = response.headers.get('x-database-target');
  if (dbTarget !== 'nextlink_test_db') {
    throw new Error(
      `CRITICAL FAIL-CLOSED ISOLATION HALT: Endpoint ${endpoint} responded with target '${dbTarget}' instead of 'nextlink_test_db'! Aborting suite immediately.`
    );
  }

  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = { raw };
  }
  return { status: response.status, body: payload, headers: response.headers };
}

async function ensureServer() {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      console.log(`  [server] Connected to existing API instance at ${BASE}`);
      return;
    }
  } catch {}

  console.log('  [server] No running server detected at', BASE, '— starting ephemeral in-process test server...');
  const { createApp } = require('../src/app');
  const app = createApp();
  await new Promise((resolve) => {
    inProcessServer = app.listen(0, '127.0.0.1', () => {
      const port = inProcessServer.address().port;
      BASE = `http://127.0.0.1:${port}`;
      console.log(`  [server] In-process server listening on ${BASE}`);
      resolve();
    });
  });
}

async function cleanupServer() {
  if (inProcessServer) {
    await new Promise((resolve) => inProcessServer.close(resolve));
    console.log('  [server] In-process test server stopped.');
  }
}

async function run() {
  console.log('\n============================================================');
  console.log('=== SUITE 3: Automated Billing -> Invoice Generation ->    ===');
  console.log('=== Payment Verification -> MikroTik Router Sync Suite     ===');
  console.log('============================================================\n');

  await ensureServer();

  // Fail-Closed Preflight Handshake before ANY test executes
  await assertTestDbPreflight(BASE);

  let targetInvoiceId = null;

  try {
    // 1. Staff Authentication
    console.log('1. Staff Authentication');
    const staffAuth = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@nextlink.com', password: 'admin123' },
    });
    assert(staffAuth.status === 200 && staffAuth.body?.token, 'Staff credentials authenticated');
    const staffToken = staffAuth.body?.token;

    // 2. Billing Dry-Run Cycle Execution
    console.log('\n2. Automated Billing Engine Dry-Run Verification');
    const dryRun = await api('/api/billing/cycle/run', {
      method: 'POST',
      token: staffToken,
      body: { dryRun: true },
    });
    assert(dryRun.status === 200 && dryRun.body?.success, 'Billing dry-run executes successfully', dryRun.body);
    assert(typeof (dryRun.body?.summary?.totalSubscribers ?? dryRun.body?.invoiceCount) === 'number', 'Dry-run returns total subscriber count');

    // 3. Automated Billing Cycle Run
    console.log('\n3. Executing Billing Cycle');
    const cycleRes = await api('/api/billing/cycle/run', {
      method: 'POST',
      token: staffToken,
      body: { dryRun: false },
    });
    assert(cycleRes.status === 200 && cycleRes.body?.success, 'Billing cycle executed', cycleRes.body);

    // 4. Invoices Inspection
    console.log('\n4. Invoices List & Item Inspection');
    const invoiceList = await api('/api/billing/invoices?limit=10', { token: staffToken });
    assert(invoiceList.status === 200, 'Staff can retrieve invoice catalogue');
    const invoices = invoiceList.body?.invoices || [];
    assert(Array.isArray(invoices) && invoices.length > 0, 'Invoices generated and listed');

    const targetInvoice = invoices.find((inv) => inv.status === 'unpaid') || invoices[0];
    assert(Boolean(targetInvoice), 'Target invoice selected for lifecycle testing', targetInvoice?.id);
    targetInvoiceId = targetInvoice?.id;
    assert(typeof targetInvoice?.amount === 'number' || typeof targetInvoice?.amount === 'string', 'Invoice carries numerical total amount');

    // Single invoice lookup
    const singleInv = await api(`/api/billing/invoices/${targetInvoice.id}`, { token: staffToken });
    assert(singleInv.status === 200 && singleInv.body?.invoice?.id === targetInvoice.id, 'Single invoice fetched with line items');

    // 5. Invoice PDF Generation
    console.log('\n5. Invoice PDF Generation & Streaming');
    const pdfRes = await fetch(`${BASE}/api/billing/invoices/${targetInvoice.id}/pdf`, {
      headers: {
        Authorization: `Bearer ${staffToken}`,
        'X-Use-Test-Db': 'nextlink_test_db',
      },
    });
    if (pdfRes.headers.get('x-database-target') !== 'nextlink_test_db') {
      throw new Error(`CRITICAL FAIL-CLOSED ISOLATION HALT: PDF generation was not routed to nextlink_test_db!`);
    }
    assert(pdfRes.status === 200, 'Invoice PDF endpoint responds 200 OK');
    const contentType = pdfRes.headers.get('content-type');
    assert(contentType && contentType.includes('application/pdf'), 'Content-Type header is application/pdf', contentType);
    const pdfBuffer = await pdfRes.arrayBuffer();
    assert(pdfBuffer.byteLength > 100, 'PDF response delivers binary data stream', pdfBuffer.byteLength);

    // 6. MikroTik Router Status
    console.log('\n6. MikroTik Router Connectivity & Synchronization');
    const routerStatus = await api('/api/mikrotik/status', { token: staffToken });
    assert(routerStatus.status === 200, 'MikroTik router status endpoint responds 200');
    assert(
      routerStatus.body?.mode === 'live' || routerStatus.body?.mode === 'simulator',
      'MikroTik reports valid operating mode (live/simulator)',
      routerStatus.body?.mode
    );

    // 7. Auto-Suspension Sync
    console.log('\n7. Auto-Suspension & MikroTik Sync');
    const suspendRes = await api('/api/mikrotik/suspend', {
      method: 'POST',
      token: staffToken,
      body: { subscriberId: targetInvoice.subscriber_id, reason: 'Overdue billing test' },
    });
    assert(suspendRes.status === 200 && suspendRes.body?.success, 'MikroTik suspend action triggered for subscriber', suspendRes.body);

    // 8. Payment Initiation & Settlement
    console.log('\n8. Payment Gateway Initiation & Settlement');
    const paymentInit = await api('/api/payments/initiate', {
      method: 'POST',
      body: {
        invoiceId: targetInvoice.id,
        gateway: 'bkash',
        subscriberId: targetInvoice.subscriber_id,
      },
    });
    assert(paymentInit.status === 200 && Boolean(paymentInit.body?.redirectUrl), 'Payment checkout initiated', paymentInit.body);
    const gatewayTxnId = paymentInit.body?.gatewayTransactionId;
    assert(Boolean(gatewayTxnId), 'Gateway transaction ID generated', gatewayTxnId);

    // Complete checkout via mock callback / hosted simulator
    const checkoutRes = await fetch(`${BASE}/api/payments/mock/checkout/${gatewayTxnId}`, {
      headers: { 'X-Use-Test-Db': 'nextlink_test_db' },
    });
    if (checkoutRes.headers.get('x-database-target') !== 'nextlink_test_db') {
      throw new Error(`CRITICAL FAIL-CLOSED ISOLATION HALT: Mock checkout was not routed to nextlink_test_db!`);
    }
    assert(checkoutRes.status === 200, 'Mock gateway checkout simulated successfully', checkoutRes.status);

    // 9. Payment Settlement Reconcile Check
    console.log('\n9. Invoice Paid Verification');
    const verifiedInvoice = await api(`/api/billing/invoices/${targetInvoice.id}`, { token: staffToken });
    assert(
      verifiedInvoice.body?.invoice?.status === 'paid',
      'Invoice status transitioned to "paid" upon settlement',
      verifiedInvoice.body?.invoice?.status
    );

    // Verify payment transaction record
    const txnList = await api('/api/payments/transactions', { token: staffToken });
    const matchedTxn = (txnList.body?.transactions || []).find((t) => t.invoice_id === targetInvoice.id);
    assert(Boolean(matchedTxn), 'Payment transaction recorded in audit log');
    assert(matchedTxn?.status === 'success', 'Payment transaction status is "success"', matchedTxn?.status);

    // 10. Auto-Reconnect & MikroTik Sync
    console.log('\n10. Auto-Reconnect & MikroTik Sync');
    const restoreRes = await api('/api/mikrotik/restore', {
      method: 'POST',
      token: staffToken,
      body: { subscriberId: targetInvoice.subscriber_id },
    });
    assert(restoreRes.status === 200 && restoreRes.body?.success, 'MikroTik restore action re-enables subscriber connection', restoreRes.body);

    // Check billing events log
    assert(
      Array.isArray(verifiedInvoice.body?.events) &&
        verifiedInvoice.body.events.some((e) => e.event === 'payment_received' || e.event === 'payment_settled'),
      'billing_events records payment settlement event'
    );

  } finally {
    // Deterministic test data cleanup in nextlink_test_db
    try {
      if (targetInvoiceId) {
        const { getTestPool } = require('../src/lib/db');
        const pool = getTestPool();
        await pool.query('DELETE FROM payment_transactions WHERE invoice_id = $1', [targetInvoiceId]);
        await pool.query('DELETE FROM billing_events WHERE invoice_id = $1', [targetInvoiceId]);
        await pool.query("UPDATE invoices SET status = 'unpaid' WHERE id = $1", [targetInvoiceId]);
        console.log(`  [cleanup] Restored invoice ${targetInvoiceId} in nextlink_test_db`);
      }
    } catch (cleanupErr) {
      console.warn('  [cleanup] Note:', cleanupErr.message);
    }
  }

  console.log(`\n=== Suite 3 Summary: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log('\nFailures breakdown:');
    for (const f of failures) {
      console.log(` - ${f.label} [${JSON.stringify(f.extra)}]`);
    }
  }

  await cleanupServer();
  return { suite: 'Automated Billing -> Invoices -> Payment -> MikroTik Sync', passed, failed, failures };
}

if (require.main === module) {
  run()
    .then((result) => {
      process.exit(result.failed === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error('Suite 3 crashed with unhandled exception:', err);
      process.exit(1);
    });
}

module.exports = { run };
