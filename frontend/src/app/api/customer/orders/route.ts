import { NextResponse } from 'next/server';
import { getCustomerOrders, getSubscriberById } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');

    if (!customerId) {
      return NextResponse.json(
        { success: false, error: 'Customer ID is required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Verify subscriber exists
    const subscriber = await getSubscriberById(customerId);
    if (!subscriber) {
      return NextResponse.json(
        { success: false, error: 'Customer not found.' },
        { status: 404, headers: corsHeaders }
      );
    }

    // Strict customer isolation: only fetch orders belonging to this customer
    const orders = await getCustomerOrders(customerId);

    return NextResponse.json(
      {
        success: true,
        orders,
      },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    console.error('Error fetching customer orders:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to fetch customer orders' },
      { status: 500, headers: corsHeaders }
    );
  }
}

