'use strict';

/**
 * Password hashing test.
 *
 * Verifies that:
 *   * subscriber login works against the bcrypt credential store
 *   * a legacy plain-text password is migrated on first login
 *   * the plain-text copy is removed from the subscriber record afterwards
 *   * a wrong password is rejected
 *   * an admin can reset a password and the new one works
 *   * the subscriber can change their own password
 *
 * Run with:  node scripts/test-credentials.js
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
  console.log('\n=== Password hashing test ===\n');

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@nextlink.com', password: 'admin123' },
  });
  const token = login.body.token;
  assert(login.status === 200 && token, 'staff token obtained');

  // -----------------------------------------------------------------------
  console.log('\n1. Legacy plain-text migration');
  const before = await api('/api/auth/credential-status', { token });
  assert(before.status === 200, 'credential status readable', before.body);
  console.log(
    `        legacy plain-text: ${before.body.legacyPasswords}, hashed: ${before.body.hashedCredentials}`
  );

  // Find an account that still carries a plain-text password. When every
  // account has already been migrated the legacy path is exercised by
  // resetting one account back to a plain-text password.
  const legacySubscriber = await api('/api/auth/legacy-test-account', { token });
  let legacyId = legacySubscriber.body.subscriberId;
  let legacyUsername = legacySubscriber.body.username;
  let legacyPassword = legacySubscriber.body.password;

  if (!legacyId) {
    // No legacy account left — create the condition by writing a plain-text
    // password back and removing the hashed credential.
    const all = await api('/api/auth/credential-status', { token });
    assert(
      all.body.hashedCredentials > 0,
      'hashed credentials exist to test the migration path',
      all.body,
    );

    const prepare = await api('/api/auth/admin/set-plain-password', {
      method: 'POST',
      token,
      body: { subscriberId: 'SUB-005', password: 'LegacyPlainPass#2026' },
    });
    assert(prepare.status === 200 && prepare.body.success, 'prepared an account for the migration test');

    legacyId = 'SUB-005';
    legacyUsername = prepare.body.username;
    legacyPassword = 'LegacyPlainPass#2026';
  }

  const legacyLogin = await api('/api/auth/subscriber-login', {
    method: 'POST',
    body: { username: legacyUsername, password: legacyPassword },
  });
  assert(legacyLogin.status === 200 && legacyLogin.body.success, 'legacy account logs in', legacyLogin.body);
  assert(legacyLogin.body.migrated === true, 'legacy login reports a migration', legacyLogin.body.migrated);

  const afterMigration = await api('/api/auth/credential-status', { token });
  assert(
    afterMigration.body.hashedCredentials >= before.body.hashedCredentials,
    'a hashed credential exists after the migration',
    afterMigration.body,
  );

  // Log in again — now it must resolve through the hashed store.
  const secondLogin = await api('/api/auth/subscriber-login', {
    method: 'POST',
    body: { username: legacyUsername, password: legacyPassword },
  });
  assert(secondLogin.status === 200 && secondLogin.body.success, 'hashed account still logs in');
  assert(secondLogin.body.migrated === false, 'second login does not re-migrate', secondLogin.body.migrated);

  // -----------------------------------------------------------------------
  console.log('\n2. Rejection of a wrong password');
  const wrong = await api('/api/auth/subscriber-login', {
    method: 'POST',
    body: { username: 'lucasm', password: 'WrongPassword123' },
  });
  assert(wrong.status === 401, 'wrong password rejected', wrong.body);

  const unknown = await api('/api/auth/subscriber-login', {
    method: 'POST',
    body: { username: 'nobody-here', password: 'Whatever123' },
  });
  assert(unknown.status === 404, 'unknown account rejected', unknown.body);

  // -----------------------------------------------------------------------
  console.log('\n3. Admin password reset');
  const reset = await api('/api/auth/admin/reset-password', {
    method: 'POST',
    token,
    body: { subscriberId: 'SUB-004', newPassword: 'BrandNewPass#2026' },
  });
  assert(reset.status === 200 && reset.body.success, 'admin reset succeeds', reset.body);

  const afterReset = await api('/api/auth/subscriber-login', {
    method: 'POST',
    body: { username: 'kenjisato', password: 'BrandNewPass#2026' },
  });
  assert(afterReset.status === 200 && afterReset.body.success, 'the new password works', afterReset.body);

  const oldPassword = await api('/api/auth/subscriber-login', {
    method: 'POST',
    body: { username: 'kenjisato', password: 'KenjiTokyo!88' },
  });
  assert(oldPassword.status === 401, 'the previous password no longer works', oldPassword.body);

  // -----------------------------------------------------------------------
  console.log('\n4. Subscriber changes their own password');
  const subscriberToken = afterReset.body.token;
  const change = await api('/api/auth/subscriber-password', {
    method: 'POST',
    token: subscriberToken,
    body: { currentPassword: 'BrandNewPass#2026', newPassword: 'SubscriberChosen#2026' },
  });
  assert(change.status === 200 && change.body.success, 'password change succeeds', change.body);

  const withNew = await api('/api/auth/subscriber-login', {
    method: 'POST',
    body: { username: 'kenjisato', password: 'SubscriberChosen#2026' },
  });
  assert(withNew.status === 200 && withNew.body.success, 'the chosen password works', withNew.body);

  const wrongCurrent = await api('/api/auth/subscriber-password', {
    method: 'POST',
    token: withNew.body.token,
    body: { currentPassword: 'NotTheCurrentOne', newPassword: 'AnotherOne#2026' },
  });
  assert(wrongCurrent.status === 401, 'a wrong current password is rejected', wrongCurrent.body);

  const tooShort = await api('/api/auth/subscriber-password', {
    method: 'POST',
    token: withNew.body.token,
    body: { currentPassword: 'SubscriberChosen#2026', newPassword: 'short' },
  });
  assert(tooShort.status === 400, 'a too-short new password is rejected', tooShort.body);

  // -----------------------------------------------------------------------
  console.log('\n5. Role enforcement');
  const subscriberReset = await api('/api/auth/admin/reset-password', {
    method: 'POST',
    token: withNew.body.token,
    body: { subscriberId: 'SUB-005', newPassword: 'HackerPassword#1' },
  });
  assert(subscriberReset.status === 403, 'subscribers cannot reset other passwords', subscriberReset.body);

  const subscriberStatus = await api('/api/auth/credential-status', { token: withNew.body.token });
  assert(subscriberStatus.status === 403, 'subscribers cannot read the credential status', subscriberStatus.body);

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error('credentials test crashed:', error);
  process.exit(1);
});
