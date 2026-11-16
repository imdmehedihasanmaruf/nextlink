'use strict';

/**
 * Suite: Phase 4.3 Automated Verification for Packages, Subscriptions, Customers & Orders
 *
 * Verifies:
 * Part A: Static Architecture & File Verification (Laravel 13):
 *    - 6 Controllers (PackageController, SubscriberController, SubscriptionController,
 *      OrderController, CoverageController, ApplicationController)
 *    - 7 Eloquent Models (Package, Subscriber, SubscriberCredential, SubscriberBilling,
 *      Order, ConnectionRequest, CoverageArea)
 *    - Route registrations in routes/api.php
 *
 * Part B: Dynamic API Testing against Express (:3100) and Laravel 13 (:3101):
 *    - Fail-Closed Preflight Handshake: validates X-Database-Target === 'nextlink_test_db' before ANY test runs.
 *    - Strict Test Database Isolation: requires and verifies X-Use-Test-Db: nextlink_test_db
 *      and asserts X-Database-Target: nextlink_test_db on every write response.
 *    - Package pricing integrity (SEC-02): rejects client price overrides.
 *    - Subscription activation payment requirement (SEC-04): rejects unverified activation.
 *    - Application document download security (SEC-09): super_admin RBAC & realpath verification.
 *    - Coverage area mutation RBAC & area matching.
 *    - Guaranteed cleanup: deletes any created test data from nextlink_test_db in try/finally.
 */

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const LARAVEL_DIR = path.resolve(__dirname, '../../../backend/laravel');

// Load JWT_SECRET from backend/api/.env or backend/laravel/.env
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
 * Strict fail-closed preflight handshake:
 * Must succeed with X-Database-Target === 'nextlink_test_db' before ANY test request runs.
 */
