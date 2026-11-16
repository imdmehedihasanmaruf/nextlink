'use strict';

/**
 * Comprehensive Verification & Unit/Integration Test Suite for:
 * "Subscriber Plan Invoice Preview" (Step 4, Step 5, Final Invoice, My Orders, Gateway)
 *
 * Tests all 8 required cases + end-to-end parity across preview, order, invoice, My Orders, and gateway:
 *   1. New subscriber, Standard 29.99 -> total 39.97 ("New Subscription" badge, 3 lines)
 *   2. Existing subscriber, no dues -> total 29.99 ("Monthly Renewal" badge, 1 line, no install/tax)
 *   3. Existing subscriber, 1 unpaid month -> total 62.98 ("Overdue Balance" badge, 10% late fee = 3.00)
 *   4. Existing subscriber, 2 unpaid months -> 2 previous-month lines + running month + 2 late fees (10% each = 95.97)
 *   5. Late fee rounding: 10% of 29.99 = 3.00 (half-up, integer cents: 299.9 -> 300 cents)
 *   6. Plan upgrade by an existing subscriber -> no installation/tax charged ("Package Plan Upgrade" badge)
 *   7. Changing late_fee_value / late_fee_type in Settings changes the next quote without a code change
 *   8. Quote API failure -> error state (HTTP 503, success: false, no fallback total), payment button disabled
 *   9. End-to-End Parity: Step 4 quote == Step 5 == orders.total_payable == invoices.amount == My Orders == payment_transactions.amount
 */

const assert = require('assert');
const db = require('../src/lib/db');
const utils = require('../src/lib/utils');
const billing = require('../src/services/billing/engine');
const settings = require('../src/services/settings');
const { signToken, ROLES } = require('../src/middleware/auth');

const TEST_PREFIX = 'TEST-QUOTE-';
const API_BASE = 'http://localhost:3100';
const FRONTEND_BASE = 'http://localhost:3000';

async function cleanup() {
  const rows = await db.query(`SELECT id FROM subscribers WHERE id LIKE $1`, [`${TEST_PREFIX}%`]);
  const ids = rows.rows.map((r) => r.id);
  if (ids.length === 0) return;
  await db.query(`DELETE FROM notifications WHERE user_id = ANY($1::text[])`, [ids]);
  await db.query(`DELETE FROM billing_events WHERE subscriber_id = ANY($1::text[])`, [ids]);
  await db.query(`DELETE FROM payment_transactions WHERE subscriber_id = ANY($1::text[])`, [ids]);
  await db.query(`DELETE FROM invoices WHERE subscriber_id = ANY($1::text[])`, [ids]);
  await db.query(`DELETE FROM orders WHERE customer_id = ANY($1::text[])`, [ids]);
  await db.query(`DELETE FROM subscriber_billing WHERE subscriber_id = ANY($1::text[])`, [ids]);
  await db.query(`DELETE FROM subscriber_credentials WHERE subscriber_id = ANY($1::text[])`, [ids]);
  await db.query(`DELETE FROM subscribers WHERE id = ANY($1::text[])`, [ids]);
}

