'use strict';

/**
 * Phase 4.6 Master Staging & Full Integration QA Verification Runner
 * Runs all integration suites sequentially in-process and verifies zero regressions.
 */

const paritySuite = require('./verify-phase45-laravel-parity');
const phase445Suite = require('./verify-phase445-payment-operations');
const workflowsSuite = require('./verify-phase46-workflows');
const servicesQueueSuite = require('./verify-phase46-services-queue');
const qaSecuritySuite = require('./verify-phase46-qa-security');
const laravelFoundationSuite = require('./verify-laravel-foundation');

async function runMasterVerification() {
  console.log('======================================================================');
  console.log('=== PHASE 4.6 MASTER INTEGRATION & STAGING QA VERIFICATION RUNNER ===');
  console.log('======================================================================\n');

  const suiteResults = [];

  // 1. Laravel Foundation Suite
  console.log('\n>>> RUNNING SUITE 1: Laravel Foundation & Architecture Parity <<<');
  try {
    const res1 = await laravelFoundationSuite.run();
    suiteResults.push({ name: 'Laravel Foundation & Dual Guard Architecture', ...res1 });
  } catch (err) {
    console.error('Suite 1 error:', err);
    suiteResults.push({ name: 'Laravel Foundation & Dual Guard Architecture', passed: 0, failed: 1, error: err.message });
  }

  // 2. Parity Suite
  console.log('\n>>> RUNNING SUITE 2: Express vs Laravel 13 Parity (20 Domains) <<<');
  try {
    const res2 = await paritySuite.run();
    suiteResults.push({ name: 'Express vs Laravel API Parity Suite', ...res2 });
  } catch (err) {
    console.error('Suite 2 error:', err);
    suiteResults.push({ name: 'Express vs Laravel API Parity Suite', passed: 0, failed: 1, error: err.message });
  }

  // 3. Payment Operations & Webhook Reliability Suite
  console.log('\n>>> RUNNING SUITE 3: Payment Operations & Webhook Reliability <<<');
  try {
    const res3 = await phase445Suite.run();
    suiteResults.push({ name: 'Payment Operations & Webhook Reliability', ...res3 });
  } catch (err) {
    console.error('Suite 3 error:', err);
    suiteResults.push({ name: 'Payment Operations & Webhook Reliability', passed: 0, failed: 1, error: err.message });
  }

  // 4. Workflows Suite
  console.log('\n>>> RUNNING SUITE 4: Full End-to-End Workflows (A, B, C, D) <<<');
  try {
    const res4 = await workflowsSuite.run();
    suiteResults.push({ name: 'Workflows A, B, C, D End-to-End', ...res4 });
  } catch (err) {
    console.error('Suite 4 error:', err);
    suiteResults.push({ name: 'Workflows A, B, C, D End-to-End', passed: 0, failed: 1, error: err.message });
  }

  // 5. Services, MikroTik, SMS, Queue & Scheduler Suite
  console.log('\n>>> RUNNING SUITE 5: Services, MikroTik Simulator, SMS, Queue & Scheduler <<<');
  try {
    const res5 = await servicesQueueSuite.run();
    suiteResults.push({ name: 'Services, MikroTik, SMS, Queue & Scheduler', ...res5 });
  } catch (err) {
    console.error('Suite 5 error:', err);
    suiteResults.push({ name: 'Services, MikroTik, SMS, Queue & Scheduler', passed: 0, failed: 1, error: err.message });
  }

  // 6. QA, Security & Database Integrity Suite
  console.log('\n>>> RUNNING SUITE 6: QA, Security & Database Integrity Audit <<<');
  try {
    const res6 = await qaSecuritySuite.run();
    suiteResults.push({ name: 'QA, Security & Database Integrity Audit', ...res6 });
  } catch (err) {
    console.error('Suite 6 error:', err);
    suiteResults.push({ name: 'QA, Security & Database Integrity Audit', passed: 0, failed: 1, error: err.message });
  }

  console.log('\n======================================================================');
  console.log('=== PHASE 4.6 MASTER INTEGRATION RUN SUMMARY                       ===');
  console.log('======================================================================');

  let totalPassed = 0;
  let totalFailed = 0;

  for (const s of suiteResults) {
    console.log(`- ${s.name}: ${s.passed || 0} passed, ${s.failed || 0} failed`);
    totalPassed += (s.passed || 0);
    totalFailed += (s.failed || 0);
  }

  console.log(`\nTOTAL CHECKS: ${totalPassed + totalFailed} | PASSED: ${totalPassed} | FAILED: ${totalFailed}`);

  if (totalFailed === 0) {
    console.log('\n>>> ALL SUITES PASSED! SYSTEM READY FOR PHASE 4.7 CUTOVER PLANNING <<<\n');
  }

  return { totalPassed, totalFailed, suiteResults };
}

if (require.main === module) {
  runMasterVerification()
    .then((res) => {
      process.exit(res.totalFailed === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error('Master runner failed:', err);
      process.exit(1);
    });
}

module.exports = { run: runMasterVerification };
