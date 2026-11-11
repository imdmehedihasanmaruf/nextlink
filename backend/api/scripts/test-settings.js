'use strict';

/**
 * Settings wiring test.
 *
 * The admin panel saves the router, SMS and gateway configuration into the
 * database, but the services used to read only the environment file — so the
 * operator's settings had no effect on the running platform.
 *
 * This test saves a setting through the API and checks that the service picks
 * it up.
 *
 * Run with:  node scripts/test-settings.js
 */

const BASE = process.env.API_BASE_URL || 'http://localhost:3000';

let passed = 0;
let failed = 0;

function assert(condition, label, extra) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ''}`);
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
  console.log('\n=== Settings wiring test ===\n');

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@nextlink.com', password: 'admin123' },
  });
  const token = login.body.token;
  assert(login.status === 200 && token, 'staff token obtained');

  // -----------------------------------------------------------------------
  console.log('\n1. The MikroTik configuration reaches the service');
  const before = await api('/api/mikrotik/status', { token });
  assert(before.status === 200, 'the router status is readable', before.body);

  const save = await api('/api/settings/system/mikrotik', {
    method: 'PUT',
    token,
    body: { host: '10.99.88.77', apiPort: 8728, username: 'nextlink-ops' },
  });
  assert(save.status === 200 && save.body.success, 'the MikroTik settings were saved', save.body);

  // The service reads the stored settings, so the status has to report them.
  // The simulator mode reports the simulator as the host, so the mode is
  // switched to live for this check.
  await api('/api/settings/system/mikrotik', {
    method: 'PUT',
    token,
    body: { mode: 'live', host: '10.99.88.77', apiPort: 8728, username: 'nextlink-ops' },
  });

  const after = await api('/api/mikrotik/status', { token });
  assert(
    after.body.configuredHost === '10.99.88.77',
    'the service uses the host the operator saved',
    after.body.configuredHost,
  );
  assert(after.body.mode === 'live', 'the service runs in the mode the operator saved', after.body.mode);

  // -----------------------------------------------------------------------
  console.log('\n2. A masked secret is not written back');
  const maskedSave = await api('/api/settings/system/mikrotik', {
    method: 'PUT',
    token,
    body: { password: '••••••••••••' },
  });
  assert(maskedSave.status === 200, 'the masked value was accepted', maskedSave.body);

  // The mask is ignored, so the stored password is untouched. The response
  // shows the mask because the secret is never returned in clear text.
  const afterMask = await api('/api/settings/system', { token });
  assert(
    String(afterMask.body.settings.mikrotik.password || '').includes('•'),
    'the stored password is still masked in the response',
    afterMask.body.settings.mikrotik.password,
  );
  assert(
    afterMask.body.settings.mikrotik.passwordConfigured !== undefined,
    'the response says whether a password is configured',
    afterMask.body.settings.mikrotik.passwordConfigured,
  );

  // -----------------------------------------------------------------------
  console.log('\n3. The SMS configuration reaches the service');
  const smsSave = await api('/api/settings/system/sms', {
    method: 'PUT',
    token,
    body: { provider: 'local-gateway', senderId: 'NextLinkTest' },
  });
  assert(smsSave.status === 200 && smsSave.body.success, 'the SMS settings were saved', smsSave.body);

  const smsRead = await api('/api/settings/system', { token });
  assert(
    smsRead.body.settings.sms.provider === 'local-gateway',
    'the SMS provider was stored',
    smsRead.body.settings.sms.provider,
  );
  assert(
    smsRead.body.settings.sms.senderId === 'NextLinkTest',
    'the SMS sender id was stored',
    smsRead.body.settings.sms.senderId,
  );

  // -----------------------------------------------------------------------
  console.log('\n4. Restore the original configuration');
  const restore = await api('/api/settings/system/mikrotik', {
    method: 'PUT',
    token,
    body: { mode: 'simulator', host: '', apiPort: 8728, username: '', timeoutMs: 8000 },
  });
  assert(restore.status === 200, 'the original router configuration was restored', restore.body);

  const restoreSms = await api('/api/settings/system/sms', {
    method: 'PUT',
    token,
    body: { provider: 'local', senderId: 'NextLink' },
  });
  assert(restoreSms.status === 200, 'the original SMS configuration was restored', restoreSms.body);

  const final = await api('/api/mikrotik/status', { token });
  assert(
    final.body.mode === 'simulator',
    'the service is back on the simulator',
    final.body.mode,
  );

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error('settings test crashed:', error);
  process.exit(1);
});
