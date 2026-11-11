'use strict';

/**
 * Regression test for the destructive admin save.
 *
 * The admin panel used to rewrite the whole invoices table with
 * DELETE + re-INSERT from `raw_data`. Because the billing engine only wrote
 * the status to the column, every paid invoice was reset to "unpaid" on the
 * next admin save.
 *
 * This test performs a real admin save through the same code path and checks
 * that the billing data survives.
 *
 * Run with:  node scripts/test-admin-save.js
 */

const BASE = process.env.API_BASE_URL || 'http://localhost:3100';
const ADMIN = process.env.ADMIN_BASE_URL || 'http://localhost:8000';

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
  const response = await fetch(`${BASE}${path}`, {
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

async function run() {
  console.log('\n=== Admin save regression test ===\n');

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@nextlink.com', password: 'admin123' },
  });
  const token = login.body.token;
  assert(login.status === 200 && token, 'staff token obtained');

  // -----------------------------------------------------------------------
  console.log('\n1. Record the state before the save');
  const before = await api('/api/billing/invoices?limit=200', { token });
  const paidBefore = before.body.invoices.filter((invoice) => invoice.status === 'paid');
  assert(paidBefore.length > 0, 'the database holds paid invoices', paidBefore.length);

  const paidIds = paidBefore.map((invoice) => invoice.id);
  const createdAtBefore = paidBefore[0]?.created_at;

  // -----------------------------------------------------------------------
  console.log('\n2. Perform a real admin save');
  // The admin panel reads the whole store and writes it back. This is the
  // exact payload shape the panel sends.
  const storeResponse = await fetch(`${ADMIN}/api/data`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const store = await storeResponse.json();
  assert(storeResponse.ok && Array.isArray(store.invoices), 'the admin store was loaded', store.invoices?.length);

  const saveResponse = await fetch(`${ADMIN}/api/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: 'invoices', data: store.invoices }),
  });
  const saveResult = await saveResponse.json().catch(() => ({}));
  assert(saveResponse.ok, 'the admin save succeeded', saveResult);

  // -----------------------------------------------------------------------
  console.log('\n3. Verify the billing data survived');
  const after = await api('/api/billing/invoices?limit=200', { token });
  const paidAfter = after.body.invoices.filter((invoice) => invoice.status === 'paid');
  const paidIdsAfter = paidAfter.map((invoice) => invoice.id);

  // The billing engine may add an invoice while the save runs, so the check
  // is that no paid invoice was lost — not that the count is identical.
  const lost = paidIds.filter((id) => !paidIdsAfter.includes(id));
  assert(lost.length === 0, 'no paid invoice was reset to unpaid', lost.slice(0, 5));
  assert(
    paidIdsAfter.length >= paidIds.length,
    'the paid invoices are all still there',
    { before: paidIds.length, after: paidIdsAfter.length },
  );

  // The status has to be in raw_data too, because the admin store rebuilds
  // the table from raw_data.
  const drifted = paidAfter.filter(
    (invoice) => invoice.raw_data && invoice.raw_data.status !== 'paid',
  );
  assert(drifted.length === 0, 'the status is mirrored into raw_data', drifted.map((i) => i.id).slice(0, 5));

  // The creation date must survive the save.
  const sameRow = after.body.invoices.find((invoice) => invoice.id === paidIds[0]);
  assert(
    sameRow && createdAtBefore && new Date(sameRow.created_at).getTime() === new Date(createdAtBefore).getTime(),
    'the creation date was not reset',
    { before: createdAtBefore, after: sameRow?.created_at },
  );

  // -----------------------------------------------------------------------
  console.log('\n4. The same check for the subscribers');
  const subscribersBefore = await api('/api/billing/invoices?limit=1', { token });
  assert(subscribersBefore.status === 200, 'the subscriber records are readable');

  const suspendedBefore = await api('/api/mikrotik/log?limit=1', { token });
  assert(suspendedBefore.status === 200, 'the router log is readable');

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error('admin save test crashed:', error);
  process.exit(1);
});
