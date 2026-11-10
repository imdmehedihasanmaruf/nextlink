import { NextResponse } from 'next/server';
import { getSubscriberById, getSiteContent } from '@/lib/db';

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
    const body = await request.json();
    const { customerId, packageId, purchaseType } = body;

    if (!customerId || !packageId) {
      return NextResponse.json(
        { success: false, error: 'Customer ID and Package ID are required for order calculation.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const subscriber = await getSubscriberById(customerId);
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
    const type = pTypeStr.includes('add') ? 'additional' : 'upgrade';

    // Package fee applies directly as total payable
    let remainingSubscriptionValue = 0;
    let proratedAdjustment = 0;
    let installationFee = 0;
    let taxes = 0;
    let totalPayable = targetPrice;

    // Billing cycle calculation
    const daysRemaining = 18; // 18 days left in active 30-day billing cycle
    const currentDaily = currentPrice / 30;
    const targetDaily = targetPrice / 30;

    if (type === 'upgrade') {
      remainingSubscriptionValue = Number((currentDaily * daysRemaining).toFixed(2));
      proratedAdjustment = 0.00;
      installationFee = 0.00;
      taxes = 0.00;
      totalPayable = targetPrice;
    } else {
      // Additional Connection
      remainingSubscriptionValue = 0.00;
      proratedAdjustment = 0.00;
      installationFee = 0.00;
      taxes = 0.00;
      totalPayable = targetPrice;
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

