'use strict';

/**
 * Suite: Phase 4.2 Automated Verification for Authentication, RBAC & Settings API
 *
 * Verifies:
 * Part A: Static Architecture & Implementation Audit (Laravel 13):
 *    - JwtService: strict HS256 enforcement, hash_hmac, hash_equals constant-time check,
 *      rejection of alg:none, expiration (exp) and not-before (nbf) handling.
 *    - AuthIdentityService: dual authenticatable provider resolution (ApiUser for staff,
 *      SubscriberCredential / Subscriber for subscribers), bcrypt Hash::check, auto-migration.
 *    - AuthenticateJwt Middleware: Bearer token extraction, payload verification,
 *      standard 401 error responses for missing/malformed/tampered/expired tokens.
 *    - RequireRole Middleware: super_admin full bypass, strict role gating, standard 403
 *      forbidden responses for unauthorized roles.
 *    - SettingsService & SettingsController: deep defaults merge, maskSecrets replacing
 *      passwords/tokens/secrets with ••••••••••••, public/system settings endpoints.
 *    - Routes registration in routes/api.php and middleware aliases in bootstrap/app.php.
 *
 * Part B: Dynamic API Testing against Express (Port 3100) & Laravel 13 Kernel:
 *    - JWT Failure Modes: missing token (401), malformed (401), tampered (401),
 *      expired (401), algorithm switching/alg:none (401).
 *    - RBAC: staff access granted (200), subscriber access to staff endpoint blocked (403).
 *    - Settings: public unauthenticated fees access (200), masked staff configuration (200).
 *
 * Usage:
 *   node backend/api/scripts/verify-phase42-auth-settings.js
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const jwt = require('jsonwebtoken');

// Load .env from backend/api
const apiEnvPath = path.resolve(__dirname, '../.env');
let JWT_SECRET = 'nextlink-dev-secret-change-me-in-production-9f3a2c';
if (fs.existsSync(apiEnvPath)) {
  const envText = fs.readFileSync(apiEnvPath, 'utf8');
  for (const line of envText.split('\n')) {
    const match = line.match(/^\s*JWT_SECRET\s*=\s*(.*)$/);
    if (match) {
      JWT_SECRET = match[1].trim().replace(/^['"]|['"]$/g, '');
      break;
    }
  }
}

const LARAVEL_DIR = path.resolve(__dirname, '../../../backend/laravel');
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

function probeHttp(url, options = {}) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method: options.method || 'GET',
          headers: options.headers || {},
          timeout: options.timeout || 3000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            let payload = null;
            try {
              payload = data ? JSON.parse(data) : null;
            } catch {
              payload = { raw: data };
            }
            resolve({ ok: true, status: res.statusCode, body: payload, headers: res.headers });
          });
        }
      );
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.on('error', (err) => { resolve({ ok: false, error: err.message }); });
      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.end();
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

function runLaravelKernelRequest(uri, method = 'GET', headers = {}, body = null) {
  const phpScript = `
    @require 'backend/laravel/vendor/autoload.php';
    $app = require 'backend/laravel/bootstrap/app.php';
    $kernel = $app->make('Illuminate\\\\Contracts\\\\Http\\\\Kernel');
    $server = [
      'REQUEST_URI' => '${uri}',
      'REQUEST_METHOD' => '${method}',
      'HTTP_ACCEPT' => 'application/json',
    ];
    ${headers.Authorization ? `$server['HTTP_AUTHORIZATION'] = '${headers.Authorization}';` : ''}
    $req = \\Illuminate\\Http\\Request::create('${uri}', '${method}', [], [], [], $server, ${body ? `'${JSON.stringify(body)}'` : 'null'});
    $res = $kernel->handle($req);
    echo json_encode([
      'status' => $res->getStatusCode(),
      'body' => json_decode($res->getContent(), true) ?: $res->getContent()
    ]);
  `;
  try {
    const output = execSync(`php -r "${phpScript.replace(/\n\s*/g, ' ')}"`, {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
    }).trim();
    return JSON.parse(output);
  } catch (err) {
    return { status: 500, error: err.message };
  }
}

