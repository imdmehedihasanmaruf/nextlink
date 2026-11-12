'use strict';

const config = require('../../config');
const logger = require('../../lib/logger');
const db = require('../../lib/db');
const { RouterOsClient, RouterOsError } = require('./routeros-client');
const { RouterOsSimulator } = require('./simulator');

/**
 * MikroTik service facade.
 *
 * Selects the live RouterOS client or the simulator based on configuration,
 * and records every router operation into `mikrotik_sync_log` so the admin
 * panel can show a full provisioning audit trail.
 */

let simulatorInstance = null;

function getSimulator() {
  if (!simulatorInstance) simulatorInstance = new RouterOsSimulator();
  return simulatorInstance;
}

/**
 * The effective MikroTik configuration.
 *
 * The values the operator saved in the admin panel take precedence over the
 * environment file, so the router the console shows is the router the
 * provisioning engine talks to.
 */
let cachedSettings = null;
let cachedAt = 0;
const SETTINGS_TTL_MS = 15_000;

async function getSettings() {
  const now = Date.now();
  if (cachedSettings && now - cachedAt < SETTINGS_TTL_MS) {
    return cachedSettings;
  }

  let stored = {};
  try {
    // eslint-disable-next-line global-require
    const settings = require('../settings');
    // The raw group is read, not the masked one — the router needs the real
    // password to authenticate.
    stored = (await settings.getGroup('mikrotik')) || {};
  } catch (error) {
    logger.warn('mikrotik: the stored settings could not be read', {
      message: error.message,
    });
  }

  // The mode comes from the environment when it explicitly asks for live
  // mode, so a deployment is never downgraded by a stale value in the
  // database. The connection details are the ones the operator saved in the
  // admin panel, which is where they belong — the environment provides the
  // defaults for a fresh installation.
  const envIsLive = config.mikrotik.mode === 'live';

  cachedSettings = {
    mode: envIsLive ? 'live' : stored.mode || config.mikrotik.mode,
    host: stored.host || config.mikrotik.host,
    port: Number(stored.apiPort || stored.port || config.mikrotik.port),
    user: stored.username || stored.user || config.mikrotik.user,
    password: stored.password || config.mikrotik.password,
    timeoutMs: Number(stored.timeoutMs || config.mikrotik.timeoutMs),
  };
  cachedAt = now;

  return cachedSettings;
}

/**
 * Drop the cached settings so the next call reads them again.
 */
function invalidateSettings() {
  cachedSettings = null;
  cachedAt = 0;
}

async function getClient() {
  const settings = await getSettings();

  if (settings.mode === 'live') {
    return new RouterOsClient({
      host: settings.host,
      port: settings.port,
      user: settings.user,
      password: settings.password,
      tls: false,
      timeoutMs: settings.timeoutMs,
    });
  }
  return getSimulator();
}

async function isSimulator() {
  const settings = await getSettings();
  return settings.mode !== 'live';
}

/**
 * Resolve the MikroTik (PPPoE) username for a subscriber.
 *
 * Order: explicit value -> raw_data.pppoeUsername -> raw_data.username ->
 * raw_data.connectionUsername -> subscriber id (falls back to the id so an
 * account always maps to a router entry).
 */
async function resolveUsername(subscriberId, explicitUsername) {
  if (explicitUsername) return explicitUsername;
  const subscriber = await db.queryOne('SELECT * FROM subscribers WHERE id = $1', [subscriberId]);
  if (!subscriber) return null;
  const raw = subscriber.raw_data || {};
  return raw.pppoeUsername || raw.username || raw.connectionUsername || subscriber.id;
}

/**
 * In simulator mode, make sure the target subscriber exists on the virtual
 * router before an operation is attempted — a real router would have been
 * provisioned at activation time.
 */
async function ensureSimulatorSecret(username, subscriberId) {
  if ((await getSettings()).mode === 'live') return;
  const simulator = getSimulator();
  const result = simulator.ensureSecret(username, { comment: `Subscriber ${subscriberId || ''}`.trim() });
  if (result.created) {
    logger.info('mikrotik simulator: provisioned secret', { username, subscriberId });
  }
}

/**
 * Close the client when it talks to a real router. The simulator holds no
 * socket, so there is nothing to close.
 */
