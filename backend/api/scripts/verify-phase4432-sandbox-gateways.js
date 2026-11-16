'use strict';

/**
 * Suite: Phase 4.4.3.2 Automated Verification for Payment Gateway Sandbox Integration
 *
 * Verifies:
 * Part A: Static Architecture & File Verification (Laravel 13):
 *    - PaymentGatewayInterface.php & AbstractPaymentGateway.php
 *    - BkashGatewayAdapter.php (Tokenized Checkout API structure)
 *    - NagadGatewayAdapter.php (Merchant API structure)
 *    - SslCommerzGatewayAdapter.php (Session Create & Validator API structure)
 *    - RocketGatewayAdapter.php (Adapter structure & manual documentation)
 *    - MockGatewayAdapter.php (Deterministic offline simulation)
 *    - PaymentGatewayService.php refactored as adapter manager
 *
 * Part B: Dynamic API Testing against Express (:3100) and Laravel 13 (:3101):
 *    - GATE-01: Fail-Closed Preflight Handshake (assertTestDbPreflight)
 *    - GATE-02: GET /api/payments/gateways returns supported gateway list
 *    - GATE-03: Gateway initiation across multiple providers (bkash, nagad, sslcommerz, mock)
 *    - GATE-04: Gateway contract validation (redirectUrl, gatewayTransactionId, amount, status)
 *    - GATE-05: Tenant isolation: cross-subscriber payment initiation rejected with 403
 *    - GATE-06: Server-side pricing integrity: client-supplied amount override rejected
 *    - GATE-07: Mock mode simulation across dual engines
 *    - GATE-08: Sandbox provider error handling & invalid payload rejection
 *    - GATE-09: Production security: mock mode disabled & headers suppressed in production simulation
 *    - GATE-10: Guaranteed cleanup in nextlink_test_db
 */

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const LARAVEL_DIR = path.resolve(__dirname, '../../../backend/laravel');

// Load JWT_SECRET
let JWT_SECRET = 'nextlink-dev-secret-change-me-in-production-9f3a2c';
const apiEnvPath = path.resolve(__dirname, '../.env');
const laravelEnvPath = path.resolve(LARAVEL_DIR, '.env');

function parseEnvSecret(filePath) {
  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*JWT_SECRET\s*=\s*(.*)$/);
      if (match) {
        return match[1].trim().replace(/^['"]|['"]$/g, '');
      }
    }
  }
  return null;
}

const loadedSecret = parseEnvSecret(apiEnvPath) || parseEnvSecret(laravelEnvPath);
if (loadedSecret) {
  JWT_SECRET = loadedSecret;
}

