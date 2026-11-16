import { NextResponse } from 'next/server';
import { getDbPool, findSubscriber } from '@/lib/db';
import { authenticate, authError } from '@/lib/customerAuth';

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

/**
 * GET /api/customer/profile
 * Returns the current subscriber's profile including firstName and lastName.
 */
export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (!auth.ok) {
    return authError(auth);
  }

  try {
    const subscriber = await findSubscriber(auth.subscriber!.id);
    if (!subscriber) {
      return NextResponse.json(
        { success: false, error: 'Subscriber not found.' },
        { status: 404, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        success: true,
        user: {
          id: subscriber.id,
          firstName: subscriber.firstName,
          lastName: subscriber.lastName,
          name: subscriber.name,
          email: subscriber.email,
          phone: subscriber.phone,
          address: subscriber.address,
        },
      },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to fetch profile' },
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * Save the contact details the subscriber is allowed to edit.
 *
 * The subscriber's own account is updated — the id comes from the token, not
 * from the payload, so one customer can never edit another customer's record.
 */
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (!auth.ok) {
    return authError(auth);
  }

  try {
    const body = await request.json();
    const rawFirstName = typeof body?.firstName === 'string' ? body.firstName.trim() : '';
    const rawLastName = typeof body?.lastName === 'string' ? body.lastName.trim() : '';
    const rawFullName = typeof body?.name === 'string' ? body.name.trim() : '';

    const parts = rawFullName ? rawFullName.split(/\s+/) : [];
    const firstName = rawFirstName || parts[0] || '';
    const lastName = rawLastName || parts.slice(1).join(' ') || '';
    const name = `${firstName} ${lastName}`.trim() || rawFullName;

    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
    const address = typeof body?.address === 'string' ? body.address.trim() : '';

    if (!firstName || name.length < 2) {
      return NextResponse.json(
        { success: false, error: 'First Name and Last Name are required.' },
        { status: 400, headers: corsHeaders },
      );
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
      id: auth.subscriber!.id,
      firstName,
      lastName,
      name,
      email,
      phone,
      address,
    };

    await pool.query(
      `UPDATE subscribers
          SET first_name = $1,
              last_name = $2,
              name = $3,
              email = $4,
              phone = $5,
              raw_data = $6,
              updated_at = NOW()
        WHERE id = $7`,
      [firstName, lastName, name, email, phone, JSON.stringify(updated), auth.subscriber!.id],
    );

    return NextResponse.json(
      {
        success: true,
        message: 'Profile saved.',
        user: {
          id: auth.subscriber!.id,
          firstName,
          lastName,
          name,
          email,
          phone,
          address,
        },
      },
      { headers: corsHeaders },
    );
  } catch (error: any) {
    console.error('Error saving the customer profile:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'The profile could not be saved.' },
      { status: 500, headers: corsHeaders },
    );
  }
}

export const PUT = POST;
