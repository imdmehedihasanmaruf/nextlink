import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSubscriberById, getSiteContent, createOrderRecord, countOverdueInvoices } from '@/lib/db';
import { authenticate, authError, ownsAccount, billingApiBase, bearerToken } from '@/lib/customerAuth';

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
    if (status !== 'active' && status !== 'registered') {
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

    const pTypeStr = String(purchaseType || '').toLowerCase();
    const type = pTypeStr.includes('add') ? 'ADDITIONAL' : 'UPGRADE';

    // The operator's pricing rule: every package purchase is charged the plan
    // price PLUS a fixed $18 installation fee. The $5 late fee is only added
    // when the running-month bill is still unpaid past the grace days — it is
    // counted on the next cycle, matching recurring billing semantics.
    const INSTALLATION_FEE = 18;
    const LATE_FEE = 5;
    const overdueInvoices = await countOverdueInvoices(auth.subscriber!.id, 5);
    const lateFee = overdueInvoices > 0 ? LATE_FEE : 0;

    const daysRemaining = 0;
    const currentDaily = 0;
    const proratedAdjustment = 0;
    const installationFee = INSTALLATION_FEE;
    const taxes = 0;
    const totalPayable = Number((targetPrice + installationFee + lateFee).toFixed(2));

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
      // The stored value is always upper-case; the comparison with lower-case
      // in db.ts used to silently fail and the pending plan was never kept.
      purchaseType: type,
      purchase_type: type.toUpperCase(),
      purchaseTypeLabel: orderClassificationLabel,
      purchase_type_label: orderClassificationLabel,
      currentPackageId: subscriber.packageId,
      currentPackageName: subscriber.packageName,
      downloadSpeed: targetPkg.speed || targetPkg.downloadSpeed || 100,
      uploadSpeed: targetPkg.uploadSpeed || targetPkg.speed || 100,
      monthlyPrice: targetPrice,
      proratedAdjustment,
      installationFee,
      lateFee,
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

    // 8. A registered (not-yet-subscribed) account becomes a subscriber the
    // moment their first package purchase completes. The billing engine owns
    // that transition - it creates the billing profile and provisions the
    // router line - so the portal asks it to do so instead of writing the
    // status itself.
    if (status === 'registered') {
      const activation = await fetch(`${billingApiBase()}/api/customer/subscription/activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearerToken(request)}`,
        },
        body: JSON.stringify({
          packageId: targetPkg.id,
          packageName: targetPkg.name,
          orderId,
        }),
      });
      const activationResult = await activation.json().catch(() => ({}));
      if (!activation.ok || !activationResult.success) {
        console.error('Subscription activation failed:', activationResult.error);
        return NextResponse.json(
          {
            success: false,
            error:
              activationResult.error ||
              'The payment was taken but the subscription could not be activated. Please contact support.',
          },
          { status: 500, headers: corsHeaders },
        );
      }
    }

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

