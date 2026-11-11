'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../../lib/db');
const logger = require('../../lib/logger');

/**
 * Subscriber credential store.
 *
 * Passwords are hashed with bcrypt. The legacy platform kept them as plain
 * text inside `subscribers.raw_data.password`, so the first successful login
 * against a legacy account re-hashes the password and removes the plain copy.
 *
 * The hashed value lives in `subscriber_credentials`, a dedicated table, so
 * the admin store's DELETE + re-INSERT of `subscribers` cannot wipe it.
 */

const BCRYPT_ROUNDS = 10;

/**
 * Hash a plaintext password.
 */
async function hashPassword(plain) {
  return bcrypt.hash(String(plain), BCRYPT_ROUNDS);
}

/**
 * Compare a plaintext password against a stored hash.
 */
async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(String(plain), hash);
}

/**
 * Compare two strings in constant time.
 *
 * The legacy plain-text password was compared with `!==`, which leaks the
 * length and the prefix of the secret through the response time. This is the
 * same helper the webhook signature check uses.
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) {
    // Compare against itself so the timing does not depend on the length.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Find the credential row for a subscriber.
 */
async function findBySubscriberId(subscriberId) {
  return db.queryOne('SELECT * FROM subscriber_credentials WHERE subscriber_id = $1', [subscriberId]);
}

/**
 * Find the credential row by username.
 */
async function findByUsername(username) {
  return db.queryOne('SELECT * FROM subscriber_credentials WHERE username = $1', [username]);
}

/**
 * Store (or replace) a subscriber's credentials.
 *
 * The plain-text password is never written to the database. The previous
 * version kept it in the `legacy_password` column, which left 10 readable
 * passwords in the table even after the account had been migrated to bcrypt.
 */
async function setCredentials({ subscriberId, username, password, legacyPassword = null }) {
  const hash = await hashPassword(password);

  const attempt = (candidate) =>
    db.queryOne(
      `INSERT INTO subscriber_credentials
         (subscriber_id, username, password_hash, legacy_password, migrated_at, raw_data)
       VALUES ($1, $2, $3, NULL, NOW(), $4)
       ON CONFLICT (subscriber_id) DO UPDATE SET
          username = EXCLUDED.username,
          password_hash = EXCLUDED.password_hash,
          legacy_password = NULL,
          migrated_at = NOW(),
          updated_at = NOW()
       RETURNING *`,
      [subscriberId, candidate || null, hash, JSON.stringify({ source: 'api' })],
    );

  try {
    return await attempt(username);
  } catch (error) {
    // Two subscribers can legitimately share a phone number, but the username
    // must be unique. A collision retries with a deterministic suffix instead
    // of rolling back the whole activation.
    if (String(error?.code || '') === '23505' && String(error?.constraint || '').includes('username')) {
      const suffixed = `${username || 'user'}-${subscriberId}`;
      logger.warn('credential username collided, retrying with a suffix', {
        subscriberId,
        candidate: suffixed,
      });
      return attempt(suffixed);
    }
    throw error;
  }
}

/**
 * Remove the plain-text password from a subscriber's raw_data once it has been
 * hashed. The field is set to an empty string rather than deleted so the shape
 * of raw_data stays the same for the existing admin UI.
 */
async function stripLegacyPassword(subscriberId) {
  const subscriber = await db.queryOne('SELECT raw_data FROM subscribers WHERE id = $1', [subscriberId]);
  if (!subscriber) return false;

  const raw = subscriber.raw_data || {};
  if (!raw.password) return false;

  // The three-argument form of jsonb_set returns NULL when the path does not
  // exist, which wiped the whole raw_data of the account. The four-argument
  // form with create_missing=true only adds the key.
  await db.query(
    `UPDATE subscribers
        SET raw_data = jsonb_set(COALESCE(raw_data, '{}'::jsonb), '{password}', '""'::jsonb, true),
            updated_at = NOW()
      WHERE id = $1`,
    [subscriberId],
  );
  return true;
}

