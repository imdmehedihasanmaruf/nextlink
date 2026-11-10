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

  // -----------------------------------------------------------------------
  console.log('Database');
  const database = await db.healthCheck();
  if (database.ok) ok('PostgreSQL reachable', config.db.connectionString.replace(/:[^:@]*@/, ':***@'));
  else fail('PostgreSQL unreachable', database.error);

  // -----------------------------------------------------------------------
  console.log('\nRedis');
  if (!config.redis.enabled) {
    warn('Redis disabled', 'the job queue falls back to the in-process queue');
  } else {
    const tcp = await checkTcp(
      config.redis.url.replace(/^redis:\/\//, '').split('@').pop().split(':')[0],
      Number(config.redis.url.split(':').pop()) || 6379,
    );
    if (tcp.ok) ok('Redis reachable', config.redis.url.replace(/:[^:@]*@/, ':***@'));
    else fail('Redis unreachable', tcp.error);
  }

  // -----------------------------------------------------------------------
  console.log('\nMikroTik RouterOS');
  if (config.mikrotik.mode === 'simulator') {
    warn('running in simulator mode', 'set MIKROTIK_MODE=live to use a real router');
  } else {
    if (!config.mikrotik.password) {
      fail('MIKROTIK_PASSWORD is empty', 'the router will reject the login');
    } else {
      ok('credentials present', `${config.mikrotik.user}@${config.mikrotik.host}:${config.mikrotik.port}`);
    }

    if (LIVE) {
      const tcp = await checkTcp(config.mikrotik.host, config.mikrotik.port, config.mikrotik.timeoutMs);
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
  const gateways = [
    {
      id: 'bkash',
      label: 'bKash',
      mode: config.payments.mode,
      configured: Boolean(
        config.payments.bkash.appKey &&
          config.payments.bkash.appSecret &&
          config.payments.bkash.username &&
          config.payments.bkash.password,
      ),
      baseUrl: config.payments.bkash.baseUrl,
    },
    {
      id: 'nagad',
      label: 'Nagad',
      mode: config.payments.mode,
      configured: Boolean(config.payments.nagad.merchantId && config.payments.nagad.apiKey),
      baseUrl: config.payments.nagad.baseUrl,
    },
    {
      id: 'sslcommerz',
      label: 'SSLCommerz',
      mode: config.payments.mode,
      configured: Boolean(
        config.payments.sslcommerz.storeId && config.payments.sslcommerz.storePassword,
      ),
      baseUrl: config.payments.sslcommerz.baseUrl,
    },
    {
      id: 'rocket',
      label: 'Rocket',
      mode: config.payments.mode,
      configured: Boolean(config.payments.rocket.merchantId && config.payments.rocket.apiKey),
      baseUrl: config.payments.rocket.baseUrl,
    },
  ];

  for (const gateway of gateways) {
    if (gateway.mode !== 'live') {
      warn(`${gateway.label} in mock mode`, 'set PAYMENT_MODE=live to use the real gateway');
      continue;
    }
    if (!gateway.configured) {
      fail(`${gateway.label} is not fully configured`, 'merchant credentials are missing');
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
  if (config.sms.mode !== 'live') {
    warn('running in mock mode', 'set SMS_MODE=live to send real messages');
  } else if (!config.sms.providerUrl) {
    fail('SMS_PROVIDER_URL is empty');
  } else {
    ok('provider configured', config.sms.providerUrl);
    if (LIVE) {
      const reach = await checkHttp(config.sms.providerUrl, { method: 'POST' });
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
          .execSync(`git ls-files --error-unmatch api-server/${name}`, { cwd: path.join(__dirname, '..', '..'), stdio: 'ignore' })
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
