import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
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
 * Deactivate the subscriber's account.
 *
 * Calls Express decommissioning (/api/portal/cancel) so the router line is
 * suspended, cancel invoice is created, and status is updated. The account
 * is kept for billing history.
 */
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (!auth.ok) {
    return authError(auth);
  }

  try {
    const token = bearerToken(request);
    // Decommission line and subscription on the Express engine
    try {
      await fetch(`${billingApiBase()}/api/portal/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reason: 'Temporary pause',
          description: 'Account self-deactivated by subscriber from profile settings.',
          notSureBuyAgain: true,
        }),
      });
    } catch (err: any) {
      console.warn('Portal cancel decommissioning attempt during deactivate:', err?.message);
    }

    const pool = getDbPool();
    const row = await pool.query('SELECT raw_data FROM subscribers WHERE id = $1', [
      auth.subscriber!.id,
    ]);
    if (row.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Subscriber not found.' },
        { status: 404, headers: corsHeaders },
      );
    }

    const raw = row.rows[0].raw_data || {};
    const updated = {
      ...raw,
      status: 'deactivated',
      deactivatedAt: new Date().toISOString(),
      deactivatedBy: 'self',
    };

    await pool.query(
      `UPDATE subscribers
          SET status = 'deactivated',
              raw_data = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [JSON.stringify(updated), auth.subscriber!.id],
    );

    return NextResponse.json(
      {
        success: true,
        message: 'Your account has been deactivated. Your billing history is kept.',
      },
      { headers: corsHeaders },
    );
  } catch (error: any) {
    console.error('Error deactivating the customer account:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'The account could not be deactivated.' },
      { status: 500, headers: corsHeaders },
    );
  }
}