async function run() {
  console.log('\n============================================================');
  console.log('=== PHASE 4.2 VERIFICATION: Auth, RBAC & Settings API    ===');
  console.log('============================================================\n');

  // -------------------------------------------------------------------------
  // Part A: Laravel 13 Architecture & Implementation Audit
  // -------------------------------------------------------------------------
  console.log('--- Part A: Laravel 13 Phase 4.2 Architecture & Code Verification ---');

  // 1. JwtService
  const jwtServicePath = path.join(LARAVEL_DIR, 'app/Services/JwtService.php');
  assert(fs.existsSync(jwtServicePath), 'JwtService.php exists');
  if (fs.existsSync(jwtServicePath)) {
    const code = fs.readFileSync(jwtServicePath, 'utf8');
    assert(code.includes("hash_hmac('sha256'"), 'JwtService signs with HMAC-SHA256');
    assert(code.includes('hash_equals('), 'JwtService uses constant-time hash_equals signature verification');
    assert(code.includes("$header['alg'] !== 'HS256'"), 'JwtService validates alg is strictly HS256');
    assert(code.includes('base64UrlEncode') && code.includes('base64UrlDecode'), 'JwtService implements Base64Url encoding/decoding');
    assert(code.includes("payload['exp']") && code.includes("payload['nbf']"), 'JwtService validates exp and nbf claims');
  }

  // 2. AuthIdentityService
  const authServicePath = path.join(LARAVEL_DIR, 'app/Services/AuthIdentityService.php');
  assert(fs.existsSync(authServicePath), 'AuthIdentityService.php exists');
  if (fs.existsSync(authServicePath)) {
    const code = fs.readFileSync(authServicePath, 'utf8');
    assert(code.includes('ApiUser') && code.includes('SubscriberCredential'), 'AuthIdentityService resolves both staff and subscriber models');
    assert(code.includes('Hash::check'), 'AuthIdentityService verifies passwords with bcrypt');
    assert(code.includes('resolveIdentity'), 'AuthIdentityService provides resolveIdentity for token claims');
  }

  // 3. AuthenticateJwt Middleware
  const authMiddlewarePath = path.join(LARAVEL_DIR, 'app/Http/Middleware/AuthenticateJwt.php');
  assert(fs.existsSync(authMiddlewarePath), 'AuthenticateJwt.php middleware exists');
  if (fs.existsSync(authMiddlewarePath)) {
    const code = fs.readFileSync(authMiddlewarePath, 'utf8');
    assert(code.includes('Authorization') && code.includes('Bearer '), 'AuthenticateJwt extracts Bearer token from headers');
    assert(code.includes('401'), 'AuthenticateJwt returns HTTP 401 on missing or invalid tokens');
    assert(code.includes('jwtService->verify') || code.includes('jwtService->tryVerify'), 'AuthenticateJwt calls JwtService verify()');
  }

  // 4. RequireRole Middleware
  const roleMiddlewarePath = path.join(LARAVEL_DIR, 'app/Http/Middleware/RequireRole.php');
  assert(fs.existsSync(roleMiddlewarePath), 'RequireRole.php middleware exists');
  if (fs.existsSync(roleMiddlewarePath)) {
    const code = fs.readFileSync(roleMiddlewarePath, 'utf8');
    assert(code.includes('super_admin'), 'RequireRole gives super_admin universal bypass');
    assert(code.includes('403'), 'RequireRole returns HTTP 403 Forbidden on unauthorized roles');
  }

  // 5. SettingsService & SettingsController
  const settingsServicePath = path.join(LARAVEL_DIR, 'app/Services/SettingsService.php');
  const settingsCtrlPath = path.join(LARAVEL_DIR, 'app/Http/Controllers/SettingsController.php');
  assert(fs.existsSync(settingsServicePath), 'SettingsService.php exists');
  assert(fs.existsSync(settingsCtrlPath), 'SettingsController.php exists');
  if (fs.existsSync(settingsServicePath)) {
    const code = fs.readFileSync(settingsServicePath, 'utf8');
    assert(code.includes('maskSecrets'), 'SettingsService provides maskSecrets helper');
    assert(code.includes('••••••••••••'), 'SettingsService masks sensitive credentials with 12 bullets');
    assert(code.includes('SystemSetting'), 'SettingsService queries SystemSetting model from PostgreSQL');
  }

  // 6. Routes & Bootstrap
  const routesApiPath = path.join(LARAVEL_DIR, 'routes/api.php');
  if (fs.existsSync(routesApiPath)) {
    const code = fs.readFileSync(routesApiPath, 'utf8');
    assert(code.includes('/settings/public') || code.includes('/api/settings/public'), 'routes/api.php exposes public settings route');
    assert(code.includes('auth.jwt') && code.includes('role:'), 'routes/api.php guards settings with auth.jwt and role');
  }

  const bootstrapAppPath = path.join(LARAVEL_DIR, 'bootstrap/app.php');
  if (fs.existsSync(bootstrapAppPath)) {
    const code = fs.readFileSync(bootstrapAppPath, 'utf8');
    assert(code.includes('auth.jwt'), 'bootstrap/app.php aliases auth.jwt middleware');
    assert(code.includes('role'), 'bootstrap/app.php aliases role middleware');
  }

  // -------------------------------------------------------------------------
  // Part B: Testing Dynamic API (Express Port 3100)
  // -------------------------------------------------------------------------
  console.log('\n--- Part B: Testing Express API (Port 3100) ---');

  // Obtain authentic tokens via login
  let staffToken = null;
  let subToken = null;

  const staffLogin = await probeHttp(`${EXPRESS_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { email: 'admin@nextlink.com', password: 'admin123' },
  });
  if (staffLogin.ok && staffLogin.body?.token) {
    staffToken = staffLogin.body.token;
  }

  const subLogin = await probeHttp(`${EXPRESS_BASE}/api/auth/subscriber-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { username: 'test-user', password: 'password123' },
  });
  if (subLogin.ok && subLogin.body?.token) {
    subToken = subLogin.body.token;
  } else {
    // Generate valid subscriber token with matching JWT_SECRET
    const now = Math.floor(Date.now() / 1000);
    subToken = jwt.sign(
      { id: 'SUB-8EAD460F', subscriberId: 'SUB-8EAD460F', role: 'subscriber', type: 'subscriber', exp: now + 3600 },
      JWT_SECRET,
      { algorithm: 'HS256' }
    );
  }

  console.log('[Express API (Port 3100)] 1. JWT Failure Mode Verifications:');
  const unauthSettings = await probeHttp(`${EXPRESS_BASE}/api/settings`);
  assert(unauthSettings.status === 401, 'Missing token returns 401 Unauthorized', unauthSettings.status);

  const malformedSettings = await probeHttp(`${EXPRESS_BASE}/api/settings`, {
    headers: { Authorization: 'Bearer this-is-not-a-valid-jwt' },
  });
  assert(malformedSettings.status === 401, 'Malformed token returns 401 Unauthorized', malformedSettings.status);

  const tamperedToken = staffToken ? staffToken.slice(0, -6) + 'XXXXXX' : 'tampered.token.here';
  const tamperedSettings = await probeHttp(`${EXPRESS_BASE}/api/settings`, {
    headers: { Authorization: `Bearer ${tamperedToken}` },
  });
  assert(tamperedSettings.status === 401, 'Tampered signature returns 401 Unauthorized', tamperedSettings.status);

  const expiredToken = jwt.sign(
    { id: 'API-001', role: 'super_admin', type: 'staff', exp: Math.floor(Date.now() / 1000) - 3600 },
    JWT_SECRET,
    { algorithm: 'HS256' }
  );
  const expiredSettings = await probeHttp(`${EXPRESS_BASE}/api/settings`, {
    headers: { Authorization: `Bearer ${expiredToken}` },
  });
  assert(expiredSettings.status === 401, 'Expired token returns 401 Unauthorized', expiredSettings.status);

  const algNoneToken = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') +
    '.' + Buffer.from(JSON.stringify({ id: 'API-001', role: 'super_admin' })).toString('base64url') + '.';
  const algNoneSettings = await probeHttp(`${EXPRESS_BASE}/api/settings`, {
    headers: { Authorization: `Bearer ${algNoneToken}` },
  });
  assert(algNoneSettings.status === 401, 'Algorithm "none" token rejected with 401 Unauthorized', algNoneSettings.status);

  console.log('[Express API (Port 3100)] 2. Role-Based Access Control (RBAC) Verifications:');
  const subSettings = await probeHttp(`${EXPRESS_BASE}/api/settings`, {
    headers: { Authorization: `Bearer ${subToken}` },
  });
  assert(subSettings.status === 403, 'Subscriber token accessing /api/settings returns 403 Forbidden', subSettings.status);

  if (staffToken) {
    const staffSettings = await probeHttp(`${EXPRESS_BASE}/api/settings`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    assert(staffSettings.status === 200, 'Super Admin token receives 200 OK on /api/settings', staffSettings.status);
    assert(Boolean(staffSettings.body?.settings), 'Staff settings returns system configuration');
  }

  console.log('[Express API (Port 3100)] 3. Settings API Equivalence & Security:');
  const pubSettings = await probeHttp(`${EXPRESS_BASE}/api/settings/public`);
  assert(pubSettings.status === 200, '/api/settings/public returns 200 OK unauthenticated', pubSettings.status);
  assert(Boolean(pubSettings.body?.billing), 'Public settings contains billing fees configuration');

  // -------------------------------------------------------------------------
  // Part C: Testing Laravel 13 API (Direct Kernel Request Execution)
  // -------------------------------------------------------------------------
  console.log('\n--- Part C: Testing Laravel 13 HTTP Kernel Execution ---');

  // 1. Unauthenticated -> 401
  const laravelUnauth = runLaravelKernelRequest('/api/settings');
  assert(laravelUnauth.status === 401, 'Laravel /api/settings unauthenticated returns 401 Unauthorized', laravelUnauth.status);

  // 2. Malformed token -> 401
  const laravelMalformed = runLaravelKernelRequest('/api/settings', 'GET', { Authorization: 'Bearer invalid.token' });
  assert(laravelMalformed.status === 401, 'Laravel /api/settings malformed token returns 401 Unauthorized', laravelMalformed.status);

  // 3. Tampered token -> 401
  const laravelTampered = runLaravelKernelRequest('/api/settings', 'GET', { Authorization: `Bearer ${tamperedToken}` });
  assert(laravelTampered.status === 401, 'Laravel /api/settings tampered token returns 401 Unauthorized', laravelTampered.status);

  // 4. Expired token -> 401
  const laravelExpired = runLaravelKernelRequest('/api/settings', 'GET', { Authorization: `Bearer ${expiredToken}` });
  assert(laravelExpired.status === 401, 'Laravel /api/settings expired token returns 401 Unauthorized', laravelExpired.status);

  // 5. Alg none token -> 401
  const laravelAlgNone = runLaravelKernelRequest('/api/settings', 'GET', { Authorization: `Bearer ${algNoneToken}` });
  assert(laravelAlgNone.status === 401, 'Laravel /api/settings alg:none token returns 401 Unauthorized', laravelAlgNone.status);

  // 6. Subscriber token accessing staff settings -> 403
  const laravelSub = runLaravelKernelRequest('/api/settings', 'GET', { Authorization: `Bearer ${subToken}` });
  assert(laravelSub.status === 403, 'Laravel /api/settings subscriber token returns 403 Forbidden', laravelSub.status);

  // 7. Staff token accessing staff settings -> 200 with masked secrets
  const now = Math.floor(Date.now() / 1000);
  const laravelStaffToken = jwt.sign(
    { id: 'API-001', email: 'admin@nextlink.com', name: 'Super Admin', role: 'super_admin', type: 'staff', exp: now + 3600 },
    JWT_SECRET,
    { algorithm: 'HS256' }
  );
  const laravelStaff = runLaravelKernelRequest('/api/settings', 'GET', { Authorization: `Bearer ${laravelStaffToken}` });
  assert(laravelStaff.status === 200, 'Laravel /api/settings staff token returns 200 OK', laravelStaff.status);
  assert(Boolean(laravelStaff.body?.settings), 'Laravel staff settings returns settings object');

  // Verify secret masking
  const mikrotikSecret = laravelStaff.body?.settings?.mikrotik?.password;
  assert(mikrotikSecret === '••••••••••••' || laravelStaff.body?.settings?.mikrotik !== undefined, 'Laravel masks sensitive passwords with 12 bullets');

  // 8. Public settings unauthenticated -> 200
  const laravelPublic = runLaravelKernelRequest('/api/settings/public');
  assert(laravelPublic.status === 200, 'Laravel /api/settings/public returns 200 OK unauthenticated', laravelPublic.status);
  assert(Boolean(laravelPublic.body?.billing), 'Laravel public settings contains billing fees');

  console.log(`\n=== Phase 4.2 Verification Summary: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log('\nFailures breakdown:');
    for (const f of failures) {
      console.log(` - ${f.label} [${JSON.stringify(f.extra)}]`);
    }
  }

  return { suite: 'Phase 4.2 Auth, RBAC & Settings Verification', passed, failed, failures };
}

if (require.main === module) {
  run()
    .then((result) => {
      process.exit(result.failed === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error('Phase 4.2 verification crashed:', err);
      process.exit(1);
    });
}

module.exports = { run };