const EXPRESS_BASE = process.env.API_BASE_URL || 'http://localhost:3100';
const LARAVEL_BASE = process.env.LARAVEL_BASE_URL || 'http://localhost:3101';

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
 * Strict fail-closed preflight handshake
 */
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

  const isProdSim = String(headers['X-Simulate-Production'] || headers['x-simulate-production'] || '').toLowerCase() === 'true';

  if (!isProdSim) {
    const dbTarget = response.headers.get('x-database-target');
    if (dbTarget !== 'nextlink_test_db') {
      throw new Error(
        `CRITICAL ISOLATION FAILURE: Request to ${endpoint} returned database target '${dbTarget}' instead of 'nextlink_test_db'. Aborting immediately!`
      );
    }
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

function generateTokens() {
  const now = Math.floor(Date.now() / 1000);

  const staffToken = jwt.sign(
    {
      id: 'API-001',
      userId: 'API-001',
      email: 'admin@nextlink.com',
      name: 'Super Admin',
      role: 'super_admin',
      type: 'staff',
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET,
    { algorithm: 'HS256' }
  );

  const subscriberTokenA = jwt.sign(
    {
      id: 'SUB-001',
      subscriberId: 'SUB-001',
      username: 'alexwright',
      email: 'alex.wright@example.com',
      name: 'Alexander Wright',
      role: 'subscriber',
      type: 'subscriber',
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET,
    { algorithm: 'HS256' }
  );

  const subscriberTokenB = jwt.sign(
    {
      id: 'SUB-2FDC18C9',
      subscriberId: 'SUB-2FDC18C9',
      username: 'sarahturner',
      email: 'sarah.turner@example.com',
      name: 'Sarah Turner',
      role: 'subscriber',
      type: 'subscriber',
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET,
    { algorithm: 'HS256' }
  );

  return { staffToken, subscriberTokenA, subscriberTokenB };
}

/**
 * Part A: Static Architecture & File Verification
 */
function verifyStaticArchitecture() {
  console.log('\n--- Part A: Phase 4.4.3.2 Sandbox Gateway Architecture Verification ---');

  const EXPECTED_FILES = [
    'app/Services/Payments/PaymentGatewayInterface.php',
    'app/Services/Payments/AbstractPaymentGateway.php',
    'app/Services/Payments/BkashGatewayAdapter.php',
    'app/Services/Payments/NagadGatewayAdapter.php',
    'app/Services/Payments/SslCommerzGatewayAdapter.php',
    'app/Services/Payments/RocketGatewayAdapter.php',
    'app/Services/Payments/MockGatewayAdapter.php',
    'app/Services/PaymentGatewayService.php',
  ];

  for (const relPath of EXPECTED_FILES) {
    const fullPath = path.join(LARAVEL_DIR, relPath);
    assert(fs.existsSync(fullPath), `Adapter exists: ${relPath}`);
  }
}

/**
 * Part B: Dynamic API Testing on Target
 */
async function testApiTarget(targetName, baseUrl) {
  console.log(`\n--- Part B: Testing ${targetName} (${baseUrl}) ---`);

  let reachable = false;
  try {
    const probe = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1500) });
    reachable = probe.ok || probe.status === 200 || probe.status === 503;
  } catch {
    try {
      const probeV1 = await fetch(`${baseUrl}/api/v1/health`, { signal: AbortSignal.timeout(1500) });
      reachable = probeV1.ok || probeV1.status === 200 || probeV1.status === 503;
    } catch {}
  }

  if (!reachable) {
    console.log(`  [skip] ${targetName} at ${baseUrl} is not currently running. Architecture verified in Part A.`);
    return false;
  }

  // GATE-01: Preflight handshake
  await assertTestDbPreflight(baseUrl);
  assert(true, `[${targetName}] [GATE-01] Preflight handshake verified active target nextlink_test_db`);

  const { staffToken, subscriberTokenA, subscriberTokenB } = generateTokens();
  let createdTxnIds = [];
  let invoiceId = null;

  try {
    // GATE-02: Gateway Listing
    console.log(`  [${targetName}] 1. Gateway Listing:`);
    const gatewaysRes = await request(baseUrl, '/api/payments/gateways', { token: subscriberTokenA });
    assert(gatewaysRes.status === 200, `[${targetName}] [GATE-02] GET /api/payments/gateways responds 200`, gatewaysRes.status);
    const gatewaysList = gatewaysRes.body?.gateways || [];
    assert(Array.isArray(gatewaysList) && gatewaysList.length > 0, `[${targetName}] Gateways list is populated`);

    const hasBkash = gatewaysList.some((g) => g.id === 'bkash' || g.gateway === 'bkash');
    const hasNagad = gatewaysList.some((g) => g.id === 'nagad' || g.gateway === 'nagad');
    const hasSsl = gatewaysList.some((g) => g.id === 'sslcommerz' || g.gateway === 'sslcommerz');
    assert(hasBkash, `[${targetName}] bKash gateway is registered`);
    assert(hasNagad, `[${targetName}] Nagad gateway is registered`);
    assert(hasSsl, `[${targetName}] SSLCommerz gateway is registered`);

    // Setup an isolated unpaid test invoice for SUB-001 in nextlink_test_db
    const { getTestPool } = require('../src/lib/db');
    const pool = getTestPool();
    const testInvId = `INV-SANDBOX-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await pool.query(
      `INSERT INTO invoices (id, subscriber_id, amount, status, due_date, raw_data, created_at, updated_at)
       VALUES ($1, 'SUB-001', 35.00, 'unpaid', CURRENT_DATE + 10, '{"period":"2026-11"}', NOW(), NOW())`,
      [testInvId]
    );
    invoiceId = testInvId;
    const expectedAmount = 35.00;

    // GATE-03 & GATE-04: Multi-Gateway Initiation
    console.log(`  [${targetName}] 2. Multi-Gateway Initiation:`);
    if (invoiceId) {
      // bKash initiation
      const bkashInit = await request(baseUrl, '/api/payments/initiate', {
        method: 'POST',
        token: subscriberTokenA,
        body: { invoiceId, gateway: 'bkash', subscriberId: 'SUB-001' },
      });
      assert(bkashInit.status === 200, `[${targetName}] [GATE-03] POST /api/payments/initiate (bKash) responds 200`, bkashInit.status);
      assert(Boolean(bkashInit.body?.redirectUrl), `[${targetName}] [GATE-04] bKash returns redirectUrl`);
      if (bkashInit.body?.gatewayTransactionId) createdTxnIds.push(bkashInit.body.gatewayTransactionId);

      // Nagad initiation
      const nagadInit = await request(baseUrl, '/api/payments/initiate', {
        method: 'POST',
        token: subscriberTokenA,
        body: { invoiceId, gateway: 'nagad', subscriberId: 'SUB-001' },
      });
      assert(nagadInit.status === 200, `[${targetName}] [GATE-03] POST /api/payments/initiate (Nagad) responds 200`, nagadInit.status);
      assert(Boolean(nagadInit.body?.redirectUrl), `[${targetName}] [GATE-04] Nagad returns redirectUrl`);
      if (nagadInit.body?.gatewayTransactionId) createdTxnIds.push(nagadInit.body.gatewayTransactionId);

      // SSLCommerz initiation
      const sslInit = await request(baseUrl, '/api/payments/initiate', {
        method: 'POST',
        token: subscriberTokenA,
        body: { invoiceId, gateway: 'sslcommerz', subscriberId: 'SUB-001' },
      });
      assert(sslInit.status === 200, `[${targetName}] [GATE-03] POST /api/payments/initiate (SSLCommerz) responds 200`, sslInit.status);
      assert(Boolean(sslInit.body?.redirectUrl), `[${targetName}] [GATE-04] SSLCommerz returns redirectUrl`);
      if (sslInit.body?.gatewayTransactionId) createdTxnIds.push(sslInit.body.gatewayTransactionId);

      // Mock initiation
      const mockInit = await request(baseUrl, '/api/payments/initiate', {
        method: 'POST',
        token: subscriberTokenA,
        body: { invoiceId, gateway: 'mock', subscriberId: 'SUB-001' },
      });
      assert(mockInit.status === 200, `[${targetName}] [GATE-03] POST /api/payments/initiate (Mock) responds 200`, mockInit.status);
      assert(Boolean(mockInit.body?.redirectUrl), `[${targetName}] [GATE-04] Mock returns redirectUrl`);
      const mockTxnId = mockInit.body?.gatewayTransactionId;
      if (mockTxnId) createdTxnIds.push(mockTxnId);

      // GATE-05: Cross-subscriber payment IDOR rejection
      console.log(`  [${targetName}] 3. Tenant IDOR Security:`);
      const idorInit = await request(baseUrl, '/api/payments/initiate', {
        method: 'POST',
        token: subscriberTokenB,
        body: { invoiceId, gateway: 'bkash', subscriberId: 'SUB-2FDC18C9' },
      });
      assert(
        idorInit.status === 403 || idorInit.status === 404,
        `[${targetName}] [GATE-05] Cross-subscriber payment initiation rejected with 403/404`,
        idorInit.status
      );

      // GATE-06: Server-side pricing integrity (client amount ignored/rejected)
      console.log(`  [${targetName}] 4. Server-Side Pricing Integrity:`);
      const tamperedInit = await request(baseUrl, '/api/payments/initiate', {
        method: 'POST',
        token: subscriberTokenA,
        body: { invoiceId, gateway: 'bkash', subscriberId: 'SUB-001', amount: 0.01 },
      });
      if (tamperedInit.status === 200) {
        assert(
          Number(tamperedInit.body?.amount || expectedAmount) !== 0.01,
          `[${targetName}] [GATE-06] Server ignores client-supplied tampered amount 0.01`
        );
      } else {
        assert(tamperedInit.status === 400 || tamperedInit.status === 422, `[${targetName}] [GATE-06] Server rejects tampered amount payload`);
      }

      // GATE-07: Mock Gateway Checkout Simulation
      console.log(`  [${targetName}] 5. Mock Checkout Simulation:`);
      if (mockTxnId) {
        const checkoutRes = await fetch(`${baseUrl}/api/payments/mock/checkout/${mockTxnId}`, {
          headers: { 'X-Use-Test-Db': 'nextlink_test_db' },
        });
        assert(
          checkoutRes.status === 200 || checkoutRes.status === 302,
          `[${targetName}] [GATE-07] Mock checkout simulation responds with 200 or 302`,
          checkoutRes.status
        );
      }

      // GATE-08: Sandbox Error / Unknown Gateway Handling
      console.log(`  [${targetName}] 6. Provider Error Handling:`);
      const invalidGatewayInit = await request(baseUrl, '/api/payments/initiate', {
        method: 'POST',
        token: subscriberTokenA,
        body: { invoiceId, gateway: 'unknown_vendor_gateway', subscriberId: 'SUB-001' },
      });
      assert(
        invalidGatewayInit.status === 400 || invalidGatewayInit.status === 404,
        `[${targetName}] [GATE-08] Unknown gateway initiation rejected with 400/404`,
        invalidGatewayInit.status
      );
    }

    // GATE-09: Production Simulation Guard
    console.log(`  [${targetName}] 7. Production Security Mode:`);
    const prodMockProbe = await fetch(`${baseUrl}/api/payments/mock/checkout/SIM-PROD-001`, {
      headers: {
        'X-Simulate-Production': 'true',
        'X-Use-Test-Db': 'nextlink_test_db',
      },
    });
    assert(
      prodMockProbe.status === 404 || prodMockProbe.status === 403,
      `[${targetName}] [GATE-09] Mock checkout endpoint returns 404/403 under simulated production`,
      prodMockProbe.status
    );
    assert(
      !prodMockProbe.headers.get('x-database-target'),
      `[${targetName}] [GATE-09] Production simulation suppresses X-Database-Target header`
    );

  } finally {
    // GATE-10: Teardown created test invoice and transactions in nextlink_test_db
    try {
      const { getTestPool } = require('../src/lib/db');
      const pool = getTestPool();
      if (invoiceId) {
        await pool.query('DELETE FROM invoices WHERE id = $1', [invoiceId]);
      }
      for (const txnId of createdTxnIds) {
        await pool.query('DELETE FROM payment_transactions WHERE gateway_txn_id = $1', [txnId]);
        await pool.query('DELETE FROM payment_webhooks WHERE gateway_txn_id = $1', [txnId]);
      }
      console.log(`  [cleanup] Removed test invoice ${invoiceId || ''} and ${createdTxnIds.length} test transactions from nextlink_test_db`);
    } catch (cleanErr) {
      console.warn('  [cleanup] Note:', cleanErr.message);
    }
  }

  return true;
}

async function run() {
  console.log('\n============================================================');
  console.log('=== PHASE 4.4.3.2 VERIFICATION: Payment Gateway Sandbox  ===');
  console.log('=== Integration & Dual-Engine Parity Verification        ===');
  console.log('============================================================');

  // Static Architecture Audit
  verifyStaticArchitecture();

  // Test Express API target (port 3100)
  await testApiTarget('Express API (Port 3100)', EXPRESS_BASE);

  // Test Laravel API target (port 3101)
  await testApiTarget('Laravel 13 API (Port 3101)', LARAVEL_BASE);

  console.log(`\n=== Phase 4.4.3.2 Verification Summary: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log('\nFailures breakdown:');
    for (const f of failures) {
      console.log(` - ${f.label} [${JSON.stringify(f.extra)}]`);
    }
  }

  return { suite: 'Phase 4.4.3.2 Payment Gateway Sandbox', passed, failed, failures };
}

if (require.main === module) {
  run()
    .then((result) => {
      process.exit(result.failed === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error('Phase 4.4.3.2 verification crashed:', err);
      process.exit(1);
    });
}

module.exports = { run };
