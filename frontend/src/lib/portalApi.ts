'use client';

/**
 * Client for the NextLink Express API (Backend Engine, port 3001).
 *
 * Used by the subscriber portal for real bill payment: invoices are read from
 * the API and payments are settled through bKash / Nagad / SSLCommerz / Rocket.
 */

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_BILLING_API_URL?.replace(/\/api$/, '') || 'http://localhost:3001';

const TOKEN_KEY = 'nextlink-subscriber-api-token';

export interface PortalInvoice {
  id: string;
  subscriber_id: string;
  amount: string | number;
  status: 'paid' | 'unpaid' | string;
  due_date: string;
  raw_data: any;
  created_at: string;
}

export interface PortalTransaction {
  id: string;
  invoice_id: string;
  gateway: string;
  amount: string | number;
  status: string;
  gateway_txn_id: string;
  created_at: string;
}

export interface PortalSummary {
  outstanding: number;
  unpaidCount: number;
  paidCount: number;
  paidTotal: number;
  nextInvoice: { id: string; due_date: string; amount: string | number } | null;
  subscriber: {
    id: string;
    name: string;
    phone: string;
    email: string;
    status: string;
    packageId: string;
    packageName: string;
  } | null;
}

export interface ApiResult<T = any> {
  success: boolean;
  error?: string;
  data?: T;
  [key: string]: any;
}

/** Read the cached subscriber API token. */
export function getSubscriberToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

/** Cache the subscriber API token. */
export function setSubscriberToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

/**
 * Log the subscriber in against the Express API and cache the JWT.
 */
export async function subscriberLogin(username: string, password: string): Promise<ApiResult> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/subscriber-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const payload = await response.json();
    if (payload.success && payload.token) setSubscriberToken(payload.token);
    return payload;
  } catch {
    return { success: false, error: 'Cannot reach the billing service. Please try again later.' };
  }
}

/**
 * Authenticated request against the Express API.
 */
export async function portalFetch<T = any>(path: string, options: RequestInit = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  const token = getSubscriberToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
    const payload = await response.json();
    if (!response.ok && !payload.error) {
      return { success: false, error: `Request failed (${response.status})` };
    }
    return payload;
  } catch {
    return { success: false, error: 'Cannot reach the billing service. Please try again later.' };
  }
}

/** Load the subscriber's invoices and transactions. */
export async function fetchMyInvoices() {
  return portalFetch<{ invoices: PortalInvoice[]; transactions: PortalTransaction[] }>(
    '/api/portal/my-invoices'
  );
}

/** Load the subscriber's billing summary. */
export async function fetchMySummary() {
  return portalFetch<{ summary: PortalSummary }>('/api/portal/my-summary');
}

/**
 * Start a payment for an invoice. Returns the gateway redirect URL.
 */
export async function payInvoice(invoiceId: string, gateway: string) {
  return portalFetch<{
    redirectUrl: string;
    gatewayTransactionId: string;
    transactionId: string;
    amount: number;
    currency: string;
  }>('/api/portal/pay', {
    method: 'POST',
    body: JSON.stringify({ invoiceId, gateway }),
  });
}
