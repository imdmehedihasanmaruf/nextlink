import { NextResponse } from 'next/server';
import { findSubscriber } from '@/lib/db';

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
    const { username, password } = body;

    if (!username || !username.trim()) {
      return NextResponse.json(
        { success: false, error: 'Username, subscriber ID, or email is required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const subscriber = await findSubscriber(username.trim());

    if (!subscriber) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Customer account not found. Package purchases and plan upgrades are strictly restricted to existing NextLink subscribers. Please verify your credentials or contact customer support.' 
        },
        { status: 404, headers: corsHeaders }
      );
    }

    if (subscriber.password && password) {
      if (subscriber.password.trim() !== password.trim()) {
        return NextResponse.json(
          { success: false, error: 'Invalid password. Please check your customer account credentials.' },
          { status: 401, headers: corsHeaders }
        );
      }
    }

    const customerUser = {
      id: subscriber.id,
      name: subscriber.name,
      username: subscriber.username,
      email: subscriber.email,
      phone: subscriber.phone,
      package: subscriber.packageName,
      packageId: subscriber.packageId,
      address: subscriber.address,
      joinDate: subscriber.joinDate,
      status: subscriber.status,
      balance: subscriber.balance,
      dueDate: subscriber.dueDate,
      ipAddress: subscriber.ipAddress,
      macAddress: subscriber.macAddress,
      connectionType: subscriber.connectionType,
      zone: subscriber.zone,
    };

    return NextResponse.json(
      {
        success: true,
        message: 'Existing customer authenticated successfully',
        user: customerUser,
      },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    console.error('Error in backend customer-login route:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Authentication failed' },
      { status: 500, headers: corsHeaders }
    );
  }
}

