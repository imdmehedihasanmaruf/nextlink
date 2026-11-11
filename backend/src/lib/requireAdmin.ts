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

// Server-to-server verification target — the internal Express service.
const API_BASE =
  process.env.INTERNAL_API_URL?.replace(/\/api$/, '') || 'http://localhost:3100';

export interface AdminPrincipal {
  id: string;
  email: string;
  name: string;
  role: string;
}

const STAFF_ROLES = new Set(['super_admin', 'billing', 'support', 'technician', 'noc_operator']);

/**
 * The built-in permission matrix, used when the roles table has not been
 * loaded yet — it mirrors src/lib/roles.ts. Once the operator edits the
 * matrix in the admin UI, the stored matrix is the source of truth.
 */
const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  super_admin: [
    'dashboard', 'subscribers', 'packages', 'billing', 'tickets', 'technicians',
    'referral_rewards', 'boost_bandwidth', 'live_latency', 'interface_traffic', 'peering_hubs',
    'reports', 'cms', 'settings', 'roles',
  ],
  billing: ['dashboard', 'subscribers', 'billing', 'referral_rewards', 'reports'],
  support: ['dashboard', 'subscribers', 'tickets', 'technicians', 'boost_bandwidth', 'live_latency'],
  technician: ['dashboard', 'tickets', 'technicians', 'live_latency', 'interface_traffic'],
  noc_operator: ['dashboard', 'reports', 'tickets', 'live_latency', 'interface_traffic', 'peering_hubs'],
};

async function loadPermissions(): Promise<Record<string, string[]>> {
  try {
    // eslint-disable-next-line global-require
    const { getAdminStore } = require('@/lib/db');
    const store = await getAdminStore();
    const roles = Array.isArray(store?.roles) ? store.roles : [];
    if (roles.length === 0) return DEFAULT_PERMISSIONS;

    const fromTable: Record<string, string[]> = {};
    for (const role of roles) {
      if (role?.key && Array.isArray(role.permissions)) {
        fromTable[role.key] = role.permissions;
      }
    }
    return { ...DEFAULT_PERMISSIONS, ...fromTable };
  } catch {
    return DEFAULT_PERMISSIONS;
  }
}

/**
 * Check a permission against the stored (operator-edited) matrix or the
 * built-in defaults. Used when the required permission depends on the
 * request body, so requireAdmin() cannot evaluate it up front.
 */
export async function hasRolePermission(
  roleKey: string,
  permission: string,
): Promise<boolean> {
  const permissions = await loadPermissions();
  const allowed = permissions[roleKey] || [];
  return allowed.includes(permission);
}

/**
 * Verify the bearer token in the request with the Express API and return the
 * staff principal, or null when the caller is not a signed-in staff member.
 */
export async function requireAdmin(
  request: Request,
  permission?: string,
): Promise<{ ok: boolean; principal?: AdminPrincipal; error?: string; status?: number }> {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    return {
      ok: false,
      error: 'Authentication required. Please sign in to the admin panel.',
      status: 401,
    };
  }

  try {
    // Server-to-server call — no CORS headers involved.
    const response = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    if (!response.ok) {
      return { ok: false, error: 'Your session has expired. Please sign in again.', status: 401 };
    }

    const payload = await response.json();
    const user = payload?.user || {};

    if (!user?.id || !STAFF_ROLES.has(String(user?.role || ''))) {
      return {
        ok: false,
        error: 'This action is restricted to staff accounts.',
        status: 403,
      };
    }

    const roleKey = String(user?.role || '');
    if (permission && !(await hasRolePermission(roleKey, permission))) {
      return {
        ok: false,
        error: 'Your role does not have permission for this action.',
        status: 403,
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
      status: 503,
    };
  }
}
