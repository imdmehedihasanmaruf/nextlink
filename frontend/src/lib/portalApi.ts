'use client';

/**
 * Client for the Express API (Backend Engine).
 *
 * In this workspace the portal is served by Next.js on port 3000 and Next
 * proxies /api/* to the internal Express service on port 3100. The default
 * BASE is therefore same-origin (relative) — in production you may set
 * NEXT_PUBLIC_BILLING_API_URL to an absolute URL instead, e.g. a CDN-fronted
 * domain or a separate API subdomain.
 */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_BILLING_API_URL?.replace(/\/api$/, '') || '';

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
    creditBalance: number;
    referralReward: number;
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
 * Remove the cached token. Called when the subscriber signs out, so the next
 * sign-in cannot reuse the previous token.
 */
export function clearSubscriberToken() {
  setSubscriberToken(null);
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
 *
 * @param auth  When false the request is sent without the bearer token, which
 *              is what the public endpoints (connection requests, coverage
 *              finder) need.
 */
export async function portalFetch<T = any>(
  path: string,
  options: RequestInit & { auth?: boolean } = {},
): Promise<ApiResult<T>> {
  const { auth = true, headers, ...rest } = options;

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((headers as Record<string, string>) || {}),
  };

  if (auth) {
    const token = getSubscriberToken();
    if (token) requestHeaders.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { ...rest, headers: requestHeaders });
    const payload = await response.json();
    if (!response.ok && !payload.error) {
      return { success: false, error: `Request failed (${response.status})` };
    }
    return payload;
  } catch {
    return { success: false, error: 'Cannot reach the billing service. Please try again later.' };
  }
}

/**
 * The bearer token of the signed-in subscriber, for the calls that go to this
 * app's own API routes.
 */
export function subscriberAuthHeader(): Record<string, string> {
  const token = getSubscriberToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
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

// ---------------------------------------------------------------------------
// Public website — connection requests and coverage finder
// ---------------------------------------------------------------------------

/**
 * Submit an online connection request (SRS 3.1).
 * The ID document is sent as a base64 data URL and stored server side.
 */
export async function submitConnectionRequest(payload: {
  fullName: string;
  phone: string;
  email?: string | null;
  idNumber: string;
  idDocumentDataUrl?: string | null;
  address: string;
  packageId?: string | null;
  packageName?: string | null;
  ontConfig?: string | null;
  referral?: string | null;
}) {
  return portalFetch<{ request: { id: string; status: string; createdAt: string } }>(
    '/api/applications',
    { method: 'POST', body: JSON.stringify(payload), auth: false },
  );
}

export interface CoverageArea {
  id: string;
  zone: string;
  district: string | null;
  areas: string[];
  status: 'available' | 'unavailable' | 'planned';
  lat: number | null;
  lng: number | null;
  notes: string | null;
}

/** List the coverage zones available for the location checker. */
export async function fetchCoverageZones() {
  return portalFetch<{
    zones: Array<{ zone: string; area_count: number; available_count: number }>;
  }>('/api/coverage/zones', { auth: false });
}

/** List the districts inside a zone. */
export async function fetchCoverageDistricts(zone: string) {
  return portalFetch<{
    zone: string;
    districts: Array<{ district: string; area_count: number; available_count: number }>;
  }>(`/api/coverage/districts?zone=${encodeURIComponent(zone)}`, { auth: false });
}

/** Every coverage area, with coordinates for the map. */
export async function fetchCoverageAreas() {
  return portalFetch<{ areas: CoverageArea[] }>('/api/coverage/areas', { auth: false });
}

/** Check whether a specific location is covered. */
export async function checkCoverage(zone: string, district?: string, area?: string) {
  const params = new URLSearchParams({ zone });
  if (district) params.set('district', district);
  if (area) params.set('area', area);
  return portalFetch<{
    covered: boolean;
    reason: string;
    zone: string;
    district?: string;
    areas?: string[];
    lat?: number | null;
    lng?: number | null;
  }>(`/api/coverage/check?${params.toString()}`, { auth: false });
}

// ---------------------------------------------------------------------------
// Support tickets
// ---------------------------------------------------------------------------

export interface PortalTicket {
  id: string;
  title: string;
  subject?: string;
  status: string;
  priority: string;
  category?: string;
  description?: string;
  assigned_to_name?: string | null;
  sla_due_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** The signed-in subscriber's referral information. */
export async function fetchMyReferral() {
  return portalFetch<{
    code: string;
    enabled: boolean;
    title: string;
    description: string;
    bonusAmount: number;
    stats: { pending: number; qualified: number; credited: number; void: number; totalCredited: number };
    referrals: Array<{
      id: string;
      code: string;
      status: string;
      rewardAmount: number;
      qualifiedAt: string | null;
      creditedAt: string | null;
      createdAt: string;
    }>;
  }>('/api/customer/referral');
}

/** List the signed-in subscriber's turbo boost requests. */
export async function fetchMyTurboBoost() {
  return portalFetch<{
    activeRequest: boolean;
    maxMbps: number;
    requests: Array<{
      id: string;
      reference: string;
      durationHours: number;
      requestedMbps: number;
      status: string;
      adminNote: string | null;
      ticketId: string | null;
      createdAt: string;
      decidedAt: string | null;
      appliedAt: string | null;
    }>;
  }>('/api/customer/turbo-boost');
}

/** Request a turbo boost. */
export async function requestTurboBoost(payload: { durationHours: number; requestedMbps: number }) {
  return portalFetch<{
    reference: string;
    request: {
      id: string;
      reference: string;
      status: string;
      durationHours: number;
      requestedMbps: number;
      ticketId: string | null;
      createdAt: string;
    };
  }>('/api/customer/turbo-boost', { method: 'POST', body: JSON.stringify(payload) });
}

/** Create a support ticket. */
export async function createTicket(payload: {
  subject: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}) {
  return portalFetch<{
    ticket: {
      id: string;
      status: string;
      priority: string;
      assignedTo: string | null;
      slaDueAt: string;
      createdAt: string;
    };
  }>('/api/tickets', { method: 'POST', body: JSON.stringify(payload) });
}

/** List the signed-in subscriber's tickets. */
export async function fetchMyTickets() {
  return portalFetch<{ tickets: PortalTicket[] }>('/api/tickets');
}

/** Read one ticket with its conversation thread. */
export async function fetchTicket(ticketId: string) {
  return portalFetch<{ ticket: PortalTicket & { thread?: any[] } }>(
    `/api/tickets/${encodeURIComponent(ticketId)}`
  );
}

/** Reply to a ticket. */
export async function replyToTicket(ticketId: string, body: string) {
  return portalFetch<{ message: any }>(`/api/tickets/${encodeURIComponent(ticketId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}
