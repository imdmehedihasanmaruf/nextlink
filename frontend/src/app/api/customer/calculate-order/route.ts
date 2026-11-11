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

    // The operator's pricing rule: every package purchase is charged the plan
    // price PLUS a fixed $18 installation fee PLUS a fixed $5 late fee. No
    // proration credit is subtracted — the plan price is always the base.
    const INSTALLATION_FEE = 18;
    const LATE_FEE = 5;

    const remainingSubscriptionValue = 0.00;
    const proratedAdjustment = 0.00;
    const installationFee = INSTALLATION_FEE;
    const lateFee = LATE_FEE;
    const taxes = 0.00;
    const totalPayable = Number((targetPrice + installationFee + lateFee).toFixed(2));

    if (type === 'UPGRADE') {
      // No proration credit is applied — the plan price is the base.
    }
    // An additional connection is simply priced the same way — package price +
    // fixed fees.

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
      lateFee,
      taxes,
      discount: 0.00,
      totalPayableToday: totalPayable,
      nextBillingDate,
      daysRemainingInCycle: 0,
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
        lateFee,
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

