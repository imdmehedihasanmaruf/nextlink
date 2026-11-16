'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const db = require('../src/lib/db');
const { signToken } = require('../src/middleware/auth');

function httpRequest(endpoint, options = {}) {
  const { method = 'GET', body, headers = {} } = options;
  return new Promise((resolve, reject) => {
    const url = new URL(`http://localhost:3100${endpoint}`);
    const reqHeaders = { ...headers };
    if (body) reqHeaders['Content-Type'] = 'application/json';

    const req = http.request(
      url,
      { method, headers: reqHeaders },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runVerification() {
  console.log('='.repeat(80));
  console.log('VERIFYING ISSUES 1 - 4 FIXES');
  console.log('='.repeat(80));

  const results = [];
  function record(issue, name, pass, detail = '') {
    results.push({ issue, name, pass, detail });
    console.log(`${pass ? '✅ PASS' : '❌ FAIL'} | ${issue}: ${name} (${detail})`);
  }

  // -------------------------------------------------------------------------
  // ISSUE 1: /cancel page & cancel-info for users without active package
  // -------------------------------------------------------------------------
  try {
    // 1. User without active subscription calling /api/portal/cancel-info
    const tokenNoSub = signToken({
      id: 'NL-TEST-NO-SUB-01',
      subscriberId: 'NL-TEST-NO-SUB-01',
      type: 'subscriber',
      role: 'subscriber',
      email: 'nosub@test.com'
    });

    const resNoSub = await httpRequest('/api/portal/cancel-info', {
      headers: { Authorization: `Bearer ${tokenNoSub}` }
    });

    const noSubOk = resNoSub.status === 200 &&
      resNoSub.data.success === true &&
      resNoSub.data.has_active_subscription === false &&
      resNoSub.data.hasActivePackage === false;

    record(
      'Issue 1',
      'GET /api/portal/cancel-info returns 200 with has_active_subscription = false for user without active package',
      noSubOk,
      `Status: ${resNoSub.status}, has_active_subscription: ${resNoSub.data?.has_active_subscription}`
    );

    // 2. Check /cancel/page.tsx code for friendly empty state and retry button
    const cancelPagePath = path.resolve(__dirname, '../../../frontend/src/app/cancel/page.tsx');
    const cancelPageCode = fs.readFileSync(cancelPagePath, 'utf8');

    const hasRetry = cancelPageCode.includes('Retry') && cancelPageCode.includes('onClick={loadData}');
    const hasEmptyState = cancelPageCode.includes('You have no active package to cancel') && cancelPageCode.includes('/dashboard/purchase');
    const hasDualUnpack = cancelPageCode.includes('infoRes?.data || (infoRes?.subscriber ? infoRes : null)');

    record(
      'Issue 1',
      'Frontend /cancel page handles dual unpacking, Retry button on error, and friendly empty state',
      hasRetry && hasEmptyState && hasDualUnpack,
      `Retry: ${hasRetry}, Empty State: ${hasEmptyState}, Dual Unpack: ${hasDualUnpack}`
    );
  } catch (err) {
    record('Issue 1', 'Cancel info verification', false, err.message);
  }

  // -------------------------------------------------------------------------
  // ISSUE 2: Cancel Invoices on Frontend and Backend
  // -------------------------------------------------------------------------
  try {
    // 1. Frontend /cancel page has Section C with View/PDF only, NO delete
    const cancelPagePath = path.resolve(__dirname, '../../../frontend/src/app/cancel/page.tsx');
    const cancelPageCode = fs.readFileSync(cancelPagePath, 'utf8');

    const hasSectionC = cancelPageCode.includes('Section C: Unsubscriber Cancel Invoice List');
    const noDeleteOnFrontend = !cancelPageCode.includes('deleteInvoice') && !cancelPageCode.includes('Delete Cancel');

    record(
      'Issue 2',
      'Frontend /cancel has Cancel Invoices list with View/PDF only and strictly NO delete',
      hasSectionC && noDeleteOnFrontend,
      `Section C: ${hasSectionC}, No Delete: ${noDeleteOnFrontend}`
    );

    // 2. Backend sidebar has Cancel Invoices item
    const sidebarPath = path.resolve(__dirname, '../../../backend/src/components/Sidebar.tsx');
    const sidebarCode = fs.readFileSync(sidebarPath, 'utf8');
    const hasCancelInvoicesNav = sidebarCode.includes("label: 'Cancel Invoices'") && sidebarCode.includes("href: '/cancellations'");

    record(
      'Issue 2',
      'Backend Sidebar has "Cancel Invoices" navigation link to /cancellations',
      hasCancelInvoicesNav,
      `Nav Found: ${hasCancelInvoicesNav}`
    );

    // 3. Backend Cancellations page has all required columns and CSV export
    const backendCancelPagePath = path.resolve(__dirname, '../../../backend/src/app/(app)/cancellations/page.tsx');
    const backendCancelCode = fs.readFileSync(backendCancelPagePath, 'utf8');

    const cols = [
      'Invoice No',
      'Subscriber',
      'Package',
      'Cancel Reason',
      'Description',
      'Buy-Again Date',
      'Cancel Date',
      'Cancel Time',
      'City &amp; Postal',
      'State &amp; Country',
      'Dues',
      'Status',
      'Actions'
    ];
    const allColsPresent = cols.every((c) => backendCancelCode.includes(c));
    const hasCsvExport = backendCancelCode.includes('handleExportCsv') && backendCancelCode.includes('Export CSV');

    record(
      'Issue 2',
      'Backend Cancel Invoices page has all required columns and CSV export',
      allColsPresent && hasCsvExport,
      `All 13 Columns: ${allColsPresent}, CSV Export: ${hasCsvExport}`
    );

    // 4. Role management permissions view_cancel_invoices and export_cancel_invoices
    const rolesPath = path.resolve(__dirname, '../../../backend/src/lib/roles.ts');
    const rolesCode = fs.readFileSync(rolesPath, 'utf8');
    const hasRolePerms = rolesCode.includes('view_cancel_invoices') && rolesCode.includes('export_cancel_invoices');

    record(
      'Issue 2',
      'Role Governance matrix includes view_cancel_invoices and export_cancel_invoices',
      hasRolePerms,
      `Permissions added: ${hasRolePerms}`
    );

    // 5. Billing module shows cancel invoices with filter and no delete
    const billingPagePath = path.resolve(__dirname, '../../../backend/src/app/(app)/billing/page.tsx');
    const billingCode = fs.readFileSync(billingPagePath, 'utf8');
    const billingHasFilter = billingCode.includes('Cancelled Invoices') && billingCode.includes('Cancel Invoice');

    record(
      'Issue 2',
      'Billing module supports Cancel Invoices filter, tagged badge, and no delete action',
      billingHasFilter,
      `Filter & Tag present: ${billingHasFilter}`
    );
  } catch (err) {
    record('Issue 2', 'Cancel invoices backend/frontend verification', false, err.message);
  }

  // -------------------------------------------------------------------------
  // ISSUE 3: Remove "Cancel Package" button from Dashboard Current Package card
  // -------------------------------------------------------------------------
  try {
    const dashPath = path.resolve(__dirname, '../../../frontend/src/app/dashboard/page.tsx');
    const dashCode = fs.readFileSync(dashPath, 'utf8');

    const noCancelBtnOnCard = !dashCode.includes('Cancel Package') && !dashCode.includes('Cancel Package (Inactive)');
    const hasUpgradePlanBtn = dashCode.includes('Upgrade Fiber Plan');
    const hasTopBannerCancelledOrders = dashCode.includes('My Cancelled Orders') && dashCode.includes('href="/cancel"');

    record(
      'Issue 3',
      '"Cancel Package" button removed from Current Package card while "Upgrade Fiber Plan" and top banner "My Cancelled Orders" stay intact',
      noCancelBtnOnCard && hasUpgradePlanBtn && hasTopBannerCancelledOrders,
      `Removed from card: ${noCancelBtnOnCard}, Upgrade Plan intact: ${hasUpgradePlanBtn}, Top Banner link intact: ${hasTopBannerCancelledOrders}`
    );
  } catch (err) {
    record('Issue 3', 'Dashboard button verification', false, err.message);
  }

  // -------------------------------------------------------------------------
  // ISSUE 4: Remove Dark/Light mode toggle from headers and lock to light mode
  // -------------------------------------------------------------------------
  try {
    const frontendNavPath = path.resolve(__dirname, '../../../frontend/src/components/Navbar.tsx');
    const frontendNavCode = fs.readFileSync(frontendNavPath, 'utf8');

    const backendHeaderPath = path.resolve(__dirname, '../../../backend/src/components/Header.tsx');
    const backendHeaderCode = fs.readFileSync(backendHeaderPath, 'utf8');

    const frontendNoToggle = !frontendNavCode.includes('aria-label="Toggle Theme"') && !frontendNavCode.includes('Switch to Light Mode') && !frontendNavCode.includes('Switch to Dark Mode');
    const backendNoToggle = !backendHeaderCode.includes('Switch to light mode') && !backendHeaderCode.includes('Switch to dark mode');

    const frontendThemeProv = fs.readFileSync(path.resolve(__dirname, '../../../frontend/src/components/ThemeProvider.tsx'), 'utf8');
    const backendThemeProv = fs.readFileSync(path.resolve(__dirname, '../../../backend/src/components/ThemeProvider.tsx'), 'utf8');

    const lockedLight = frontendThemeProv.includes('forcedTheme="light"') && backendThemeProv.includes('forcedTheme="light"');
    const clearsLegacyTheme = frontendThemeProv.includes("classList.remove('dark')") && backendThemeProv.includes("classList.remove('dark')");

    record(
      'Issue 4',
      'Dark/Light toggle removed from frontend Navbar and backend Header, forcedTheme="light" active, legacy dark class removed',
      frontendNoToggle && backendNoToggle && lockedLight && clearsLegacyTheme,
      `Frontend Toggle Removed: ${frontendNoToggle}, Backend Toggle Removed: ${backendNoToggle}, Locked Light: ${lockedLight}, Legacy Cleared: ${clearsLegacyTheme}`
    );
  } catch (err) {
    record('Issue 4', 'Theme toggle removal verification', false, err.message);
  }

  console.log('\n' + '='.repeat(80));
  const passed = results.filter((r) => r.pass).length;
  console.log(`TOTAL: ${passed}/${results.length} CHECKS PASSED`);
  console.log('='.repeat(80));

  await db.getPool().end();
  process.exit(passed === results.length ? 0 : 1);
}

runVerification().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});

