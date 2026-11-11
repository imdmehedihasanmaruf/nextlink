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

const MIN_HOURS = 1;
const MAX_HOURS = 24;
const MAX_MBPS = 10000;

async function getInfo(subscriberId) {
  const rows = await db.query(
    `SELECT * FROM turbo_boost_requests
      WHERE subscriber_id = $1
      ORDER BY created_at DESC
      LIMIT 100`,
    [subscriberId],
  );
  const active = rows.rows.some((r) => ['requested', 'in_progress'].includes(r.status));
  const maxMbps = await db.queryOne(
    `SELECT COALESCE((SELECT (raw_data->>'maxMbps')::int FROM turbo_boost_requests WHERE subscriber_id = $1 LIMIT 1), $2) AS cap`,
    [subscriberId, MAX_MBPS],
  );
  return {
    activeRequest: active,
    maxMbps: Number(maxMbps?.cap ?? MAX_MBPS),
    requests: rows.rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      durationHours: r.duration_hours,
      requestedMbps: r.requested_mbps,
      status: r.status,
      adminNote: r.admin_note,
      ticketId: r.ticket_id,
      createdAt: r.created_at,
      decidedAt: r.decided_at,
      appliedAt: r.applied_at,
    })),
  };
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
  return result.rows;
}

async function transition(id, action, actor) {
  const allowed = {
    approve:  { from: ['requested'], to: 'in_progress', sets: 'decided_by, decided_at' },
    reject:   { from: ['requested', 'in_progress'], to: 'rejected', sets: 'decided_by, decided_at' },
    complete: { from: ['requested', 'in_progress'], to: 'completed', sets: 'decided_by, decided_at, applied_at' },
  };
  const rule = allowed[action];
  if (!rule) throw new Error('Unknown boost action');

  const sets = {
    approve:  'status = $2, decided_by = $3, decided_at = NOW(), updated_at = NOW()',
    reject:   'status = $2, decided_by = $3, decided_at = NOW(), updated_at = NOW()',
    complete: 'status = $2, decided_by = $3, decided_at = NOW(), applied_at = NOW(), updated_at = NOW()',
  }[action];

  const updated = await db.queryOne(
    `UPDATE turbo_boost_requests
        SET ${sets}
      WHERE id = $1 AND status = ANY($4::text[])
      RETURNING *`,
    [id, rule.to, actor?.id || 'staff', rule.from],
  );
  if (updated) {
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
  return updated;
}

module.exports = { getInfo, request, listForStaff, transition };
