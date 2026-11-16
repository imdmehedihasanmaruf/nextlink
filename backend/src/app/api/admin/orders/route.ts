import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAllOrders, updateOrderStatus } from '@/lib/db';
import { apiPost, getApiToken } from '@/lib/apiClient';
import { requireAdmin } from '@/lib/requireAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALLOWED_ORIGINS = (process.env.ADMIN_CORS_ORIGINS ||
  'http://localhost:8000,http://localhost:8001,http://localhost:3000').split(',');

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request, 'billing');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401, headers: corsHeaders });
  }

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
  const auth = await requireAdmin(request, 'billing');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401, headers: corsHeaders });
  }

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

    // Provisioning is a router operation, so it is performed by the billing
    // service — it owns the MikroTik client. The status is only reported as
    // provisioned when the router confirmed it.
    let provisioning: { attempted: boolean; success: boolean; error?: string; temporaryPassword?: string } = {
      attempted: false,
      success: false,
    };

    if (status === 'Active') {
      provisioning = { attempted: true, success: false };
      try {
        const orders = await getAllOrders();
        const order = orders.find((item: any) => item.id === orderId);

        if (order) {
          // The password is random. The previous `NL-${orderId}` was
          // predictable from the order id alone.
          const provisionPassword = crypto.randomBytes(12).toString('base64url');
          const authHeader = request.headers.get('authorization') || '';
          const internalApiUrl = process.env.INTERNAL_API_URL || process.env.API_BASE_URL || 'http://localhost:3100';

          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          if (authHeader) {
            headers.Authorization = authHeader;
          }

          const res = await fetch(`${internalApiUrl}/api/mikrotik/provision`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              subscriberId: order.customer_id,
              username: order.customer_id,
              password: provisionPassword,
            }),
          });

          const result = await res.json().catch(() => ({ success: false, error: 'Non-JSON response from API' }));

          if (result.success) {
            provisioning = {
              attempted: true,
              success: true,
              // Shown once to the operator, never stored in clear text and
              // never logged.
              temporaryPassword: provisionPassword,
            };
          } else {
            provisioning = {
              attempted: true,
              success: false,
              error: result.error || 'The router did not confirm the provisioning.',
            };
          }
        }
      } catch (error: any) {
        provisioning = {
          attempted: true,
          success: false,
          error: error?.message || 'The router could not be reached.',
        };
      }
    }

    const message =
      status === 'Active'
        ? provisioning.success
          ? `Order ${orderId} approved and provisioned on the router.`
          : `Order ${orderId} approved, but the router provisioning did not complete${
              provisioning.error ? `: ${provisioning.error}` : '.'
            }`
        : `Order ${orderId} updated to status "${status}".`;

    return NextResponse.json(
      {
        success: true,
        message,
        provisioning,
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
