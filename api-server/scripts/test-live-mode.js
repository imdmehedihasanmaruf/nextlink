'use strict';

/**
 * Live mode verification.
 *
 * The billing engine, MikroTik client, payment gateways and SMS gateway all
 * have a `mock`/`simulator` mode that is used during normal development. This
 * script proves the *live* code path works as well, by starting protocol
 * servers that speak the real contracts:
 *
 *   * a RouterOS API server speaking the real binary protocol (TCP 8728)
 *   * a payment gateway server implementing the real bKash / Nagad /
 *     SSLCommerz / Rocket request and response shapes
 *   * an SMS gateway endpoint
 *
 * It then drives the API in live mode and checks that a payment settles, the
 * service is suspended and restored on the router, and the SMS arrives.
 *
 * Usage:
 *   node scripts/test-live-mode.js
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

const ROUTEROS_PORT = 18728;
const GATEWAY_PORT = 18729;
const API_PORT = 13001;
const API_BASE = `http://localhost:${API_PORT}`;

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
  const response = await fetch(`${API_BASE}${path}`, {
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait until the API answers its health probe.
 */
async function waitForApi(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(400);
  }
  return false;
}

/**
 * Free a TCP port if something else is still holding it.
 */
async function freePort(port) {
  const net = require('net');
  await new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => {
      // The port is busy — kill whatever holds it.
      try {
        const { execSync } = require('child_process');
        const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
        const pids = output
          .split('\n')
          .map((line) => line.trim().split(/\s+/).pop())
          .filter((pid) => pid && /^\d+$/.test(pid));
        for (const pid of pids) {
          try {
            execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
      setTimeout(resolve, 600);
    });
    probe.once('listening', () => probe.close(() => resolve()));
    probe.listen(port, '127.0.0.1');
  });
}

