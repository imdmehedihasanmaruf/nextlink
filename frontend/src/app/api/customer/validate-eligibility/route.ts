import { NextResponse } from 'next/server';
import { getSubscriberById } from '@/lib/db';

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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const customerId = url.searchParams.get('customerId');
  if (!customerId) {
    return NextResponse.json(
      { success: false, error: 'Customer ID query param is required' },
      { status: 400, headers: corsHeaders }
    );
  }
  return validateCustomer(customerId);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { customerId } = body;

    if (!customerId) {
      return NextResponse.json(
        { success: false, error: 'Customer ID is required for authentication verification.' },
        { status: 400, headers: corsHeaders }
      );
    }

    return validateCustomer(customerId);
  } catch (err: any) {
    console.error('Error validating customer eligibility:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Validation failed' },
      { status: 500, headers: corsHeaders }
    );
  }
}

async function validateCustomer(customerId: string) {
  try {
    const subscriber = await getSubscriberById(customerId);

    if (!subscriber) {
      return NextResponse.json(
        {
          success: false,
          eligible: false,
          error: 'Non-existing customer. Access denied. Package purchases are strictly restricted to registered existing subscribers.',
        },
        { status: 403, headers: corsHeaders }
      );
    }

    const status = (subscriber.status || 'active').toLowerCase();
    const balance = Number(subscriber.balance || 0);

    // Evaluate Account Restrictions
    if (status === 'blocked' || status === 'suspended') {
      return NextResponse.json(
        {
          success: true,
          eligible: false,
          status,
          restrictionCode: 'ACCOUNT_SUSPENDED',
          message: 'Account Suspended: Your subscriber connection is restricted due to administrative hold or unpaid account balance. Package purchases are not permitted until status is normalized.',
          subscriber,
        },
        { headers: corsHeaders }
      );
    }

    if (status === 'pending') {
      return NextResponse.json(
        {
          success: true,
          eligible: false,
          status,
          restrictionCode: 'PENDING_VERIFICATION',
          message: 'Pending Verification: Your subscriber account is undergoing identity verification. Please await activation before purchasing additional packages.',
          subscriber,
        },
        { headers: corsHeaders }
      );
    }

    if (status === 'disconnected') {
      return NextResponse.json(
        {
          success: true,
          eligible: false,
          status,
          restrictionCode: 'DISCONNECTED',
          message: 'Connection Disconnected: Your optical line is currently decommissioned. Follow the line reactivation process before modifying packages.',
          subscriber,
        },
        { headers: corsHeaders }
      );
    }

    // Check outstanding bills
    if (balance > 0) {
      return NextResponse.json(
        {
          success: true,
          eligible: false,
          status: 'active',
          hasOutstandingDue: true,
          balance,
          restrictionCode: 'OUTSTANDING_BALANCE',
          message: `Outstanding Balance: You have an overdue balance of $${balance.toFixed(2)}. Please settle your pending invoice before upgrading or ordering additional plans.`,
          subscriber,
        },
        { headers: corsHeaders }
      );
    }

    // Customer is completely active and eligible!
    return NextResponse.json(
      {
        success: true,
        eligible: true,
        status: 'active',
        hasOutstandingDue: false,
        balance,
        message: 'Customer verified and fully eligible for package purchase.',
        subscriber: {
          id: subscriber.id,
          name: subscriber.name,
          username: subscriber.username,
          email: subscriber.email,
          phone: subscriber.phone,
          status: subscriber.status,
          packageId: subscriber.packageId,
          packageName: subscriber.packageName,
          balance: subscriber.balance,
          dueDate: subscriber.dueDate,
          connectionType: subscriber.connectionType,
          ipAddress: subscriber.ipAddress,
          macAddress: subscriber.macAddress,
          address: subscriber.address,
          zone: subscriber.zone,
        },
      },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    console.error('Error validating customer eligibility:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Validation failed' },
      { status: 500, headers: corsHeaders }
    );
  }
}