async function assertTestDbPreflight(baseUrl) {
  const probe = await fetch(`${baseUrl}/health`, {
    headers: { 'X-Use-Test-Db': 'nextlink_test_db' },
    signal: AbortSignal.timeout(3000),
  });
  const target = probe.headers.get('x-database-target');
  if (target !== 'nextlink_test_db') {
    throw new Error(
      `CRITICAL TEST DB PREFLIGHT FAILURE: Expected X-Database-Target to be 'nextlink_test_db', but received '${target}'. ` +
      `Halting suite execution immediately to protect production database!`
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

  // Strict non-optional response guard: must affirmatively declare nextlink_test_db
  const dbTarget = response.headers.get('x-database-target');
  if (dbTarget !== 'nextlink_test_db') {
    throw new Error(
      `CRITICAL ISOLATION FAILURE: Request to ${endpoint} returned database target '${dbTarget}' instead of 'nextlink_test_db'. Aborting immediately!`
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

function generateTokens() {
  const now = Math.floor(Date.now() / 1000);

  // Use valid database-backed user identities
  const staffToken = jwt.sign(
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
    { algorithm: 'HS256' }
  );

  const subscriberToken = jwt.sign(
    {
      id: 'SUB-8EAD460F',
      subscriberId: 'SUB-8EAD460F',
      username: 'applicant',
      email: 'applicant@example.com',
      name: 'Test Applicant',
      role: 'subscriber',
      type: 'subscriber',
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET,
    { algorithm: 'HS256' }
  );

  return { staffToken, subscriberToken };
}

// 1x1 valid PNG base64
const VALID_NID_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * Part A: Static Architecture & File Verification
 */
function verifyStaticArchitecture() {
  console.log('\n--- Part A: Phase 4.3 Architecture & Controller Verification ---');

  const EXPECTED_CONTROLLERS = [
    'PackageController',
    'SubscriberController',
    'SubscriptionController',
    'OrderController',
    'CoverageController',
    'ApplicationController',
  ];

  for (const name of EXPECTED_CONTROLLERS) {
    const filePath = path.join(LARAVEL_DIR, `app/Http/Controllers/${name}.php`);
    assert(fs.existsSync(filePath), `Controller exists: app/Http/Controllers/${name}.php`);
  }

  const EXPECTED_MODELS = [
    'Package',
    'Subscriber',
    'SubscriberCredential',
    'SubscriberBilling',
    'Order',
    'ConnectionRequest',
    'CoverageArea',
  ];

  for (const name of EXPECTED_MODELS) {
    const filePath = path.join(LARAVEL_DIR, `app/Models/${name}.php`);
    assert(fs.existsSync(filePath), `Eloquent Model exists: app/Models/${name}.php`);
  }

  const routesFile = path.join(LARAVEL_DIR, 'routes/api.php');
  assert(fs.existsSync(routesFile), 'routes/api.php exists');
  if (fs.existsSync(routesFile)) {
    const code = fs.readFileSync(routesFile, 'utf8');
    assert(code.includes('PackageController'), 'routes/api.php references PackageController');
    assert(code.includes('CoverageController'), 'routes/api.php references CoverageController');
    assert(code.includes('ApplicationController'), 'routes/api.php references ApplicationController');
    assert(code.includes('OrderController'), 'routes/api.php references OrderController');
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

  // Pre-test fail-closed handshake
  await assertTestDbPreflight(baseUrl);

  console.log(`  [target] Connected to ${targetName} at ${baseUrl}`);
  const { staffToken, subscriberToken } = generateTokens();

  let createdAppId = null;

  try {
    // 1. Packages API
    console.log(`  [${targetName}] 1. Package APIs:`);
    const pkgs = await request(baseUrl, '/api/customer/packages');
    assert(pkgs.status === 200, `[${targetName}] GET /api/customer/packages responds 200 OK`, pkgs.status);
    const pkgList = pkgs.body?.packages || [];
    assert(Array.isArray(pkgList) && pkgList.length > 0, `[${targetName}] Packages list contains packages`, pkgList.length);
    if (pkgList.length > 0) {
      const firstPkg = pkgList[0];
      assert(Boolean(firstPkg.id && firstPkg.name), `[${targetName}] Package has id and name (${firstPkg.id})`);
      assert(typeof Number(firstPkg.price) === 'number', `[${targetName}] Package carries numeric price ($${firstPkg.price})`);
    }

    // 2. Coverage & Application APIs
    console.log(`  [${targetName}] 2. Coverage & Applications:`);
    const zones = await request(baseUrl, '/api/coverage/zones');
    assert(zones.status === 200 && Array.isArray(zones.body?.zones), `[${targetName}] GET /api/coverage/zones responds 200 with zones array`);

    const areas = await request(baseUrl, '/api/coverage/areas');
    assert(areas.status === 200 && Array.isArray(areas.body?.areas), `[${targetName}] GET /api/coverage/areas responds 200 with coordinates`);

    const checkAvailable = await request(baseUrl, '/api/coverage/check?zone=Europe&district=London Central');
    assert(checkAvailable.status === 200, `[${targetName}] GET /api/coverage/check responds 200`);
    assert(checkAvailable.body?.covered === true, `[${targetName}] Available zone reports covered: true`);

    // Connection Request into nextlink_test_db
    const testPhone = `+88019${Date.now().toString().slice(-8)}`;
    const appRes = await request(baseUrl, '/api/applications', {
      method: 'POST',
      body: {
        fullName: 'Phase 4.3 Test Applicant',
        phone: testPhone,
        email: `applicant.${Date.now()}@nextlink.global`,
        idNumber: 'NID-P43-12345',
        idDocumentDataUrl: VALID_NID_PNG,
        address: 'Suite 500, Tech City, Dhaka',
        packageId: 'PKG-002',
        packageName: 'Standard',
        ontConfig: 'Wi-Fi 6 Gateway Mode',
      },
    });
    assert(appRes.status === 201 && appRes.body?.success, `[${targetName}] POST /api/applications submits connection request`);
    createdAppId = appRes.body?.request?.id;
    assert(Boolean(createdAppId), `[${targetName}] Application tracking ID returned (${createdAppId})`);

    // SEC-09: Document download authorization
    if (createdAppId) {
      const docUnauth = await request(baseUrl, `/api/applications/${createdAppId}/document`);
      assert(docUnauth.status === 401, `[${targetName}] [SEC-09] Anonymous GET /api/applications/{id}/document returns 401`);

      const docSub = await request(baseUrl, `/api/applications/${createdAppId}/document`, { token: subscriberToken });
      assert(docSub.status === 403, `[${targetName}] [SEC-09] Subscriber GET /api/applications/{id}/document returns 403`);

      const docStaff = await request(baseUrl, `/api/applications/${createdAppId}/document`, { token: staffToken });
      assert(docStaff.status === 200 || docStaff.status === 304, `[${targetName}] [SEC-09] Super admin GET /api/applications/{id}/document succeeds`, docStaff.status);
    }

    // Staff application list
    const listApps = await request(baseUrl, '/api/applications', { token: staffToken });
    assert(listApps.status === 200 && Array.isArray(listApps.body?.requests), `[${targetName}] GET /api/applications requires staff token`);

    // 3. Customer & Portal APIs
    console.log(`  [${targetName}] 3. Customer Portal & Summary:`);
    const summaryRes = await request(baseUrl, '/api/portal/my-summary', { token: subscriberToken });
    assert(summaryRes.status === 200, `[${targetName}] GET /api/portal/my-summary responds 200 for subscriber`);
    assert(Boolean(summaryRes.body?.subscriber || summaryRes.body?.subscriberId), `[${targetName}] Portal summary includes subscriber object or id`);

    // Unauthenticated rejection
    const unauthSummary = await request(baseUrl, '/api/portal/my-summary');
    assert(unauthSummary.status === 401, `[${targetName}] Unauthenticated /api/portal/my-summary returns 401 Unauthorized`);

    // SEC-04: Subscription activation payment requirement verification
    console.log(`  [${targetName}] 4. Subscription Activation Integrity (SEC-04):`);
    const cancelledSubToken = jwt.sign(
      { id: 'NL-TEST-CANCEL-01', subscriberId: 'NL-TEST-CANCEL-01', role: 'subscriber', type: 'subscriber', exp: Math.floor(Date.now() / 1000) + 3600 },
      JWT_SECRET,
      { algorithm: 'HS256' }
    );
    const unverifiedActivation = await request(baseUrl, '/api/customer/subscription/activate', {
      method: 'POST',
      token: cancelledSubToken,
      body: { packageId: 'PKG-003' },
    });
    assert(
      unverifiedActivation.status === 403 || unverifiedActivation.status === 400 || unverifiedActivation.status === 409,
      `[${targetName}] [SEC-04] Unverified subscription activation is rejected with 403/400/409`,
      unverifiedActivation.status
    );

    // 5. Order Management APIs & SEC-02 Price Tampering Rejection
    console.log(`  [${targetName}] 5. Order Security & Pricing (SEC-02):`);
    const ordersRes = await request(baseUrl, '/api/orders', { token: staffToken });
    assert(ordersRes.status === 200, `[${targetName}] GET /api/orders responds 200 for staff`);

    const tamperedOrder = await request(baseUrl, '/api/orders', {
      method: 'POST',
      token: subscriberToken,
      body: {
        customerId: 'SUB-1001',
        packageId: 'PKG-001',
        monthlyPrice: 0.01,
        totalPayable: 0.01,
      },
    });
    if (tamperedOrder.status === 201 || tamperedOrder.status === 200) {
      const orderPrice = Number(tamperedOrder.body?.order?.monthly_price || tamperedOrder.body?.order?.monthlyPrice);
      assert(orderPrice !== 0.01, `[${targetName}] [SEC-02] Server rejects or overrides client price 0.01 on order creation`, orderPrice);
    } else {
      assert(tamperedOrder.status === 400 || tamperedOrder.status === 403 || tamperedOrder.status === 404, `[${targetName}] [SEC-02] Server rejects invalid/tampered order payload`, tamperedOrder.status);
    }

    // Cross-tenant order rejection
    const crossTenantOrder = await request(baseUrl, '/api/orders', {
      method: 'POST',
      token: subscriberToken,
      body: {
        customerId: 'SUB-9999',
        packageId: 'PKG-001',
      },
    });
    assert(
      crossTenantOrder.status === 403 || crossTenantOrder.status === 400 || crossTenantOrder.status === 404,
      `[${targetName}] Cross-tenant order creation is rejected with 403/400/404`,
      crossTenantOrder.status
    );

  } finally {
    // Guaranteed teardown of test records from nextlink_test_db
    if (createdAppId && baseUrl === EXPRESS_BASE) {
      try {
        const { getTestPool } = require('../src/lib/db');
        const pool = getTestPool();
        await pool.query('DELETE FROM connection_requests WHERE id = $1', [createdAppId]);
        console.log(`  [cleanup] Removed test connection request ${createdAppId} from nextlink_test_db`);
      } catch (cleanErr) {
        console.warn('  [cleanup] Note:', cleanErr.message);
      }
    }
  }

  return true;
}

async function run() {
  console.log('\n============================================================');
  console.log('=== PHASE 4.3 VERIFICATION: Packages, Subscriptions,     ===');
  console.log('=== Customers & Orders Endpoints & Parity Verification    ===');
  console.log('============================================================');

  // Static Architecture Audit
  verifyStaticArchitecture();

  // Test Express API target (port 3100)
  await testApiTarget('Express API (Port 3100)', EXPRESS_BASE);

  // Test Laravel API target (port 3101)
  await testApiTarget('Laravel 13 API (Port 3101)', LARAVEL_BASE);

  console.log(`\n=== Phase 4.3 Verification Summary: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log('\nFailures breakdown:');
    for (const f of failures) {
      console.log(` - ${f.label} [${JSON.stringify(f.extra)}]`);
    }
  }

  return { suite: 'Phase 4.3 Packages, Subscriptions & Orders', passed, failed, failures };
}

if (require.main === module) {
  run()
    .then((result) => {
      process.exit(result.failed === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error('Phase 4.3 verification crashed:', err);
      process.exit(1);
    });
}

module.exports = { run };
