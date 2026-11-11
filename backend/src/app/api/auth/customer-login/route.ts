import { NextResponse } from 'next/server';
import { findSubscriber } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALLOWED_ORIGINS = (process.env.ADMIN_CORS_ORIGINS ||
  'http://localhost:8000,http://localhost:8001,http://localhost:3000').split(',');

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

/**
 * A simple in-process rate limiter for the legacy login route. The Express
 * API has its own limiter; this protects the fallback path the same way.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function rateLimit(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_ATTEMPTS;
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

    const clientKey =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';

    if (!rateLimit(clientKey)) {
      return NextResponse.json(
        { success: false, error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: corsHeaders }
      );
    }

    const subscriber = await findSubscriber(username.trim());

    if (!subscriber) {
      return NextResponse.json(
        { success: false, error: 'Customer account not found.' },
        { status: 404, headers: corsHeaders }
      );
    }

    // The stored password must exist and match. An account with no stored
    // password can never sign in through this route — previously the check
    // was skipped entirely and anyone could walk into any account.
    const storedPassword = String(subscriber.password || '');
    if (!storedPassword) {
      return NextResponse.json(
        {
          success: false,
          error:
            'This account has not got a password set. Please reset it through the customer portal.',
        },
        { status: 401, headers: corsHeaders }
      );
    }
    if (!password || storedPassword !== String(password)) {
      return NextResponse.json(
        { success: false, error: 'Invalid password.' },
        { status: 401, headers: corsHeaders }
      );
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
