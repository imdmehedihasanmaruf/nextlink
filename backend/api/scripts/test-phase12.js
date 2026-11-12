'use strict';

/**
 * Phase 1 & 2 feature test — public website and admin core.
 *
 * Covers:
 *   * online connection request (with NID document upload)
 *   * coverage finder (zones, districts, availability check)
 *   * ticket lifecycle (create, auto-assign, SLA, status change, thread)
 *   * system settings persistence (MikroTik / SMS / gateway config)
 *   * role enforcement on the new endpoints
 *
 * Run with:  node scripts/test-phase12.js
 */

const BASE = process.env.API_BASE_URL || 'http://localhost:3100';

let passed = 0;
let failed = 0;

function assert(condition, label, extra) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ''}`);
  }
}

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  // The body is read once and parsed from text — reading it twice throws
  // "Body is unusable" when the response is not valid JSON.
  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = { raw };
  }
  return { status: response.status, body: payload };
}

/** A tiny valid PNG (1x1) as a base64 data URL. */
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function run() {
  console.log('\n=== Phase 1 & 2 feature test ===\n');

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@nextlink.com', password: 'admin123' },
  });
  const token = login.body.token;
  assert(login.status === 200 && token, 'staff token obtained');

  // -----------------------------------------------------------------------
  console.log('\n1. Online connection request (SRS 3.1)');
  const request = await api('/api/applications', {
    method: 'POST',
    body: {
      fullName: 'Test Applicant',
      phone: '+8801712345678',
      email: 'applicant@example.com',
      idNumber: 'A1234567890',
      idDocumentDataUrl: PNG_DATA_URL,
      address: 'House 12, Road 5, Banani, Dhaka 1213, Bangladesh',
      packageId: 'PKG-004',
      packageName: 'Premium',
      ontConfig: 'Wi-Fi 6 Gateway Mode',
      referral: '',
    },
  });
  assert(request.status === 201 && request.body.success, 'connection request accepted', request.body);
  assert(Boolean(request.body.request?.id), 'reference id returned', request.body.request);
  const requestId = request.body.request?.id;

  const listRequests = await api('/api/applications', { token });
  assert(
    listRequests.status === 200 &&
      listRequests.body.requests.some((r) => r.id === requestId),
    'request appears in the admin list',
  );

  const stored = listRequests.body.requests.find((r) => r.id === requestId);
  assert(Boolean(stored.id_document_path), 'ID document stored on the server', stored?.id_document_path);
  assert(stored.status === 'pending', 'request starts as pending', stored?.status);

  const documentResponse = await fetch(`${BASE}/api/applications/${requestId}/document`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(documentResponse.status === 200, 'ID document can be downloaded by staff');

  const statusUpdate = await api(`/api/applications/${requestId}`, {
    method: 'PATCH',
    token,
    body: { status: 'approved' },
  });
  assert(statusUpdate.body.request?.status === 'approved', 'request status updated', statusUpdate.body);

  const unauthenticated = await api('/api/applications');
  assert(unauthenticated.status === 401, 'application list requires authentication');

  // -----------------------------------------------------------------------
  console.log('\n2. Coverage finder (SRS 3.1)');
  const zones = await api('/api/coverage/zones');
  assert(zones.status === 200 && zones.body.zones.length > 0, 'coverage zones listed', zones.body.zones?.length);
  assert(
    zones.body.zones.every((z) => z.area_count > 0),
    'every zone reports its area count',
  );

  const firstZone = zones.body.zones[0].zone;
  const districts = await api(`/api/coverage/districts?zone=${encodeURIComponent(firstZone)}`);
  assert(districts.status === 200 && districts.body.districts.length > 0, 'districts listed for a zone');

  const districts2 = await api('/api/coverage/districts?zone=Europe');
  const paris = districts2.body.districts.find((d) => d.district === 'Paris Metro');
  assert(Boolean(paris), 'Paris Metro district present in the seeded data');

  const availableCheck = await api('/api/coverage/check?zone=Europe&district=London Central');
  assert(availableCheck.body.covered === true, 'available district reports covered', availableCheck.body);

  const unavailableCheck = await api('/api/coverage/check?zone=Europe&district=Paris Metro');
  assert(unavailableCheck.body.covered === false, 'unavailable district reports not covered', unavailableCheck.body);

  const unknownCheck = await api('/api/coverage/check?zone=Atlantis');
  assert(unknownCheck.body.covered === false, 'unknown zone reports not covered', unknownCheck.body);

  const areas = await api('/api/coverage/areas');
  assert(areas.body.areas.length > 0, 'coverage areas listed for the map');
  assert(
    areas.body.areas.some((a) => a.lat !== null && a.lng !== null),
    'coverage areas carry map coordinates',
  );

  // -----------------------------------------------------------------------
  console.log('\n3. Ticket lifecycle (SRS 3.3)');
  const subscriberLogin = await api('/api/auth/subscriber-login', {
    method: 'POST',
    body: { username: 'alexwright', password: 'AlexPassword@2026' },
  });
  const subscriberToken = subscriberLogin.body.token;
  assert(subscriberLogin.status === 200 && subscriberToken, 'subscriber token obtained');

  const ticket = await api('/api/tickets', {
    method: 'POST',
    token: subscriberToken,
    body: {
      subject: 'Fiber link is down at my premises',
      category: 'Fiber/Optical',
      priority: 'critical',
      description: 'The PON LOS light has been blinking red since this morning and the service is completely down.',
    },
  });
  assert(ticket.status === 201 && ticket.body.success, 'ticket created', ticket.body);
  assert(Boolean(ticket.body.ticket?.id), 'ticket id returned');
  assert(Boolean(ticket.body.ticket?.slaDueAt), 'SLA deadline computed', ticket.body.ticket);
  const ticketId = ticket.body.ticket?.id;

  const myTickets = await api('/api/tickets', { token: subscriberToken });
  assert(
    myTickets.body.tickets.some((t) => t.id === ticketId),
    'ticket appears in the subscriber list',
  );

  const ticketDetail = await api(`/api/tickets/${ticketId}`, { token: subscriberToken });
  assert(ticketDetail.status === 200, 'ticket detail readable by the owner');
  assert(
    ticketDetail.body.ticket.sla_due_at !== null,
    'SLA deadline stored on the ticket',
    ticketDetail.body.ticket?.sla_due_at,
  );

  const otherTicket = await api(`/api/tickets/${ticketId}`, { token });
  assert(otherTicket.status === 200, 'staff can read the ticket');

  const reply = await api(`/api/tickets/${ticketId}/messages`, {
    method: 'POST',
    token: subscriberToken,
    body: { body: 'Router LOS light is still red, please send a technician.' },
  });
  assert(reply.status === 201, 'subscriber can reply to the thread');

  const staffReply = await api(`/api/tickets/${ticketId}/messages`, {
    method: 'POST',
    token,
    body: { body: 'A technician has been dispatched and will arrive within 4 hours.' },
  });
  assert(staffReply.status === 201, 'staff can reply to the thread');

  const thread = await api(`/api/tickets/${ticketId}`, { token: subscriberToken });
  assert(thread.body.ticket.thread.length >= 2, 'thread holds both messages', thread.body.ticket.thread?.length);
  assert(
    Boolean(thread.body.ticket.first_response_at),
    'first staff response stamps the SLA response time',
    thread.body.ticket?.first_response_at,
  );

  const statusChange = await api(`/api/tickets/${ticketId}/status`, {
    method: 'PATCH',
    token,
    body: { status: 'in_progress' },
  });
  assert(statusChange.body.ticket?.status === 'in_progress', 'staff can change the status', statusChange.body);

  const subscriberStatusChange = await api(`/api/tickets/${ticketId}/status`, {
    method: 'PATCH',
    token: subscriberToken,
    body: { status: 'resolved' },
  });
  assert(subscriberStatusChange.status === 403, 'subscribers cannot change the status');

  const stats = await api('/api/tickets/stats', { token });
  assert(stats.status === 200 && stats.body.totals, 'CRM statistics available', stats.body.totals);
  assert(stats.body.totals.total > 0, 'statistics count the tickets');

  const breaches = await api('/api/tickets/sla-breaches', { token });
  assert(breaches.status === 200 && Array.isArray(breaches.body.breaches), 'SLA breach list available');

  // -----------------------------------------------------------------------
  console.log('\n4. System settings persistence');
  const settings = await api('/api/settings/system', { token });
  assert(settings.status === 200 && settings.body.settings, 'system settings readable');
  assert(
    settings.body.settings.mikrotik && settings.body.settings.sms && settings.body.settings.payments,
    'all settings groups present',
  );
  assert(
    settings.body.settings.mikrotik.password === '' ||
      settings.body.settings.mikrotik.password.includes('•'),
    'secrets are masked in the response',
    settings.body.settings.mikrotik.password,
  );

  const saveSettings = await api('/api/settings/system/mikrotik', {
    method: 'PUT',
    token,
    body: { host: '10.0.0.1', apiPort: 8728, username: 'nextlink' },
  });
  assert(saveSettings.status === 200, 'mikrotik settings saved', saveSettings.body);

  const reread = await api('/api/settings/system', { token });
  assert(
    reread.body.settings.mikrotik.host === '10.0.0.1',
    'saved setting persisted',
    reread.body.settings.mikrotik.host,
  );

  // Restore the original value so the test does not change the environment.
  await api('/api/settings/system/mikrotik', {
    method: 'PUT',
    token,
    body: { host: '192.168.88.1', username: 'admin' },
  });

  const billingSettings = await api('/api/settings/system/billing', {
    method: 'PUT',
    token,
    body: { dueDay: 12 },
  });
  assert(billingSettings.status === 200, 'billing settings saved');
  await api('/api/settings/system/billing', { method: 'PUT', token, body: { dueDay: 10 } });

  const settingsDenied = await api('/api/settings/system', { token: subscriberToken });
  assert(settingsDenied.status === 403, 'subscribers cannot read the system settings');

  // -----------------------------------------------------------------------
  console.log('\n5. Audit trail');
  const auditLog = await api('/api/audit?limit=50', { token });
  assert(auditLog.status === 200 && auditLog.body.entries.length > 0, 'audit entries recorded');
  assert(
    auditLog.body.entries.some((e) => e.action === 'ticket.created'),
    'ticket creation audited',
  );
  assert(
    auditLog.body.entries.some((e) => e.action === 'settings.updated'),
    'settings change audited',
  );

  // Cleanup so the test stays repeatable.
  await api(`/api/applications/${requestId}`, {
    method: 'PATCH',
    token,
    body: { status: 'rejected' },
  });

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error('phase 1/2 test crashed:', error);
  process.exit(1);
});
