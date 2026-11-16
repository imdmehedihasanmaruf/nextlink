'use strict';

/**
 * Unified Test Harness & Master Verification Runner
 *
 * Orchestrates all 4 automated verification suites:
 * 1. Admin Sidebar Routes & API Responses (Suite 1)
 * 2. Package Creation -> Website Reflection -> Onboarding (Suite 2)
 * 3. Automated Billing -> Invoice Generation -> Payment -> MikroTik Sync (Suite 3)
 * 4. Support Ticket Creation & Technician Assignment (Suite 4)
 *
 * Usage:
 *   node scripts/run-all-verifications.js
 */

const suite1 = require('./verify-admin-navigation');
const suite2 = require('./verify-package-onboarding');
const suite3 = require('./verify-billing-mikrotik');
const suite4 = require('./verify-tickets-technicians');

async function main() {
  const startTime = Date.now();
  console.log('======================================================================');
  console.log('             NEXTLINK PLATFORM - E2E AUTOMATED VERIFICATION           ');
  console.log('======================================================================');
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const results = [];

  try {
    results.push(await suite1.run());
  } catch (err) {
    console.error('Suite 1 failed to execute:', err);
    results.push({ suite: 'Admin Sidebar Routes & API Responses', passed: 0, failed: 1, failures: [{ label: err.message }] });
  }

  try {
    results.push(await suite2.run());
  } catch (err) {
    console.error('Suite 2 failed to execute:', err);
    results.push({ suite: 'Package Creation -> Onboarding', passed: 0, failed: 1, failures: [{ label: err.message }] });
  }

  try {
    results.push(await suite3.run());
  } catch (err) {
    console.error('Suite 3 failed to execute:', err);
    results.push({ suite: 'Automated Billing -> MikroTik Sync', passed: 0, failed: 1, failures: [{ label: err.message }] });
  }

  try {
    results.push(await suite4.run());
  } catch (err) {
    console.error('Suite 4 failed to execute:', err);
    results.push({ suite: 'Support Tickets & Technicians', passed: 0, failed: 1, failures: [{ label: err.message }] });
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  let totalPassed = 0;
  let totalFailed = 0;
  for (const r of results) {
    totalPassed += r.passed;
    totalFailed += r.failed;
  }

  console.log('\n======================================================================');
  console.log('                   FINAL VERIFICATION SUMMARY REPORT                  ');
  console.log('======================================================================');
  console.log(`Duration: ${durationSec}s`);
  console.log(`Total Checks Executed: ${totalPassed + totalFailed}`);
  console.log(`Passed: ${totalPassed}`);
  console.log(`Failed: ${totalFailed}`);
  console.log('----------------------------------------------------------------------');

  for (const r of results) {
    const statusLabel = r.failed === 0 ? '✓ PASS' : '✗ FAIL';
    console.log(`${statusLabel.padEnd(8)} | ${r.suite.padEnd(52)} | ${r.passed} passed, ${r.failed} failed`);
  }
  console.log('======================================================================\n');

  if (totalFailed > 0) {
    console.log('Regressions / Failures detected:');
    for (const r of results) {
      if (r.failed > 0 && r.failures) {
        console.log(`\n[${r.suite}]:`);
        for (const f of r.failures) {
          console.log(` - ${f.label}${f.extra ? ` -> ${JSON.stringify(f.extra)}` : ''}`);
        }
      }
    }
  }

  process.exit(totalFailed === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Master verification runner crashed:', err);
    process.exit(1);
  });
}

module.exports = { main };