async function closeIfLive(client) {
  const settings = await getSettings();
  if (settings.mode === 'live') {
    await client.close().catch(() => {});
  }
}

/**
 * Log a router operation. Never throws — auditing must not break the flow.
 */
async function logOperation({ subscriberId, action, status, request, response, error }) {
  try {
    const settings = await getSettings();
    await db.query(
      `INSERT INTO mikrotik_sync_log
         (subscriber_id, router, action, status, request, response, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        subscriberId || null,
        settings.mode === 'live' ? `${settings.host}:${settings.port}` : 'simulator',
        action,
        status,
        request ? JSON.stringify(request) : null,
        response ? JSON.stringify(response) : null,
        error ? String(error).slice(0, 1000) : null,
      ],
    );
  } catch (logError) {
    logger.warn('mikrotik_sync_log insert failed', { message: logError.message });
  }
}

/**
 * Test connectivity to the configured router (or simulator).
 */
async function testConnection() {
  const startedAt = Date.now();
  const settings = await getSettings();
  const client = await getClient();
  try {
    await client.connect();
    const info = await client.getSystemInfo();
    const latencyMs = Date.now() - startedAt;
    await logOperation({
      action: 'test_connection',
      status: 'success',
      response: info,
    });
    return {
      success: true,
      mode: settings.mode === 'live' ? 'live' : 'simulator',
      latencyMs,
      router: info,
    };
  } catch (error) {
    await logOperation({ action: 'test_connection', status: 'failed', error: error.message });
    return {
      success: false,
      mode: settings.mode === 'live' ? 'live' : 'simulator',
      error: error.message,
    };
  } finally {
    await closeIfLive(client);
  }
}

/**
 * Suspend a subscriber's service: disable the PPPoE secret and drop any
 * live session so the line stops immediately.
 */
async function suspendSubscriber({ subscriberId, username }) {
  const client = await getClient();
  const request = { subscriberId, username, action: 'disable' };
  try {
    await client.connect();
    await ensureSimulatorSecret(username, subscriberId);
    await client.setPppoeSecretDisabled(username, true);

    let kicked = 0;
    const sessions = await client.listActiveSessions();
    for (const session of sessions) {
      if (session.name === username) {
        await client.removeActiveSession(session.id);
        kicked += 1;
      }
    }

    const response = { username, disabled: true, sessionsKicked: kicked };
    await logOperation({ subscriberId, action: 'suspend', status: 'success', request, response });
    return { success: true, ...response };
  } catch (error) {
    await logOperation({ subscriberId, action: 'suspend', status: 'failed', request, error: error.message });
    return { success: false, error: error.message };
  } finally {
    await closeIfLive(client);
  }
}

/**
 * Restore a subscriber's service: enable the PPPoE secret so the client can
 * reconnect (auto-reconnection on payment).
 */
async function restoreSubscriber({ subscriberId, username, profile }) {
  const client = await getClient();
  const request = { subscriberId, username, action: 'enable', profile };
  try {
    await client.connect();
    await ensureSimulatorSecret(username, subscriberId);
    await client.setPppoeSecretDisabled(username, false);
    if (profile) {
      await client.setPppoeSecretProfile(username, profile).catch(() => {
        /* profile change is best-effort */
      });
    }
    const response = { username, disabled: false };
    await logOperation({ subscriberId, action: 'restore', status: 'success', request, response });
    return { success: true, ...response };
  } catch (error) {
    await logOperation({ subscriberId, action: 'restore', status: 'failed', request, error: error.message });
    return { success: false, error: error.message };
  } finally {
    await closeIfLive(client);
  }
}

/**
 * Apply a bandwidth profile (queue) to a subscriber — used by the Turbo Boost
 * feature and by package upgrades.
 */
async function applyBandwidthProfile({ subscriberId, username, profileName, maxLimit }) {
  const client = await getClient();
  const request = { subscriberId, username, profileName, maxLimit };
  try {
    await client.connect();
    await client.setPppoeSecretProfile(username, profileName);
    if (maxLimit) {
      await client.setQueueLimit(profileName, maxLimit);
    }
    const response = { username, profile: profileName, maxLimit };
    await logOperation({ subscriberId, action: 'apply_profile', status: 'success', request, response });
    return { success: true, ...response };
  } catch (error) {
    await logOperation({ subscriberId, action: 'apply_profile', status: 'failed', request, error: error.message });
    return { success: false, error: error.message };
  } finally {
    await closeIfLive(client);
  }
}

/**
 * Force-disconnect a live session (bandwidth reset / manual kick).
 */
async function disconnectSession({ subscriberId, username }) {
  const client = await getClient();
  try {
    await client.connect();
    const sessions = await client.listActiveSessions();
    let kicked = 0;
    for (const session of sessions) {
      if (!username || session.name === username) {
        await client.removeActiveSession(session.id);
        kicked += 1;
      }
    }
    await logOperation({
      subscriberId,
      action: 'disconnect_session',
      status: 'success',
      request: { username },
      response: { sessionsKicked: kicked },
    });
    return { success: true, sessionsKicked: kicked };
  } catch (error) {
    await logOperation({ subscriberId, action: 'disconnect_session', status: 'failed', error: error.message });
    return { success: false, error: error.message };
  } finally {
    await closeIfLive(client);
  }
}

/**
 * The RouterOS profile and queue limit that belong to a subscriber's plan.
 *
 * Without this every subscriber was shaped at the 10 Mbps fallback, so a
 * gigabit customer ran at a hundredth of the speed they pay for.
 */
async function getProfileForSubscriber(subscriberId) {
  const row = await db.queryOne(
    `SELECT p.routeros_profile, p.max_limit, p.speed
       FROM subscribers s
       LEFT JOIN packages p ON p.id = s.package_id
      WHERE s.id = $1`,
    [subscriberId],
  );

  if (row && row.routeros_profile) {
    return { profile: row.routeros_profile, maxLimit: row.max_limit || '' };
  }

  // Fall back to a profile derived from the plan speed.
  const speed = Number(row?.speed || 0);
  if (speed >= 1000) return { profile: 'nl-1g', maxLimit: '1000M/1000M' };
  if (speed >= 500) return { profile: 'nl-500m', maxLimit: '500M/500M' };
  if (speed >= 200) return { profile: 'nl-200m', maxLimit: '200M/200M' };
  if (speed >= 100) return { profile: 'nl-100m', maxLimit: '100M/100M' };
  return { profile: 'nl-25m', maxLimit: '25M/25M' };
}

/**
 * Ensure the PPPoE secret exists for a subscriber, creating it when the
 * router does not know it yet (new activation).
 */
async function ensureSecret({ subscriberId, username, password, profile, remoteAddress, address }) {
  const client = await getClient();
  const resolved = profile ? { profile, maxLimit: '' } : await getProfileForSubscriber(subscriberId);
  const request = { subscriberId, username, profile: resolved.profile, remoteAddress, address };
  try {
    await client.connect();
    const secrets = await client.listPppoeSecrets();
    const existing = secrets.find((secret) => secret.name === username);

    if (existing) {
      // The two updates are not swallowed. The previous code ignored a failed
      // write and still reported success, so the panel claimed the line was
      // provisioned while the secret on the router was still disabled.
      await client.setPppoeSecretProfile(username, resolved.profile);
      await client.setPppoeSecretDisabled(username, false);
      const response = { username, created: false, profile: resolved.profile };
      await logOperation({ subscriberId, action: 'ensure_secret', status: 'success', request, response });
      return { success: true, ...response };
    }

    await client.send('/ppp/secret/add', {
      name: username,
      password,
      profile: resolved.profile,
      service: 'pppoe',
      'remote-address': remoteAddress || '',
      address: address || '',
      disabled: 'no',
    });

    const response = { username, created: true, profile: resolved.profile };
    await logOperation({ subscriberId, action: 'ensure_secret', status: 'success', request, response });
    return { success: true, ...response };
  } catch (error) {
    await logOperation({ subscriberId, action: 'ensure_secret', status: 'failed', request, error: error.message });
    return { success: false, error: error.message };
  } finally {
    await closeIfLive(client);
  }
}

module.exports = {
  RouterOsError,
  isSimulator,
  getClient,
  getSettings,
  invalidateSettings,
  resolveUsername,
  testConnection,
  suspendSubscriber,
  restoreSubscriber,
  applyBandwidthProfile,
  disconnectSession,
  ensureSecret,
  getProfileForSubscriber,
  logOperation,
};
