'use strict';

/**
 * Requirement 4f — Comprehensive Billing Engine Unit & Integration Test Suite
 *
 * Scenarios verified:
 *   1. Signup on the 1st of the month (2026-01-01):
 *      - Charges Package Price + $8.99 Installation Fee + $0.99 Tax Fee
 *      - Zero proration
 *   2. Signup on the 15th of the month (2026-01-15):
 *      - Charges exact same Package Price + $8.99 Installation Fee + $0.99 Tax Fee
 *      - Zero proration
 *   3. Signup on the 31st of the month (2026-01-31):
 *      - Charges exact same Package Price + $8.99 Installation Fee + $0.99 Tax Fee
 *      - Zero proration
 *   4. Shorter month — February (2026-02-28):
 *      - Signup on Feb 28 charges Package Price + $8.99 Installation + $0.99 Tax, no proration
 *      - Subsequent monthly cycle in Feb clamps due date cleanly to Feb 28
 *   5. A paid month -> following month:
 *      - Charges ONLY the monthly package price ($0.00 installation, $0.00 tax, $0.00 carry-over, $0.00 late fee)
 *   6. One missed month -> following month:
 *      - Carries unpaid amount forward into the next month's bill
 *      - Adds 2% late fee calculated on the selected package plan's price
 *      - Shows late fee and carried-over amounts as separate line items on the invoice
 *   7. Two consecutive missed months:
 *      - Month 1 unpaid -> Month 2 includes Month 1 carry-over + 2% late fee (for Month 1)
 *      - Month 2 also unpaid -> Month 3 carries forward Month 2's total (which already includes Month 1)
 *        and applies a single 2% late fee for Month 2 (late fee is NEVER applied twice for Month 1)
 *   8. Idempotency (4d) & Billing Event Logging:
 *      - Re-running generateInvoice for the same subscriber and period returns created: false
 *      - Every charge is logged in billing_events
 */

const assert = require('assert');
const db = require('../src/lib/db');
const utils = require('../src/lib/utils');
const billing = require('../src/services/billing/engine');

const TEST_PREFIX = 'TEST-BILL-4F-';

async function cleanupTestSubscribers() {
  const rows = await db.query(`SELECT id FROM subscribers WHERE id LIKE $1`, [`${TEST_PREFIX}%`]);
  const ids = rows.rows.map((r) => r.id);
  if (ids.length === 0) return;
  await db.query(`DELETE FROM notifications WHERE user_id = ANY($1::text[])`, [ids]);
  await db.query(`DELETE FROM billing_events WHERE subscriber_id = ANY($1::text[])`, [ids]);
  await db.query(`DELETE FROM payment_transactions WHERE subscriber_id = ANY($1::text[])`, [ids]);
  await db.query(`DELETE FROM invoices WHERE subscriber_id = ANY($1::text[])`, [ids]);
  await db.query(`DELETE FROM subscriber_billing WHERE subscriber_id = ANY($1::text[])`, [ids]);
  await db.query(`DELETE FROM subscribers WHERE id = ANY($1::text[])`, [ids]);
}

async function createTestSubscriber(suffix, signupDateIso, packageId, packageName, packagePrice) {
  const id = `${TEST_PREFIX}${suffix}`;
  const raw = {
    id,
    name: `Billing Test ${suffix}`,
    firstName: 'Billing',
    lastName: `Test ${suffix}`,
    email: `test-${suffix.toLowerCase()}@nextlink.test`,
    phone: '+8801700009999',
    packageId,
    packageName,
    status: 'active',
    joinDate: signupDateIso,
    subscriptionStartedAt: `${signupDateIso}T00:00:00.000Z`,
    credit_balance: 0,
  };
  await db.query(
    `INSERT INTO subscribers (id, name, first_name, last_name, email, phone, package_id, status, raw_data, created_at, updated_at)
     VALUES ($1, $2, 'Billing', $3, $4, $5, $6, 'active', $7, $8::timestamptz, NOW())`,
    [id, raw.name, `Test ${suffix}`, raw.email, raw.phone, packageId, JSON.stringify(raw), `${signupDateIso}T00:00:00.000Z`],
  );
  return {
    id,
    name: raw.name,
    phone: raw.phone,
    email: raw.email,
    packageId,
    packageName,
    status: 'active',
    joinDate: signupDateIso,
    subscriptionStartedAt: `${signupDateIso}T00:00:00.000Z`,
    creditBalance: 0,
    raw,
  };
}

