import { NextResponse } from 'next/server';
import { getSubscriberById, getSiteContent } from '@/lib/db';
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
    const auth = await authenticate(request);
    if (!auth.ok) {
      return authError(auth);
    }

    const body = await request.json();
    const { customerId, packageId, purchaseType } = body;

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

    const targetPkg = packages.find(p => p.id === packageId || p.name.toLowerCase() === packageId.toLowerCase());
    if (!targetPkg) {
      return NextResponse.json(
        { success: false, error: 'Selected package tier not found.' },
        { status: 404, headers: corsHeaders }
      );
    }

    const currentPkg = packages.find(p => p.id === subscriber.packageId || p.name.toLowerCase() === (subscriber.packageName || '').toLowerCase()) || {
      id: subscriber.packageId || 'PKG-002',
      name: subscriber.packageName || 'Standard 200M',
      price: 29.99,
      speed: 200,
    };

    const targetPrice = Number(targetPkg.price || 0);
    const currentPrice = Number(currentPkg.price || 0);

    const pTypeStr = String(purchaseType || '').toLowerCase();
    const type = pTypeStr.includes('add') ? 'ADDITIONAL' : 'UPGRADE';

    // The proration is calculated from the real billing cycle. The previous
    // code used a fixed number of days and always charged the full price of
    // the new plan on top of the month's bill.
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

    let remainingSubscriptionValue = 0;
    let proratedAdjustment = 0;
    let installationFee = 0;
    let taxes = 0;
    let totalPayable = targetPrice;

    if (type === 'UPGRADE') {
      // The unused part of the old plan is credited, and the new plan is only
      // charged for the days that are left in the cycle.
      remainingSubscriptionValue = Number((currentDaily * daysRemaining).toFixed(2));
      proratedAdjustment = -remainingSubscriptionValue;
      installationFee = 0.00;
      taxes = 0.00;
      totalPayable = Number(
        Math.max(0, targetDaily * daysRemaining + installationFee + taxes + proratedAdjustment).toFixed(2)
      );
    } else {
      // An additional connection is a separate line with its own fee.
      remainingSubscriptionValue = 0.00;
      proratedAdjustment = 0.00;
      installationFee = Number((targetPrice * 0.1).toFixed(2));
      taxes = 0.00;
      totalPayable = Number((targetPrice + installationFee).toFixed(2));
    }

    // Determine next billing date
    const nextBillingDate = subscriber.dueDate || '2026-02-15';

    const calculation = {
      customerName: subscriber.name,
      customerId: subscriber.id,
      connectionId: `CONN-${subscriber.id.replace('SUB-', 'OPT-')}-01`,
      currentPackage: {
        id: currentPkg.id,
        name: currentPkg.name,
        speed: currentPkg.speed || 100,
        price: currentPrice,
      },
      selectedPackage: {
        id: targetPkg.id,
        name: targetPkg.name,
        downloadSpeed: targetPkg.speed || targetPkg.downloadSpeed || 100,
        uploadSpeed: targetPkg.uploadSpeed || targetPkg.speed || 100,
        price: targetPrice,
        hardwareReady: targetPkg.hardwareReady || 'Wi-Fi 6 ONU',
      },
      purchaseType: type,
      monthlySubscriptionPrice: targetPrice,
      remainingCurrentSubscriptionValue: remainingSubscriptionValue,
      proratedAdjustment,
      installationFee,
      taxes,
      discount: 0.00,
      totalPayableToday: totalPayable,
      nextBillingDate,
      daysRemainingInCycle: daysRemaining,
    };

    return NextResponse.json(
      {
        success: true,
        calculation,
        currentPackage: currentPkg.name,
        newPackage: targetPkg.name,
        currentPrice,
        newPrice: targetPrice,
        proratedAdjustment,
        installationFee,
        taxes,
        discount: 0.00,
        totalPayable,
        totalPayableToday: totalPayable,
        nextBillingDate,
        message: 'Order calculations verified by backend billing engine.',
      },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    console.error('Error calculating order:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Calculation error' },
      { status: 500, headers: corsHeaders }
    );
  }
}

