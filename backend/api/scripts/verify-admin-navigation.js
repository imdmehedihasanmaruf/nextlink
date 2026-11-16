'use strict';

/**
 * Suite 1: Automated Verification for Admin Sidebar Routes & API Responses
 *
 * Verifies:
 * 1. Admin sidebar navigation configuration (all 21 modules):
 *    - Dashboard, Frontend CMS, User Details, Packages, Subscriber Details,
 *      Billing, Cancel Invoices, Billing Engine, Operations, Tickets,
 *      Technicians, Referral Rewards, Boost Bandwidth, Live Latency & Ping,
 *      Bandwidth & Traffic, Cloud Peering Hubs, Reports, Role Management,
 *      Settings, Profile, Notifications.
 * 2. Next.js app route files existence on disk for all 21 modules.
 * 3. Express Admin / Management API endpoints:
 *    - Health check probe (/health)
 *    - Staff authentication & token verification (/api/auth/login)
 *    - Unauthorized access protection (401 for unauthenticated requests)
 *    - Role-based access control (RBAC - 403 for subscriber role attempting admin endpoints)
 *    - Settings endpoints (/api/settings)
 *    - Notifications API (/api/notifications)
 *
 * Usage:
 *   node scripts/verify-admin-navigation.js
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

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

async function api(endpoint, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${endpoint}`, {
    method,
    headers,
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
  console.log('=== SUITE 1: Admin Sidebar Routes & API Responses Verification ===');
  console.log('============================================================\n');

  // -------------------------------------------------------------------------
  // Part A: Admin Sidebar 21 Modules Static Verification
  // -------------------------------------------------------------------------
  console.log('Part A: Admin Sidebar Modules & Page Routes Existence');

  const EXPECTED_MODULES = [
    { id: 1, name: 'Dashboard', route: '/dashboard', file: 'dashboard/page.tsx' },
    { id: 2, name: 'Frontend CMS', route: '/cms', file: 'cms/page.tsx' },
    { id: 3, name: 'User Details', route: '/users', file: 'users/page.tsx' },
    { id: 4, name: 'Packages', route: '/packages', file: 'packages/page.tsx' },
    { id: 5, name: 'Subscriber Details', route: '/orders', file: 'orders/page.tsx' },
    { id: 6, name: 'Billing', route: '/billing', file: 'billing/page.tsx' },
    { id: 7, name: 'Cancel Invoices', route: '/cancellations', file: 'cancellations/page.tsx' },
    { id: 8, name: 'Billing Engine', route: '/billing-engine', file: 'billing-engine/page.tsx' },
    { id: 9, name: 'Operations', route: '/operations', file: 'operations/page.tsx' },
    { id: 10, name: 'Tickets', route: '/tickets', file: 'tickets/page.tsx' },
    { id: 11, name: 'Technicians', route: '/technicians', file: 'technicians/page.tsx' },
    { id: 12, name: 'Referral Rewards', route: '/referrals', file: 'referrals/page.tsx' },
    { id: 13, name: 'Boost Bandwidth', route: '/boost', file: 'boost/page.tsx' },
    { id: 14, name: 'Live Latency & Ping', route: '/latency', file: 'latency/page.tsx' },
    { id: 15, name: 'Bandwidth & Traffic', route: '/traffic', file: 'traffic/page.tsx' },
    { id: 16, name: 'Cloud Peering Hubs', route: '/peering', file: 'peering/page.tsx' },
    { id: 17, name: 'Reports', route: '/reports', file: 'reports/page.tsx' },
    { id: 18, name: 'Role Management', route: '/roles', file: 'roles/page.tsx' },
    { id: 19, name: 'Settings', route: '/settings', file: 'settings/page.tsx' },
    { id: 20, name: 'Profile', route: '/profile', file: 'profile/page.tsx' },
    { id: 21, name: 'Notifications', route: '/notifications', file: 'notifications/page.tsx' },
  ];

  const adminAppDir = path.resolve(__dirname, '../../../backend/src/app/(app)');
  const sidebarPath = path.resolve(__dirname, '../../../backend/src/components/Sidebar.tsx');
  const navigationConfigPath = path.resolve(__dirname, '../../../backend/src/lib/navigation.ts');

  assert(fs.existsSync(sidebarPath), 'Sidebar.tsx component exists', sidebarPath);
  const sidebarContent = fs.existsSync(sidebarPath) ? fs.readFileSync(sidebarPath, 'utf8') : '';
  const navigationContent = fs.existsSync(navigationConfigPath) ? fs.readFileSync(navigationConfigPath, 'utf8') : '';
  const combinedNavContent = sidebarContent + '\n' + navigationContent;

  for (const mod of EXPECTED_MODULES) {
    const filePath = path.join(adminAppDir, mod.file);
    const exists = fs.existsSync(filePath);
    assert(
      exists,
      `Module ${mod.id} [${mod.name}]: route file exists (${mod.file})`,
      exists ? undefined : `Missing file: ${filePath}`
    );

    // Verify module appears in Sidebar navigation configuration
    const inSidebar = combinedNavContent.includes(mod.name) || combinedNavContent.includes(mod.route);
    assert(
      inSidebar,
      `Module ${mod.id} [${mod.name}]: configured in Admin Navigation (${mod.route})`,
      inSidebar ? undefined : `Module ${mod.name} / ${mod.route} not found in navigation`
    );
  }

  // -------------------------------------------------------------------------
  // Part B: Admin API Endpoints & Auth Verification
  // -------------------------------------------------------------------------
  console.log('\nPart B: Admin API Endpoints & Access Control Verification');

  await ensureServer();

  // 1. Health check
  const health = await api('/health');
  assert(health.status === 200, 'Health endpoint responds 200 OK', health.status);
  assert(health.body && health.body.service === 'nextlink-api', 'Health reports service name "nextlink-api"', health.body?.service);
  assert(health.body && health.body.database === 'connected', 'Health confirms database connected', health.body?.database);

  // 2. Staff Login
  const adminLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@nextlink.com', password: 'admin123' },
  });
  assert(adminLogin.status === 200 && adminLogin.body?.token, 'Staff login succeeds and returns JWT', adminLogin.status);
  assert(adminLogin.body?.user?.role === 'super_admin', 'Staff role is super_admin', adminLogin.body?.user?.role);
  const staffToken = adminLogin.body?.token;

  // 3. Route Protection (Unauthenticated calls must be rejected with 401)
  const unauthBilling = await api('/api/billing/invoices');
  assert(unauthBilling.status === 401, 'Unauthenticated /api/billing/invoices returns 401 Unauthorized', unauthBilling.status);

  const unauthSettings = await api('/api/settings');
  assert(unauthSettings.status === 401, 'Unauthenticated /api/settings returns 401 Unauthorized', unauthSettings.status);

  const unauthTickets = await api('/api/tickets/stats');
  assert(unauthTickets.status === 401, 'Unauthenticated /api/tickets/stats returns 401 Unauthorized', unauthTickets.status);

  // 4. Role-Based Access Control (Subscriber token cannot access admin routes)
  const subLogin = await api('/api/auth/subscriber-login', {
    method: 'POST',
    body: { username: 'alexwright', password: 'AlexPassword@2026' },
  });
  const subToken = subLogin.body?.token;
  assert(subLogin.status === 200 && Boolean(subToken), 'Subscriber login succeeds to obtain subscriber token');

  if (subToken) {
    const subAccessAudit = await api('/api/audit', { token: subToken });
    assert(subAccessAudit.status === 403, 'Subscriber token accessing /api/audit returns 403 Forbidden', subAccessAudit.status);

    const subAccessSettings = await api('/api/settings', { token: subToken });
    assert(subAccessSettings.status === 403, 'Subscriber token accessing /api/settings returns 403 Forbidden', subAccessSettings.status);

    const subAccessTicketsStats = await api('/api/tickets/stats', { token: subToken });
    assert(subAccessTicketsStats.status === 403, 'Subscriber token accessing /api/tickets/stats returns 403 Forbidden', subAccessTicketsStats.status);
  }

  // 5. Settings API Verification (Staff access)
  const settingsRes = await api('/api/settings', { token: staffToken });
  assert(settingsRes.status === 200 && settingsRes.body?.settings, 'Staff can retrieve system settings', settingsRes.status);
  assert(
    settingsRes.body?.settings?.mikrotik !== undefined && settingsRes.body?.settings?.billing !== undefined,
    'System settings include mikrotik and billing configurations'
  );

  // 6. Notifications API Verification (Staff access)
  const notificationsRes = await api('/api/notifications', { token: staffToken });
  assert(
    notificationsRes.status === 200 && Array.isArray(notificationsRes.body?.notifications),
    'Staff can retrieve admin notifications',
    notificationsRes.status
  );

  console.log(`\n=== Suite 1 Summary: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log('\nFailures breakdown:');
    for (const f of failures) {
      console.log(` - ${f.label} [${JSON.stringify(f.extra)}]`);
    }
  }

  await cleanupServer();
  return { suite: 'Admin Sidebar Routes & API Responses', passed, failed, failures };
}

if (require.main === module) {
  run()
    .then((result) => {
      process.exit(result.failed === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error('Suite 1 crashed with unhandled exception:', err);
      process.exit(1);
    });
}

module.exports = { run };
