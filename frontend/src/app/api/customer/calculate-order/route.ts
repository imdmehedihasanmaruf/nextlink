import { NextResponse } from 'next/server';
import { getSubscriberById, getSiteContent } from '@/lib/db';
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
    const auth = await authenticate(request);
    if (!auth.ok) {
      return authError(auth);
    }

    const body = await request.json();
    const { customerId, packageId, purchaseType, simulateFailure } = body;

    if (!packageId) {
      return NextResponse.json(
        { success: false, error: 'Package ID is required for order calculation.' },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!ownsAccount(auth, customerId)) {
      return NextResponse.json(
        { success: false, error: 'You are not allowed to calculate for this account.' },
        { status: 403, headers: corsHeaders }
      );
    }

    const subscriber = await getSubscriberById(auth.subscriber!.id);
    if (!subscriber) {
      return NextResponse.json(
        { success: false, error: 'Customer not found.' },
        { status: 404, headers: corsHeaders }
      );
    }

    const siteData = await getSiteContent();
    const packages: any[] = siteData.packages || [];

    const targetPkg = packages.find(
      (p) => p.id === packageId || p.name.toLowerCase() === String(packageId).toLowerCase()
    );
    if (!targetPkg) {
      return NextResponse.json(
        { success: false, error: 'Selected package tier not found.' },
        { status: 404, headers: corsHeaders }
      );
    }

    const currentPkg = packages.find(
      (p) =>
        (subscriber.packageId && p.id === subscriber.packageId) ||
        (subscriber.packageName && p.name.toLowerCase() === String(subscriber.packageName).toLowerCase())
    );

    // Delegate quote calculation strictly to the backend Billing Engine (single source of truth).
    const token = bearerToken(request);
    const quoteRes = await fetch(`${billingApiBase()}/api/billing/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(simulateFailure ? { 'x-simulate-quote-failure': '1' } : {}),
      },
      body: JSON.stringify({
        subscriberId: subscriber.id,
        packageId: targetPkg.id,
        purchaseType: purchaseType || 'NEW',
        simulateFailure: Boolean(simulateFailure),
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
            'Unable to verify invoice preview with the Billing Engine. Please retry.',
        },
        { status: quoteRes.status >= 400 ? quoteRes.status : 502, headers: corsHeaders }
      );
    }

    const quote = quotePayload.quote;
    const nextBillingDate = subscriber.dueDate || '';

    const calculation = {
      customerName: subscriber.name,
      customerId: subscriber.id,
      connectionId: `CONN-${subscriber.id.replace('SUB-', 'OPT-')}-01`,
      scenario: quote.scenario,
      scenarioNumber: quote.scenarioNumber,
      badge: quote.badge,
      packageLabel: quote.packageLabel,
      lines: quote.lines || [],
      currentPackage: currentPkg
        ? {
            id: currentPkg.id,
            name: currentPkg.name,
            speed: currentPkg.speed || 100,
            price: Number(currentPkg.price || 0),
          }
        : null,
      selectedPackage: {
        id: targetPkg.id,
        name: targetPkg.name,
        downloadSpeed: targetPkg.speed || targetPkg.downloadSpeed || 100,
        uploadSpeed: targetPkg.uploadSpeed || targetPkg.speed || 100,
        price: quote.packagePrice,
        hardwareReady: targetPkg.hardwareReady || 'Wi-Fi 6 ONU',
      },
      purchaseType: quote.scenario === 'NEW_SUBSCRIBER' ? 'NEW' : String(purchaseType || 'RENEWAL').toUpperCase(),
      monthlySubscriptionPrice: quote.packagePrice,
      remainingCurrentSubscriptionValue: 0,
      proratedAdjustment: 0,
      installationFee: quote.installationFee,
      lateFee: quote.lateFee,
      lateFeeType: quote.late_fee_type,
      lateFeeValue: quote.late_fee_value,
      lateFeePercent: quote.lateFeePercent,
      carriedOverAmount: quote.carriedOverAmount,
      previousDue: quote.previousDue,
      unpaidInvoiceIds: quote.unpaidInvoiceIds || [],
      unpaidMonthsCount: quote.unpaidMonthsCount || 0,
      taxes: quote.taxFee,
      taxFee: quote.taxFee,
      discount: 0,
      totalPayable: quote.totalPayable,
      totalPayableToday: quote.totalPayable,
      totalPayableCents: quote.totalPayableCents,
      formattedTotalPayable: quote.formattedTotalPayable,
      nextBillingDate,
      daysRemainingInCycle: 0,
      verifiedAt: quote.verifiedAt,
    };

    return NextResponse.json(
      {
        success: true,
        quote,
        calculation,
        scenario: quote.scenario,
        badge: quote.badge,
        alreadyPaid: Boolean(quote.alreadyPaid),
        isCurrentPeriodPaid: Boolean(quote.isCurrentPeriodPaid),
        paidMonthYear: quote.paidMonthYear,
        nextDueDate: quote.nextDueDate,
        paidNotice: quote.paidNotice,
        lines: quote.lines,
        currentPackage: currentPkg?.name || '',
        newPackage: targetPkg.name,
        packageLabel: quote.packageLabel,
        currentPrice: Number(currentPkg?.price || 0),
        newPrice: quote.packagePrice,
        proratedAdjustment: 0,
        installationFee: quote.installationFee,
        lateFee: quote.lateFee,
        carriedOverAmount: quote.carriedOverAmount,
        previousDue: quote.previousDue,
        taxes: quote.taxFee,
        taxFee: quote.taxFee,
        discount: 0,
        totalPayable: quote.totalPayable,
        totalPayableToday: quote.totalPayable,
        formattedTotalPayable: quote.formattedTotalPayable,
        nextBillingDate,
        message: 'Order calculations verified by backend billing engine.',
      },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    console.error('Error calculating order:', err);
    return NextResponse.json(
      {
        success: false,
        error: err.message || 'Unable to verify quote with the billing engine.',
      },
      { status: 502, headers: corsHeaders }
    );
  }
}