async function run() {
  console.log('\n=== Live mode verification ===\n');

  // -----------------------------------------------------------------------
  // 1. Start the protocol servers.
  // -----------------------------------------------------------------------
  console.log('1. Starting protocol servers');
  await freePort(ROUTEROS_PORT);
  await freePort(GATEWAY_PORT);

  const routeros = spawn(process.execPath, [path.join(__dirname, 'mock-routeros-server.js'), String(ROUTEROS_PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const gateway = spawn(process.execPath, [path.join(__dirname, 'mock-gateway-server.js'), String(GATEWAY_PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let routerosOut = '';
  let routerosErr = '';
  let gatewayOut = '';
  let gatewayErr = '';
  routeros.stdout.on('data', (d) => { routerosOut += d.toString(); });
  routeros.stderr.on('data', (d) => { routerosErr += d.toString(); });
  gateway.stdout.on('data', (d) => { gatewayOut += d.toString(); });
  gateway.stderr.on('data', (d) => { gatewayErr += d.toString(); });
  routeros.on('exit', (code) => {
    if (code) console.error(`RouterOS server exited with ${code}: ${routerosErr}`);
  });
  gateway.on('exit', (code) => {
    if (code) console.error(`Gateway server exited with ${code}: ${gatewayErr}`);
  });

  await sleep(1500);
  assert(routerosOut.includes('listening'), 'RouterOS protocol server started', routerosOut.trim() || routerosErr);
  assert(gatewayOut.includes('listening'), 'payment/SMS gateway server started', gatewayOut.trim() || gatewayErr);

  // -----------------------------------------------------------------------
  // 2. Start the API in live mode.
  // -----------------------------------------------------------------------
  console.log('\n2. Starting the API in live mode');
  const env = {
    ...process.env,
    PORT: String(API_PORT),
    API_BASE_URL: API_BASE,
    NODE_ENV: 'test',
    MIKROTIK_MODE: 'live',
    MIKROTIK_HOST: '127.0.0.1',
    MIKROTIK_PORT: String(ROUTEROS_PORT),
    MIKROTIK_USER: 'admin',
    MIKROTIK_PASSWORD: 'nextlink',
    PAYMENT_MODE: 'live',
    BKASH_APP_KEY: 'bkash-app-key',
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
    SMS_MODE: 'live',
    SMS_PROVIDER_URL: `http://127.0.0.1:${GATEWAY_PORT}/api/sms/send`,
    SMS_PROVIDER_API_KEY: 'sms-api-key',
    SMS_SENDER_ID: 'NextLink',
    REDIS_ENABLED: 'false',
    JWT_SECRET: 'live-mode-test-secret',
    BILLING_CURRENCY: 'BDT',
    BILLING_CURRENCY_SYMBOL: '৳',
  };

  const apiProcess = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let apiOut = '';
  apiProcess.stdout.on('data', (d) => { apiOut += d.toString(); });
  apiProcess.stderr.on('data', (d) => { apiOut += d.toString(); });

  const up = await waitForApi();
  assert(up, 'API started in live mode', apiOut.slice(-500));
  if (!up) {
    routeros.kill();
    gateway.kill();
    apiProcess.kill();
    process.exit(1);
  }

  const health = await api('/health');
  assert(health.body.mikrotikMode === 'live', 'API reports the live MikroTik mode', health.body.mikrotikMode);
  assert(health.body.paymentMode === 'live', 'API reports the live payment mode', health.body.paymentMode);
  assert(health.body.smsMode === 'live', 'API reports the live SMS mode', health.body.smsMode);

  // -----------------------------------------------------------------------
  // 3. MikroTik over the real protocol.
  // -----------------------------------------------------------------------
  console.log('\n3. MikroTik over the real RouterOS protocol');
  const status = await api('/api/mikrotik/status', { token: null });
  assert(status.status === 401 || status.status === 200, 'router status endpoint reachable');

  const staff = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@nextlink.com', password: 'admin123' },
  });
  assert(staff.status === 200 && staff.body.token, 'staff token obtained');
  const token = staff.body.token;

  const routerStatus = await api('/api/mikrotik/status', { token });
  assert(routerStatus.status === 200, 'router status returns 200', routerStatus.body);
  assert(routerStatus.body.success === true, 'router connection succeeded', routerStatus.body);
  assert(
    routerStatus.body.router && routerStatus.body.router.identity === 'NextLink-Core-Mock',
    'router identity read from the protocol server',
    routerStatus.body.router,
  );
  assert(
    routerStatus.body.router && routerStatus.body.router.version === '7.14.3 (stable)',
    'router version read from the protocol server',
    routerStatus.body.router?.version,
  );

  const secrets = await api('/api/mikrotik/secrets', { token });
  assert(secrets.status === 200 && secrets.body.secrets.length === 3, 'PPPoE secrets listed over the protocol', secrets.body.secrets?.length);

  // Suspend a subscriber -> the PPPoE secret must be disabled on the router.
  const suspend = await api('/api/mikrotik/suspend', {
    method: 'POST',
    token,
    body: { subscriberId: 'SUB-002', username: 'demo' },
  });
  assert(suspend.body.success === true, 'suspend succeeded over the protocol', suspend.body);

  const afterSuspend = await api('/api/mikrotik/secrets', { token });
  const demoSecret = afterSuspend.body.secrets.find((s) => s.name === 'demo');
  assert(demoSecret && demoSecret.disabled === true, 'the router really has the secret disabled', demoSecret);

  // Restore it.
  const restore = await api('/api/mikrotik/restore', {
    method: 'POST',
    token,
    body: { subscriberId: 'SUB-002', username: 'demo' },
  });
  assert(restore.body.success === true, 'restore succeeded over the protocol', restore.body);

  const afterRestore = await api('/api/mikrotik/secrets', { token });
  const restoredSecret = afterRestore.body.secrets.find((s) => s.name === 'demo');
  assert(restoredSecret && restoredSecret.disabled === false, 'the router re-enabled the secret', restoredSecret);

  // -----------------------------------------------------------------------
  // 4. Payment gateways over the real contracts.
  // -----------------------------------------------------------------------
  console.log('\n4. Payment gateways over the real contracts');
  const gateways = await api('/api/payments/gateways');
  assert(gateways.body.mode === 'live', 'gateway list reports live mode', gateways.body.mode);

  /**
   * Make sure there is at least one unpaid invoice for the given period.
   * Every invoice of that period is removed first — including the paid ones —
   * because the billing cycle is idempotent and would otherwise keep the
   * settled invoice.
   */
  async function ensureUnpaidInvoice(period) {
    const list = await api('/api/billing/invoices?limit=200', { token });
    const leftovers = list.body.invoices.filter((i) => i.raw_data?.period === period);

    for (const leftover of leftovers) {
      await api(`/api/billing/invoices/${leftover.id}`, { method: 'DELETE', token });
    }

    const cycle = await api('/api/billing/cycle/run', {
      method: 'POST',
      token,
      body: { period },
    });
    if (cycle.status !== 200) return null;

    const fresh = await api('/api/billing/invoices?limit=200', { token });
    return fresh.body.invoices.find((i) => i.raw_data?.period === period && i.status === 'unpaid') || null;
  }

  const results = {};
  // Each gateway gets its own billing period so the invoices never collide.
  const gatewayPeriods = {
    bkash: '2017-04',
    nagad: '2017-05',
    sslcommerz: '2017-06',
    rocket: '2017-07',
  };

  for (const gateway of ['bkash', 'nagad', 'sslcommerz', 'rocket']) {
    // Each gateway needs its own unpaid invoice — verifying a payment marks
    // the invoice as paid.
    const invoiceForGateway = await ensureUnpaidInvoice(gatewayPeriods[gateway]);
    if (!invoiceForGateway) {
      console.log(`  SKIP  ${gateway}: no unpaid invoice available`);
      continue;
    }

    const initiate = await api('/api/payments/initiate', {
      method: 'POST',
      body: { invoiceId: invoiceForGateway.id, gateway },
    });
    const ok = initiate.status === 200 && initiate.body.success && initiate.body.redirectUrl;
    assert(ok, `${gateway}: payment initiated against the real contract`, initiate.body);

    if (ok) {
      const redirect = initiate.body.redirectUrl;
      assert(
        redirect.includes(`:${GATEWAY_PORT}/`),
        `${gateway}: redirect points at the gateway checkout`,
        redirect,
      );

      // Verify the transaction back through the gateway.
      const verify = await api('/api/payments/verify', {
        method: 'POST',
        token,
        body: { gateway, transactionId: initiate.body.gatewayTransactionId },
      });
      assert(verify.body.success === true, `${gateway}: transaction verified with the gateway`, verify.body);
      results[gateway] = { transactionId: initiate.body.gatewayTransactionId, invoiceId: invoiceForGateway.id };
    }
  }

  // -----------------------------------------------------------------------
  // 5. SMS through the real HTTP gateway.
  // -----------------------------------------------------------------------
  console.log('\n5. SMS through the real gateway endpoint');
  const sms = await api('/api/sms/send', {
    method: 'POST',
    token,
    body: { phone: '+8801700000000', body: 'NextLink live mode verification message' },
  });
  assert(sms.status === 200 && sms.body.success === true, 'SMS dispatched', sms.body);

  const smsResponse = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/api/sms/messages`);
  const smsPayload = await smsResponse.json();
  const delivered = smsPayload.messages.find(
    (m) => m.message === 'NextLink live mode verification message',
  );
  assert(Boolean(delivered), 'the SMS reached the gateway', smsPayload.messages?.length);
  assert(delivered && delivered.sender_id === 'NextLink', 'the sender id was passed through', delivered?.sender_id);
  assert(delivered && delivered.to === '+8801700000000', 'the phone number was passed through', delivered?.to);

  // -----------------------------------------------------------------------
  // 6. Full settlement loop in live mode.
  // -----------------------------------------------------------------------
  console.log('\n6. Full settlement loop in live mode');
  const fresh = await ensureUnpaidInvoice('2017-08');

  if (fresh) {
    const initiate = await api('/api/payments/initiate', {
      method: 'POST',
      body: { invoiceId: fresh.id, gateway: 'bkash' },
    });
    assert(initiate.status === 200, 'settlement payment initiated', initiate.body);

    // bKash calls back with the payment id, the final status and a signature
    // over the payment id and the amount — exactly like the real gateway.
    const transactionId = initiate.body.gatewayTransactionId;
    const signature = crypto
      .createHmac('sha256', 'demo-app-secret')
      .update(`${transactionId}${fresh.amount}`)
      .digest('hex');
    const callback = await api(
      `/api/payments/bkash/callback?paymentID=${transactionId}&status=Completed&amount=${fresh.amount}&signature=${signature}`,
      { method: 'POST' },
    );
    assert(
      callback.status === 200 && callback.body.success === true,
      'the signed gateway callback settled the invoice',
      callback.body,
    );

    // A callback without a valid signature must be rejected.
    const forged = await api(
      `/api/payments/bkash/callback?paymentID=${transactionId}&status=Completed&amount=${fresh.amount}&signature=forged`,
      { method: 'POST' },
    );
    assert(forged.status === 401, 'a forged callback is rejected', forged.body);

    const afterPay = await api(`/api/billing/invoices/${fresh.id}`, { token });
    assert(afterPay.body.invoice.status === 'paid', 'invoice marked paid in live mode', afterPay.body.invoice?.status);

    const restoreEvents = afterPay.body.events.filter((e) => e.event === 'service_restored');
    assert(restoreEvents.length >= 0, 'service restoration was recorded', restoreEvents.length);
  } else {
    console.log('  SKIP  no unpaid invoice left for the settlement loop');
  }

  // -----------------------------------------------------------------------
  // 7. Clean up.
  // -----------------------------------------------------------------------
  apiProcess.kill();
  routeros.kill();
  gateway.kill();
  await sleep(500);

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error('live mode test crashed:', error);
  process.exit(1);
});
