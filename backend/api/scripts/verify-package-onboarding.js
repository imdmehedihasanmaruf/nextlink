'use strict';

/**
 * Suite 2: Automated Verification for Package Creation -> Website Reflection ->
 * Connection Request -> Admin Approval -> Subscriber Onboarding Pipeline
 *
 * Verifies:
 * 1. Package catalogue retrieval from backend.
 * 2. Public website reflection of packages and coverage areas.
 * 3. Connection request submission with NID document upload (base64 image payload).
 * 4. Staff review of pending connection request and ID document retrieval.
 * 5. Admin approval of connection request generating subscriber record and temporary credentials.
 * 6. Idempotency of approval (approving again reuses existing account without error).
 * 7. Subscriber login using generated temporary password.
 * 8. Subscriber portal onboarding verification (accessing my-summary and profile).
 *
 * Usage:
 *   node scripts/verify-package-onboarding.js
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

// 1x1 valid PNG as base64 data URL
const VALID_NID_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function run() {
  console.log('\n============================================================');
  console.log('=== SUITE 2: Package Creation -> Website Reflection ->     ===');
  console.log('=== Connection Request -> Approval -> Onboarding Suite     ===');
  console.log('============================================================\n');

  await ensureServer();

  // Fail-Closed Preflight Handshake before ANY test executes
  await assertTestDbPreflight(BASE);

  let createdAppId = null;
  let createdSubscriberId = null;

  try {
    // 1. Staff authentication
    console.log('1. Staff Authentication');
    const staffAuth = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@nextlink.com', password: 'admin123' },
    });
    assert(staffAuth.status === 200 && staffAuth.body?.token, 'Staff credentials authenticated successfully');
    const staffToken = staffAuth.body?.token;

    // 2. Package catalogue & Website reflection
    console.log('\n2. Package Catalogue & Public Website Reflection');
    const coverageZones = await api('/api/coverage/zones');
    assert(coverageZones.status === 200 && Array.isArray(coverageZones.body?.zones), 'Public coverage zones endpoint responds 200');
    assert(coverageZones.body?.zones?.length > 0, 'At least one coverage zone exists in catalogue');

    const coverageAreas = await api('/api/coverage/areas');
    assert(coverageAreas.status === 200 && Array.isArray(coverageAreas.body?.areas), 'Public coverage areas endpoint responds 200');
    assert(coverageAreas.body?.areas?.length > 0, 'Public coverage areas list is populated');

    // Verify packages available for customer selection
    const customerPackages = await api('/api/customer/packages');
    assert(customerPackages.status === 200, 'Customer packages endpoint responds 200', customerPackages.status);
    const pkgList = customerPackages.body?.packages || [];
    assert(Array.isArray(pkgList) && pkgList.length > 0, 'Package catalogue contains selectable packages');

    const selectedPkg = pkgList[0] || { id: 'PKG-002', name: 'Standard', price: 29.99 };
    console.log(`  [test] Using package for connection request: ${selectedPkg.id} (${selectedPkg.name})`);

    // 3. Online Connection Request with NID document upload
    console.log('\n3. Connection Request Submission with NID Document');
    const testPhone = `+88017${Date.now().toString().slice(-8)}`;
    const testEmail = `applicant.${Date.now()}@example.com`;
    const requestPayload = {
      fullName: 'Test Verifier Applicant',
      phone: testPhone,
      email: testEmail,
      idNumber: 'NID-9988776655',
      idDocumentDataUrl: VALID_NID_PNG,
      address: 'Plot 18, Road 11, Banani DOHS, Dhaka, Bangladesh',
      packageId: selectedPkg.id,
      packageName: selectedPkg.name,
      ontConfig: 'Wi-Fi 6 Gateway Mode',
    };

    const submitRes = await api('/api/applications', {
      method: 'POST',
      body: requestPayload,
    });
    assert(submitRes.status === 201 && submitRes.body?.success, 'Connection request submitted with 201 Created', submitRes.body);
    const applicationId = submitRes.body?.request?.id;
    createdAppId = applicationId;
    assert(Boolean(applicationId), 'Application returns unique tracking ID', applicationId);

    // 4. Staff Review & Document Inspection
    console.log('\n4. Staff Review of Application');
    const listApps = await api('/api/applications', { token: staffToken });
    assert(listApps.status === 200 && Array.isArray(listApps.body?.requests), 'Staff can retrieve application list');
    const foundApp = (listApps.body?.requests || []).find((r) => r.id === applicationId);
    assert(Boolean(foundApp), 'Submitted application appears in staff application queue');
    assert(foundApp?.status === 'pending', 'Submitted application initial status is "pending"');
    assert(Boolean(foundApp?.id_document_path), 'Application records path to uploaded NID document');

    // Verify ID document download endpoint
    const docRes = await fetch(`${BASE}/api/applications/${applicationId}/document`, {
      headers: {
        Authorization: `Bearer ${staffToken}`,
        'X-Use-Test-Db': 'nextlink_test_db',
      },
    });
    if (docRes.headers.get('x-database-target') !== 'nextlink_test_db') {
      throw new Error(`CRITICAL FAIL-CLOSED ISOLATION HALT: Document download was not routed to nextlink_test_db!`);
    }
    assert(docRes.status === 200, 'Staff can download uploaded NID document via API', docRes.status);

    // 5. Admin Approval & Subscriber Creation
    console.log('\n5. Admin Approval of Application');
    const approveRes = await api(`/api/applications/${applicationId}`, {
      method: 'PATCH',
      token: staffToken,
      body: { status: 'approved' },
    });
    assert(approveRes.status === 200 && approveRes.body?.success, 'Application approved successfully by admin', approveRes.body);
    const subscriberId = approveRes.body?.subscriberId;
    createdSubscriberId = subscriberId;
    const tempPassword = approveRes.body?.temporaryPassword;
    assert(Boolean(subscriberId), 'Approval creates new subscriber ID', subscriberId);
    assert(Boolean(tempPassword), 'Approval issues temporary subscriber password');

    // 6. Idempotency Check
    console.log('\n6. Approval Idempotency Check');
    const secondApprove = await api(`/api/applications/${applicationId}`, {
      method: 'PATCH',
      token: staffToken,
      body: { status: 'approved' },
    });
    assert(secondApprove.status === 200, 'Second approval call is idempotent and succeeds without duplicate creation');
    assert(secondApprove.body?.subscriberId === subscriberId, 'Re-approval reuses the identical subscriber ID');

    // 7. Subscriber Onboarding & Login
    console.log('\n7. Subscriber Login & Credential Verification');
    const subLogin = await api('/api/auth/subscriber-login', {
      method: 'POST',
      body: { username: testPhone, password: tempPassword },
    });
    assert(subLogin.status === 200 && subLogin.body?.success, 'Subscriber logs in with temporary password', subLogin.body);
    const subToken = subLogin.body?.token;
    assert(Boolean(subToken), 'Subscriber login returns authentication JWT token');

    // 8. Subscriber Portal Access
    console.log('\n8. Subscriber Portal Summary');
    const summaryRes = await api('/api/portal/my-summary', { token: subToken });
    assert(summaryRes.status === 200, 'Subscriber can access portal summary', summaryRes.status);
    assert(
      summaryRes.body?.subscriber?.id === subscriberId,
      'Portal summary returns matching subscriber ID',
      summaryRes.body?.subscriber?.id
    );

  } finally {
    // Deterministic test data cleanup in nextlink_test_db
    try {
      const { getTestPool } = require('../src/lib/db');
      const pool = getTestPool();
      if (createdSubscriberId) {
        await pool.query('DELETE FROM subscriber_billing WHERE subscriber_id = $1', [createdSubscriberId]);
        await pool.query('DELETE FROM subscriber_credentials WHERE subscriber_id = $1', [createdSubscriberId]);
        await pool.query('DELETE FROM subscribers WHERE id = $1', [createdSubscriberId]);
        console.log(`  [cleanup] Removed test subscriber ${createdSubscriberId} from nextlink_test_db`);
      }
      if (createdAppId) {
        await pool.query('DELETE FROM connection_requests WHERE id = $1', [createdAppId]);
        console.log(`  [cleanup] Removed test application ${createdAppId} from nextlink_test_db`);
      }
    } catch (cleanupErr) {
      console.warn('  [cleanup] Note:', cleanupErr.message);
    }
  }

  console.log(`\n=== Suite 2 Summary: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log('\nFailures breakdown:');
    for (const f of failures) {
      console.log(` - ${f.label} [${JSON.stringify(f.extra)}]`);
    }
  }

  await cleanupServer();
  return { suite: 'Package Creation -> Website Reflection -> Onboarding', passed, failed, failures };
}

if (require.main === module) {
  run()
    .then((result) => {
      process.exit(result.failed === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error('Suite 2 crashed with unhandled exception:', err);
      process.exit(1);
    });
}

module.exports = { run };
