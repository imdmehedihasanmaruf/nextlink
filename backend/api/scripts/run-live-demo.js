'use strict';

/**
 * Live mode demo stack.
 *
 * Starts the whole platform in *live* mode:
 *   * a RouterOS API server that speaks the real binary protocol
 *   * a payment + SMS gateway server that implements the real bKash, Nagad,
 *     SSLCommerz and Rocket contracts
 *   * the NextLink Express API with MIKROTIK_MODE, PAYMENT_MODE and SMS_MODE
 *     all set to "live", pointed at those servers
 *
 * This is the same code path that runs against a real router and a real
 * merchant account — only the endpoints differ. It is how you rehearse a
 * production switch before the real credentials are in place.
 *
 * Usage:
 *   node scripts/run-live-demo.js
 *
 * Then, in another terminal:
 *   npm run diagnose:live
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROUTEROS_PORT = Number(process.env.DEMO_ROUTEROS_PORT || 18728);
const GATEWAY_PORT = Number(process.env.DEMO_GATEWAY_PORT || 18729);
// The demo API runs on its own port so the normal development API on 3100
// stays untouched.
const API_PORT = Number(process.env.DEMO_API_PORT || 3002);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Free a TCP port if something else is holding it.
 */
async function freePort(port) {
  const net = require('net');
  await new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', async () => {
      const { execSync } = require('child_process');
      try {
        const output = execSync(`netstat -ano -p tcp | findstr LISTENING | findstr :${port}`, {
          encoding: 'utf8',
        });
        const pids = new Set();
        for (const line of output.split('\n')) {
          const columns = line.trim().split(/\s+/);
          const pid = columns[columns.length - 1];
          if (pid && /^\d+$/.test(pid)) pids.add(pid);
        }
        for (const pid of pids) {
          try {
            execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
            console.log(`  freed port ${port} (stopped pid ${pid})`);
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* nothing listening or netstat unavailable */
      }
      await sleep(900);
      resolve();
    });
    probe.once('listening', () => probe.close(() => resolve()));
    probe.listen(port, '127.0.0.1');
  });
}

/**
 * Load the .env file so the demo inherits the database and Redis settings.
 */
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return {};
  const values = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    values[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return values;
}

async function main() {
  console.log('\n=== NextLink live mode demo ===\n');
  console.log('Starting the platform in live mode against local protocol servers.');
  console.log('The API code path is identical to a real router / merchant account.\n');

  await freePort(ROUTEROS_PORT);
  await freePort(GATEWAY_PORT);
  await freePort(API_PORT);
  const baseEnv = { ...loadEnv(), ...process.env };

  const routeros = spawn(
    process.execPath,
    [path.join(__dirname, 'mock-routeros-server.js'), String(ROUTEROS_PORT)],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  routeros.stdout.on('data', (d) => process.stdout.write(`  [routeros] ${d}`));
  routeros.stderr.on('data', (d) => process.stderr.write(`  [routeros] ${d}`));

  const gateway = spawn(
    process.execPath,
    [path.join(__dirname, 'mock-gateway-server.js'), String(GATEWAY_PORT)],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  gateway.stdout.on('data', (d) => process.stdout.write(`  [gateway]  ${d}`));
  gateway.stderr.on('data', (d) => process.stderr.write(`  [gateway]  ${d}`));

  await sleep(1500);

  const liveEnv = {
    ...baseEnv,
    PORT: String(API_PORT),
    API_BASE_URL: `http://localhost:${API_PORT}`,
    NODE_ENV: 'development',

    // MikroTik — live mode against the protocol server.
    MIKROTIK_MODE: 'live',
    MIKROTIK_HOST: '127.0.0.1',
    MIKROTIK_PORT: String(ROUTEROS_PORT),
    MIKROTIK_USER: 'admin',
    MIKROTIK_PASSWORD: 'nextlink',

    // Payment gateways — live mode against the contract server.
    PAYMENT_MODE: 'live',
    BKASH_APP_KEY: 'demo-app-key',
    BKASH_APP_SECRET: 'demo-app-secret',
    BKASH_USERNAME: 'bkash-user',
    BKASH_PASSWORD: 'bkash-pass',
    BKASH_BASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
    NAGAD_BASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
    NAGAD_MERCHANT_ID: 'nagad-merchant',
    NAGAD_API_KEY: 'nagad-api-key',
    SSLCOMMERZ_STORE_ID: 'ssl-store',
    SSLCOMMERZ_STORE_PASSWORD: 'ssl-pass',
    SSLCOMMERZ_BASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
    ROCKET_BASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
    ROCKET_MERCHANT_ID: 'rocket-merchant',
    ROCKET_API_KEY: 'rocket-api-key',

    // SMS — live mode against the HTTP endpoint.
    SMS_MODE: 'live',
    SMS_PROVIDER_URL: `http://127.0.0.1:${GATEWAY_PORT}/api/sms/send`,
    SMS_PROVIDER_API_KEY: 'sms-api-key',
    SMS_SENDER_ID: 'NextLink',
  };

  const api = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: liveEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.on('data', (d) => process.stdout.write(`  [api]      ${d}`));
  api.stderr.on('data', (d) => process.stderr.write(`  [api]      ${d}`));

  const stop = () => {
    api.kill();
    routeros.kill();
    gateway.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  await sleep(3000);

  console.log('');
  console.log('  Live stack is running. In another terminal run:');
  console.log('');
  console.log('    npm run diagnose:live');
  console.log('');
  console.log(`  API          http://localhost:${API_PORT}`);
  console.log(`  RouterOS     127.0.0.1:${ROUTEROS_PORT} (admin / nextlink)`);
  console.log(`  Gateways     127.0.0.1:${GATEWAY_PORT}`);
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
}

main().catch((error) => {
  console.error('live demo failed to start:', error);
  process.exit(1);
});
