'use strict';

/**
 * Turbo Boost — customer support/service request.
 *
 * The customer submits a burst request from the portal. Each request gets a
 * unique reference, is persisted in `turbo_boost_requests`, automatically
 * opens a support ticket (so the request is visible in the existing ticket
 * queue), and can only be advanced by staff:
 *
 *     requested -> in_progress -> completed      (admin approves, applies, confirms)
 *     requested -> rejected                       (admin rejects with a reason)
 *
 * The subtoken "applied on the router" is never faked: a request only becomes
 * `completed` when staff marks it completed, and nothing in this module flips
 * the MikroTik rate-limit — the router change happens out-of-band and is
 * logged in the ticket. This module records and tracks; it never silently
 * pretends a network change happened.
 */

const crypto = require('crypto');
const db = require('../../lib/db');
const logger = require('../../lib/logger');
const utils = require('../../lib/utils');
const { audit } = require('../../middleware/auth');
const crm = require('../crm');
const notifications = require('../notifications');

const MIN_HOURS = 1;
const MAX_HOURS = 24;
const MAX_MBPS = 10000;

async function expireElapsedBoosts(subscriberId = null) {
  try {
    if (subscriberId) {
      await db.query(
        `UPDATE turbo_boost_requests
            SET status = 'expired', updated_at = NOW()
          WHERE subscriber_id = $1
            AND status IN ('active', 'in_progress', 'completed')
            AND expires_at IS NOT NULL
            AND expires_at <= NOW()`,
        [subscriberId],
      );
    } else {
      await db.query(
        `UPDATE turbo_boost_requests
            SET status = 'expired', updated_at = NOW()
          WHERE status IN ('active', 'in_progress', 'completed')
            AND expires_at IS NOT NULL
            AND expires_at <= NOW()`,
      );
    }
  } catch (err) {
    logger.warn('expireElapsedBoosts failed', { error: err.message });
  }
}

function mapBoostRow(r) {
  const nowMs = Date.now();
  const appliedMs = r.applied_at ? new Date(r.applied_at).getTime() : r.created_at ? new Date(r.created_at).getTime() : nowMs;
  const durationMs = Number(r.duration_hours || 1) * 3600 * 1000;
  const expiresMs = r.expires_at ? new Date(r.expires_at).getTime() : appliedMs + durationMs;
  const isRunningStatus = ['active', 'in_progress', 'completed'].includes(r.status);
  const remainingSeconds = isRunningStatus ? Math.max(0, Math.floor((expiresMs - nowMs) / 1000)) : 0;
  const effectiveStatus = isRunningStatus && remainingSeconds <= 0 ? 'expired' : r.status === 'completed' || r.status === 'in_progress' ? 'active' : r.status;

  return {
    id: r.id,
    reference: r.reference,
    subscriberId: r.subscriber_id,
    subscriberName: r.subscriber_name || null,
    subscriberPhone: r.subscriber_phone || null,
    subscriberPackage: r.subscriber_package || null,
    durationHours: Number(r.duration_hours || 1),
    requestedMbps: Number(r.requested_mbps || 1000),
    status: effectiveStatus,
    rawStatus: r.status,
    adminNote: r.admin_note,
    ticketId: r.ticket_id,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    appliedAt: r.applied_at,
    expiresAt: r.expires_at || new Date(expiresMs).toISOString(),
    deactivatedAt: r.deactivated_at || null,
    remainingSeconds,
  };
}