/**
 * Authenticate a subscriber.
 *
 * Resolution order:
 *   1. `subscriber_credentials` (hashed) — the current store
 *   2. `subscribers.raw_data.password` (legacy plain text) — migrated on success
 *
 * @param {string} identifier  username, email, phone or subscriber id
 * @param {string} password
 */
async function authenticate(identifier, password) {
  const value = String(identifier || '').trim();
  if (!value || !password) {
    return { success: false, error: 'Invalid credentials' };
  }

  // 1. Hashed credential store.
  const hashed =
    (await findByUsername(value)) ||
    (await db.queryOne('SELECT * FROM subscriber_credentials WHERE subscriber_id = $1', [value]));

  if (hashed) {
    const ok = await verifyPassword(password, hashed.password_hash);
    if (!ok) {
      return { success: false, error: 'Invalid credentials' };
    }

    await db.query('UPDATE subscriber_credentials SET last_login_at = NOW() WHERE subscriber_id = $1', [
      hashed.subscriber_id,
    ]);

    const subscriber = await db.queryOne(
      'SELECT id, name, email, phone, status, package_id, raw_data FROM subscribers WHERE id = $1',
      [hashed.subscriber_id],
    );
    if (!subscriber) {
      return { success: false, error: 'Account not found' };
    }

    return { success: true, subscriber, migrated: false };
  }

  // 2. Legacy plain-text password.
  const subscriber = await db.queryOne(
    `SELECT * FROM subscribers
      WHERE id = $1
         OR LOWER(name) = LOWER($2)
         OR LOWER(email) = LOWER($2)
         OR phone = $2
         OR raw_data->>'username' = $2
      LIMIT 1`,
    [value, value],
  );

  if (!subscriber) {
    return { success: false, error: 'No account matches those credentials' };
  }

  const raw = subscriber.raw_data || {};
  const legacyPassword = String(raw.password || '');

  if (!legacyPassword || !safeEqual(legacyPassword, password)) {
    return { success: false, error: 'Invalid credentials' };
  }

  // Migrate to the hashed store on the first successful login.
  const username = raw.username || raw.pppoeUsername || subscriber.id;
  await setCredentials({
    subscriberId: subscriber.id,
    username,
    password,
    legacyPassword,
  });
  await stripLegacyPassword(subscriber.id);

  logger.info('subscriber credential migrated to bcrypt', { subscriberId: subscriber.id, username });

  const refreshed = await db.queryOne(
    'SELECT id, name, email, phone, status, package_id, raw_data FROM subscribers WHERE id = $1',
    [subscriber.id],
  );

  return { success: true, subscriber: refreshed, migrated: true };
}

/**
 * Change a subscriber's password.
 */
async function changePassword(subscriberId, newPassword) {
  const subscriber = await db.queryOne('SELECT raw_data FROM subscribers WHERE id = $1', [subscriberId]);
  if (!subscriber) return { success: false, error: 'Subscriber not found' };

  const raw = subscriber.raw_data || {};
  await setCredentials({
    subscriberId,
    username: raw.username || raw.pppoeUsername || subscriberId,
    password: newPassword,
  });
  await stripLegacyPassword(subscriberId);

  return { success: true };
}

/**
 * Reset a subscriber's password (admin action).
 */
async function resetPassword(subscriberId, newPassword) {
  return changePassword(subscriberId, newPassword);
}

/**
 * How many subscribers still carry a plain-text password.
 */
async function countLegacyPasswords() {
  const result = await db.queryOne(
    `SELECT COUNT(*)::int AS count
       FROM subscribers
      WHERE COALESCE(raw_data->>'password', '') <> ''`,
  );
  return Number(result?.count || 0);
}

/**
 * How many subscribers have a hashed credential.
 */
async function countHashedCredentials() {
  const result = await db.queryOne(
    'SELECT COUNT(*)::int AS count FROM subscriber_credentials',
  );
  return Number(result?.count || 0);
}

module.exports = {
  hashPassword,
  verifyPassword,
  findBySubscriberId,
  findByUsername,
  setCredentials,
  stripLegacyPassword,
  authenticate,
  changePassword,
  resetPassword,
  countLegacyPasswords,
  countHashedCredentials,
};
