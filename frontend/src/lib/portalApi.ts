'use client';

/**
 * Client for the Express API (Backend Engine).
 *
 * In this workspace the portal is served by Next.js on port 3000 and Next
 * proxies /api/* to the internal Express service on port 3000. The default
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
  installation_fee?: string | number;
  tax_fee?: string | number;
  late_fee?: string | number;
  carried_over_amount?: string | number;
  late_fee_applied?: boolean;
  status: 'paid' | 'unpaid' | string;
  due_date: string;
  package_name?: string;
  package_speed?: number;
  package_price?: number;
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
  nextInvoice: { id: string | null; due_date: string; amount: string | number; isEstimated?: boolean } | null;
  isCurrentPeriodPaid?: boolean;
  alreadyPaid?: boolean;
  paidMonthYear?: string;
  nextDueDate?: string;
  paidNotice?: string;
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
    if (token) {
      requestHeaders.Authorization = `Bearer ${token}`;
    } else if (typeof window !== 'undefined') {
      try {
        const storedAuth =
          window.localStorage.getItem('nextlink-subscriber-auth') ||
          window.localStorage.getItem('nextlink-auth');
        if (storedAuth) {
          const parsed = JSON.parse(storedAuth);
          const userId = parsed?.state?.user?.id;
          if (userId) {
            requestHeaders['x-subscriber-id'] = userId;
          }
        }
      } catch {}
    }
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

export interface PaymentGatewayItem {
  id: string;
  name: string;
  supported: boolean;
  method?: string;
  description?: string;
}

export interface PaymentInitiateResult {
  transactionId: string;
  gatewayTransactionId: string;
  redirectUrl: string;
  amount: number;
  currency: string;
  invoiceId: string;
}

/**
 * Fetch available payment gateways and active mode from backend.
 */
export async function fetchPaymentGateways() {
  return portalFetch<{
    mode: string;
    gateways: PaymentGatewayItem[];
  }>('/api/payments/gateways', { auth: false });
}

/**
 * Start a payment for an invoice. Returns the gateway redirect URL.
 */
export async function payInvoice(
  invoiceId: string,
  gateway: string,
  customer?: { name?: string; email?: string; phone?: string; address?: string }
) {
  // Try /api/payments/initiate first, falling back to /api/portal/pay
  const res = await portalFetch<PaymentInitiateResult>('/api/payments/initiate', {
    method: 'POST',
    body: JSON.stringify({ invoiceId, gateway, customer }),
  });
  if (res.success && res.redirectUrl) return res;
  return portalFetch<PaymentInitiateResult>('/api/portal/pay', {
    method: 'POST',
    body: JSON.stringify({ invoiceId, gateway }),
  });
}

/**
 * Verify a payment transaction against the gateway (reconciliation check).
 */
