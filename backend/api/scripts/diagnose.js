'use strict';

/**
 * Integration diagnostics.
 *
 * Checks every external integration and reports whether it is configured,
 * reachable and working. Run it after switching an integration to live mode
 * to confirm the real credentials before going to production.
 *
 * Usage:
 *   node scripts/diagnose.js            # check the configuration only
 *   node scripts/diagnose.js --live     # also connect to the live services
 */

const fs = require('fs');
const path = require('path');
const net = require('net');

const config = require('../src/config');
const db = require('../src/lib/db');
const logger = require('../src/lib/logger');
const mikrotik = require('../src/services/mikrotik');
const sms = require('../src/services/sms');
const settings = require('../src/services/settings');

const LIVE = process.argv.includes('--live');

let problems = 0;
let warnings = 0;

function ok(label, detail) {
  console.log(`  \u2713 ${label}${detail ? ` — ${detail}` : ''}`);
}

function warn(label, detail) {
  warnings += 1;
  console.log(`  ! ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail) {
  problems += 1;
  console.log(`  \u2717 ${label}${detail ? ` — ${detail}` : ''}`);
}

/**
 * The effective settings: the database row wins for connection details, and
 * the environment wins for an explicitly requested live mode — the same
 * resolution the service code uses. Reporting only the environment used to
 * tell the operator their configuration was broken when it was fine.
 */
async function effectiveSettings() {
  const stored = await settings
    .getAll()
    .catch(() => ({ mikrotik: {}, payments: {}, sms: {}, billing: {} }));

  const mode = config.mikrotik.mode === 'live' ? 'live' : stored.mikrotik.mode || config.mikrotik.mode;
  const envIsLive = config.payments.mode === 'live';
  const paymentMode = envIsLive ? 'live' : stored.payments.mode || config.payments.mode;
  const smsMode = config.sms.mode === 'live' ? 'live' : stored.sms.mode || config.sms.mode;

  return { mikrotik: { ...stored.mikrotik, mode }, payments: { ...stored.payments, mode: paymentMode }, sms: { ...stored.sms, mode: smsMode } };
}

/**
 * Hide the password in a connection URL before it is printed.
 */
function redactUrl(url) {
  return String(url || '').replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1***@');
}

/**
 * Check that a TCP host/port accepts a connection.
 */
function checkTcp(host, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, error: 'connection timed out' });
    }, timeoutMs);

    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ ok: true });
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message });
    });
  });
}

/**
 * Check that an HTTP endpoint answers.
 */
async function checkHttp(url, { method = 'GET', headers = {}, body = null, timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return { ok: response.ok, status: response.status };
  } catch (error) {
    clearTimeout(timer);
    return { ok: false, error: error.message };
  }
}

async function run() {
  console.log('\n=== NextLink integration diagnostics ===\n');
  console.log(`Environment : ${config.env}`);
  console.log(`Live checks : ${LIVE ? 'enabled' : 'disabled (pass --live to connect)'}\n`);

  const stored = await effectiveSettings();

  // -----------------------------------------------------------------------
  console.log('Database');
  const database = await db.healthCheck();
  if (database.ok) ok('PostgreSQL reachable', redactUrl(config.db.connectionString));
  else fail('PostgreSQL unreachable', database.error);

  // -----------------------------------------------------------------------
  console.log('\nRedis');
  if (!config.redis.enabled) {
    warn('Redis disabled', 'the job queue falls back to the in-process queue');
  } else {
    const tcp = await checkTcp(
      redactUrl(config.redis.url).replace(/^redis:\/\//, '').split('@').pop().split(':')[0],
      Number(redactUrl(config.redis.url).split(':').pop()) || 6379,
    );
    if (tcp.ok) ok('Redis reachable', redactUrl(config.redis.url));
    else fail('Redis unreachable', tcp.error);
  }

  // -----------------------------------------------------------------------
  console.log('\nMikroTik RouterOS');
  const mt = {
    mode: stored.mikrotik.mode,
    host: stored.mikrotik.host,
    port: Number(stored.mikrotik.apiPort || stored.mikrotik.port || 8728),
    user: stored.mikrotik.username || 'admin',
    password: stored.mikrotik.password || '',
    timeoutMs: Number(stored.mikrotik.timeoutMs || 8000),
  };

  if (mt.mode === 'simulator') {
    warn('running in simulator mode', 'set MIKROTIK_MODE=live or switch the admin panel to live mode to use a real router');
  } else {
    if (!mt.password) {
      fail('the router password is empty', 'the router will reject the login — set it in the admin panel (System Settings → MikroTik)');
    } else {
      ok('credentials present', `${mt.user}@${mt.host}:${mt.port}`);
    }

    if (LIVE) {
      const tcp = await checkTcp(mt.host, mt.port, mt.timeoutMs);
      if (tcp.ok) ok('router API port open');
      else fail('router API port unreachable', tcp.error);

      const result = await mikrotik.testConnection();
      if (result.success) {
        ok('router responded', `${result.router?.identity} · ${result.router?.version} · ${result.latencyMs}ms`);
      } else {
        fail('router did not respond', result.error);
      }
    }
  }

  // -----------------------------------------------------------------------
  console.log('\nPayment gateways');
  const gw = stored.payments;
  const gateways = [
    {
      id: 'bkash',
      label: 'bKash',
      configured: Boolean(gw.bkash.appKey && gw.bkash.appSecret && gw.bkash.username && gw.bkash.password),
      baseUrl: config.payments.bkash.baseUrl,
    },
    {
      id: 'nagad',
      label: 'Nagad',
      configured: Boolean(gw.nagad.merchantId && gw.nagad.apiKey),
      baseUrl: config.payments.nagad.baseUrl,
    },
    {
      id: 'sslcommerz',
      label: 'SSLCommerz',
      configured: Boolean(gw.sslcommerz.storeId && gw.sslcommerz.storePassword),
      baseUrl: config.payments.sslcommerz.baseUrl,
    },
    {
      id: 'rocket',
      label: 'Rocket',
      configured: Boolean(gw.rocket.merchantId && gw.rocket.apiKey),
      baseUrl: config.payments.rocket.baseUrl,
    },
  ];

  for (const gateway of gateways) {
    if (gw.mode !== 'live') {
      warn(`${gateway.label} in mock mode`, 'set PAYMENT_MODE=live or switch the admin panel to live mode to use the real gateway');
      continue;
    }
    if (!gateway.configured) {
      fail(`${gateway.label} is not fully configured`, 'merchant credentials are missing — set them in the admin panel (System Settings → Payment Gateways)');
      continue;
    }
    ok(`${gateway.label} configured`, gateway.baseUrl);

    if (LIVE) {
      const reach = await checkHttp(gateway.baseUrl, { method: 'GET' });
      if (reach.ok) ok(`${gateway.label} endpoint reachable`);
      else if (reach.status) warn(`${gateway.label} answered ${reach.status}`, 'the endpoint exists');
      else fail(`${gateway.label} endpoint unreachable`, reach.error);
    }
  }

  // -----------------------------------------------------------------------
  console.log('\nSMS gateway');
  const smsCfg = stored.sms;
  if (smsCfg.mode !== 'live') {
    warn('running in mock mode', 'set SMS_MODE=live or switch the admin panel to live mode to send real messages');
  } else if (!smsCfg.providerUrl) {
    fail('the SMS provider URL is empty', 'set it in the admin panel (System Settings → SMS)');
  } else {
    ok('provider configured', smsCfg.providerUrl);
    if (LIVE) {
      const reach = await checkHttp(smsCfg.providerUrl, { method: 'POST' });
      if (reach.ok) ok('SMS provider reachable');
      else if (reach.status) warn(`SMS provider answered ${reach.status}`);
      else fail('SMS provider unreachable', reach.error);
    }
  }

  // -----------------------------------------------------------------------
  console.log('\nSecurity');
  if (config.jwt.secret === 'nextlink-dev-secret-change-me' || config.jwt.secret.length < 24) {
    fail('JWT_SECRET is weak', 'set a long random value before going live');
  } else {
    ok('JWT secret is set');
  }
  if (config.env === 'production' && config.cors.origins.includes('*')) {
    fail('CORS allows every origin', 'list the real frontends instead');
  } else {
    ok('CORS origins are restricted', config.cors.origins.join(', '));
  }
  const envFile = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) {
    const tracked = ['.env', '.env.local'].some((name) => {
      try {
        return require('child_process')
          .execSync(`git ls-files --error-unmatch backend/api/${name}`, { cwd: path.join(__dirname, '..', '..'), stdio: 'ignore' })
          .toString()
          .trim();
      } catch {
        return false;
      }
    });
    if (tracked) fail('the environment file is tracked by git');
    else ok('the environment file is not tracked by git');
  }

  console.log(`\n=== ${problems} problem(s), ${warnings} warning(s) ===\n`);
  await db.close();
  process.exit(problems > 0 ? 1 : 0);
}

run().catch(async (error) => {
  logger.error('diagnostics failed', { message: error.message });
  await db.close();
  process.exit(1);
});
