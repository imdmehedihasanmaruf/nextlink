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
    currency: 'BDT',
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
  const current = await getGroup(group);
  const merged = merge(current, value);

  await db.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [group, JSON.stringify(merged)],
  );

  logger.info('system settings updated', { group });
  return merged;
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

module.exports = { DEFAULTS, getAll, getGroup, setGroup, getMasked, maskSecrets, testMikrotik };
