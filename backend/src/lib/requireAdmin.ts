/**
 * Authentication for the admin panel's own API routes.
 *
 * The admin panel signs in against the Express API and caches the staff JWT
 * in the browser. Every request the browser makes to this app's API must
 * carry that token, and the route handlers verify it with the Express API.
 *
 * Without this, every admin route in this app was open to anyone — the whole
 * subscriber database, the payment configuration and the invoice mirror could
 * be read or overwritten by an anonymous caller.
 */

const API_BASE =
  process.env.NEXT_PUBLIC_BILLING_API_URL?.replace(/\/api$/, '') || 'http://localhost:3001';

export interface AdminPrincipal {
  id: string;
  email: string;
  name: string;
  role: string;
}

const STAFF_ROLES = new Set(['super_admin', 'billing', 'support', 'technician']);

/**
 * Verify the bearer token in the request with the Express API and return the
 * staff principal, or null when the caller is not a signed-in staff member.
 */
export async function requireAdmin(
  request: Request,
): Promise<{ ok: boolean; principal?: AdminPrincipal; error?: string }> {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    return {
      ok: false,
      error: 'Authentication required. Please sign in to the admin panel.',
    };
  }

  try {
    // Server-to-server call — no CORS headers involved.
    const response = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    if (!response.ok) {
      return { ok: false, error: 'Your session has expired. Please sign in again.' };
    }

    const payload = await response.json();
    const user = payload?.user || {};

    if (!user?.id || !STAFF_ROLES.has(String(user?.role || ''))) {
      return {
        ok: false,
        error: 'This action is restricted to staff accounts.',
      };
    }

    return {
      ok: true,
      principal: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  } catch {
    return {
      ok: false,
      error: 'The authentication service is unavailable. Please try again in a moment.',
    };
  }
}