async function getInfo(subscriberId) {
  await expireElapsedBoosts(subscriberId);

  const [rows, appBoostSetting] = await Promise.all([
    db.query(
      `SELECT * FROM turbo_boost_requests
        WHERE subscriber_id = $1
        ORDER BY created_at DESC
        LIMIT 100`,
      [subscriberId],
    ),
    db.queryOne("SELECT value FROM app_settings WHERE key = 'boostBandwidth'"),
  ]);

  const mapped = rows.rows.map(mapBoostRow);
  const currentActive = mapped.find((r) => r.status === 'active' && r.remainingSeconds > 0) || null;
  const currentPending = mapped.find((r) => r.status === 'requested') || null;
  const latestExpired = mapped.find((r) => r.status === 'expired' || r.status === 'deactivated') || null;

  const boostConfig = appBoostSetting?.value || {};
  const configuredMbps = Number(boostConfig.boostSpeedMbps || boostConfig.maxMbps || 1000);
  const configuredDurationHours = Number(boostConfig.defaultDurationHours || 2);

  let status = 'inactive';
  if (currentActive) status = 'active';
  else if (currentPending) status = 'pending';
  else if (latestExpired) status = 'expired';

  return {
    status,
    activeRequest: Boolean(currentActive || currentPending),
    activeBoost: currentActive,
    pendingBoost: currentPending,
    latestExpired,
    remainingSeconds: currentActive ? currentActive.remainingSeconds : 0,
    expiresAt: currentActive ? currentActive.expiresAt : null,
    configuredMbps,
    configuredDurationHours,
    maxMbps: MAX_MBPS,
    requests: mapped,
  };
}