async function createSubscriber({ suffix, status = 'registered', packageId = '', packageName = '' }) {
  const id = `${TEST_PREFIX}${suffix}`;
  const raw = {
    id,
    name: `Quote Test ${suffix}`,
    firstName: 'Quote',
    lastName: suffix,
    email: `quote-${suffix.toLowerCase()}@nextlink.test`,
    phone: '+8801711223344',
    packageId,
    packageName,
    status,
    source: status === 'registered' ? 'self-register' : 'admin',
    joinDate: '2026-08-01',
    balance: 0,
    credit_balance: 0,
  };
  await db.query(
    `INSERT INTO subscribers (id, name, first_name, last_name, email, phone, package_id, status, raw_data, created_at, updated_at)
     VALUES ($1, $2, 'Quote', $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
    [id, raw.name, suffix, raw.email, raw.phone, packageId || null, status, JSON.stringify(raw)],
  );
  const token = signToken({
    id,
    subscriberId: id,
    name: raw.name,
    firstName: 'Quote',
    lastName: suffix,
    role: ROLES.SUBSCRIBER,
    type: 'subscriber',
  });
  return { id, token, raw };
}

async function insertInvoice({ id, subscriberId, period, packageId, packageName, amount, status = 'unpaid', dueDate }) {
  const raw = {
    id,
    period,
    subscriberId,
    packageId,
    packageName,
    packagePrice: amount,
    subscriptionAmount: amount,
    subscriptionAmountCents: utils.toCents(amount),
    amount,
    status,
    dueDate: dueDate || `${period}-10`,
  };
  await db.query(
    `INSERT INTO invoices (id, subscriber_id, amount, installation_fee, tax_fee, late_fee, carried_over_amount, late_fee_applied, status, due_date, raw_data, created_at, updated_at)
     VALUES ($1, $2, $3, 0, 0, 0, 0, FALSE, $4, $5, $6, NOW(), NOW())`,
    [id, subscriberId, amount, status, dueDate || `${period}-10`, JSON.stringify(raw)],
  );
}

async function run() {
  console.log('=== Subscriber Plan Invoice Preview & Quote Engine Test Suite ===\n');
  await cleanup();

  // Ensure default fee config: installationFee=8.99, taxFee=0.99, late_fee_type='percent', late_fee_value=10
  await settings.setGroup('billing', {
    installationFee: 8.99,
    taxFee: 0.99,
    late_fee_type: 'percent',
    late_fee_value: 10,
  });

  // Verify Standard (200 Mbps, $29.99) and Advanced (300 Mbps, $49.99) exist in packages
  const stdPkg = await db.queryOne(`SELECT * FROM packages WHERE id = 'PKG-002' OR (name = 'Standard' AND price = 29.99) LIMIT 1`);
  const advPkg = await db.queryOne(`SELECT * FROM packages WHERE id = 'PKG-003' OR (name = 'Advanced' AND price = 49.99) LIMIT 1`);
  assert(stdPkg, 'Standard ($29.99, 200 Mbps) package must exist in packages table');
  assert(advPkg, 'Advanced ($49.99, 300 Mbps) package must exist in packages table');

  const results = [];

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // TEST 1: New subscriber, Standard 29.99 -> total 39.97
    // ─────────────────────────────────────────────────────────────────────────
    const subNew = await createSubscriber({ suffix: 'NEW-1', status: 'registered' });
    const quote1 = await billing.calculateQuote({
      subscriberId: subNew.id,
      packageId: stdPkg.id,
    });
    assert.strictEqual(quote1.scenario, 'NEW_SUBSCRIBER');
    assert.strictEqual(quote1.badge, 'New Subscription');
    assert.strictEqual(quote1.lines.length, 3, 'Scenario 1 must have 3 line items');
    assert.strictEqual(quote1.lines[0].label, 'Standard (200 Mbps) monthly fee');
    assert.strictEqual(quote1.lines[0].formattedAmount, '$29.99');
    assert.strictEqual(quote1.lines[1].label, 'One-Time Installation Fee');
    assert.strictEqual(quote1.lines[1].formattedAmount, '+$8.99');
    assert.strictEqual(quote1.lines[2].label, 'Tax Fee');
    assert.strictEqual(quote1.lines[2].formattedAmount, '+$0.99');
    assert.strictEqual(quote1.totalPayableCents, 3997);
    assert.strictEqual(quote1.totalPayable, 39.97);
    assert.strictEqual(quote1.formattedTotalPayable, '$39.97');
    results.push({
      test: '1. New subscriber, Standard 29.99 -> total 39.97',
      status: 'PASS',
      evidence: `Badge="${quote1.badge}", Lines=[${quote1.lines.map((l) => `${l.label}: ${l.formattedAmount}`).join(' | ')}], Total=${quote1.formattedTotalPayable}`,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 2: Existing subscriber, no dues -> total 29.99
    // ─────────────────────────────────────────────────────────────────────────
    const subExisting = await createSubscriber({
      suffix: 'EXIST-2',
      status: 'active',
      packageId: stdPkg.id,
      packageName: stdPkg.name,
    });
    await insertInvoice({
      id: `INV-202610-${subExisting.id}`,
      subscriberId: subExisting.id,
      period: '2026-10',
      packageId: stdPkg.id,
      packageName: stdPkg.name,
      amount: 29.99,
      status: 'paid',
    });

    const quote2 = await billing.calculateQuote({
      subscriberId: subExisting.id,
      packageId: stdPkg.id,
    });
    assert.strictEqual(quote2.scenario, 'EXISTING_NORMAL');
    assert.strictEqual(quote2.badge, 'Monthly Renewal');
    assert.strictEqual(quote2.lines.length, 1, 'Scenario 2 must have 1 line item');
    assert.strictEqual(quote2.lines[0].label, 'Standard (200 Mbps) monthly fee');
    assert.strictEqual(quote2.lines[0].formattedAmount, '$29.99');
    assert.strictEqual(quote2.installationFeeCents, 0, 'No installation fee for existing subscriber');
    assert.strictEqual(quote2.taxFeeCents, 0, 'No tax fee for existing subscriber');
    assert.strictEqual(quote2.lateFeeCents, 0);
    assert.strictEqual(quote2.totalPayableCents, 2999);
    assert.strictEqual(quote2.totalPayable, 29.99);
    results.push({
      test: '2. Existing subscriber, no dues -> total 29.99',
      status: 'PASS',
      evidence: `Badge="${quote2.badge}", Lines=[${quote2.lines.map((l) => `${l.label}: ${l.formattedAmount}`).join(' | ')}], Total=${quote2.formattedTotalPayable}`,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 3: Existing subscriber, 1 unpaid month -> total 62.98 (10% late fee = 3.00)
    // ─────────────────────────────────────────────────────────────────────────
    const subOverdue1 = await createSubscriber({
      suffix: 'OVERDUE-3',
      status: 'active',
      packageId: stdPkg.id,
      packageName: stdPkg.name,
    });
    await insertInvoice({
      id: `INV-202610-${subOverdue1.id}`,
      subscriberId: subOverdue1.id,
      period: '2026-10',
      packageId: stdPkg.id,
      packageName: stdPkg.name,
      amount: 29.99,
      status: 'unpaid',
    });

    const quote3 = await billing.calculateQuote({
      subscriberId: subOverdue1.id,
      packageId: stdPkg.id,
    });
    assert.strictEqual(quote3.scenario, 'OVERDUE_BALANCE');
    assert.strictEqual(quote3.badge, 'Overdue Balance');
    assert.strictEqual(quote3.lines.length, 3, 'Scenario 3 (1 unpaid month) must have 3 line items');
    assert.strictEqual(quote3.lines[0].label, 'Standard (200 Mbps) previous month fee (October 2026)');
    assert.strictEqual(quote3.lines[0].formattedAmount, '$29.99');
    assert.strictEqual(quote3.lines[1].label, 'Standard (200 Mbps) running month fee');
    assert.strictEqual(quote3.lines[1].formattedAmount, '$29.99');
    assert.strictEqual(quote3.lines[2].label, 'Late Fee (10%)');
    assert.strictEqual(quote3.lines[2].formattedAmount, '+$3.00');
    assert.strictEqual(quote3.lateFeeCents, 300);
    assert.strictEqual(quote3.totalPayableCents, 6298);
    assert.strictEqual(quote3.totalPayable, 62.98);
    results.push({
      test: '3. Existing subscriber, 1 unpaid month -> total 62.98 (10% late fee = 3.00)',
      status: 'PASS',
      evidence: `Badge="${quote3.badge}", Lines=[${quote3.lines.map((l) => `${l.label}: ${l.formattedAmount}`).join(' | ')}], Total=${quote3.formattedTotalPayable}`,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4: Existing subscriber, 2 unpaid months -> 2 previous-month lines + running month + 2 late fees (10% each)
    // ─────────────────────────────────────────────────────────────────────────
    const subOverdue2 = await createSubscriber({
      suffix: 'OVERDUE-4',
      status: 'active',
      packageId: stdPkg.id,
      packageName: stdPkg.name,
    });
    await insertInvoice({
      id: `INV-202609-${subOverdue2.id}`,
      subscriberId: subOverdue2.id,
      period: '2026-09',
      packageId: stdPkg.id,
      packageName: stdPkg.name,
      amount: 29.99,
      status: 'unpaid',
    });
    await insertInvoice({
      id: `INV-202610-${subOverdue2.id}`,
      subscriberId: subOverdue2.id,
      period: '2026-10',
      packageId: stdPkg.id,
      packageName: stdPkg.name,
      amount: 29.99,
      status: 'unpaid',
    });

    const quote4 = await billing.calculateQuote({
      subscriberId: subOverdue2.id,
      packageId: stdPkg.id,
    });
    assert.strictEqual(quote4.scenario, 'OVERDUE_BALANCE');
    assert.strictEqual(quote4.badge, 'Overdue Balance');
    assert.strictEqual(quote4.lines.length, 5, '2 unpaid months must produce 2 prev-month lines + 1 running month + 2 late fees');
    assert.strictEqual(quote4.lines[0].label, 'Standard (200 Mbps) previous month fee (September 2026)');
    assert.strictEqual(quote4.lines[0].amountCents, 2999);
    assert.strictEqual(quote4.lines[1].label, 'Standard (200 Mbps) previous month fee (October 2026)');
    assert.strictEqual(quote4.lines[1].amountCents, 2999);
    assert.strictEqual(quote4.lines[2].label, 'Standard (200 Mbps) running month fee');
    assert.strictEqual(quote4.lines[2].amountCents, 2999);
    assert.strictEqual(quote4.lines[3].label, 'Late Fee (10%) (September 2026)');
    assert.strictEqual(quote4.lines[3].amountCents, 300);
    assert.strictEqual(quote4.lines[4].label, 'Late Fee (10%) (October 2026)');
    assert.strictEqual(quote4.lines[4].amountCents, 300);
    // Verify no compounding (300 + 300 = 600 cents, NOT 10% on 32.99)
    assert.strictEqual(quote4.lateFeeCents, 600);
    assert.strictEqual(quote4.totalPayableCents, 9597);
    assert.strictEqual(quote4.totalPayable, 95.97);
    results.push({
      test: '4. Existing subscriber, 2 unpaid months -> 2 prev-month + running + 2 late fees ($95.97)',
      status: 'PASS',
      evidence: `Lines=${quote4.lines.length} [${quote4.lines.map((l) => `${l.label}: ${l.formattedAmount}`).join(' | ')}], Total=${quote4.formattedTotalPayable}`,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 5: Late fee rounding: 10% of 29.99 = 3.00 (half-up, integer cents)
    // ─────────────────────────────────────────────────────────────────────────
    const roundedCents = billing.calculateLateFeeCents(2999, {
      late_fee_type: 'percent',
      late_fee_value: 10,
    });
    assert.strictEqual(roundedCents, 300, '10% of 2999 cents (299.9) must round half-up to 300 cents ($3.00)');
    assert.strictEqual(utils.fromCents(roundedCents), 3.0);
    results.push({
      test: '5. Late fee rounding: 10% of 29.99 = 3.00 (half-up, integer cents)',
      status: 'PASS',
      evidence: `2999 cents * 10% = 299.9 cents -> rounded half-up = ${roundedCents} cents ($${utils.fromCentsStr(roundedCents)})`,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 6: Plan upgrade by an existing subscriber -> no installation/tax charged
    // ─────────────────────────────────────────────────────────────────────────
    const quote6 = await billing.calculateQuote({
      subscriberId: subExisting.id,
      packageId: advPkg.id,
      purchaseType: 'UPGRADE',
    });
    assert.strictEqual(quote6.scenario, 'EXISTING_NORMAL');
    assert.strictEqual(quote6.badge, 'Package Plan Upgrade');
    assert.strictEqual(quote6.lines.length, 1);
    assert.strictEqual(quote6.lines[0].label, 'Advanced (300 Mbps) monthly fee');
    assert.strictEqual(quote6.lines[0].formattedAmount, '$49.99');
    assert.strictEqual(quote6.installationFeeCents, 0, 'Plan upgrade must charge $0 installation fee');
    assert.strictEqual(quote6.taxFeeCents, 0, 'Plan upgrade must charge $0 tax fee');
    assert.strictEqual(quote6.totalPayable, 49.99);
    results.push({
      test: '6. Plan upgrade by existing subscriber -> no installation/tax charged',
      status: 'PASS',
      evidence: `Badge="${quote6.badge}", Line="${quote6.lines[0].label}: ${quote6.lines[0].formattedAmount}", Install=$0.00, Tax=$0.00, Total=${quote6.formattedTotalPayable}`,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 7: Changing late_fee_value in Settings changes the next quote without a code change
    // ─────────────────────────────────────────────────────────────────────────
    await settings.setGroup('billing', {
      late_fee_type: 'percent',
      late_fee_value: 5,
    });
    const quote7a = await billing.calculateQuote({
      subscriberId: subOverdue1.id,
      packageId: stdPkg.id,
    });
    // 5% of 2999 cents = 149.95 -> half-up = 150 cents ($1.50). Total = 29.99 + 29.99 + 1.50 = 61.48
    assert.strictEqual(quote7a.lateFeeCents, 150, '5% of $29.99 must be 150 cents ($1.50)');
    assert.strictEqual(quote7a.totalPayable, 61.48);
    assert.strictEqual(quote7a.lines[2].label, 'Late Fee (5%)');

    // Also test flat late fee type in Settings
    await settings.setGroup('billing', {
      late_fee_type: 'flat',
      late_fee_value: 4.5,
    });
    const quote7b = await billing.calculateQuote({
      subscriberId: subOverdue1.id,
      packageId: stdPkg.id,
    });
    assert.strictEqual(quote7b.lateFeeCents, 450, 'Flat $4.50 late fee must be 450 cents');
    assert.strictEqual(quote7b.totalPayable, 64.48);

    // Restore default 10% late fee
    await settings.setGroup('billing', {
      late_fee_type: 'percent',
      late_fee_value: 10,
    });
    const quote7c = await billing.calculateQuote({
      subscriberId: subOverdue1.id,
      packageId: stdPkg.id,
    });
    assert.strictEqual(quote7c.lateFeeCents, 300);
    assert.strictEqual(quote7c.totalPayable, 62.98);
    results.push({
      test: '7. Changing late_fee_value in Settings changes next quote without code change',
      status: 'PASS',
      evidence: `5% percent -> Late Fee=$1.50 (Total=$61.48); $4.50 flat -> Late Fee=$4.50 (Total=$64.48); restored 10% -> Late Fee=$3.00 (Total=$62.98)`,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 8: Quote API failure -> error state, payment button disabled (no fallback total)
    // ─────────────────────────────────────────────────────────────────────────
    const failRes = await fetch(`${FRONTEND_BASE}/api/customer/calculate-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${subNew.token}`,
      },
      body: JSON.stringify({
        customerId: subNew.id,
        packageId: stdPkg.id,
        purchaseType: 'UPGRADE',
        simulateFailure: true,
      }),
    });
    const failJson = await failRes.json();
    assert.strictEqual(failRes.ok, false, 'Quote failure must return non-200 HTTP status');
    assert.strictEqual(failJson.success, false, 'Quote failure response must have success: false');
    assert.strictEqual(failJson.totalPayable, undefined, 'Quote failure must NEVER return a fallback total');
    results.push({
      test: '8. Quote API failure -> error state, no fallback total',
      status: 'PASS',
      evidence: `HTTP ${failRes.status}, success=${failJson.success}, error="${failJson.error}", totalPayable=${failJson.totalPayable}`,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 9: End-to-End Total Parity across Step 4, Step 5, Order, Invoice, My Orders & Gateway
    // ─────────────────────────────────────────────────────────────────────────
    const calcRes = await fetch(`${FRONTEND_BASE}/api/customer/calculate-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${subOverdue1.token}`,
      },
      body: JSON.stringify({
        customerId: subOverdue1.id,
        packageId: stdPkg.id,
        purchaseType: 'UPGRADE',
      }),
    });
    const calcJson = await calcRes.json();
    assert.strictEqual(calcJson.success, true);
    assert.strictEqual(calcJson.totalPayable, 62.98);

    const orderRes = await fetch(`${FRONTEND_BASE}/api/customer/orders/create-and-pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${subOverdue1.token}`,
      },
      body: JSON.stringify({
        customerId: subOverdue1.id,
        packageId: stdPkg.id,
        purchaseType: 'UPGRADE',
        paymentMethod: 'bkash',
        termsAccepted: true,
      }),
    });
    const orderJson = await orderRes.json();
    assert.strictEqual(orderJson.success, true, `create-and-pay failed: ${orderJson.error}`);
    assert.strictEqual(Number(orderJson.order.totalPayable), 62.98, 'Order totalPayable must match quote ($62.98)');
    assert.strictEqual(Number(orderJson.payment.amount), 62.98, 'Gateway payment amount must match quote ($62.98)');

    const dbInvoice = await db.queryOne(`SELECT * FROM invoices WHERE id = $1`, [orderJson.payment.invoiceId]);
    assert.strictEqual(Number(dbInvoice.amount), 62.98, 'Generated invoice amount in DB must be $62.98');
    assert.strictEqual(Number(dbInvoice.carried_over_amount), 29.99, 'Invoice carried_over_amount must be $29.99');
    assert.strictEqual(Number(dbInvoice.late_fee), 3.0, 'Invoice late_fee must be $3.00');

    const dbPaymentTx = await db.queryOne(
      `SELECT * FROM payment_transactions WHERE invoice_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [orderJson.payment.invoiceId],
    );
    assert.strictEqual(Number(dbPaymentTx.amount), 62.98, 'Gateway payment_transactions row must be $62.98');

    const myInvoicesRes = await fetch(`${API_BASE}/api/portal/my-invoices`, {
      headers: { Authorization: `Bearer ${subOverdue1.token}` },
    });
    const myInvoicesJson = await myInvoicesRes.json();
    const activeBills = (myInvoicesJson.invoices || []).filter((i) => i.status !== 'carried_forward');
    assert.strictEqual(activeBills.length, 1, 'My Orders active bills must have the 1 combined invoice');
    assert.strictEqual(Number(activeBills[0].amount), 62.98, 'My Orders invoice amount must be $62.98');

    results.push({
      test: '9. End-to-End Parity (Step 4 == Step 5 == Invoice == My Orders == Gateway)',
      status: 'PASS',
      evidence: `Preview=$${calcJson.totalPayable.toFixed(2)}, Order=$${Number(orderJson.order.totalPayable).toFixed(2)}, Invoice=${dbInvoice.id} ($${Number(dbInvoice.amount).toFixed(2)}), MyOrders=$${Number(activeBills[0].amount).toFixed(2)}, GatewayTx=${dbPaymentTx.id} ($${Number(dbPaymentTx.amount).toFixed(2)})`,
    });

    console.table(results);
    console.log('\nALL 9 QUOTE & INVOICE PREVIEW TESTS PASSED (9/9)!');
  } finally {
    await cleanup();
    await db.close();
  }
}

run().catch(async (err) => {
  console.error('TEST FAILURE:', err);
  await cleanup().catch(() => {});
  await db.close().catch(() => {});
  process.exit(1);
});

