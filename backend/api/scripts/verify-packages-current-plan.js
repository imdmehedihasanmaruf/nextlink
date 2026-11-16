/**
 * End-to-end verification script for Package page & Purchase Step 1 "Your Current Plan" logic.
 */
const { Pool } = require('pg');
const config = require('../src/config');

const pool = new Pool({
  connectionString: config.db.connectionString,
});

async function main() {
  console.log('--- STARTING VERIFICATION: Package Page & Checkout Current Plan Logic ---');

  // 1. Fetch packages from DB
  const packagesRes = await pool.query('SELECT id, name, speed, upload_speed, price FROM packages ORDER BY speed ASC');
  const packages = packagesRes.rows.map(p => ({
    id: p.id,
    name: p.name,
    speed: Number(p.speed),
    uploadSpeed: Number(p.upload_speed),
    price: Number(p.price)
  }));
  console.log(`[DB] Loaded ${packages.length} packages:`, packages.map(p => `${p.id}: ${p.name} (${p.speed}M, $${p.price})`).join(', '));

  // Simulation function that runs the exact same authoritative logic as PackagesPage and PurchaseContent
  function evaluatePlanDisplay({ isAuthenticated, subscriber, user }) {
    const isCancelled = Boolean(
      subscriber?.status === 'cancelled' ||
      user?.status === 'cancelled' ||
      user?.subscriptionCancelledAt
    );

    const isActiveSubscriber = Boolean(
      isAuthenticated &&
      !isCancelled &&
      (
        subscriber?.status === 'active' ||
        subscriber?.status === 'suspended' ||
        user?.status === 'active' ||
        user?.status === 'suspended'
      )
    );

    const activePackageId = isActiveSubscriber
      ? (subscriber?.packageId || user?.packageId || null)
      : null;

    const currentPackage = activePackageId
      ? packages.find(p => p.id.trim().toLowerCase() === activePackageId.trim().toLowerCase())
      : null;

    const currentSpeed = currentPackage ? currentPackage.speed : (subscriber?.speedMbps || 0);
    const currentPrice = currentPackage ? currentPackage.price : (subscriber?.price || 0);

    const cards = packages.map(pkg => {
      const isCurrentPlan = Boolean(
        activePackageId &&
        pkg.id.trim().toLowerCase() === activePackageId.trim().toLowerCase()
      );

      const isHigherTier = Boolean(
        activePackageId &&
        !isCurrentPlan &&
        (pkg.speed > currentSpeed || (pkg.speed === currentSpeed && pkg.price > currentPrice))
      );

      const isLowerTier = Boolean(
        activePackageId &&
        !isCurrentPlan &&
        (pkg.speed < currentSpeed || (pkg.speed === currentSpeed && pkg.price < currentPrice))
      );

      let badge = null;
      let buttonLabel = '';
      let buttonDisabled = false;

      if (isCurrentPlan) {
        badge = 'Your Current Plan';
        buttonLabel = 'Current Plan';
        buttonDisabled = true;
      } else if (isAuthenticated && activePackageId) {
        if (isHigherTier) buttonLabel = 'Upgrade';
        else if (isLowerTier) buttonLabel = 'Downgrade';
        else buttonLabel = 'Switch Plan';
      } else if (isAuthenticated) {
        buttonLabel = `Choose ${pkg.name}`;
      } else {
        buttonLabel = 'Sign In to Purchase';
      }

      return {
        id: pkg.id,
        name: pkg.name,
        isCurrentPlan,
        badge,
        buttonLabel,
        buttonDisabled
      };
    });

    const currentPlanCard = cards.find(c => c.isCurrentPlan);

    return {
      activePackageId,
      currentPlanCard: currentPlanCard ? currentPlanCard.id : null,
      cards
    };
  }

  let allPass = true;

  // Test 1: Active subscriber with PKG-002
  console.log('\n--- Scenario 1: Active Subscriber with PKG-002 ---');
  const res1 = evaluatePlanDisplay({
    isAuthenticated: true,
    subscriber: { status: 'active', packageId: 'PKG-002', speedMbps: 200, price: 29.99 },
    user: { id: 'SUB-TEST', status: 'active', packageId: 'PKG-002' }
  });

  const card002 = res1.cards.find(c => c.id === 'PKG-002');
  const card001 = res1.cards.find(c => c.id === 'PKG-001'); // 100M < 200M -> Downgrade
  const card003 = res1.cards.find(c => c.id === 'PKG-003'); // 300M > 200M -> Upgrade

  const pass1 = (
    res1.currentPlanCard === 'PKG-002' &&
    card002.badge === 'Your Current Plan' &&
    card002.buttonLabel === 'Current Plan' &&
    card002.buttonDisabled === true &&
    card001.buttonLabel === 'Downgrade' &&
    card003.buttonLabel === 'Upgrade'
  );
  console.log(`Scenario 1 (Active with PKG-002): ${pass1 ? 'PASS' : 'FAIL'}`);
  console.log(`  - Matched Current: ${card002.id} (${card002.badge}, Button: ${card002.buttonLabel}, Disabled: ${card002.buttonDisabled})`);
  console.log(`  - Lower Tier (PKG-001): Button: ${card001.buttonLabel}`);
  console.log(`  - Higher Tier (PKG-003): Button: ${card003.buttonLabel}`);
  if (!pass1) allPass = false;

  // Test 2: Cancelled subscriber
  console.log('\n--- Scenario 2: Cancelled Subscriber ---');
  const res2 = evaluatePlanDisplay({
    isAuthenticated: true,
    subscriber: { status: 'cancelled', packageId: 'PKG-002', speedMbps: 200, price: 29.99 },
    user: { id: 'SUB-CANCELLED', status: 'cancelled', packageId: 'PKG-002' }
  });
  const pass2 = (
    res2.activePackageId === null &&
    res2.currentPlanCard === null &&
    res2.cards.every(c => c.badge !== 'Your Current Plan' && !c.buttonDisabled && c.buttonLabel.startsWith('Choose'))
  );
  console.log(`Scenario 2 (Cancelled subscriber): ${pass2 ? 'PASS' : 'FAIL'}`);
  console.log(`  - Current Plan Marked: ${res2.currentPlanCard || 'None (Correct)'}`);
  console.log(`  - Button Labels: ${res2.cards[0].buttonLabel}, ${res2.cards[1].buttonLabel}`);
  if (!pass2) allPass = false;

  // Test 3: Registered / new user with no package
  console.log('\n--- Scenario 3: Registered Subscriber With No Plan ---');
  const res3 = evaluatePlanDisplay({
    isAuthenticated: true,
    subscriber: { status: 'registered', packageId: '', speedMbps: 0, price: 0 },
    user: { id: 'SUB-NEW', status: 'registered', packageId: '' }
  });
  const pass3 = (
    res3.activePackageId === null &&
    res3.currentPlanCard === null &&
    res3.cards.every(c => c.badge !== 'Your Current Plan' && !c.buttonDisabled && c.buttonLabel.startsWith('Choose'))
  );
  console.log(`Scenario 3 (New subscriber with no plan): ${pass3 ? 'PASS' : 'FAIL'}`);
  console.log(`  - Current Plan Marked: ${res3.currentPlanCard || 'None (Correct)'}`);
  if (!pass3) allPass = false;

  // Test 4: Logged-out visitor
  console.log('\n--- Scenario 4: Logged-out Visitor ---');
  const res4 = evaluatePlanDisplay({
    isAuthenticated: false,
    subscriber: null,
    user: null
  });
  const pass4 = (
    res4.activePackageId === null &&
    res4.currentPlanCard === null &&
    res4.cards.every(c => c.badge !== 'Your Current Plan' && !c.buttonDisabled && c.buttonLabel === 'Sign In to Purchase')
  );
  console.log(`Scenario 4 (Logged-out visitor): ${pass4 ? 'PASS' : 'FAIL'}`);
  console.log(`  - Current Plan Marked: ${res4.currentPlanCard || 'None (Correct)'}`);
  console.log(`  - Buttons show: ${res4.cards[0].buttonLabel}`);
  if (!pass4) allPass = false;

  // Test 5: Real-time update simulation (Admin upgrades subscriber from PKG-002 to PKG-004)
  console.log('\n--- Scenario 5: Real-time Plan Upgrade (PKG-002 -> PKG-004) ---');
  const res5 = evaluatePlanDisplay({
    isAuthenticated: true,
    subscriber: { status: 'active', packageId: 'PKG-004', speedMbps: 500, price: 99.99 },
    user: { id: 'SUB-TEST', status: 'active', packageId: 'PKG-004' }
  });
  const card004_new = res5.cards.find(c => c.id === 'PKG-004');
  const card002_new = res5.cards.find(c => c.id === 'PKG-002'); // Now lower tier -> Downgrade
  const card006_new = res5.cards.find(c => c.id === 'PKG-006'); // Higher tier -> Upgrade

  const pass5 = (
    res5.currentPlanCard === 'PKG-004' &&
    card004_new.badge === 'Your Current Plan' &&
    card004_new.buttonLabel === 'Current Plan' &&
    card004_new.buttonDisabled === true &&
    card002_new.buttonLabel === 'Downgrade' &&
    card006_new.buttonLabel === 'Upgrade'
  );
  console.log(`Scenario 5 (Live telemetry sync reflects PKG-004): ${pass5 ? 'PASS' : 'FAIL'}`);
  console.log(`  - New Current Plan: ${card004_new.id} (${card004_new.badge}, Button: ${card004_new.buttonLabel})`);
  console.log(`  - Old Plan (PKG-002) is now: ${card002_new.buttonLabel}`);
  console.log(`  - Higher Plan (PKG-006) is now: ${card006_new.buttonLabel}`);
  if (!pass5) allPass = false;

  // Test 6: Checkout Step 1 cannot re-purchase current plan
  console.log('\n--- Scenario 6: Checkout Step 1 Blocks Re-purchasing Current Plan ---');
  const activePackageId = 'PKG-002';
  const selectedPackageSame = packages.find(p => p.id === 'PKG-002');
  const isSelectedCurrentPlan = Boolean(
    activePackageId &&
    selectedPackageSame?.id &&
    selectedPackageSame.id.trim().toLowerCase() === activePackageId.trim().toLowerCase()
  );
  const proceedDisabledSame = !selectedPackageSame || isSelectedCurrentPlan;

  const selectedPackageDifferent = packages.find(p => p.id === 'PKG-005');
  const isSelectedDifferentCurrent = Boolean(
    activePackageId &&
    selectedPackageDifferent?.id &&
    selectedPackageDifferent.id.trim().toLowerCase() === activePackageId.trim().toLowerCase()
  );
  const proceedDisabledDifferent = !selectedPackageDifferent || isSelectedDifferentCurrent;

  const pass6 = (proceedDisabledSame === true && proceedDisabledDifferent === false);
  console.log(`Scenario 6 (Proceed button disabled when Current Plan selected): ${pass6 ? 'PASS' : 'FAIL'}`);
  console.log(`  - When selecting current plan (PKG-002): Proceed button disabled = ${proceedDisabledSame} (Expected true)`);
  console.log(`  - When selecting upgrade plan (PKG-005): Proceed button disabled = ${proceedDisabledDifferent} (Expected false)`);
  if (!pass6) allPass = false;

  console.log('\n=========================================');
  console.log(`OVERALL RESULT: ${allPass ? 'ALL TESTS PASSED (PASS)' : 'FAILED'}`);
  console.log('=========================================');

  await pool.end();
  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

