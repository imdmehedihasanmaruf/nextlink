import { NextResponse } from 'next/server';
import { authenticate, authError, billingApiBase, bearerToken } from '@/lib/customerAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

/**
 * Cancel the subscriber's plan.
 *
 * The billing engine owns the transition: it closes the billing profile, takes
 * the router line down and records the cancellation. The purchase and the
 * cancellation timestamps stay on the account so the profile can show them.
 */
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (!auth.ok) {
    return authError(auth);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const response = await fetch(`${billingApiBase()}/api/customer/subscription/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken(request)}`,
      },
      body: JSON.stringify({ reason: body?.reason || null }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
      return NextResponse.json(
        { success: false, error: payload.error || 'The subscription could not be cancelled.' },
        { status: response.status || 400, headers: corsHeaders },
      );
    }

    return NextResponse.json(
      {
        success: true,
        message:
          'Your subscription has been cancelled. The purchase and cancellation dates stay on your profile.',
        cancelledAt: payload.cancelledAt || null,
      },
      { headers: corsHeaders },
    );
  } catch (error: any) {
    console.error('Error cancelling the subscription:', error);
    return NextResponse.json(
      { success: false, error: 'The subscription could not be cancelled right now. Please contact support.' },
      { status: 500, headers: corsHeaders },
    );
  }
}
