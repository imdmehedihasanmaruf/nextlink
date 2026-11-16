import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSubscriberById, getSiteContent, createOrderRecord, countOverdueInvoices, getBillingFeeConfig } from '@/lib/db';
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

    // 3. Package Validation
    const siteData = await getSiteContent();
    const packages: any[] = siteData.packages || [];
    const targetPkg = packages.find(p => p.id === packageId || p.name.toLowerCase() === String(packageId).toLowerCase());

    if (!targetPkg) {
      return NextResponse.json(
        { success: false, error: 'Requested package not found in catalog.' },
        { status: 404, headers: corsHeaders }
      );
    }

    // 4. Payment Method Validation
    const allowedMethods = ['bkash', 'nagad', 'sslcommerz', 'rocket'];
    const chosenMethod = String(paymentMethod || 'bkash').toLowerCase();
    if (!allowedMethods.includes(chosenMethod)) {
      return NextResponse.json(
        { success: false, error: `Payment method ${paymentMethod} is not configured or supported.` },
        { status: 400, headers: corsHeaders }
      );
    }

    // 5. Server-Side Financial Calculation via Backend Billing Quote Engine (Single Source of Truth)
    const token = bearerToken(request);
    const quoteRes = await fetch(`${billingApiBase()}/api/billing/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        subscriberId: subscriber.id,
        packageId: targetPkg.id,
        purchaseType: purchaseType || 'NEW',
      }),
      cache: 'no-store',
    });

    const quotePayload = await quoteRes.json().catch(() => null);
    if (!quoteRes.ok || !quotePayload?.success || !quotePayload?.quote) {
      return NextResponse.json(
        {
          success: false,
          error:
            quotePayload?.error ||
            'Could not verify invoice total with the Billing Engine. Payment was not started.',
        },
        { status: quoteRes.status >= 400 ? quoteRes.status : 502, headers: corsHeaders }
      );
    }

    const quote = quotePayload.quote;

    // Duplicate payment protection (Requirement 5)
    if (quote.alreadyPaid) {
      return NextResponse.json(
        {
          success: false,
          code: 'ALREADY_PAID',
          error: quote.paidNotice || `Paid for ${quote.paidMonthYear || 'this month'}. Next due: ${quote.nextDueDate || 'next month'}.`,
          nextDueDate: quote.nextDueDate,
        },
        { status: 400, headers: corsHeaders }
      );
    }

    const pTypeStr = String(purchaseType || '').toLowerCase();
    const type =
      quote.scenario === 'NEW_SUBSCRIBER'
        ? 'NEW'
        : pTypeStr.includes('add')
          ? 'ADDITIONAL'
          : pTypeStr.includes('renew') || quote.badge === 'Monthly Renewal'
            ? 'RENEWAL'
            : 'UPGRADE';

    const targetPrice = Number(quote.packagePrice);
    const proratedAdjustment = 0;
    const installationFee = Number(quote.installationFee);
    const taxes = Number(quote.taxFee);
    const lateFee = Number(quote.lateFee);
    const carriedOverAmount = Number(quote.carriedOverAmount);
    const totalPayable = Number(quote.totalPayable);

    // 6. Generate the order id
    const orderId = `ORD-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
    const orderStatus = 'Pending Activation';
    const activationTime =
      quote.scenario !== 'NEW_SUBSCRIBER'
        ? 'Instant Zero-Downtime Provisioning (Activated)'
        : 'Estimated 24-48 Hours (Physical Drop Scheduling & OLT Calibration)';

    const orderClassificationLabel =
      type === 'RENEWAL' ? 'Monthly Renewal' : (purchaseTypeLabel || quote.badge || 'New Subscription');
    
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

    // The installation address comes from the account. When it is unknown the
    // field stays empty — a made-up address would end up on the invoice.
    const defaultLocation = subscriber.address ? String(subscriber.address) : '';

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
      carriedOverAmount,
      previousDue: Number(quote.previousDue || 0),
      taxes,
      discount: 0.00,
      totalPayable,
      scenario: quote.scenario,
      badge: quote.badge,
      packageLabel: quote.packageLabel,
      lines: quote.lines || [],
      unpaidInvoiceIds: quote.unpaidInvoiceIds || [],
      paymentMethod: chosenMethod,
      payment_method: chosenMethod,
      // The payment is not verified until the gateway confirms it. The order
      // is created as pending and the transaction id is written by the
      // gateway, not invented here.
      paymentStatus: 'Payment Pending',
      payment_status: 'Payment Pending',
      orderStatus,
      order_status: orderStatus,
      trxId: null,
      trx_id: null,
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
      nextBillingDate: subscriber.dueDate || new Date().toISOString().split('T')[0],
      next_billing_date: subscriber.dueDate || new Date().toISOString().split('T')[0],
      expectedActivationTime: activationTime,
      expected_activation_time: activationTime,
      paymentDetails: paymentDetails || {},
    };

    // 7. Persist to PostgreSQL orders & invoices
    const savedOrder = await createOrderRecord(newOrder);
    const invoiceId = savedOrder.invoiceId;

    // 8. Start the payment at the gateway. The portal never marks the order
    // or the invoice as paid — the billing engine does that when the gateway
    // confirms the transaction, and the subscription is activated by that
    // same settlement.
    const gatewayName = chosenMethod;
    const paymentResponse = await fetch(`${billingApiBase()}/api/portal/purchase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken(request)}`,
      },
      body: JSON.stringify({
        invoiceId,
        orderId,
        packageId: targetPkg.id,
        packageName: targetPkg.name,
        gateway: gatewayName,
      }),
    });
    const paymentResult = await paymentResponse.json().catch(() => ({}));
    if (!paymentResponse.ok || !paymentResult.success || !paymentResult.redirectUrl) {
      console.error('Payment could not be started:', paymentResult.error);
      return NextResponse.json(
        {
          success: false,
          error:
            paymentResult.error ||
            'The payment could not be started. The order was recorded but no money was taken - please try again.',
          orderId,
          invoiceId,
        },
        { status: 502, headers: corsHeaders },
      );
    }

    return NextResponse.json(
      {
        success: true,
        message:
          'The order was placed. Complete the payment at the gateway to activate the plan.',
        order: { ...newOrder, invoice_id: invoiceId, trx_id: paymentResult.gatewayTransactionId || null },
        payment: {
          redirectUrl: paymentResult.redirectUrl,
          gatewayTransactionId: paymentResult.gatewayTransactionId || null,
          invoiceId,
          amount: paymentResult.amount,
          currency: paymentResult.currency,
        },
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

