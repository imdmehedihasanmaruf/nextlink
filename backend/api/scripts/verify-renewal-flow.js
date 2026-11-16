/**
 * Verification test script for Monthly Bill Renewal & Duplicate Payment Protection
 */
const { Pool } = require('pg');
const config = require('../src/config');
const billing = require('../src/services/billing/engine');
const dates = require('../src/lib/dates');
const utils = require('../src/lib/utils');

const pool = new Pool({
  connectionString: config.db.connectionString,
});

async function runTests() {
  console.log('=== STARTING MONTHLY BILL RENEWAL VERIFICATION TESTS ===\n');
  let allPassed = true;

  // 1. Setup Test Subscriber with Package PKG-002 ($29.99)
  const testSubId = 'NL-TEST-RENEWAL-01';
  await pool.query(
    `INSERT INTO subscribers (id, name, email, phone, package_id, status, raw_data, created_at, updated_at)
     VALUES ($1, 'Renewal Tester', 'renewal@example.com', '+8801700000001', 'PKG-002', 'active',
             jsonb_build_object('dueDate', '2026-11-10', 'packageName', 'Standard', 'packageId', 'PKG-002'),
             NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       status = 'active',
       package_id = 'PKG-002',
       raw_data = jsonb_build_object('dueDate', '2026-11-10', 'packageName', 'Standard', 'packageId', 'PKG-002')`,
    [testSubId]
  );

  // Clean invoices for test subscriber
  await pool.query('DELETE FROM billing_events WHERE subscriber_id = $1', [testSubId]);
  await pool.query('DELETE FROM payment_transactions WHERE subscriber_id = $1', [testSubId]);
  await pool.query('DELETE FROM invoices WHERE subscriber_id = $1', [testSubId]);
  await pool.query('DELETE FROM orders WHERE customer_id = $1', [testSubId]);

  console.log('[Test Setup] Cleaned subscriber state for', testSubId);

  // ----------------------------------------------------
  // TEST 1: Renewal with No Dues
  // Expectation: Total = package price ($29.99), Badge: "Monthly Renewal", NO install fee, NO tax fee
  // ----------------------------------------------------
  console.log('\n--- TEST 1: Renewal with No Dues (Scenario 2) ---');
  // Add 1 prior paid invoice so subscriber has active subscription history
  await pool.query(
    `INSERT INTO invoices (id, subscriber_id, amount, status, due_date, raw_data, created_at, updated_at)
     VALUES ($1, $2, 29.99, 'paid', '2026-10-10',
             jsonb_build_object('period', '2026-10', 'packageId', 'PKG-002', 'packageName', 'Standard'),
             NOW(), NOW())`,
    ['INV-202610-TEST-01', testSubId]
  );

  const quoteNoDues = await billing.calculateQuote({
    subscriberId: testSubId,
    packageId: 'PKG-002',
    purchaseType: 'RENEWAL',
  });

  const pass1 = (
    quoteNoDues.badge === 'Monthly Renewal' &&
    quoteNoDues.scenario === 'EXISTING_NORMAL' &&
    Number(quoteNoDues.totalPayable) === 29.99 &&
    Number(quoteNoDues.installationFee) === 0 &&
    Number(quoteNoDues.taxFee) === 0 &&
    Number(quoteNoDues.lateFee) === 0 &&
    quoteNoDues.lines.length === 1 &&
    quoteNoDues.lines[0].code === 'monthly_fee' &&
    quoteNoDues.alreadyPaid === false
  );

  console.log(`Test 1 (Renewal, no dues): ${pass1 ? 'PASS' : 'FAIL'}`);
  console.log(`  - Badge: ${quoteNoDues.badge} (Expected: Monthly Renewal)`);
  console.log(`  - Total Payable: $${quoteNoDues.totalPayable} (Expected: $29.99)`);
  console.log(`  - Installation Fee: $${quoteNoDues.installationFee} (Expected: $0.00)`);
  console.log(`  - Tax Fee: $${quoteNoDues.taxFee} (Expected: $0.00)`);
  console.log(`  - Lines: ${JSON.stringify(quoteNoDues.lines.map(l => l.label))}`);
  if (!pass1) allPassed = false;

  // ----------------------------------------------------
  // TEST 2: Renewal with 1 Unpaid Month
  // Expectation: Previous month ($29.99) + Running month ($29.99) + 10% Late Fee ($3.00) = $62.98
  // ----------------------------------------------------
  console.log('\n--- TEST 2: Renewal with 1 Unpaid Month (Scenario 3) ---');
  await pool.query(
    `INSERT INTO invoices (id, subscriber_id, amount, status, due_date, raw_data, created_at, updated_at)
     VALUES ($1, $2, 29.99, 'unpaid', '2026-09-10',
             jsonb_build_object('period', '2026-09', 'packageId', 'PKG-002', 'packageName', 'Standard', 'subscriptionAmountCents', 2999),
             NOW(), NOW())`,
    ['INV-202609-TEST-01', testSubId]
  );

  const quote1Due = await billing.calculateQuote({
    subscriberId: testSubId,
    packageId: 'PKG-002',
    purchaseType: 'RENEWAL',
  });

  const pass2 = (
    quote1Due.badge === 'Overdue Balance' &&
    quote1Due.scenario === 'OVERDUE_BALANCE' &&
    Number(quote1Due.totalPayable) === 62.98 &&
    Number(quote1Due.installationFee) === 0 &&
    Number(quote1Due.taxFee) === 0 &&
    Number(quote1Due.lateFee) === 3.00 &&
    Number(quote1Due.carriedOverAmount) === 29.99
  );

  console.log(`Test 2 (Renewal with 1 unpaid month): ${pass2 ? 'PASS' : 'FAIL'}`);
  console.log(`  - Badge: ${quote1Due.badge} (Expected: Overdue Balance)`);
  console.log(`  - Carried Over: $${quote1Due.carriedOverAmount}`);
  console.log(`  - Running Month: $${quote1Due.packagePrice}`);
  console.log(`  - Late Fee: $${quote1Due.lateFee}`);
  console.log(`  - Total Payable: $${quote1Due.totalPayable} (Expected: $62.98)`);
  if (!pass2) allPassed = false;

  // ----------------------------------------------------
  // TEST 3: Renewal with 2 Unpaid Months
  // Expectation: 2 Previous months (29.99 x 2) + Running month (29.99) + 2 Late Fees (3.00 x 2) = 17.98 late/carried + 89.97 + 6.00 = $95.97
  // ----------------------------------------------------
  console.log('\n--- TEST 3: Renewal with 2 Unpaid Months ---');
  await pool.query(
    `INSERT INTO invoices (id, subscriber_id, amount, status, due_date, raw_data, created_at, updated_at)
     VALUES ($1, $2, 29.99, 'unpaid', '2026-08-10',
             jsonb_build_object('period', '2026-08', 'packageId', 'PKG-002', 'packageName', 'Standard', 'subscriptionAmountCents', 2999),
             NOW(), NOW())`,
    ['INV-202608-TEST-01', testSubId]
  );

  const quote2Dues = await billing.calculateQuote({
    subscriberId: testSubId,
    packageId: 'PKG-002',
    purchaseType: 'RENEWAL',
  });

  const pass3 = (
    quote2Dues.badge === 'Overdue Balance' &&
    quote2Dues.unpaidMonthsCount === 2 &&
    Number(quote2Dues.carriedOverAmount) === 59.98 &&
    Number(quote2Dues.lateFee) === 6.00 &&
    Number(quote2Dues.totalPayable) === 95.97
  );

  console.log(`Test 3 (Renewal with 2 unpaid months): ${pass3 ? 'PASS' : 'FAIL'}`);
  console.log(`  - Carried Over: $${quote2Dues.carriedOverAmount} (2 months x $29.99)`);
  console.log(`  - Running Month: $${quote2Dues.packagePrice}`);
  console.log(`  - Late Fee Total: $${quote2Dues.lateFee} (2 months x $3.00)`);
  console.log(`  - Total Payable: $${quote2Dues.totalPayable} (Expected: $95.97)`);
  if (!pass3) allPassed = false;

  // ----------------------------------------------------
  // TEST 4: Settle Invoice & Advance Due Date
  // Expectation: applyPayment marks invoice paid and advances subscriber dueDate to next month
  // ----------------------------------------------------
  console.log('\n--- TEST 4: Payment Application & Due Date Advance ---');
  const renewalInvoiceId = 'INV-202611-TEST-RENEWAL';
  await pool.query(
    `INSERT INTO invoices (id, subscriber_id, amount, status, due_date, raw_data, created_at, updated_at)
     VALUES ($1, $2, 29.99, 'unpaid', '2026-11-10',
             jsonb_build_object('period', '2026-11', 'packageId', 'PKG-002', 'packageName', 'Standard'),
             NOW(), NOW())`,
    [renewalInvoiceId, testSubId]
  );

  // Apply payment of $29.99
  const payResult = await billing.applyPayment({
    invoiceId: renewalInvoiceId,
    transactionId: 'TXN-TEST-12345',
    gateway: 'bkash',
    amount: 29.99,
  });

  const subAfterPay = await pool.query('SELECT raw_data FROM subscribers WHERE id = $1', [testSubId]);
  const newDueDate = subAfterPay.rows[0]?.raw_data?.dueDate;

  const pass4 = (
    payResult.invoice.status === 'paid' &&
    newDueDate &&
    newDueDate.includes('2026-12')
  );

  console.log(`Test 4 (Apply Payment & Advance Due Date): ${pass4 ? 'PASS' : 'FAIL'}`);
  console.log(`  - Invoice Status: ${payResult.invoice.status} (Expected: paid)`);
  console.log(`  - Advanced Due Date in DB: ${newDueDate} (Expected: 2026-12-10)`);
  if (!pass4) allPassed = false;

  // ----------------------------------------------------
  // TEST 5: Duplicate Payment Protection on Server
  // Expectation: calculateQuote detects current period is paid -> alreadyPaid = true, paidNotice returned
  // ----------------------------------------------------
  console.log('\n--- TEST 5: Duplicate Payment Protection ---');
  // Mark any remaining earlier test invoices as paid so subscriber has clean paid state for 2026-11
  await pool.query("UPDATE invoices SET status = 'paid' WHERE subscriber_id = $1", [testSubId]);

  const quoteAlreadyPaid = await billing.calculateQuote({
    subscriberId: testSubId,
    packageId: 'PKG-002',
    purchaseType: 'RENEWAL',
  });

  const pass5 = (
    quoteAlreadyPaid.alreadyPaid === true &&
    quoteAlreadyPaid.isCurrentPeriodPaid === true &&
    quoteAlreadyPaid.paidNotice.includes('Paid for') &&
    quoteAlreadyPaid.nextDueDate.length > 0
  );

  console.log(`Test 5 (Duplicate Payment Block on Server): ${pass5 ? 'PASS' : 'FAIL'}`);
  console.log(`  - alreadyPaid: ${quoteAlreadyPaid.alreadyPaid} (Expected: true)`);
  console.log(`  - isCurrentPeriodPaid: ${quoteAlreadyPaid.isCurrentPeriodPaid} (Expected: true)`);
  console.log(`  - paidNotice: ${quoteAlreadyPaid.paidNotice}`);
  console.log(`  - nextDueDate: ${quoteAlreadyPaid.nextDueDate}`);
  if (!pass5) allPassed = false;

  // ----------------------------------------------------
  // TEST 6: Upgrade to Different Plan Still Works
  // Expectation: Selecting PKG-004 ($99.99) is treated as Package Plan Upgrade, NOT blocked
  // ----------------------------------------------------
  console.log('\n--- TEST 6: Upgrade to Higher Plan Still Works ---');
  const quoteUpgrade = await billing.calculateQuote({
    subscriberId: testSubId,
    packageId: 'PKG-004',
    purchaseType: 'UPGRADE',
  });

  const pass6 = (
    quoteUpgrade.badge === 'Package Plan Upgrade' &&
    quoteUpgrade.scenario === 'EXISTING_NORMAL' &&
    Number(quoteUpgrade.totalPayable) === 99.99 &&
    Number(quoteUpgrade.installationFee) === 0 &&
    Number(quoteUpgrade.taxFee) === 0 &&
    quoteUpgrade.alreadyPaid === false
  );

  console.log(`Test 6 (Upgrade to PKG-004): ${pass6 ? 'PASS' : 'FAIL'}`);
  console.log(`  - Badge: ${quoteUpgrade.badge} (Expected: Package Plan Upgrade)`);
  console.log(`  - Total Payable: $${quoteUpgrade.totalPayable} (Expected: $99.99)`);
  console.log(`  - alreadyPaid: ${quoteUpgrade.alreadyPaid} (Expected: false)`);
  if (!pass6) allPassed = false;

  // Cleanup test subscriber
  await pool.query('DELETE FROM billing_events WHERE subscriber_id = $1', [testSubId]);
  await pool.query('DELETE FROM payment_transactions WHERE subscriber_id = $1', [testSubId]);
  await pool.query('DELETE FROM invoices WHERE subscriber_id = $1', [testSubId]);
  await pool.query('DELETE FROM orders WHERE customer_id = $1', [testSubId]);
  await pool.query('DELETE FROM subscribers WHERE id = $1', [testSubId]);

  console.log('\n=========================================');
  console.log(`FINAL RESULT: ${allPassed ? 'ALL VERIFICATION TESTS PASSED (PASS)' : 'TESTS FAILED'}`);
  console.log('=========================================');

  await pool.end();
  process.exit(allPassed ? 0 : 1);
}

runTests().catch(err => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});

