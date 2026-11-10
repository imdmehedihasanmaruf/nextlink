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

function getClient() {
  if (config.mikrotik.mode === 'live') {
    return new RouterOsClient({
      host: config.mikrotik.host,
      port: config.mikrotik.port,
      user: config.mikrotik.user,
      password: config.mikrotik.password,
      tls: false,
      timeoutMs: config.mikrotik.timeoutMs,
    });
  }
  return getSimulator();
}

function isSimulator() {
  return config.mikrotik.mode !== 'live';
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
  if (!isSimulator()) return;
  const simulator = getSimulator();
  const result = simulator.ensureSecret(username, { comment: `Subscriber ${subscriberId || ''}`.trim() });
  if (result.created) {
    logger.info('mikrotik simulator: provisioned secret', { username, subscriberId });
  }
}

/**
 * Log a router operation. Never throws — auditing must not break the flow.
 */
async function logOperation({ subscriberId, action, status, request, response, error }) {
  try {
    await db.query(
      `INSERT INTO mikrotik_sync_log
         (subscriber_id, router, action, status, request, response, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        subscriberId || null,
        isSimulator() ? 'simulator' : `${config.mikrotik.host}:${config.mikrotik.port}`,
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
  const client = getClient();
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
      mode: isSimulator() ? 'simulator' : 'live',
      latencyMs,
      router: info,
    };
  } catch (error) {
    await logOperation({ action: 'test_connection', status: 'failed', error: error.message });
    return {
      success: false,
      mode: isSimulator() ? 'simulator' : 'live',
      error: error.message,
    };
  } finally {
    if (!isSimulator()) await client.close().catch(() => {});
  }
}

/**
 * Suspend a subscriber's service: disable the PPPoE secret and drop any
 * live session so the line stops immediately.
 */
async function suspendSubscriber({ subscriberId, username }) {
  const client = getClient();
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
    if (!isSimulator()) await client.close().catch(() => {});
  }
}

/**
 * Restore a subscriber's service: enable the PPPoE secret so the client can
 * reconnect (auto-reconnection on payment).
 */
async function restoreSubscriber({ subscriberId, username, profile }) {
  const client = getClient();
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
    if (!isSimulator()) await client.close().catch(() => {});
  }
}

/**
 * Apply a bandwidth profile (queue) to a subscriber — used by the Turbo Boost
 * feature and by package upgrades.
 */
async function applyBandwidthProfile({ subscriberId, username, profileName, maxLimit }) {
  const client = getClient();
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
    if (!isSimulator()) await client.close().catch(() => {});
  }
}

/**
 * Force-disconnect a live session (bandwidth reset / manual kick).
 */
async function disconnectSession({ subscriberId, username }) {
  const client = getClient();
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
    if (!isSimulator()) await client.close().catch(() => {});
  }
}

/**
 * Ensure the PPPoE secret exists for a subscriber, creating it when the
 * router does not know it yet (new activation).
 */
async function ensureSecret({ subscriberId, username, password, profile = 'default-10m', remoteAddress, address }) {
  const client = getClient();
  const request = { subscriberId, username, profile, remoteAddress, address };
  try {
    await client.connect();
    const secrets = await client.listPppoeSecrets();
    const existing = secrets.find((secret) => secret.name === username);

    if (existing) {
      await client.setPppoeSecretProfile(username, profile).catch(() => {});
      await client.setPppoeSecretDisabled(username, false).catch(() => {});
      const response = { username, created: false, profile };
      await logOperation({ subscriberId, action: 'ensure_secret', status: 'success', request, response });
      return { success: true, ...response };
    }

    await client.send('/ppp/secret/add', {
      name: username,
      password,
      profile,
      service: 'pppoe',
      'remote-address': remoteAddress || '',
      address: address || '',
      disabled: 'no',
    });

    const response = { username, created: true, profile };
    await logOperation({ subscriberId, action: 'ensure_secret', status: 'success', request, response });
    return { success: true, ...response };
  } catch (error) {
    await logOperation({ subscriberId, action: 'ensure_secret', status: 'failed', request, error: error.message });
    return { success: false, error: error.message };
  } finally {
    if (!isSimulator()) await client.close().catch(() => {});
  }
}

module.exports = {
  RouterOsError,
  isSimulator,
  getClient,
  resolveUsername,
  testConnection,
  suspendSubscriber,
  restoreSubscriber,
  applyBandwidthProfile,
  disconnectSession,
  ensureSecret,
  logOperation,
};
