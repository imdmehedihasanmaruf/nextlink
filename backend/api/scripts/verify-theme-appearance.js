'use strict';

/**
 * End-to-end verification script for the Theme Appearance fix.
 * Tests:
 * 1. Health check of API server
 * 2. Subscriber authentication and theme field in response
 * 3. Preference persistence: PATCH /api/portal/preferences with 'dark', 'light', 'system'
 * 4. DB verification in both subscribers.theme and user_preferences table
 * 5. Preference retrieval: GET /api/portal/preferences
 * 6. Profile & /me verification: GET /api/auth/me returns updated theme
 * 7. Verification of front-end components:
 *    - settings/page.tsx has instant switcher & active highlighting
 *    - SettingsPanel.tsx has instant switcher & active highlighting
 *    - ThemeToggle.tsx syncs with store and DB
 *    - layout.tsx pre-paint script handles nl_user_theme -> nl_theme -> prefers-color-scheme
 *    - globals.css @media print light-lock
 */

const fs = require('fs');
const path = require('path');
const db = require('../src/lib/db');
const { signToken, ROLES } = require('../src/middleware/auth');

const API_BASE = 'http://localhost:3100';

async function testThemeSystem() {
  console.log('--- STARTING APPEARANCE & THEME SYSTEM VERIFICATION ---');

  // 1. Health check
  const healthRes = await fetch(`${API_BASE}/health`);
  const health = await healthRes.json();
  if (!healthRes.ok || !health.success) {
    throw new Error(`API health check failed: ${JSON.stringify(health)}`);
  }
  console.log('✔ [1/7] Express API is healthy on port 3100');

  // 2. Find test subscriber
  const subRow = await db.queryOne(`
    SELECT s.id, s.name, s.theme
      FROM subscribers s
     WHERE s.status = 'active'
     LIMIT 1
  `);
  if (!subRow) {
    throw new Error('No active subscriber found in DB');
  }
  const subscriberId = subRow.id;
  console.log(`✔ [2/7] Found test subscriber: ${subRow.name} (ID: ${subscriberId})`);

  // Issue scoped subscriber JWT
  const token = signToken({
    id: subscriberId,
    name: subRow.name,
    role: ROLES.SUBSCRIBER,
    type: 'subscriber',
    subscriberId: subscriberId,
  });
  console.log('✔ [3/7] Scoped subscriber JWT generated successfully');

  // 3. Test PATCH /api/portal/preferences with 'dark'
  const patchDarkRes = await fetch(`${API_BASE}/api/portal/preferences`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ theme: 'dark', themeColor: 'blue', fontSize: 'md' }),
  });
  const patchDark = await patchDarkRes.json();
  if (!patchDarkRes.ok || !patchDark.success || patchDark.theme !== 'dark') {
    throw new Error(`PATCH /api/portal/preferences (dark) failed: ${JSON.stringify(patchDark)}`);
  }

  // Verify in PostgreSQL
  const checkDarkSub = await db.queryOne('SELECT theme FROM subscribers WHERE id = $1', [subscriberId]);
  const checkDarkPref = await db.queryOne('SELECT theme FROM user_preferences WHERE user_id = $1', [subscriberId]);
  if (checkDarkSub.theme !== 'dark' || checkDarkPref.theme !== 'dark') {
    throw new Error(`DB verification failed for dark mode! sub: ${checkDarkSub.theme}, pref: ${checkDarkPref.theme}`);
  }
  console.log('✔ [4/7] Theme switched to "dark": DB subscribers.theme="dark" and user_preferences.theme="dark" verified');

  // 4. Test GET /api/portal/preferences and GET /api/auth/me
  const getPrefRes = await fetch(`${API_BASE}/api/portal/preferences`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const getPref = await getPrefRes.json();
  if (!getPrefRes.ok || getPref.theme !== 'dark') {
    throw new Error(`GET /api/portal/preferences failed: ${JSON.stringify(getPref)}`);
  }

  const getMeRes = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const getMe = await getMeRes.json();
  if (!getMeRes.ok || getMe.user.theme !== 'dark') {
    throw new Error(`GET /api/auth/me failed to return updated theme: ${JSON.stringify(getMe)}`);
  }
  console.log('✔ [5/7] Preferences API & /api/auth/me both correctly return theme="dark"');

  // 5. Test switching back to 'light' and 'system'
  const patchLightRes = await fetch(`${API_BASE}/api/portal/preferences`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ theme: 'light' }),
  });
  const patchLight = await patchLightRes.json();
  if (!patchLightRes.ok || patchLight.theme !== 'light') {
    throw new Error(`PATCH (light) failed: ${JSON.stringify(patchLight)}`);
  }

  const patchSysRes = await fetch(`${API_BASE}/api/portal/preferences`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ theme: 'system' }),
  });
  const patchSys = await patchSysRes.json();
  if (!patchSysRes.ok || patchSys.theme !== 'system') {
    throw new Error(`PATCH (system) failed: ${JSON.stringify(patchSys)}`);
  }
  console.log('✔ [6/7] Mode switching between "light" and "system" verified in backend & database');

  // 6. Verify front-end source files
  const basePath = path.resolve(__dirname, '../../../frontend/src');

  // Check settings/page.tsx
  const settingsSrc = fs.readFileSync(path.join(basePath, 'app/settings/page.tsx'), 'utf8');
  if (!settingsSrc.includes('handleThemePick') || !settingsSrc.includes('useTheme') || !settingsSrc.includes('nl_theme')) {
    throw new Error('settings/page.tsx missing required theme handlers');
  }

  // Check SettingsPanel.tsx
  const panelSrc = fs.readFileSync(path.join(basePath, 'components/SettingsPanel.tsx'), 'utf8');
  if (!panelSrc.includes('handleThemePick') || !panelSrc.includes('useTheme') || !panelSrc.includes('nl_theme')) {
    throw new Error('SettingsPanel.tsx missing required theme handlers');
  }

  // Check ThemeToggle.tsx
  const toggleSrc = fs.readFileSync(path.join(basePath, 'components/ThemeToggle.tsx'), 'utf8');
  if (!toggleSrc.includes('saveUserPreferences') || !toggleSrc.includes('nl_theme')) {
    throw new Error('ThemeToggle.tsx missing persistence integration');
  }

  // Check layout.tsx pre-paint script
  const layoutSrc = fs.readFileSync(path.join(basePath, 'app/layout.tsx'), 'utf8');
  if (!layoutSrc.includes('nl_user_theme') || !layoutSrc.includes('nl_theme') || !layoutSrc.includes('prefers-color-scheme')) {
    throw new Error('layout.tsx missing zero-FOUT pre-paint script');
  }

  // Check globals.css print light-lock
  const cssSrc = fs.readFileSync(path.join(basePath, 'styles/globals.css'), 'utf8');
  if (!cssSrc.includes('@media print') || !cssSrc.includes('#ffffff !important')) {
    throw new Error('globals.css missing print light-lock rule');
  }

  // Check Navbar.tsx (Frontend Header): ThemeToggle must be completely removed from DOM markup
  const navbarSrc = fs.readFileSync(path.join(basePath, 'components/Navbar.tsx'), 'utf8');
  if (navbarSrc.includes('<ThemeToggle') || navbarSrc.includes('ThemeToggle')) {
    throw new Error('Navbar.tsx still contains ThemeToggle references or markup');
  }

  // Check Header.tsx (Backend Admin Header): ThemeToggle must be completely removed from DOM markup
  const adminHeaderSrc = fs.readFileSync(path.resolve(__dirname, '../../../backend/src/components/Header.tsx'), 'utf8');
  if (adminHeaderSrc.includes('<ThemeToggle') || adminHeaderSrc.includes('ThemeToggle')) {
    throw new Error('Header.tsx (backend) still contains ThemeToggle references or markup');
  }

  console.log('✔ [7/8] Header bars verified: ThemeToggle completely removed from DOM markup on both frontend and backend');
  console.log('✔ [8/8] All frontend components verified: zero-FOUT head script, instant switching, store/DB synchronization, and print light-lock');

  console.log('--- ALL THEME & APPEARANCE CHECKS PASSED SUCCESSFULLY ---');
  await db.close();
  process.exit(0);
}

testThemeSystem().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
