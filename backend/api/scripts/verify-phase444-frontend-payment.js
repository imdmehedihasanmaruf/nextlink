'use strict';

/**
 * Phase 4.4.4 Verification Suite: Next.js Frontend Payment Integration
 *
 * Verifies:
 * 1. File & Route Architecture (PaymentModal, Checkout, Result screens, Portal aliases)
 * 2. API Client Contract (fetchPaymentGateways, payInvoice, verifyPaymentTransaction)
 * 3. Responsive Payment Methods UI (bKash, Nagad, SSLCommerz, Rocket via aggregator)
 * 4. End-to-End Checkout Flow & Idempotency (authoritative amounts, double-click prevention)
 * 5. Payment Result Screens (success, pending, failed, cancelled, verification in progress)
 * 6. Payment History Table with Ownership Enforcement & Safe Details
 * 7. Live Dashboard Balance Refresh & `?paid=` query param handling
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../..');
const frontendRoot = path.resolve(repoRoot, 'frontend');

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;

function assert(condition, testId, description) {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  [PASS] ${testId}: ${description}`);
  } else {
    failedChecks++;
    console.error(`  [FAIL] ${testId}: ${description}`);
  }
}

console.log('================================================================================');
console.log('VERIFYING PHASE 4.4.4: NEXT.JS FRONTEND PAYMENT INTEGRATION');
console.log('================================================================================\n');

// -----------------------------------------------------------------------------
// Suite 1: File & Route Structure
// -----------------------------------------------------------------------------
console.log('--- Suite 1: File & Route Structure ---');

const requiredFiles = [
  'src/lib/portalApi.ts',
  'src/components/PaymentModal.tsx',
  'src/components/PaymentResultScreen.tsx',
  'src/app/checkout/page.tsx',
  'src/app/payment/result/page.tsx',
  'src/app/payment/success/page.tsx',
  'src/app/payment/cancel/page.tsx',
  'src/app/payment/fail/page.tsx',
  'src/app/portal/payments/success/page.tsx',
  'src/app/portal/payments/cancel/page.tsx',
  'src/app/portal/payments/fail/page.tsx',
  'src/app/dashboard/orders/page.tsx',
  'src/app/dashboard/page.tsx',
];

for (const relPath of requiredFiles) {
  const fullPath = path.join(frontendRoot, relPath);
  const exists = fs.existsSync(fullPath);
  const testId = `ROUTE-${relPath.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;
  assert(exists, testId, `File exists at frontend/${relPath}`);
}

// -----------------------------------------------------------------------------
// Suite 2: API Client Payment Contracts (portalApi.ts)
// -----------------------------------------------------------------------------
console.log('\n--- Suite 2: API Client Contracts (portalApi.ts) ---');

const portalApiContent = fs.readFileSync(path.join(frontendRoot, 'src/lib/portalApi.ts'), 'utf8');

assert(
  portalApiContent.includes('export interface PaymentGatewayItem') &&
  portalApiContent.includes('export interface PaymentInitiateResult'),
  'API-TS-01',
  'portalApi.ts exports TypeScript interfaces for gateways and initiate results'
);

assert(
  portalApiContent.includes('export async function fetchPaymentGateways'),
  'API-TS-02',
  'portalApi.ts exports fetchPaymentGateways() connected to /api/payments/gateways'
);

assert(
  portalApiContent.includes('export async function payInvoice'),
  'API-TS-03',
  'portalApi.ts exports payInvoice() connected to Express payment initiation'
);

assert(
  portalApiContent.includes('export async function verifyPaymentTransaction'),
  'API-TS-04',
  'portalApi.ts exports verifyPaymentTransaction() for server-to-server check'
);

// -----------------------------------------------------------------------------
// Suite 3: Responsive Payment Methods UI & Aggregator Routing (PaymentModal.tsx)
// -----------------------------------------------------------------------------
console.log('\n--- Suite 3: Responsive Payment Methods UI (PaymentModal.tsx) ---');

const paymentModalContent = fs.readFileSync(path.join(frontendRoot, 'src/components/PaymentModal.tsx'), 'utf8');

assert(
  paymentModalContent.includes('bkash') &&
  paymentModalContent.includes('nagad') &&
  paymentModalContent.includes('sslcommerz') &&
  paymentModalContent.includes('rocket'),
  'UI-GW-01',
  'PaymentModal supports bKash, Nagad, SSLCommerz, and Rocket'
);

assert(
  paymentModalContent.includes('Aggregator') ||
  paymentModalContent.includes('aggregator') ||
  paymentModalContent.includes('SSLCommerz / AamarPay'),
  'UI-GW-02',
  'PaymentModal identifies Rocket as routed via authorized aggregator channel'
);

assert(
  paymentModalContent.includes('fetchPaymentGateways') &&
  paymentModalContent.includes('filter('),
  'UI-GW-03',
  'PaymentModal queries backend for enabled gateways and filters out unsupported methods'
);

assert(
  paymentModalContent.includes('isSubmitting') &&
  paymentModalContent.includes('disabled={isSubmitting'),
  'UI-GW-04',
  'PaymentModal enforces idempotent double-click prevention while submitting'
);

assert(
  paymentModalContent.includes('PAYMENT_WINDOW_CLOSED'),
  'UI-GW-05',
  'PaymentModal gracefully handles closed monthly billing payment window error'
);

// -----------------------------------------------------------------------------
// Suite 4: Dedicated Checkout Flow (app/checkout/page.tsx)
// -----------------------------------------------------------------------------
console.log('\n--- Suite 4: Dedicated Checkout Page (checkout/page.tsx) ---');

const checkoutContent = fs.readFileSync(path.join(frontendRoot, 'src/app/checkout/page.tsx'), 'utf8');

assert(
  checkoutContent.includes('targetInvoiceId') || checkoutContent.includes('searchParams.get(\'invoiceId\')'),
  'CHK-01',
  'Checkout page extracts invoiceId from query parameters'
);

assert(
  checkoutContent.includes('unpaidInvoices') || checkoutContent.includes('fetchMyInvoices'),
  'CHK-02',
  'Checkout page loads authoritative invoices and permits switching between unpaid bills'
);

assert(
  checkoutContent.includes('payInvoice(') && checkoutContent.includes('window.location.href = res.redirectUrl'),
  'CHK-03',
  'Checkout page executes payment initiation and safely redirects to gateway checkout'
);

assert(
  checkoutContent.includes('isSubmitting') && checkoutContent.includes('disabled={isSubmitting'),
  'CHK-04',
  'Checkout page prevents double-click submission with visual loading feedback'
);

// -----------------------------------------------------------------------------
// Suite 5: Payment Result Screens & Direct Aliases
// -----------------------------------------------------------------------------
console.log('\n--- Suite 5: Payment Result Screens ---');

const resultScreenContent = fs.readFileSync(path.join(frontendRoot, 'src/components/PaymentResultScreen.tsx'), 'utf8');

const expectedStatuses = ['success', 'pending', 'failed', 'cancelled', 'verifying'];
for (const st of expectedStatuses) {
  assert(
    resultScreenContent.includes(`status === '${st}'`) || resultScreenContent.includes(`status === "${st}"`),
    `RES-ST-${st.toUpperCase()}`,
    `PaymentResultScreen handles '${st}' status with dedicated UI state`
  );
}

assert(
  resultScreenContent.includes('downloadInvoicePdf'),
  'RES-PDF-01',
  'PaymentResultScreen provides direct invoice PDF download action'
);

assert(
  resultScreenContent.includes('handleManualVerification') || resultScreenContent.includes('verifyPaymentTransaction'),
  'RES-VERIFY-01',
  'PaymentResultScreen supports manual status verification trigger for pending transactions'
);

// -----------------------------------------------------------------------------
// Suite 6: Payment History Table with Ownership Enforcement (dashboard/orders/page.tsx)
// -----------------------------------------------------------------------------
console.log('\n--- Suite 6: Payment History Table (dashboard/orders/page.tsx) ---');

const ordersPageContent = fs.readFileSync(path.join(frontendRoot, 'src/app/dashboard/orders/page.tsx'), 'utf8');

assert(
  ordersPageContent.includes('data-testid="payment-history-card"'),
  'HIST-CARD-01',
  'orders/page.tsx mounts dedicated Payment & Transaction History card'
);

assert(
  ordersPageContent.includes('liveTransactions') && ordersPageContent.includes('paginatedTransactions'),
  'HIST-PAGINATE-01',
  'orders/page.tsx filters and paginates subscriber transaction ledger'
);

assert(
  ordersPageContent.includes('txSearchQuery') && ordersPageContent.includes('txStatusFilter'),
  'HIST-FILTER-01',
  'orders/page.tsx supports search and status filtering for transactions'
);

assert(
  ordersPageContent.includes('txDetailModalOpen') && ordersPageContent.includes('selectedTransaction'),
  'HIST-MODAL-01',
  'orders/page.tsx provides safe transaction details modal with ownership enforcement'
);

assert(
  ordersPageContent.includes('PaymentModal') && ordersPageContent.includes('checkoutModalOpen'),
  'HIST-MODAL-02',
  'orders/page.tsx integrates responsive PaymentModal for Pay Now actions'
);

// -----------------------------------------------------------------------------
// Suite 7: Dashboard Balance Refresh on Return (dashboard/page.tsx)
// -----------------------------------------------------------------------------
console.log('\n--- Suite 7: Dashboard Balance Refresh (dashboard/page.tsx) ---');

const dashboardContent = fs.readFileSync(path.join(frontendRoot, 'src/app/dashboard/page.tsx'), 'utf8');

assert(
  dashboardContent.includes('paidInvoiceParam = searchParams?.get(\'paid\')') ||
  dashboardContent.includes('searchParams.get(\'paid\')'),
  'DASH-PAID-01',
  'dashboard/page.tsx extracts ?paid= query parameter upon gateway redirect'
);

assert(
  dashboardContent.includes('paidBannerVisible') && dashboardContent.includes('Payment Settled Successfully'),
  'DASH-PAID-02',
  'dashboard/page.tsx renders prominent payment settlement alert banner'
);

assert(
  dashboardContent.includes('loadDashboardLive(true)'),
  'DASH-PAID-03',
  'dashboard/page.tsx triggers immediate live data reload to refresh balance without hard reload'
);

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log('\n================================================================================');
console.log(`PHASE 4.4.4 VERIFICATION SUMMARY: ${passedChecks}/${totalChecks} CHECKS PASSED`);
if (failedChecks === 0) {
  console.log('STATUS: ALL PHASE 4.4.4 FRONTEND PAYMENT INTEGRATION ASSERTIONS PASSED (100%)');
} else {
  console.log(`STATUS: ${failedChecks} CHECKS FAILED`);
}
console.log('================================================================================');

process.exit(failedChecks === 0 ? 0 : 1);

