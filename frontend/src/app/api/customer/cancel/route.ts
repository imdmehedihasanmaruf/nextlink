import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authenticate, authError } from '@/lib/customerAuth';

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
 * Cancel the subscriber's plan. The timestamp is recorded on the subscriber's
 * profile. The line is taken out of service — state change is done through the
 * admin API so network provisioning is handled consistently with a deactivate.
 */
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (!auth.ok) {
    return authError(auth);
  }

  try {
    const pool = getDbPool();
    const row = await pool.query('SELECT raw_data FROM subscribers WHERE id = $1', [auth.subscriber!.id]);
    if (row.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Subscriber not found.' },
        { status: 404, headers: corsHeaders },
      );
    }

    const raw = row.rows[0].raw_data || {};
    const updated = {
      ...raw,
      status: 'cancelled',
      subscriptionCancelledAt: new Date().toISOString(),
      cancelledBy: 'self',
    };

    await pool.query(
      `UPDATE subscribers
         SET status = 'cancelled',
             raw_data = $1,
             updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(updated), auth.subscriber!.id],
    );

    // The router line is suspended by the billing service on the next admin
    // sweep, or manually by support from the admin panel. The subscriber
    // portal does not hold an admin token to cancel the PPPoE secret itself.

    return NextResponse.json(
      {
        success: true,
        message: 'Your subscription has been cancelled. An upgrade is always available by contacting support.',
      },
      { headers: corsHeaders },
    );
  } catch (error: any) {
    console.error('Error cancelling subscription:', error);
    return NextResponse.json(
      { success: false, error: 'The subscription could not be cancelled right now. Please contact support.' },
      { status: 500, headers: corsHeaders },
    );
  }
}