async function activate(subscriberId, { durationHours = 2, requestedMbps = 1000 } = {}) {
  await expireElapsedBoosts(subscriberId);
  const hours = Math.min(Math.max(Number(durationHours) || 2, MIN_HOURS), MAX_HOURS);
  const mbps = Math.min(Math.max(Number(requestedMbps) || 1000, 100), MAX_MBPS);

  const subscriber = await db.queryOne(
    'SELECT id, name, phone, status, raw_data FROM subscribers WHERE id = $1',
    [subscriberId],
  );
  if (!subscriber || ['blocked', 'suspended', 'disconnected'].includes(String(subscriber.status))) {
    throw new Error('Your account is not eligible for Turbo Boost activation.');
  }

  // If there is already an active boost, return it or extend it.
  const existing = await db.queryOne(
    `SELECT * FROM turbo_boost_requests
      WHERE subscriber_id = $1 AND status IN ('active', 'in_progress', 'requested')
      ORDER BY created_at DESC LIMIT 1`,
    [subscriberId],
  );

  let record;
  if (existing && existing.status === 'requested') {
    record = await db.queryOne(
      `UPDATE turbo_boost_requests
          SET status = 'active',
              duration_hours = $2::int,
              requested_mbps = $3::int,
              applied_at = NOW(),
              decided_at = NOW(),
              expires_at = NOW() + ($2::int * INTERVAL '1 hour'),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [existing.id, hours, mbps],
    );
  } else if (existing && ['active', 'in_progress'].includes(existing.status)) {
    const mappedExisting = mapBoostRow(existing);
    if (mappedExisting.remainingSeconds > 0) {
      return mappedExisting;
    }
  }

  if (!record) {
    const id = utils.generateId('TBR');
    const reference = `TBR-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    record = await db.queryOne(
      `INSERT INTO turbo_boost_requests
         (id, reference, subscriber_id, duration_hours, requested_mbps, status, applied_at, decided_at, expires_at, raw_data)
       VALUES ($1, $2, $3, $4::int, $5::int, 'active', NOW(), NOW(), NOW() + ($4::int * INTERVAL '1 hour'), $6)
       RETURNING *`,
      [
        id,
        reference,
        subscriberId,
        hours,
        mbps,
        JSON.stringify({
          activatedAt: new Date().toISOString(),
          subscriberName: subscriber.name,
          mode: 'on-demand',
        }),
      ],
    );
  }

  try {
    await notifications.notifySubscriber(subscriberId, {
      type: 'boost_activated',
      title: '1 Gbps Turbo Boost Activated',
      message: `Your line has been boosted to ${mbps} Mbps for ${hours} hour(s). Reference: ${record.reference}.`,
      link: '/dashboard',
      meta: { boostId: record.id, reference: record.reference, durationHours: hours, requestedMbps: mbps },
    });
  } catch (err) {
    logger.warn('boost activation notification failed', { error: err.message });
  }

  await audit({
    actorId: subscriberId,
    actorRole: 'subscriber',
    action: 'turbo_boost.activated',
    entityType: 'turbo_boost_request',
    entityId: record.id,
    details: { reference: record.reference, durationHours: hours, requestedMbps: mbps },
  });

  return mapBoostRow(record);
}

async function deactivate(subscriberId, { requestId = null, actor = null } = {}) {
  const params = [subscriberId];
  let whereSql = `subscriber_id = $1 AND status IN ('active', 'in_progress', 'completed', 'requested')`;
  if (requestId) {
    params.push(requestId);
    whereSql += ` AND id = $2`;
  }

  const updated = await db.queryOne(
    `UPDATE turbo_boost_requests
        SET status = 'expired',
            deactivated_at = NOW(),
            expires_at = NOW(),
            updated_at = NOW()
      WHERE ${whereSql}
      RETURNING *`,
    params,
  );

  if (updated) {
    await audit({
      actorId: actor?.id || subscriberId,
      actorRole: actor?.role || 'subscriber',
      action: 'turbo_boost.deactivated',
      entityType: 'turbo_boost_request',
      entityId: updated.id,
      details: { reference: updated.reference },
    });
  }

  return updated ? mapBoostRow(updated) : null;
}

async function request(subscriberId, { durationHours, requestedMbps }) {
  const hours = Number(durationHours);
  const mbps = Number(requestedMbps);
  if (!Number.isFinite(hours) || hours < MIN_HOURS || hours > MAX_HOURS) {
    throw new Error(`The boost duration must be between ${MIN_HOURS} and ${MAX_HOURS} hours`);
  }
  if (!Number.isFinite(mbps) || mbps <= 0 || mbps > MAX_MBPS) {
    throw new Error(`The requested speed must be between 1 and ${MAX_MBPS} Mbps`);
  }
  const active = await db.queryOne(
    `SELECT id FROM turbo_boost_requests
      WHERE subscriber_id = $1 AND status IN ('requested', 'in_progress')`,
    [subscriberId],
  );
  if (active) {
    throw new Error('You already have a boost request pending. Wait for it to be processed.');
  }
  const subscriber = await db.queryOne(
    'SELECT id, status FROM subscribers WHERE id = $1',
    [subscriberId],
  );
  if (!subscriber || ['blocked', 'suspended', 'disconnected'].includes(String(subscriber.status))) {
    throw new Error('Your account is not eligible for a boost request.');
  }

  const id = utils.generateId('TBR');
  const reference = `TBR-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  // The ticket carries the request into the support queue so the team tracks
  // everything in one place.
  let ticketId = null;
  try {
    const subscriberRow = await db.queryOne(
      'SELECT name, phone, raw_data FROM subscribers WHERE id = $1',
      [subscriberId],
    );
    const ticket = await crm.createTicket({
      subscriberId,
      subscriberName: subscriberRow?.name || null,
      subscriberPhone: subscriberRow?.phone || null,
      subscriberZone: (subscriberRow?.raw_data || {}).zone || null,
      subject: `[Turbo Boost] ${mbps} Mbps for ${hours}h (${reference})`,
      category: 'support',
      priority: 'high',
      description: `Subscriber requested a time-boxed burst of ${mbps} Mbps for ${hours} hour(s). Apply the rate-limit change on the router out-of-band, then mark this boost request completed. Reference: ${reference}`,
    });
    ticketId = ticket?.id || null;
  } catch (error) {
    logger.warn('could not open a support ticket for the boost request', { error: error.message });
  }

  const inserted = await db.queryOne(
    `INSERT INTO turbo_boost_requests
       (id, reference, subscriber_id, duration_hours, requested_mbps, status, ticket_id, raw_data)
     VALUES ($1, $2, $3, $4, $5, 'requested', $6, $7)
     RETURNING *`,
    [id, reference, subscriberId, hours, mbps, ticketId, JSON.stringify({ requestedAt: new Date().toISOString() })],
  );
  await audit({
    actorId: subscriberId,
    actorRole: 'subscriber',
    action: 'turbo_boost.requested',
    entityType: 'turbo_boost_request',
    entityId: id,
    details: { reference, durationHours: hours, requestedMbps: mbps },
  });
  return inserted;
}

async function listForStaff({ status, limit = 100, offset = 0 } = {}) {
  await expireElapsedBoosts();
  const where = [];
  const params = [];
  if (status) {
    params.push(String(status));
    where.push(`tbr.status = $${params.length}`);
  }
  params.push(limit, offset);
  const sql = `
    SELECT tbr.*, s.name AS subscriber_name, s.phone AS subscriber_phone, s.package_id AS subscriber_package
      FROM turbo_boost_requests tbr
      LEFT JOIN subscribers s ON s.id = tbr.subscriber_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY tbr.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const result = await db.query(sql, params);
  return result.rows.map(mapBoostRow);
}

async function transition(id, action, actor) {
  const allowed = {
    approve:    { from: ['requested', 'expired'], to: 'active' },
    activate:   { from: ['requested', 'in_progress', 'expired'], to: 'active' },
    reject:     { from: ['requested', 'in_progress', 'active'], to: 'rejected' },
    complete:   { from: ['requested', 'in_progress'], to: 'active' },
    deactivate: { from: ['requested', 'in_progress', 'active', 'completed'], to: 'expired' },
  };
  const rule = allowed[action];
  if (!rule) throw new Error('Unknown boost action');

  const sets = {
    approve:    "status = $2, decided_by = $3, decided_at = NOW(), applied_at = NOW(), expires_at = NOW() + (duration_hours || ' hours')::interval, updated_at = NOW()",
    activate:   "status = $2, decided_by = $3, decided_at = NOW(), applied_at = NOW(), expires_at = NOW() + (duration_hours || ' hours')::interval, updated_at = NOW()",
    reject:     'status = $2, decided_by = $3, decided_at = NOW(), expires_at = NOW(), updated_at = NOW()',
    complete:   "status = $2, decided_by = $3, decided_at = NOW(), applied_at = NOW(), expires_at = NOW() + (duration_hours || ' hours')::interval, updated_at = NOW()",
    deactivate: 'status = $2, decided_by = $3, deactivated_at = NOW(), expires_at = NOW(), updated_at = NOW()',
  }[action];

  const updated = await db.queryOne(
    `UPDATE turbo_boost_requests
        SET ${sets}
      WHERE id = $1 AND status = ANY($4::text[])
      RETURNING *`,
    [id, rule.to, actor?.id || 'staff', rule.from],
  );
  if (updated) {
    if (['approve', 'activate', 'complete'].includes(action) && updated.subscriber_id) {
      try {
        await notifications.notifySubscriber(updated.subscriber_id, {
          type: 'boost_activated',
          title: '1 Gbps Turbo Boost Activated',
          message: `Your 1 Gbps On-Demand Turbo Boost (${updated.requested_mbps} Mbps for ${updated.duration_hours}h) is now active!`,
          link: '/dashboard',
          meta: { boostId: updated.id, reference: updated.reference },
        });
      } catch (err) {
        logger.warn('boost transition notification failed', { error: err.message });
      }
    }
    await audit({
      actorId: actor?.id || null,
      actorRole: actor?.role || 'staff',
      action: `turbo_boost.${action}`,
      entityType: 'turbo_boost_request',
      entityId: id,
      details: { reference: updated.reference, note: actor?.note || null },
      ip: actor?.ip || null,
    });
  }
  return updated ? mapBoostRow(updated) : null;
}

module.exports = { getInfo, request, activate, deactivate, listForStaff, transition };
