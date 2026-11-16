'use strict';

const config = require('../../config');
const logger = require('../../lib/logger');
const db = require('../../lib/db');
const { RouterOsClient, RouterOsError } = require('./routeros-client');
const { RouterOsSimulator } = require('./simulator');

/**
 * MikroTik RouterOS service facade (v6 & v7 compatible).
 *
 * Provides automated provisioning, bandwidth control, and service state synchronization
 * for both PPPoE and Static IP subscribers. Features:
 *   1. Dual compatibility with RouterOS 6.x and 7.x APIs.
 *   2. Support for PPPoE secrets and Static IP simple queues / firewall address-lists.
 *   3. Reliable retry handling with exponential backoff on transient network failures.
 *   4. Safe fallback / mock mode when router hardware is unreachable or unconfigured,
 *      logging clear diagnostic warnings without crashing billing triggers or payment loops.
 *   5. Full audit logging of all router operations to `mikrotik_sync_log`.
 */

let simulatorInstance = null;

function getSimulator() {
  if (!simulatorInstance) simulatorInstance = new RouterOsSimulator();
  return simulatorInstance;
}

let cachedSettings = null;
let cachedAt = 0;
const SETTINGS_TTL_MS = 15_000;

/**
 * Retrieve the effective MikroTik configuration.
 */
async function getSettings() {
  const now = Date.now();
  if (cachedSettings && now - cachedAt < SETTINGS_TTL_MS) {
    return cachedSettings;
  }

  let stored = {};
  try {
    const settings = require('../settings');
    stored = (await settings.getGroup('mikrotik')) || {};
  } catch (error) {
    logger.warn('mikrotik: the stored settings could not be read', {
      message: error.message,
    });
  }

  const envIsLive = config.mikrotik.mode === 'live';
  const effectiveMode = envIsLive ? 'live' : stored.mode || config.mikrotik.mode || 'simulator';
  const effectiveHost = stored.host || config.mikrotik.host || '127.0.0.1';
  const effectivePort = Number(stored.apiPort || stored.port || config.mikrotik.port || 8728);
  const effectiveUser = stored.username || stored.user || config.mikrotik.user || 'admin';
  const effectivePassword = stored.password !== undefined ? stored.password : (config.mikrotik.password || '');
  const timeoutMs = Number(stored.timeoutMs || config.mikrotik.timeoutMs || 8000);

  // Validate credentials completeness
  const credentialsMissing = effectiveMode === 'live' && (!effectiveHost || !effectiveUser);

  cachedSettings = {
    mode: effectiveMode,
    host: effectiveHost,
    port: effectivePort,
    user: effectiveUser,
    password: effectivePassword,
    timeoutMs,
    credentialsMissing,
  };
  cachedAt = now;

  return cachedSettings;
}

function invalidateSettings() {
  cachedSettings = null;
  cachedAt = 0;
}

/**
 * Resolve client instance. If live mode is selected but credentials are unset,
 * logs a diagnostic warning and returns the safe in-memory simulator.
 */