export async function verifyPaymentTransaction(gateway: string, transactionId: string) {
  return portalFetch<{
    success: boolean;
    status: string;
    transactionId: string;
    amount?: number;
    error?: string;
  }>('/api/payments/verify', {
    method: 'POST',
    body: JSON.stringify({ gateway, transactionId }),
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
  raw_data?: any;
  created_at: string;
  updated_at: string;
}

/** The signed-in subscriber's subscription state and lifecycle dates. */
export async function fetchMySubscription() {
  return portalFetch<{
    subscription: {
      status: string;
      isSubscriber: boolean;
      packageId: string;
      packageName: string;
      subscriptionStartedAt: string | null;
      subscriptionCancelledAt: string | null;
      billingProfile: { status: string; amount: number; nextInvoiceDate: string | null } | null;
      lastPurchase: { id: string; packageName: string; amount: number; createdAt: string } | null;
      invoices: Array<{ id: string; amount: number; status: string; dueDate: string; createdAt: string }>;
      canCancel: boolean;
    };
  }>('/api/customer/subscription');
}

/** Cancel the current subscription. */
export async function cancelSubscription(reason?: string) {
  return portalFetch<{ cancelledAt: string | null }>('/api/customer/subscription/cancel', {
    method: 'POST',
    body: JSON.stringify({ reason: reason || null }),
  });
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

/** Request or immediately activate a turbo boost. */
export async function requestTurboBoost(payload: {
  durationHours: number;
  requestedMbps: number;
  action?: 'activate' | 'request';
}) {
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
      expiresAt?: string | null;
      remainingSeconds?: number;
    };
  }>('/api/customer/turbo-boost', { method: 'POST', body: JSON.stringify(payload) });
}

/** Deactivate the currently active turbo boost. */
export async function deactivateTurboBoost(id?: string) {
  return portalFetch<{
    request: {
      id: string;
      reference: string;
      status: string;
    };
  }>('/api/customer/turbo-boost/deactivate', {
    method: 'POST',
    body: JSON.stringify(id ? { id } : {}),
  });
}

/** Fetch real-time live telemetry for dashboard cards 5–11 and authoritative subscriber package. */
export async function fetchLiveTelemetry() {
  return portalFetch<{
    telemetry: {
      timestamp: string;
      subscriber: {
        id: string;
        firstName: string;
        lastName: string;
        name: string;
        status: string;
        packageId: string;
        packageName: string;
        speedMbps: number;
        price: number;
      };
      bandwidthTraffic: {
        enabled: boolean;
        downloadRateMbps: number;
        uploadRateMbps: number;
        allocatedDownloadMbps: number;
        allocatedUploadMbps: number;
        consumedDataGB: number;
        totalQuotaGB: string | number;
        utilizationPercent: number;
        interfaces: Array<{
          id: string;
          name: string;
          type: string;
          rx: string;
          tx: string;
          status: string;
        }>;
      };
      referral: {
        enabled: boolean;
        title: string;
        description: string;
        code: string;
        referralLink: string;
        bonusAmount: number;
        referralCount: number;
        qualifiedCount: number;
        pendingCount: number;
        creditsEarned: number;
        creditsPending: number;
        referrals: any[];
      };
      turboBoost: {
        enabled: boolean;
        title: string;
        description: string;
        boostSpeedMbps: number;
        durationHours: number;
        status: 'active' | 'expired' | 'requested' | 'available';
        active: boolean;
        remainingSeconds: number;
        activeBoost: any | null;
        latestBoost: any | null;
        historyCount: number;
      };
      opticalTerminal: {
        ontStatus: string;
        signalRxDbm: number;
        signalTxDbm: number;
        signalQuality: string;
        uptime: string;
        gatewayIpv4: string;
        gatewayIpv6: string;
        oltPort: string;
        macAddress: string;
        onuModel: string;
        temperatureC: number;
      };
      liveLatency: {
        enabled: boolean;
        title: string;
        description: string;
        avgPingMs: number;
        jitterMs: number;
        packetLossPercent: number;
        targets: Array<{
          id: string;
          name: string;
          host: string;
          port: number;
          status: string;
          pingMs: number | null;
          ping: string;
          jitterMs: number;
          packetLossPercent: number;
          measuredAt: string;
        }>;
      };
      peeringHubs: Array<{
        id: string;
        name: string;
        url: string;
        badge: string;
        status: string;
        capacityGbps: number;
      }>;
      tier1Peering: {
        title: string;
        provider: string;
        asn: string;
        routeStatus: string;
        capacityGbps: number;
        uptimePercent: number;
        avgLatencyMs: number;
        activeHubCount: number;
      };
    };
  }>('/api/portal/live-telemetry');
}

/** Download an invoice PDF from the billing service. */
export async function downloadInvoicePdf(invoiceId: string): Promise<boolean> {
  try {
    const token = getSubscriberToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE_URL}/api/billing/invoices/${encodeURIComponent(invoiceId)}/pdf`, {
      headers,
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${invoiceId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

/** Create a support ticket. */
export async function createTicket(payload: {
  subject: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  attachment?: { name: string; size: number; type: string; dataUrl?: string } | null;
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

/** Update ticket status (e.g. subscriber closing their resolved ticket). */
export async function updateTicketStatus(
  ticketId: string,
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
) {
  return portalFetch<{ ticket: any }>(`/api/tickets/${encodeURIComponent(ticketId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export interface CancelInfoResponse {
  has_active_subscription?: boolean;
  hasActivePackage?: boolean;
  subscriber: {
    id: string;
    name: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    status: string;
    packageId: string;
    packageName: string;
    packageSpeed: number;
    packageLabel: string;
    monthlyFee: number;
    balance: number;
    hasActivePackage: boolean;
  };
  lastPurchase: {
    purchaseDate: string;
    purchaseTime: string;
    city: string;
    postalCode: string;
    state: string;
    country: string;
    formattedCityPostal: string;
    formattedStateCountry: string;
    subscriberId: string;
    invoiceNumber: string;
    orderId: string | null;
    packageName: string;
    packageSpeed: number;
    packageLabel: string;
  };
  cancellation: any | null;
  cancelReasons: string[];
  settings: {
    effectiveDateRule: string;
    allowNotSureBuyAgain: boolean;
  };
}

export interface CancelInvoiceItem {
  id: string;
  invoice_number: string;
  package_name: string;
  cancel_date: string;
  cancel_time: string;
  reason: string;
  status: string;
  total_amount: number;
  amount_paid: number;
  city: string;
  postal_code: string;
  state: string;
  country: string;
  description?: string;
  buy_again_date?: string;
  created_at: string;
  raw_data?: any;
}

export async function fetchCancelInfo() {
  return portalFetch<CancelInfoResponse>('/api/portal/cancel-info');
}

export async function submitCancelRequest(payload: {
  packageId?: string;
  packageName?: string;
  reason: string;
  description: string;
  buyAgainDate?: string | null;
  notSureBuyAgain?: boolean;
  effectiveDate?: string;
  cancelSession?: {
    city?: string;
    postalCode?: string;
    state?: string;
    country?: string;
  };
}) {
  return portalFetch<{
    cancellation: any;
    cancelInvoice: any;
    message?: string;
  }>('/api/portal/cancel', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchCancelInvoices() {
  return portalFetch<{ invoices: CancelInvoiceItem[] }>('/api/portal/cancel-invoices');
}

export async function fetchCancelInvoice(id: string) {
  return portalFetch<{ invoice: any }>(`/api/portal/cancel-invoices/${encodeURIComponent(id)}`);
}

/**
 * Save user UI preferences (theme, themeColor, fontSize, language, autoSave)
 * Saves to both /api/portal/preferences and /api/customer/preferences
 */
export async function saveUserPreferences(prefs: {
  theme?: string;
  themeColor?: string;
  fontSize?: string;
  language?: string;
  autoSave?: boolean;
}) {
  try {
    const res = await portalFetch<{ success: boolean; preferences: any; theme?: string }>(
      '/api/portal/preferences',
      {
        method: 'PATCH',
        body: JSON.stringify(prefs),
      }
    );
    return res;
  } catch {
    // Fallback to customer API route
    const token = getSubscriberToken();
    const res = await fetch('/api/customer/preferences', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(prefs),
    });
    return res.json();
  }
}

/**
 * Fetch authenticated subscriber's saved UI preferences
 */
export async function fetchUserPreferences() {
  try {
    return await portalFetch<{ success: boolean; preferences: any; theme?: string }>(
      '/api/portal/preferences'
    );
  } catch {
    const token = getSubscriberToken();
    const res = await fetch('/api/customer/preferences', {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return res.json();
  }
}

