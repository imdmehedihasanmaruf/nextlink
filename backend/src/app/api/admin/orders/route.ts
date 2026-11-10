import { NextResponse } from 'next/server';
import { getAllOrders, updateOrderStatus } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET() {
  try {
    const orders = await getAllOrders();
    return NextResponse.json(
      {
        success: true,
        orders,
      },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    console.error('Error fetching admin orders:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to fetch orders' },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { orderId, status } = body;

    if (!orderId || !status) {
      return NextResponse.json(
        { success: false, error: 'Order ID and new status are required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const updated = await updateOrderStatus(orderId, status);
    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'Failed to update order status or order not found.' },
        { status: 404, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: `Order ${orderId} updated to status "${status}" and provisioned successfully.`,
      },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    console.error('Error updating admin order:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to update order' },
      { status: 500, headers: corsHeaders }
    );
  }
}

