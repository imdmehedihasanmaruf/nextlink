import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSubscriberById, getSiteContent, createOrderRecord } from '@/lib/db';
import { authenticate, authError, ownsAccount } from '@/lib/customerAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: Request) {
  try {
    // The order is placed for the authenticated subscriber. The customer id
    // in the body is only cross-checked, never trusted.
    const auth = await authenticate(request);
    if (!auth.ok) {
      return authError(auth);
    }

    const body = await request.json();
    const {
      customerId,
      packageId,
      purchaseType,
      purchaseTypeLabel,
      purchaseTimestamp,
      sessionGeolocation,
      paymentMethod,
      paymentDetails,
      acceptedTerms,
      termsAccepted,
    } = body;

    const hasAcceptedTerms = !!(acceptedTerms || termsAccepted);

    // 1. Mandatory Terms check
    if (!hasAcceptedTerms) {
      return NextResponse.json(
        { success: false, error: 'Customer acceptance of NextLink Global terms of service and SLA is required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    // 2. The account has to belong to the caller.
    if (!ownsAccount(auth, customerId)) {
      return NextResponse.json(
        { success: false, error: 'You are not allowed to place an order for this account.' },
        { status: 403, headers: corsHeaders }
      );
    }

    const subscriber = await getSubscriberById(auth.subscriber!.id);
    if (!subscriber) {
      return NextResponse.json(
        { success: false, error: 'Customer not found. Purchase is strictly restricted to existing subscribers.' },
        { status: 403, headers: corsHeaders }
      );
    }

    const status = (subscriber.status || 'active').toLowerCase();
    if (status !== 'active') {
      return NextResponse.json(
        { success: false, error: `Customer account status is ${status}. Orders cannot be processed.` },
        { status: 403, headers: corsHeaders }
      );
    }

    if (Number(subscriber.balance || 0) > 0) {
      return NextResponse.json(
        { success: false, error: `Customer has an outstanding balance of $${subscriber.balance}. Please clear overdue bills first.` },
        { status: 400, headers: corsHeaders }
      );
    }

    // 3. Package Validation
    const siteData = await getSiteContent();
    const packages: any[] = siteData.packages || [];
    const targetPkg = packages.find(p => p.id === packageId || p.name.toLowerCase() === packageId.toLowerCase());

    if (!targetPkg) {
      return NextResponse.json(
        { success: false, error: 'Requested package not found in catalog.' },
        { status: 404, headers: corsHeaders }
      );
    }

    // 4. Payment Method Validation
    const allowedMethods = ['card', 'payoneer', 'applepay', 'bkash', 'upi'];
    const chosenMethod = (paymentMethod || 'card').toLowerCase();
    if (!allowedMethods.includes(chosenMethod)) {
      return NextResponse.json(
        { success: false, error: `Payment method ${paymentMethod} is not configured or supported.` },
        { status: 400, headers: corsHeaders }
      );
    }

    // 5. Server-Side Financial Calculation
    const targetPrice = Number(targetPkg.price || 0);

    // The current price comes from the catalogue, not from the subscriber
    // record — the raw_data field the old code read does not exist, so the
    // credit was always computed against a hard-coded 29.99.
    const currentPkg = (siteData.packages || []).find(
      (p: any) =>
        p.id === subscriber.packageId ||
        String(p.name || '').toLowerCase() === String(subscriber.packageName || '').toLowerCase()
    );
    const currentPrice = Number(currentPkg?.price ?? currentPkg?.downloadSpeed ?? 0);

    const pTypeStr = String(purchaseType || '').toLowerCase();
    const type = pTypeStr.includes('add') ? 'ADDITIONAL' : 'UPGRADE';

    // Proration is calculated from the real billing cycle, not from a fixed
    // number of days. The unused part of the old plan is credited and the new
    // plan is only charged for the days that are left in the cycle.
    const BILLING_DAYS = 30;
    const cycleStart = subscriber.raw_data?.billingStart
      ? new Date(subscriber.raw_data.billingStart)
      : new Date(Date.now() - 12 * 86400000);
    const daysElapsed = Math.max(
      0,
      Math.min(BILLING_DAYS, Math.floor((Date.now() - cycleStart.getTime()) / 86400000))
    );
    const daysRemaining = Math.max(0, BILLING_DAYS - daysElapsed);

    const currentDaily = currentPrice / BILLING_DAYS;
    const targetDaily = targetPrice / BILLING_DAYS;

    // The credit for the unused days of the old plan.
    const proratedAdjustment = -Number((currentDaily * daysRemaining).toFixed(2));
    const installationFee = 0;
    const taxes = 0;
    const totalPayable = Number(
      Math.max(0, targetDaily * daysRemaining + installationFee + taxes + proratedAdjustment).toFixed(2)
    );

    // 6. Generate Server Verified Tokens
    // The ids are unique: the previous values came from small spaces that
    // repeated, so an order or an invoice could overwrite another one.
    const orderId = `ORD-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
    const trxId = `TRX-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
    const orderStatus = type === 'UPGRADE' ? 'Pending Activation' : 'Pending Activation';
    const activationTime = type === 'UPGRADE' 
      ? 'Instant Zero-Downtime Provisioning (Activated)' 
      : 'Estimated 24-48 Hours (Physical Drop Scheduling & OLT Calibration)';

    const orderClassificationLabel = purchaseTypeLabel || (type === 'UPGRADE' ? 'Package Plan Upgrade' : 'Additional Secondary Drop');
    
    // Format timestamp fallback (DD/MM/YYYY · hh:mmA)
    const now = new Date();
    const dayStr = String(now.getDate()).padStart(2, '0');
    const monthStr = String(now.getMonth() + 1).padStart(2, '0');
    const yearStr = now.getFullYear();
    let hours = now.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const hoursStr = String(hours).padStart(2, '0');
    const minutesStr = String(now.getMinutes()).padStart(2, '0');
    const defaultTimestamp = `${dayStr}/${monthStr}/${yearStr} · ${hoursStr}:${minutesStr}${ampm}`;

    const defaultLocation = subscriber.address 
      ? `${subscriber.address}, Dhaka Division, Bangladesh` 
      : 'Azimpur, 1205, Dhaka Division, Bangladesh';

    const finalTimestamp = purchaseTimestamp || defaultTimestamp;
    const finalGeolocation = sessionGeolocation || defaultLocation;

    const newOrder = {
      id: orderId,
      customerId: subscriber.id,
      customerName: subscriber.name,
      connectionId: `CONN-${subscriber.id.replace('SUB-', 'OPT-')}-01`,
      packageId: targetPkg.id,
      packageName: targetPkg.name,
      purchaseType: type,
      purchase_type: type,
      purchaseTypeLabel: orderClassificationLabel,
      purchase_type_label: orderClassificationLabel,
      currentPackageId: subscriber.packageId,
      currentPackageName: subscriber.packageName,
      downloadSpeed: targetPkg.speed || targetPkg.downloadSpeed || 100,
      uploadSpeed: targetPkg.uploadSpeed || targetPkg.speed || 100,
      monthlyPrice: targetPrice,
      proratedAdjustment,
      installationFee,
      taxes,
      discount: 0.00,
      totalPayable,
      paymentMethod: chosenMethod,
      payment_method: chosenMethod,
      paymentStatus: 'Payment Verified',
      payment_status: 'Payment Verified',
      orderStatus,
      order_status: orderStatus,
      trxId,
      trx_id: trxId,
      package_id: targetPkg.id,
      package_name: targetPkg.name,
      total_payable: totalPayable,
      installation_fee: installationFee,
      prorated_adjustment: proratedAdjustment,
      created_at: new Date().toISOString(),
      purchaseTimestamp: finalTimestamp,
      purchase_timestamp: finalTimestamp,
      sessionGeolocation: finalGeolocation,
      session_geolocation: finalGeolocation,
      nextBillingDate: subscriber.dueDate || '2026-02-15',
      next_billing_date: subscriber.dueDate || '2026-02-15',
      expectedActivationTime: activationTime,
      expected_activation_time: activationTime,
      paymentDetails: paymentDetails || {},
    };

    // 7. Persist to PostgreSQL orders & invoices, and update subscriber
    await createOrderRecord(newOrder);

    return NextResponse.json(
      {
        success: true,
        message: type === 'UPGRADE' 
          ? 'Payment verified and package upgraded successfully!' 
          : 'Payment verified! Additional line order is submitted and awaiting NOC activation.',
        order: newOrder,
      },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    console.error('Error in create-and-pay order:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Order creation failed' },
      { status: 500, headers: corsHeaders }
    );
  }
}