async function getClient() {
  const settings = await getSettings();

  if (settings.mode === 'live') {
    if (settings.credentialsMissing) {
      logger.warn('mikrotik: live mode selected but router host or user is missing — using simulator fallback', {
        host: settings.host,
        user: settings.user,
      });
      return getSimulator();
    }

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
  return settings.mode !== 'live' || settings.credentialsMissing;
}

/**
 * Execute an operation with retry logic for network transients.
 */
async function withRetry(operationFn, { maxRetries = 3, initialDelayMs = 300, name = 'operation' } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operationFn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = initialDelayMs * Math.pow(2, attempt - 1);
        logger.warn(`mikrotik: ${name} failed on attempt ${attempt}/${maxRetries} (${err.message}) — retrying in ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Log a router operation to mikrotik_sync_log (never throws).
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
 * Resolve full subscriber information including connection type and IP address.
 */
async function resolveSubscriberInfo(subscriberId, explicitUsername) {
  let subscriber = null;
  if (subscriberId) {
    subscriber = await db.queryOne('SELECT * FROM subscribers WHERE id = $1', [subscriberId]);
  }
  const raw = subscriber?.raw_data || {};
  const connectionType = String(raw.connectionType || '').toLowerCase();
  const isStatic = connectionType === 'static' || connectionType === 'static_ip' || connectionType === 'static ip' || Boolean(raw.ipAddress && connectionType !== 'pppoe');
  const isPppoe = !isStatic || connectionType === 'pppoe';

  const username = explicitUsername || raw.pppoeUsername || raw.username || raw.connectionUsername || subscriber?.id || null;
  const ipAddress = raw.ipAddress || '';
  const packageId = subscriber?.package_id || raw.packageId || null;

  return {
    subscriberId: subscriber?.id || subscriberId || null,
    username,
    ipAddress,
    connectionType: isStatic ? 'static' : 'pppoe',
    isStatic,
    isPppoe,
    packageId,
    status: subscriber?.status || 'active',
  };
}

async function resolveUsername(subscriberId, explicitUsername) {
  const info = await resolveSubscriberInfo(subscriberId, explicitUsername);
  return info.username;
}

/**
 * Ensure the simulator knows the secret before an operation in simulator mode.
 */
async function ensureSimulatorSecret(username, subscriberId) {
  const settings = await getSettings();
  if (settings.mode === 'live' && !settings.credentialsMissing) return;
  const simulator = getSimulator();
  simulator.ensureSecret(username, { comment: `Subscriber ${subscriberId || ''}`.trim() });
}

/**
 * Safe client execution wrapper. If the live router is unreachable after retries,
 * falls back to the simulator and logs clear diagnostic warnings instead of crashing.
 */
async function withSafeRouterExecution(action, subscriberId, requestPayload, fn) {
  const settings = await getSettings();
  let client = await getClient();
  let isLive = settings.mode === 'live' && !settings.credentialsMissing;

  try {
    if (isLive) {
      await withRetry(() => client.connect(), {
        maxRetries: 3,
        initialDelayMs: 250,
        name: `${action}.connect`,
      });
    }

    const result = await fn(client);
    await logOperation({
      subscriberId,
      action,
      status: 'success',
      request: requestPayload,
      response: result,
    });
    return { success: true, ...result };
  } catch (error) {
    // If live router failed, log diagnostic warning and fall back safely to simulator
    if (isLive) {
      logger.warn(`mikrotik: live router unreachable at ${settings.host}:${settings.port} (${error.message}) — executing safe simulator fallback for ${action}`, {
        subscriberId,
        action,
        error: error.message,
      });

      try {
        const sim = getSimulator();
        const fallbackResult = await fn(sim);
        await logOperation({
          subscriberId,
          action,
          status: 'fallback_simulated',
          request: requestPayload,
          response: { ...fallbackResult, fallback: true, routerError: error.message },
          error: error.message,
        });
        return {
          success: true,
          simulated: true,
          fallback: true,
          warning: `Router unreachable (${error.message}) — operation recorded in mock fallback`,
          ...fallbackResult,
        };
      } catch (simError) {
        logger.error(`mikrotik: fallback execution failed: ${simError.message}`);
      }
    }

    await logOperation({
      subscriberId,
      action,
      status: 'failed',
      request: requestPayload,
      error: error.message,
    });
    return { success: false, error: error.message };
  } finally {
    if (isLive && client && typeof client.close === 'function') {
      await client.close().catch(() => {});
    }
  }
}

/**
 * Test connectivity to the configured router (or simulator).
 */
async function testConnection() {
  const startedAt = Date.now();
  const settings = await getSettings();

  if (settings.mode !== 'live' || settings.credentialsMissing) {
    const simulator = getSimulator();
    const info = await simulator.getSystemInfo();
    const latencyMs = Date.now() - startedAt;
    return {
      success: true,
      mode: 'simulator',
      latencyMs,
      router: info,
      warning: settings.credentialsMissing ? 'Router credentials unset — using simulator mode' : undefined,
    };
  }

  const client = new RouterOsClient({
    host: settings.host,
    port: settings.port,
    user: settings.user,
    password: settings.password,
    tls: false,
    timeoutMs: settings.timeoutMs,
  });

  try {
    await withRetry(() => client.connect(), {
      maxRetries: 2,
      initialDelayMs: 300,
      name: 'testConnection',
    });
    const info = await client.getSystemInfo();
    const latencyMs = Date.now() - startedAt;
    await logOperation({
      action: 'test_connection',
      status: 'success',
      response: info,
    });
    return {
      success: true,
      mode: 'live',
      latencyMs,
      router: info,
    };
  } catch (error) {
    logger.warn('mikrotik: test connection failed to live router', {
      host: settings.host,
      port: settings.port,
      error: error.message,
    });
    await logOperation({ action: 'test_connection', status: 'failed', error: error.message });
    return {
      success: false,
      mode: 'live',
      error: error.message,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * The RouterOS profile and queue limit that belong to a subscriber's plan.
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

  const speed = Number(row?.speed || 0);
  if (speed >= 1000) return { profile: 'nl-1g', maxLimit: '1000M/1000M' };
  if (speed >= 500) return { profile: 'nl-500m', maxLimit: '500M/500M' };
  if (speed >= 200) return { profile: 'nl-200m', maxLimit: '200M/200M' };
  if (speed >= 100) return { profile: 'nl-100m', maxLimit: '100M/100M' };
  return { profile: 'nl-25m', maxLimit: '25M/25M' };
}

/**
 * Suspend a subscriber's service:
 *   - PPPoE: disables PPPoE secret and force-kicks live session.
 *   - Static IP: disables/shapes simple queue and places IP into `suspended_subscribers` address-list.
 */
async function suspendSubscriber({ subscriberId, username, ipAddress, connectionType }) {
  const info = await resolveSubscriberInfo(subscriberId, username);
  const effectiveUser = username || info.username;
  const effectiveIp = ipAddress || info.ipAddress;
  const request = { subscriberId, username: effectiveUser, ipAddress: effectiveIp, action: 'suspend' };

  return withSafeRouterExecution('suspend', subscriberId, request, async (client) => {
    let kicked = 0;

    // 1. PPPoE Secret handling
    if (effectiveUser) {
      await ensureSimulatorSecret(effectiveUser, subscriberId);
      try {
        await client.setPppoeSecretDisabled(effectiveUser, true);
      } catch (err) {
        // If secret was not found, log diagnostic warning
        logger.warn(`mikrotik: suspend secret not found for ${effectiveUser}: ${err.message}`);
      }

      // Kick active sessions
      const sessions = await client.listActiveSessions();
      for (const session of sessions) {
        if (session.name === effectiveUser) {
          await client.removeActiveSession(session.id).catch(() => {});
          kicked += 1;
        }
      }
    }

    // 2. Static IP handling: add to suspended address-list and disable simple queue
    if (effectiveIp) {
      if (typeof client.addAddressList === 'function') {
        await client.addAddressList({
          list: 'suspended_subscribers',
          address: effectiveIp,
          comment: `Suspended subscriber ${subscriberId || effectiveUser || ''}`.trim(),
        }).catch(() => {});
      }
      const queueName = `queue-${effectiveUser || subscriberId}`;
      if (typeof client.setQueueDisabled === 'function') {
        await client.setQueueDisabled(queueName, true).catch(() => {});
      }
    }

    return {
      username: effectiveUser,
      ipAddress: effectiveIp,
      disabled: true,
      sessionsKicked: kicked,
    };
  });
}

/**
 * Restore a subscriber's service:
 *   - PPPoE: enables PPPoE secret and updates profile.
 *   - Static IP: removes IP from `suspended_subscribers` and re-enables bandwidth queue.
 */
async function restoreSubscriber({ subscriberId, username, profile, ipAddress, connectionType }) {
  const info = await resolveSubscriberInfo(subscriberId, username);
  const effectiveUser = username || info.username;
  const effectiveIp = ipAddress || info.ipAddress;
  const resolvedPlan = profile ? { profile, maxLimit: '' } : await getProfileForSubscriber(subscriberId);
  const request = { subscriberId, username: effectiveUser, ipAddress: effectiveIp, profile: resolvedPlan.profile, action: 'restore' };

  return withSafeRouterExecution('restore', subscriberId, request, async (client) => {
    // 1. PPPoE Secret handling
    if (effectiveUser) {
      await ensureSimulatorSecret(effectiveUser, subscriberId);
      await client.setPppoeSecretDisabled(effectiveUser, false);
      if (resolvedPlan.profile && typeof client.setPppoeSecretProfile === 'function') {
        await client.setPppoeSecretProfile(effectiveUser, resolvedPlan.profile).catch(() => {});
      }
    }

    // 2. Static IP handling: remove from suspended list and re-enable queue
    if (effectiveIp) {
      if (typeof client.removeAddressList === 'function') {
        await client.removeAddressList('suspended_subscribers', effectiveIp).catch(() => {});
      }
      const queueName = `queue-${effectiveUser || subscriberId}`;
      if (typeof client.ensureQueue === 'function') {
        await client.ensureQueue({
          name: queueName,
          target: effectiveIp,
          maxLimit: resolvedPlan.maxLimit || '25M/25M',
          disabled: false,
          comment: `Subscriber ${subscriberId || effectiveUser}`,
        }).catch(() => {});
      } else if (typeof client.setQueueDisabled === 'function') {
        await client.setQueueDisabled(queueName, false).catch(() => {});
      }
    }

    return {
      username: effectiveUser,
      ipAddress: effectiveIp,
      disabled: false,
      profile: resolvedPlan.profile,
    };
  });
}

/**
 * Apply bandwidth profile (used by Turbo Boost and package plan upgrades).
 */
async function applyBandwidthProfile({ subscriberId, username, profileName, maxLimit, ipAddress }) {
  const info = await resolveSubscriberInfo(subscriberId, username);
  const effectiveUser = username || info.username;
  const effectiveIp = ipAddress || info.ipAddress;
  const request = { subscriberId, username: effectiveUser, profileName, maxLimit, ipAddress: effectiveIp };

  return withSafeRouterExecution('apply_profile', subscriberId, request, async (client) => {
    // 1. PPPoE profile
    if (effectiveUser) {
      if (typeof client.setPppoeSecretProfile === 'function') {
        await client.setPppoeSecretProfile(effectiveUser, profileName);
      }
      // Kick session so user reconnects at new bandwidth profile
      if (typeof client.removeActiveSessionsByName === 'function') {
        await client.removeActiveSessionsByName(effectiveUser).catch(() => {});
      }
    }

    // 2. Queue bandwidth limit
    if (maxLimit) {
      const queueName = effectiveIp ? `queue-${effectiveUser || subscriberId}` : profileName;
      if (typeof client.ensureQueue === 'function' && effectiveIp) {
        await client.ensureQueue({
          name: queueName,
          target: effectiveIp,
          maxLimit,
          disabled: false,
        }).catch(() => {});
      } else if (typeof client.setQueueLimit === 'function') {
        await client.setQueueLimit(queueName, maxLimit).catch(() => {});
      }
    }

    return {
      username: effectiveUser,
      profile: profileName,
      maxLimit,
      ipAddress: effectiveIp,
    };
  });
}

/**
 * Force-disconnect a live session (bandwidth reset / manual kick).
 */
async function disconnectSession({ subscriberId, username }) {
  const info = await resolveSubscriberInfo(subscriberId, username);
  const effectiveUser = username || info.username;
  const request = { subscriberId, username: effectiveUser };

  return withSafeRouterExecution('disconnect_session', subscriberId, request, async (client) => {
    const sessions = await client.listActiveSessions();
    let kicked = 0;
    for (const session of sessions) {
      if (!effectiveUser || session.name === effectiveUser) {
        await client.removeActiveSession(session.id);
        kicked += 1;
      }
    }
    return { username: effectiveUser, sessionsKicked: kicked };
  });
}

/**
 * Ensure secret/queue exists for a subscriber (new activation or provisioning).
 */
async function ensureSecret({ subscriberId, username, password, profile, remoteAddress, address, ipAddress }) {
  const info = await resolveSubscriberInfo(subscriberId, username);
  const effectiveUser = username || info.username;
  const resolved = profile ? { profile, maxLimit: '' } : await getProfileForSubscriber(subscriberId);
  const effectiveIp = ipAddress || remoteAddress || address || info.ipAddress;
  const request = { subscriberId, username: effectiveUser, profile: resolved.profile, remoteAddress: effectiveIp };

  return withSafeRouterExecution('ensure_secret', subscriberId, request, async (client) => {
    // For PPPoE subscribers:
    const secrets = await client.listPppoeSecrets();
    const existing = secrets.find((secret) => secret.name === effectiveUser);

    if (existing) {
      await client.setPppoeSecretProfile(effectiveUser, resolved.profile);
      await client.setPppoeSecretDisabled(effectiveUser, false);
      return { username: effectiveUser, created: false, profile: resolved.profile };
    }

    await client.send('/ppp/secret/add', {
      name: effectiveUser,
      password: password || 'nextlink123',
      profile: resolved.profile,
      service: 'pppoe',
      'remote-address': effectiveIp || '',
      address: address || '',
      disabled: 'no',
    });

    // Also ensure simple queue exists if Static IP is used:
    if (effectiveIp && typeof client.ensureQueue === 'function') {
      const queueName = `queue-${effectiveUser || subscriberId}`;
      await client.ensureQueue({
        name: queueName,
        target: effectiveIp,
        maxLimit: resolved.maxLimit || '25M/25M',
        disabled: false,
        comment: `Subscriber ${subscriberId || effectiveUser}`,
      }).catch(() => {});
    }

    return { username: effectiveUser, created: true, profile: resolved.profile };
  });
}

/**
 * Synchronize a subscriber's router state with their PostgreSQL database state.
 * Validates that active subscribers are enabled with their plan bandwidth,
 * and suspended subscribers are disabled.
 */
async function syncSubscriber({ subscriberId }) {
  const info = await resolveSubscriberInfo(subscriberId);
  if (!info.subscriberId) {
    throw new Error(`Subscriber ${subscriberId} not found`);
  }

  if (info.status === 'suspended' || info.status === 'disconnected') {
    return suspendSubscriber({ subscriberId });
  }

  return restoreSubscriber({ subscriberId });
}

/**
 * List all simple queues known to the router.
 */
async function listQueues() {
  const client = await getClient();
  const settings = await getSettings();
  try {
    await client.connect();
    return await client.listQueues();
  } finally {
    if (settings.mode === 'live' && typeof client.close === 'function') {
      await client.close().catch(() => {});
    }
  }
}

/**
 * List firewall address list entries.
 */
async function listAddressList(listName) {
  const client = await getClient();
  const settings = await getSettings();
  try {
    await client.connect();
    if (typeof client.listAddressList === 'function') {
      return await client.listAddressList(listName);
    }
    return [];
  } finally {
    if (settings.mode === 'live' && typeof client.close === 'function') {
      await client.close().catch(() => {});
    }
  }
}

module.exports = {
  RouterOsError,
  isSimulator,
  getClient,
  getSimulator,
  getSettings,
  invalidateSettings,
  resolveUsername,
  resolveSubscriberInfo,
  testConnection,
  suspendSubscriber,
  restoreSubscriber,
  applyBandwidthProfile,
  disconnectSession,
  ensureSecret,
  ensureSubscriber: ensureSecret,
  syncSubscriber,
  getProfileForSubscriber,
  listQueues,
  listAddressList,
  logOperation,
};