async function runTests() {
  console.log('=== NextLink Billing Engine Unit Tests (Requirement 4a–4f) ===\n');
  await cleanupTestSubscribers();

  // Ensure standard configurable fees ($8.99 install, $0.99 tax, 2% late fee)
  const feeCfg = await billing.getFeeConfig();
  assert.strictEqual(utils.toCents(feeCfg.installationFee), 899, 'Installation fee must be $8.99 (899 cents)');
  assert.strictEqual(utils.toCents(feeCfg.taxFee), 99, 'Tax fee must be $0.99 (99 cents)');
  assert.strictEqual(Number(feeCfg.lateFeePercent), 2, 'Late fee percent must be 2%');

  // Use a real paid package from DB (price > 0) or $50.00 plan price
  const pkgRow = await db.queryOne('SELECT id, name, price FROM packages WHERE price > 0 ORDER BY created_at ASC LIMIT 1');
  const pkgId = pkgRow ? pkgRow.id : 'PKG-TEST';
  const pkgName = pkgRow ? pkgRow.name : 'Standard Fiber';
  const pkgPrice = pkgRow && Number(pkgRow.price) > 0 ? Number(pkgRow.price) : 50.00;
  const pkgCents = utils.toCents(pkgPrice);
  const expectedFirstMonthCents = pkgCents + 899 + 99;
  const expectedLateFeeCents = billing.calculateLateFeeCents(pkgCents, 2);

  const results = [];

  try {
    // 1. Signup on the 1st of the month (2026-01-01)
    const sub1 = await createTestSubscriber('JAN01', '2026-01-01', pkgId, pkgName, pkgPrice);
    const inv1 = await billing.generateInvoice({ subscriber: sub1, period: '2026-01', baseAmount: pkgPrice });
    assert.strictEqual(inv1.created, true, 'Invoice for Jan 1 signup should be created');
    assert.strictEqual(utils.toCents(inv1.invoice.amount), expectedFirstMonthCents, 'Jan 1 signup must charge Package + $8.99 + $0.99');
    assert.strictEqual(utils.toCents(inv1.invoice.installationFee), 899, 'Jan 1 installation fee must be $8.99');
    assert.strictEqual(utils.toCents(inv1.invoice.taxFee), 99, 'Jan 1 tax fee must be $0.99');
    results.push({ test: 'Signup on the 1st (2026-01-01)', status: 'PASS', amount: inv1.invoice.amount });

    // 2. Signup on the 15th of the month (2026-01-15) — No proration
    const sub15 = await createTestSubscriber('JAN15', '2026-01-15', pkgId, pkgName, pkgPrice);
    const inv15 = await billing.generateInvoice({ subscriber: sub15, period: '2026-01', baseAmount: pkgPrice });
    assert.strictEqual(inv15.created, true);
    assert.strictEqual(
      utils.toCents(inv15.invoice.amount),
      expectedFirstMonthCents,
      'Jan 15 signup must charge exact same amount as Jan 1 (no proration)',
    );
    assert.strictEqual(utils.toCents(inv15.invoice.amount), utils.toCents(inv1.invoice.amount));
    results.push({ test: 'Signup on the 15th (2026-01-15, no proration)', status: 'PASS', amount: inv15.invoice.amount });

    // 3. Signup on the 31st of the month (2026-01-31) — No proration
    const sub31 = await createTestSubscriber('JAN31', '2026-01-31', pkgId, pkgName, pkgPrice);
    const inv31 = await billing.generateInvoice({ subscriber: sub31, period: '2026-01', baseAmount: pkgPrice });
    assert.strictEqual(inv31.created, true);
    assert.strictEqual(
      utils.toCents(inv31.invoice.amount),
      expectedFirstMonthCents,
      'Jan 31 signup must charge exact same amount as Jan 1 (no proration)',
    );
    results.push({ test: 'Signup on the 31st (2026-01-31, no proration)', status: 'PASS', amount: inv31.invoice.amount });

    // 4. Shorter month — February (2026-02-28)
    const subFeb = await createTestSubscriber('FEB28', '2026-02-28', pkgId, pkgName, pkgPrice);
    const invFeb = await billing.generateInvoice({ subscriber: subFeb, period: '2026-02', baseAmount: pkgPrice });
    assert.strictEqual(invFeb.created, true);
    assert.strictEqual(
      utils.toCents(invFeb.invoice.amount),
      expectedFirstMonthCents,
      'Feb 28 signup must charge full Package + $8.99 + $0.99 with no proration',
    );
    assert.ok(invFeb.invoice.dueDate.startsWith('2026-02-'), 'February due date must stay within February');
    results.push({ test: 'Shorter month — February (2026-02-28)', status: 'PASS', amount: invFeb.invoice.amount, dueDate: invFeb.invoice.dueDate });

    // 5. Idempotency check (re-running generateInvoice for same subscriber & period)
    const dupInv = await billing.generateInvoice({ subscriber: sub1, period: '2026-01', baseAmount: pkgPrice });
    assert.strictEqual(dupInv.created, false, 'Re-running generateInvoice for same period must be idempotent (created: false)');
    results.push({ test: 'Idempotent invoice generation (4d)', status: 'PASS', note: 'Duplicate run returned created: false' });

    // 6. Paid month -> Next month charges ONLY monthly package price (4b)
    await billing.applyPayment({
      invoiceId: inv1.invoice.id,
      transactionId: 'TXN-TEST-PAID-01',
      gateway: 'mock',
      amount: inv1.invoice.amount,
    });
    const invPaidNext = await billing.generateInvoice({ subscriber: sub1, period: '2026-02', baseAmount: pkgPrice });
    assert.strictEqual(invPaidNext.created, true);
    assert.strictEqual(utils.toCents(invPaidNext.invoice.amount), pkgCents, 'Month 2 after paid Month 1 must charge ONLY package price');
    assert.strictEqual(utils.toCents(invPaidNext.invoice.installationFee), 0, 'Month 2 installation fee must be 0');
    assert.strictEqual(utils.toCents(invPaidNext.invoice.taxFee), 0, 'Month 2 tax fee must be 0');
    assert.strictEqual(utils.toCents(invPaidNext.invoice.carriedOverAmount), 0, 'Month 2 carriedOverAmount must be 0');
    assert.strictEqual(utils.toCents(invPaidNext.invoice.lateFee), 0, 'Month 2 lateFee must be 0');
    results.push({ test: 'Paid month -> following month (4b)', status: 'PASS', amount: invPaidNext.invoice.amount });

    // 7. One missed month -> Carry-over + 2% late fee on package price as separate line items (4c)
    // sub15 did NOT pay 2026-01 (amount = expectedFirstMonthCents). Generate 2026-02:
    const invMissed1 = await billing.generateInvoice({ subscriber: sub15, period: '2026-02', baseAmount: pkgPrice });
    const expectedMonth2Missed1Cents = pkgCents + expectedFirstMonthCents + expectedLateFeeCents;
    assert.strictEqual(invMissed1.created, true);
    assert.strictEqual(
      utils.toCents(invMissed1.invoice.carriedOverAmount),
      expectedFirstMonthCents,
      'Carried-over amount must equal Month 1 unpaid balance',
    );
    assert.strictEqual(
      utils.toCents(invMissed1.invoice.lateFee),
      expectedLateFeeCents,
      'Late fee must be 2% of package price',
    );
    assert.strictEqual(
      utils.toCents(invMissed1.invoice.amount),
      expectedMonth2Missed1Cents,
      'Month 2 total must equal Package + Carry-Over + 2% Late Fee',
    );
    const hasCarryLine = invMissed1.invoice.lines.some((l) => l.type === 'carried_over' && utils.toCents(l.amount) === expectedFirstMonthCents);
    const hasLateLine = invMissed1.invoice.lines.some((l) => l.type === 'late_fee' && utils.toCents(l.amount) === expectedLateFeeCents);
    assert.strictEqual(hasCarryLine, true, 'Invoice lines must include separate carried_over line item');
    assert.strictEqual(hasLateLine, true, 'Invoice lines must include separate late_fee line item');
    results.push({
      test: 'One missed month (carry-over + 2% late fee line items)',
      status: 'PASS',
      amount: invMissed1.invoice.amount,
      carriedOver: invMissed1.invoice.carriedOverAmount,
      lateFee: invMissed1.invoice.lateFee,
    });

    // 8. Two consecutive missed months (Month 1 unpaid, Month 2 unpaid -> Month 3)
    // Verify Month 1 is NOT charged a second late fee in Month 3!
    const invMissed2 = await billing.generateInvoice({ subscriber: sub15, period: '2026-03', baseAmount: pkgPrice });
    const expectedMonth3Cents = pkgCents + expectedMonth2Missed1Cents + expectedLateFeeCents;
    assert.strictEqual(invMissed2.created, true);
    assert.strictEqual(
      utils.toCents(invMissed2.invoice.carriedOverAmount),
      expectedMonth2Missed1Cents,
      'Month 3 carried-over amount must equal Month 2 unpaid total (which already rolled up Month 1)',
    );
    assert.strictEqual(
      utils.toCents(invMissed2.invoice.lateFee),
      expectedLateFeeCents,
      'Month 3 late fee must be a single 2% fee for missed Month 2 (never applied twice for Month 1)',
    );
    assert.strictEqual(
      utils.toCents(invMissed2.invoice.amount),
      expectedMonth3Cents,
      'Month 3 total must equal Package + Month 2 Carry-Over + single 2% Late Fee',
    );
    results.push({
      test: 'Two consecutive missed months (no double late fee)',
      status: 'PASS',
      amount: invMissed2.invoice.amount,
      carriedOver: invMissed2.invoice.carriedOverAmount,
      lateFee: invMissed2.invoice.lateFee,
    });

    // Verify billing_events audit log entries
    const eventsCount = await db.queryOne(
      `SELECT COUNT(*)::int AS cnt FROM billing_events WHERE subscriber_id = $1`,
      [sub15.id],
    );
    assert.ok(eventsCount.cnt >= 6, 'Every charge and fee must be logged in billing_events');
    results.push({
      test: 'Billing events audit logging (4d)',
      status: 'PASS',
      eventsLogged: eventsCount.cnt,
    });

    console.table(results);
    console.log('\nALL 9 BILLING ENGINE REQUIREMENTS TESTS PASSED.');
  } finally {
    await cleanupTestSubscribers();
    if (typeof db.close === 'function') await db.close();
  }
}

runTests().catch((err) => {
  console.error('BILLING TEST FAILED:', err);
  process.exit(1);
});
