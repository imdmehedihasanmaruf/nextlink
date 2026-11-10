import { NextResponse } from 'next/server';
import { findSubscriber } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Base URL of the NextLink Express API (Backend Engine).
 * The API owns password verification (bcrypt) and the plain-text to hash
 * migration, so the portal and the API can never disagree on credentials.
 */
const API_BASE_URL =
  process.env.NEXT_PUBLIC_BILLING_API_URL?.replace(/\/api$/, '') || 'http://localhost:3001';

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

    if (!password) {
      return NextResponse.json(
        { success: false, error: 'Password is required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Verify the credentials against the billing service, which stores the
    // password hashed with bcrypt.
    let apiResponse: Response;
    try {
      apiResponse = await fetch(`${API_BASE_URL}/api/auth/subscriber-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'Authentication service is currently unavailable. Please try again shortly.',
        },
        { status: 503, headers: corsHeaders }
      );
    }

    const apiResult = await apiResponse.json().catch(() => ({}));

    if (!apiResponse.ok || !apiResult.success) {
      const status = apiResponse.status === 404 ? 404 : 401;
      return NextResponse.json(
        {
          success: false,
          error:
            apiResult.error ||
            'Invalid password. Please check your customer account credentials.',
        },
        { status, headers: corsHeaders }
      );
    }

    // Load the full subscriber record for the portal session.
    const subscriber = await findSubscriber(username.trim());

    if (!subscriber) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Customer account not found. Package purchases and plan upgrades are strictly restricted to existing NextLink subscribers. Please verify your credentials or contact customer support.',
        },
        { status: 404, headers: corsHeaders }
      );
    }

    // Return the sanitized subscriber customer record.
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
    console.error('Error in customer-login route:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Authentication failed' },
      { status: 500, headers: corsHeaders }
    );
  }
}
