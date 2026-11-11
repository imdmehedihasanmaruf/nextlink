'use client';

/**
 * Client for the NextLink Express API (Backend Engine, port 3001).
 *
 * The admin panel keeps its existing local state for backwards compatibility;
 * this client is used for the live Phase 3 features (billing engine,
 * MikroTik provisioning, payment gateways, SMS log).
 *
 * The JWT is obtained from the API at login time and cached in localStorage.
 */

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_BILLING_API_URL?.replace(/\/api$/, '') || 'http://localhost:3001';

const TOKEN_KEY = 'nextlink-api-token';

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  error?: string;
  data?: T;
  [key: string]: any;
}

/** Read the cached API token. */
export function getApiToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

/** Cache the API token. */
export function setApiToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

/**
 * Authenticate against the Express API and cache the returned JWT.
 * Returns null when the API is unreachable so the caller can degrade
 * gracefully instead of breaking the admin panel.
 */
export async function apiLogin(email: string, password: string): Promise<ApiUser | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) return null;

    const payload = await response.json();
    if (!payload.success || !payload.token) return null;

    setApiToken(payload.token);
    return payload.user as ApiUser;
  } catch {
    return null;
  }
}

/** Log out of the Express API (clears the cached token). */
export function apiLogout() {
  setApiToken(null);
}

/**
 * Remove the cached token without calling the API.
 */
export function clearApiToken() {
  setApiToken(null);
}

/**
 * Perform an authenticated request against the Express API.
 */
export async function apiFetch<T = any>(
  path: string,
  options: RequestInit & { auth?: boolean } = {}
): Promise<ApiResponse<T>> {
  const { auth = true, headers, ...rest } = options;

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((headers as Record<string, string>) || {}),
  };

  if (auth) {
    const token = getApiToken();
    if (token) requestHeaders.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      headers: requestHeaders,
    });

    // Binary responses (PDF) are returned as-is.
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      if (!response.ok) {
        return { success: false, error: `Request failed (${response.status})` };
      }
      return { success: true, blob: await response.blob() } as ApiResponse<T>;
    }

    const payload = await response.json();
    if (!response.ok && !payload.error) {
      return { success: false, error: `Request failed (${response.status})` };
    }
    return payload;
  } catch (error: any) {
    return {
      success: false,
      error: `Cannot reach the NextLink API at ${API_BASE_URL}. Is it running?`,
    };
  }
}

/** GET helper. */
export function apiGet<T = any>(path: string, auth = true) {
  return apiFetch<T>(path, { method: 'GET', auth });
}

/** POST helper. */
export function apiPost<T = any>(path: string, body?: any, auth = true) {
  return apiFetch<T>(path, {
    method: 'POST',
    auth,
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * Open an authenticated PDF in a new browser tab.
 * Because the endpoint needs an Authorization header, the file is fetched as a
 * blob and then opened via an object URL.
 */
export async function openPdf(path: string): Promise<boolean> {
  const token = getApiToken();
  if (!token) return false;

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return false;

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether the Express API is reachable.
 */
export async function apiHealth(): Promise<ApiResponse> {
  return apiGet('/health', false);
}
