'use strict';

const db = require('../../lib/db');
const logger = require('../../lib/logger');

/**
 * System settings for the core infrastructure.
 *
 * The admin panel currently keeps MikroTik / SMS / gateway credentials in
 * component state only, so they are lost on reload and never reach the API.
 * This service persists them in `system_settings` so the billing and
 * provisioning engine can actually use them.
 *
 * Secrets are never returned in plain text — only a masked preview plus a
 * "configured / not configured" flag.
 */

const DEFAULTS = {
  mikrotik: {
    mode: 'simulator',
    host: '192.168.88.1',
    apiPort: 8728,
    apiSslPort: 8729,
    username: 'admin',
    password: '',
    timeoutMs: 8000,
  },
  sms: {
    mode: 'mock',
    provider: 'local',
    providerUrl: '',
    apiKey: '',
    senderId: 'NextLink',
  },
  payments: {
    mode: 'mock',
    bkash: { appKey: '', appSecret: '', username: '', password: '' },
    nagad: { merchantId: '', apiKey: '' },
    sslcommerz: { storeId: '', storePassword: '' },
    rocket: { merchantId: '', apiKey: '' },
  },
  billing: {
    timezone: 'Asia/Dhaka',
    dueDay: 10,
    lateGraceDays: 5,
    suspendAfterDays: 10,
    currency: 'USD',
    lateFee: 5,
  },
};

/**
 * Deep merge helper — later sources win, objects merge recursively.
 */
function merge(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = merge(result[key] || {}, value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * The cached settings tree, so the services can read the configuration
 * without an await.
 */
let cache = null;
let cachedAt = 0;
const CACHE_TTL_MS = 15_000;

/**
 * Read a settings group from the cache, refreshing it when it is stale.
 * Synchronous on purpose: the payment gateway and the SMS engine are called
 * from synchronous code paths.
 */
function getCachedGroup(group) {
  const now = Date.now();
  if (!cache || now - cachedAt > CACHE_TTL_MS) {
    // The cache is refreshed on the next call that can await.
    getAll()
      .then((all) => {
        cache = all;
        cachedAt = Date.now();
      })
      .catch(() => {});
    return cache ? cache[group] : null;
  }
  return cache[group] || null;
}

/**
 * Drop the cached settings so the next read loads them again.
 */
function invalidateCache() {
  cache = null;
  cachedAt = 0;
}

/**
 * Read the whole settings tree (with defaults applied).
 */
async function getAll() {
  const result = await db.query('SELECT key, value FROM system_settings');
  const stored = {};
  for (const row of result.rows) {
    stored[row.key] = row.value;
  }
  return merge(DEFAULTS, stored);
}

/**
 * Read a single settings group.
 */
async function getGroup(group) {
  const all = await getAll();
  return all[group] || {};
}

/**
 * Merge and persist a settings group.
 */
async function setGroup(group, value) {
  // The masked placeholder the admin UI sends back must never be stored as the
  // real credential. The strip has to be recursive — a masked `appSecret`
  // nested inside the SSLCommerz block used to be written as the literal
  // string of bullets.
  const cleaned = stripMaskedSecrets(value);
  const current = await getGroup(group);
  const merged = merge(current, cleaned);

  await db.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [group, JSON.stringify(merged)],
  );

  // The whole cache is refreshed instead of splicing one group in. The old
  // splice meant the other groups kept the previous values until the next
  // TTL expiry, so an edit to the MikroTik settings could leave the SMS
  // gateway reading stale credentials.
  invalidateCache();
  await getAll()
    .then((all) => {
      cache = all;
      cachedAt = Date.now();
    })
    .catch(() => {});

  logger.info('system settings updated', { group });
  return merged;
}

/**
 * Remove every masked placeholder from a settings payload, recursively.
 *
 * The admin panel receives `••••••••••••` for a configured secret and may send
 * it back unchanged on save. Storing it would overwrite the real credential
 * with the bullets and break the integration at the next restart.
 */
function stripMaskedSecrets(node) {
  if (Array.isArray(node)) return node.map(stripMaskedSecrets);
  if (!node || typeof node !== 'object') return node;

  const result = {};
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && value.length > 0 && /^•+$/.test(value)) {
      // A masked value is dropped entirely — the stored value is kept.
      continue;
    }
    result[key] = stripMaskedSecrets(value);
  }
  return result;
}

/**
 * Every key whose value is a credential.
 *
 * The list is matched case-insensitively and by suffix, so a field such as
 * "storePassword" or "sslcommerz_api_key" is masked as well.
 */
const SECRET_KEY_PATTERN = /pass(word)?$|secret|api_?key|token|credential/i;

/**
 * Mask every secret value so the admin UI never receives the raw credential.
 */
function maskSecrets(settings) {
  const clone = JSON.parse(JSON.stringify(settings));
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string' && SECRET_KEY_PATTERN.test(key)) {
        // The value is replaced completely — no prefix is leaked.
        node[key] = value ? '•'.repeat(12) : '';
        node[`${key}Configured`] = Boolean(value);
      } else {
        walk(value);
      }
    }
  };
  walk(clone);
  return clone;
}

/**
 * A masked view for the admin panel.
 */
async function getMasked() {
  const all = await getAll();
  return maskSecrets(all);
}

/**
 * Test the MikroTik connection using the stored configuration.
 */
async function testMikrotik() {
  const settings = await getGroup('mikrotik');
  // eslint-disable-next-line global-require
  const mikrotik = require('../mikrotik');
  const result = await mikrotik.testConnection();
  return { ...result, configured: { host: settings.host, port: settings.apiPort, mode: settings.mode } };
}

module.exports = {
  DEFAULTS,
  getAll,
  getGroup,
  getCachedGroup,
  invalidateCache,
  setGroup,
  getMasked,
  maskSecrets,
  stripMaskedSecrets,
  testMikrotik,
};
