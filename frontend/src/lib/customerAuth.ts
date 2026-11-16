import { NextResponse } from 'next/server';

/**
 * Authentication for the customer API routes.
 *
 * The portal authenticates against the NextLink Express API, which issues a
 * subscriber JWT. These route handlers verify that token with the same
 * service, so a caller can only act on their own account. The subscriber id
 * is taken from the token, never from the request body.
 */

// Server-side verification target — the internal Express service. Browsers
// reach the same logic through the Next.js /api proxy; this constant is used
// only by the server-side routes.
const BILLING_API =
  process.env.INTERNAL_API_URL?.replace(/\/api$/, '') ||
  process.env.NEXT_PUBLIC_BILLING_API_URL?.replace(/\/api$/, '') ||
  'http://localhost:3100';

/**
 * The base URL of the internal Express service. Server-side routes use it to
 * delegate work that the billing engine owns (activation, cancellation).
 */
export function billingApiBase(): string {
  return BILLING_API;
}

/**
 * The bearer token of the incoming request, so a server-side route can
 * forward the caller's identity to the Express service.
 */
export function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export interface AuthenticatedSubscriber {
  id: string;
  name: string;
  role: string;
  type: string;
}

export interface AuthResult {
  ok: boolean;
  subscriber?: AuthenticatedSubscriber;
  error?: string;
  status: number;
}

/**
 * Verify the bearer token of the request with the billing service.
 */
export async function authenticate(request: Request): Promise<AuthResult> {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: 'Authentication required. Please sign in to your subscriber account.',
    };
  }

  try {
    const response = await fetch(`${BILLING_API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    if (!response.ok) {
      return {
        ok: false,
        status: 401,
        error: 'Your session has expired. Please sign in again.',
      };
    }

    const principal = await response.json();
    const user = principal?.user || {};

    if (user.role !== 'subscriber' || !user.id) {
      return {
        ok: false,
        status: 403,
        error: 'This action is restricted to subscriber accounts.',
      };
    }

    return {
      ok: true,
      status: 200,
      subscriber: {
        id: user.id,
        name: user.name,
        role: user.role,
        type: 'subscriber',
      },
    };
  } catch {
    return {
      ok: false,
      status: 503,
      error: 'The authentication service is unavailable. Please try again in a moment.',
    };
  }
}

/**
 * Answer with the error of an authentication result.
 */
export function authError(result: AuthResult) {
  return NextResponse.json(
    { success: false, error: result.error },
    { status: result.status }
  );
}

/**
 * Check that the authenticated subscriber owns the account in the request.
 */
export function ownsAccount(result: AuthResult, customerId: string | undefined) {
  if (!result.ok || !result.subscriber) return false;
  if (!customerId) return true;
  return result.subscriber.id === customerId;
}
