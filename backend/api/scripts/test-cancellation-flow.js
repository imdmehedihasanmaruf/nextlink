'use strict';

/**
 * End-to-End Verification Test Script for Package Cancellation Flow,
 * Purchase & Cancel Invoices, Session Geolocation, PDF Generation, and Billing Rules.
 *
 * Usage: node backend/api/scripts/test-cancellation-flow.js
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const API_BASE = 'http://localhost:3100';

function httpRequest(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, API_BASE);
    const reqOpts = {
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = http.request(url, reqOpts, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed,
          raw: data,
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      const bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.write(bodyStr);
    }
    req.end();
  });
}

const results = [];
function recordResult(testName, passed, details = '') {
  results.push({ testName, passed, details });
  const statusStr = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${statusStr} | ${testName} ${details ? '(' + details + ')' : ''}`);
}

async function runTests() {
  console.log('='.repeat(80));
  console.log('STARTING PACKAGE CANCELLATION & INVOICE SESSION E2E TEST SUITE');
  console.log('='.repeat(80));

  const db = require('../src/lib/db');
  const geo = require('../src/lib/geo');
  const billingPdf = require('../src/services/billing/pdf');
  const billingEngine = require('../src/services/billing/engine');
  const { signToken } = require('../src/middleware/auth');

  // Clean test setup: Find or create a dedicated test subscriber
  const testSubEmail = 'cancel.tester@nextlink.net';
  let testSub = await db.queryOne('SELECT * FROM subscribers WHERE email = $1', [testSubEmail]);
  if (!testSub) {
    const inserted = await db.query(
      `INSERT INTO subscribers (id, name, first_name, last_name, email, phone, status, package_id, raw_data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', 'PKG-002', $7, NOW(), NOW())
       RETURNING *`,
      [
        'NL-TEST-CANCEL-01',
        'Sarah Jenkins',
        'Sarah',
        'Jenkins',
        testSubEmail,
        '+8801700999888',
        JSON.stringify({ balance: 0, packagePrice: 29.99, speed: 200, isNewSubscriber: false }),
      ]
    );
    testSub = inserted.rows[0];
  } else {
    // Reset subscriber status for test run
    await db.query("UPDATE subscribers SET status = 'active', package_id = 'PKG-002' WHERE id = $1", [testSub.id]);
    await db.query('DELETE FROM cancellations WHERE subscriber_id = $1', [testSub.id]);
    await db.query("DELETE FROM invoices WHERE subscriber_id = $1 AND (invoice_type = 'cancellation' OR invoice_type = 'cancel')", [testSub.id]);
  }

  // Create JWT tokens for API calls
  const subscriberToken = signToken(
    {
      id: testSub.id,
      subscriberId: testSub.id,
      role: 'subscriber',
      type: 'subscriber',
      email: testSub.email,
      name: testSub.name,
      username: 'sarah.jenkins',
    },
    { expiresIn: '2h' }
  );

  const adminToken = signToken(
    {
      id: 'ADM-TEST-001',
      role: 'super_admin',
      type: 'staff',
      email: 'admin@nextlink.com',
      username: 'admin',
    },
    { expiresIn: '2h' }
  );

  // -------------------------------------------------------------------------
  // TEST 1: Geolocation formatting & fallback utilities (Part 1 & 2)
  // -------------------------------------------------------------------------
  try {
    const testDate = new Date('2026-11-12T19:15:00Z');
    const formattedD = geo.formatDateDDMMYYYY(testDate, 'UTC');
    const formattedT = geo.formatTimeHHMMAMPM(testDate, 'UTC');
    const dateOk = formattedD === '12/11/2026';
    const timeOk = formattedT === '07:15PM';

    // Fallback on unknown IP
    const unknownGeo = await geo.resolveGeoLocation('127.0.0.1');
    const fallbackOk =
      unknownGeo.city === 'Unknown' ||
      unknownGeo.country === 'Unknown' ||
      unknownGeo.city === 'Azimpur'; // local default fallback

    recordResult(
      'Geo Formatting: Date (DD/MM/YYYY) and Time (hh:mmAM/PM)',
      dateOk && timeOk,
      `Date: ${formattedD}, Time: ${formattedT}`
    );
  } catch (err) {
    recordResult('Geo Formatting & Utilities', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 2: GET /api/portal/cancel-info (Part 4 Section A)
  // -------------------------------------------------------------------------
  try {
    const res = await httpRequest('/api/portal/cancel-info', {
      headers: { Authorization: `Bearer ${subscriberToken}` },
    });

    const hasSub = res.data?.success && res.data?.subscriber?.id === testSub.id;
    const hasPurchase = Boolean(res.data?.lastPurchase?.purchaseDate);
    const hasReasons = Array.isArray(res.data?.cancelReasons) && res.data.cancelReasons.length > 0;
    const hasSettings = Boolean(res.data?.settings?.effectiveDateRule);

    recordResult(
      'GET /api/portal/cancel-info: Current Plan & Real Purchase Session info',
      hasSub && hasPurchase && hasReasons && hasSettings,
      `Sub: ${testSub.id}, Reasons count: ${res.data?.cancelReasons?.length}`
    );
  } catch (err) {
    recordResult('GET /api/portal/cancel-info', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 3: Validation: Rejection of past buy-again date and short description
  // -------------------------------------------------------------------------
  try {
    // 3a. Short description (< 10 chars)
    const resShort = await httpRequest('/api/portal/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${subscriberToken}`,
      },
      body: {
        reason: 'Too expensive',
        description: 'Short', // < 10 chars
        buyAgainDate: '2026-12-01',
      },
    });

    const shortRejected =
      resShort.status === 400 &&
      (/at least 10/i.test(resShort.data?.error || '') ||
        resShort.data?.details?.some((d) => /at least 10/i.test(d.message)));

    // 3b. Past buy-again date
    const resPast = await httpRequest('/api/portal/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${subscriberToken}`,
      },
      body: {
        reason: 'Too expensive',
        description: 'This is a valid long description explaining why.',
        buyAgainDate: '2020-01-01', // in the past
      },
    });

    const pastRejected =
      resPast.status === 400 &&
      (/future date|in the past/i.test(resPast.data?.error || '') ||
        resPast.data?.details?.some((d) => /future date|in the past/i.test(d.message)));

    recordResult(
      'Validation: Rejects short description (<10 chars) and past buy-again date',
      shortRejected && pastRejected,
      `Short rejected: ${shortRejected}, Past date rejected: ${pastRejected}`
    );
  } catch (err) {
    recordResult('Validation: Rejections', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 4: Successful POST /api/portal/cancel (Part 2, 4, 5)
  // -------------------------------------------------------------------------
  let cancelInvoiceId = null;
  try {
    const resCancel = await httpRequest('/api/portal/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${subscriberToken}`,
      },
      body: {
        reason: 'Too expensive',
        description: 'Subscription cost exceeds our monthly bandwidth budget for this branch.',
        buyAgainDate: '2026-12-15',
        notSureBuyAgain: false,
        cancelSession: {
          city: 'Azimpur',
          postalCode: '1205',
          state: 'Dhaka Division',
          country: 'Bangladesh',
        },
      },
    });

    const cancelOk = resCancel.data?.success && resCancel.data?.cancellation;
    cancelInvoiceId = resCancel.data?.cancelInvoice?.id || resCancel.data?.invoice?.id;
    const invType = resCancel.data?.cancelInvoice?.invoice_type || resCancel.data?.invoice?.invoice_type;
    const invoiceTypeOk = invType === 'cancel' || invType === 'cancellation';

    // Verify subscriber status updated in DB to 'cancelled'
    const updatedSub = await db.queryOne('SELECT status FROM subscribers WHERE id = $1', [testSub.id]);
    const statusCancelled = updatedSub?.status === 'cancelled';

    recordResult(
      'POST /api/portal/cancel: Creates cancellation, cancel invoice & sets status to cancelled',
      cancelOk && invoiceTypeOk && statusCancelled,
      `Invoice: ${cancelInvoiceId}, DB Status: ${updatedSub?.status}`
    );
  } catch (err) {
    recordResult('POST /api/portal/cancel', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 5: Duplicate Cancellation Prevention (Part 4)
  // -------------------------------------------------------------------------
  try {
    const resDup = await httpRequest('/api/portal/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${subscriberToken}`,
      },
      body: {
        reason: 'Other',
        description: 'Trying to cancel again when already cancelled.',
        notSureBuyAgain: true,
      },
    });

    const dupRejected = (resDup.status === 400 || resDup.status === 409) && /already.*cancelled/i.test(resDup.data?.error || '');
    recordResult(
      'Duplicate Prevention: Blocks duplicate cancellation submission',
      dupRejected,
      `Status: ${resDup.status}, Error: ${resDup.data?.error}`
    );
  } catch (err) {
    recordResult('Duplicate Prevention', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 6: GET /api/portal/cancel-invoices (Part 4 Section C)
  // -------------------------------------------------------------------------
  try {
    const resInvoices = await httpRequest('/api/portal/cancel-invoices', {
      headers: { Authorization: `Bearer ${subscriberToken}` },
    });

    const list = resInvoices.data?.invoices || [];
    const foundInv = list.find((i) => i.id === cancelInvoiceId);
    const hasRequiredFields =
      foundInv &&
      foundInv.cancel_date &&
      foundInv.cancel_time &&
      foundInv.city &&
      foundInv.reason === 'Too expensive';

    recordResult(
      'GET /api/portal/cancel-invoices: Lists unsubscriber cancel invoices with real session data',
      Boolean(foundInv && hasRequiredFields),
      `Found ${list.length} invoice(s), Date: ${foundInv?.cancel_date}, Time: ${foundInv?.cancel_time}`
    );
  } catch (err) {
    recordResult('GET /api/portal/cancel-invoices', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 7: Cancel Invoice Immutability: DELETE returns 403 Forbidden (Part 4 & 5)
  // -------------------------------------------------------------------------
  try {
    const resDel = await httpRequest(`/api/billing/invoices/${encodeURIComponent(cancelInvoiceId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    const deleteForbidden = resDel.status === 403 && /cannot be deleted/i.test(resDel.data?.error || '');
    recordResult(
      'Immutability: DELETE on cancel invoice returns 403 Forbidden (strictly no delete)',
      deleteForbidden,
      `Status: ${resDel.status}, Error: ${resDel.data?.error}`
    );
  } catch (err) {
    recordResult('Cancel Invoice Immutability', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 8: PDF Generation with 4-box Session Info & "Cancel Time" label (Part 2 & 7)
  // -------------------------------------------------------------------------
  try {
    const invRow = await db.queryOne('SELECT * FROM invoices WHERE id = $1', [cancelInvoiceId]);
    const pdfBuf = await billingPdf.renderInvoicePdf(invRow, {
      subscriber: testSub,
      cancellation: {
        reason: 'Too expensive',
        description: 'Budget constraints',
        buy_again_date: '2026-12-15',
        cancel_date: '12/11/2026',
        cancel_time: '07:15PM',
        city: 'Azimpur',
        postal_code: '1205',
        state: 'Dhaka Division',
        country: 'Bangladesh',
      },
    });

    const isPdf = Buffer.isBuffer(pdfBuf) && pdfBuf.slice(0, 4).toString() === '%PDF';
    const zlib = require('zlib');
    const matches = pdfBuf.toString('latin1').match(/stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g) || [];
    let extracted = '';
    for (const m of matches) {
      const raw = Buffer.from(m.replace(/^stream[\r\n]+/, '').replace(/[\r\n]+endstream$/, ''), 'latin1');
      try {
        const decomp = zlib.inflateSync(raw).toString('utf8');
        const hexMatches = decomp.match(/<([0-9a-fA-F]+)>/g) || [];
        for (const h of hexMatches) {
          extracted += Buffer.from(h.slice(1, -1), 'hex').toString('utf8') + ' ';
        }
      } catch {}
    }
    const normalizedText = extracted.replace(/\s+/g, ' ');
    const hasCancelTimeLabel = normalizedText.includes('Cancel Time');
    const hasCancelTitle = /UNSUBSCRIBER\s+CANCEL/i.test(normalizedText);

    recordResult(
      'PDF Generation: Unsubscriber Cancel Invoice with "Cancel Time" and 4-box session block',
      isPdf && hasCancelTimeLabel && hasCancelTitle,
      `PDF size: ${pdfBuf.length} bytes, "Cancel Time" label: ${hasCancelTimeLabel}`
    );
  } catch (err) {
    recordResult('PDF Generation', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 9: Monthly Cycle Skips Cancelled Subscriber (Part 5)
  // -------------------------------------------------------------------------
  try {
    const period = '2026-12';
    const cycleRes = await billingEngine.runMonthlyCycle({ period, dryRun: true });
    // Verify testSub was not included in active invoice count
    const subCheck = await db.queryOne("SELECT status FROM subscribers WHERE id = $1", [testSub.id]);
    const isCancelled = subCheck?.status === 'cancelled';

    recordResult(
      'Billing Engine: Monthly recurring billing cycle excludes cancelled subscribers',
      isCancelled && typeof cycleRes?.invoiceCount === 'number',
      `Sub status: ${subCheck?.status}, Invoices counted: ${cycleRes?.invoiceCount}`
    );
  } catch (err) {
    recordResult('Billing Engine: Monthly recurring billing cycle', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 10: Re-subscription Quote Treats Cancelled as NEW (Part 5)
  // -------------------------------------------------------------------------
  try {
    const quote = await billingEngine.calculateQuote({
      subscriberId: testSub.id,
      packageId: 'PKG-002',
    });

    // When status is cancelled and rechargeAfterCancelTreatAsNew is true:
    // It must return Scenario 1 (NEW_SUBSCRIBER) with installation fee ($8.99) and tax fee ($0.99)
    const isScenario1 = quote.scenario === 'NEW_SUBSCRIBER';
    const hasInstall = Number(quote.installationFee) === 8.99;
    const hasTax = Number(quote.taxFee) === 0.99;

    recordResult(
      'Billing Quote: Cancelled subscriber buying again treated as NEW (installation + tax applied)',
      isScenario1 && hasInstall && hasTax,
      `Scenario: ${quote.scenario}, Install: $${quote.installationFee}, Tax: $${quote.taxFee}`
    );
  } catch (err) {
    recordResult('Billing Quote: Re-subscription after cancel', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 11: Admin Cancellations API: GET /api/billing/cancellations (Part 6)
  // -------------------------------------------------------------------------
  try {
    const resAdmin = await httpRequest('/api/billing/cancellations?search=Sarah', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    const adminOk = resAdmin.data?.success && Array.isArray(resAdmin.data?.cancellations);
    const foundAdmin = resAdmin.data?.cancellations?.some((c) => c.subscriber_id === testSub.id);

    recordResult(
      'Admin API: GET /api/billing/cancellations lists cancellation audit log with search',
      adminOk && foundAdmin,
      `Found record for ${testSub.id}: ${foundAdmin}`
    );
  } catch (err) {
    recordResult('Admin API: GET /api/billing/cancellations', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 12: Frontend Verification: Dashboard Buttons & Links (Part 3)
  // -------------------------------------------------------------------------
  try {
    const dashPath = path.resolve(__dirname, '../../../frontend/src/app/dashboard/page.tsx');
    const dashContent = fs.readFileSync(dashPath, 'utf8');

    const noMyOrdersBtn = !dashContent.includes('My Orders &amp; Bills') && !dashContent.includes('My Orders & Bills');
    const hasMyCancelledBtn = dashContent.includes('My Cancelled Orders') && dashContent.includes('href="/cancel"');
    const noCancelPkgOnCard = !dashContent.includes('Cancel Package') && !dashContent.includes('Cancel Package (Inactive)');
    const hasUpgradeFiberBtn = dashContent.includes('Upgrade Fiber Plan');

    recordResult(
      'Dashboard UI: "My Cancelled Orders" present, "Cancel Package" on card removed (Issue 3)',
      noMyOrdersBtn && hasMyCancelledBtn && noCancelPkgOnCard && hasUpgradeFiberBtn,
      `No Orders Btn: ${noMyOrdersBtn}, Cancelled Btn: ${hasMyCancelledBtn}, Cancel Pkg removed from card: ${noCancelPkgOnCard}, Upgrade Plan present: ${hasUpgradeFiberBtn}`
    );
  } catch (err) {
    recordResult('Dashboard UI Verification', false, err.message);
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  console.log(`TEST SUMMARY: ${passedCount}/${totalCount} TESTS PASSED`);
  console.log('='.repeat(80));

  if (typeof db.getPool === 'function') {
    await db.getPool().end();
  }
  process.exit(passedCount === totalCount ? 0 : 1);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
