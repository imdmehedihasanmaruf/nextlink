'use strict';

const db = require('../../lib/db');
const logger = require('../../lib/logger');
const utils = require('../../lib/utils');
const sms = require('../sms');

/**
 * CRM / ticket service (SRS 3.3 — Ticket Lifecycle).
 *
 * A ticket lives in two places by design:
 *   * `tickets`            — the legacy table the existing admin panel reads
 *   * `ticket_details`     — the lifecycle data (assignment, SLA, resolution)
 *   * `ticket_messages`    — the subscriber <-> helpdesk conversation
 *
 * The legacy table is written with exactly the columns it already has, so the
 * current admin UI keeps working unchanged.
 */

/**
 * SLA targets in hours, per priority.
 */
const SLA_HOURS = {
  critical: 4,
  high: 12,
  medium: 24,
  low: 48,
};

/**
 * Create a ticket from the subscriber portal.
 */
async function createTicket({ subscriberId, subscriberName, subscriberPhone, subscriberZone, subject, category, priority, description, attachment = null }) {
  const id = `TICK-${utils.randomToken(5).toUpperCase()}`;
  const now = new Date();
  const slaHours = SLA_HOURS[priority] ?? SLA_HOURS.medium;
  const slaDueAt = new Date(now.getTime() + slaHours * 3600 * 1000);

  const rawData = {
    subscriberName,
    subscriberPhone,
    category,
    priority,
    description,
    attachment,
    status: 'open',
    slaHours,
    createdAt: utils.nowIso(),
    source: 'client-portal',
  };

  await db.transaction(async (client) => {
    await client.query(
      `INSERT INTO tickets (id, title, status, priority, raw_data, created_at, updated_at)
       VALUES ($1, $2, 'open', $3, $4, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         status = EXCLUDED.status,
         priority = EXCLUDED.priority,
         raw_data = EXCLUDED.raw_data,
         updated_at = NOW()`,
      [id, subject, priority, JSON.stringify(rawData)],
    );

    await client.query(
      `INSERT INTO ticket_details
         (ticket_id, subscriber_id, category, description, sla_due_at, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (ticket_id) DO UPDATE SET
         subscriber_id = EXCLUDED.subscriber_id,
         category = EXCLUDED.category,
         description = EXCLUDED.description,
         sla_due_at = EXCLUDED.sla_due_at,
         updated_at = NOW()`,
      [id, subscriberId, category, description, slaDueAt, JSON.stringify(rawData)],
    );
  });

  // Auto-assign to a technician. A technician in the subscriber's own
  // region is preferred, then the least loaded one.
  const technician = await autoAssign(id, category, subscriberZone);
  if (technician) {
    rawData.assignedTo = technician.id;
    rawData.assignedToName = technician.name;
    await db.query('UPDATE tickets SET raw_data = $2, updated_at = NOW() WHERE id = $1', [
      id,
      JSON.stringify(rawData),
    ]);
    await db.query(
      `UPDATE ticket_details SET assigned_to = $2, assigned_to_name = $3, updated_at = NOW() WHERE ticket_id = $1`,
      [id, technician.id, technician.name],
    );
  }

  // Notify the subscriber and the helpdesk.
  try {
    const notifications = require('../notifications');
    await notifications.notifyAdmins({
      type: 'new_ticket',
      title: `New Support Ticket #${id}`,
      message: `${subscriberName || subscriberId || 'Subscriber'} opened a ${priority} ticket: "${subject}"`,
      link: '/tickets',
      roleTarget: 'tickets',
      meta: { ticketId: id, subscriberId, priority, category },
    });
    if (technician && subscriberId) {
      await notifications.notifySubscriber(subscriberId, {
        type: 'technician_assigned',
        title: `Technician Assigned (#${id})`,
        message: `Technician ${technician.name} has been assigned to your support ticket "${subject}".`,
        link: '/dashboard/tickets',
        meta: { ticketId: id, technicianId: technician.id, technicianName: technician.name },
      });
    }
  } catch (notifErr) {
    logger.warn('ticket creation notification failed', { error: notifErr.message });
  }

  if (subscriberPhone) {
    await sms.sendTemplate(
      'ticket_update',
      {
        name: subscriberName || 'Customer',
        phone: subscriberPhone,
        ticketId: id,
        title: subject,
        status: 'Open',
      },
      { subscriberId },
    );
  }

  logger.info('ticket created', { id, priority, category, assignedTo: technician?.id });
  return { id, slaDueAt, assignedTo: technician };
}

/**
 * Pick the technician for a ticket.
 *
 * The admin panel stores the technician status as 'available', 'busy' or
 * 'off-duty'. The previous filter looked for 'active', which no technician
 * ever has, so a ticket was never assigned.
 *
 * The subscriber's zone is preferred when the technician records one, and
 * the least loaded technician wins the tie.
 */
async function autoAssign(ticketId, category, subscriberZone = null) {
  const technicians = await db.query(
    `SELECT id, name, status, raw_data FROM technicians
      WHERE COALESCE(status, 'available') IN ('available', 'busy')
      ORDER BY id`,
  );
  if (technicians.rows.length === 0) return null;

  const load = await db.query(
    `SELECT assigned_to, COUNT(*)::int AS open_jobs
       FROM ticket_details
      WHERE assigned_to IS NOT NULL
        AND resolved_at IS NULL
      GROUP BY assigned_to`,
  );
  const loadMap = new Map(load.rows.map((row) => [row.assigned_to, row.open_jobs]));

  const zone = subscriberZone ? String(subscriberZone).toLowerCase() : null;

  const candidates = technicians.rows.map((technician) => {
    const raw = technician.raw_data || {};
    const technicianZone = raw.zone ? String(raw.zone).toLowerCase() : null;
    const skills = Array.isArray(raw.skills) ? raw.skills.map((s) => String(s).toLowerCase()) : [];
    const categoryMatch = category && skills.length > 0
      ? skills.includes(String(category).toLowerCase())
      : false;

    return {
      technician,
      openJobs: loadMap.get(technician.id) || 0,
      // A technician in the same region comes first.
      zoneMatch: Boolean(zone && technicianZone && technicianZone === zone),
      categoryMatch,
    };
  });

  candidates.sort((a, b) => {
    if (a.zoneMatch !== b.zoneMatch) return a.zoneMatch ? -1 : 1;
    if (a.categoryMatch !== b.categoryMatch) return a.categoryMatch ? -1 : 1;
    if (a.openJobs !== b.openJobs) return a.openJobs - b.openJobs;
    return a.technician.id.localeCompare(b.technician.id);
  });

  return candidates[0].technician;
}

/**
 * List tickets with their lifecycle details.
 */
async function listTickets({ subscriberId = null, status = null, assignedTo = null, limit = 100 } = {}) {
  const conditions = [];
  const params = [];

  if (subscriberId) {
    params.push(subscriberId);
    conditions.push(`(t.raw_data->>'subscriberId' = $${params.length} OR d.subscriber_id = $${params.length})`);
  }
  if (status && status !== 'all') {
    params.push(status.toLowerCase());
    conditions.push(`LOWER(t.status) = $${params.length}`);
  }
  if (assignedTo) {
    params.push(assignedTo);
    conditions.push(`d.assigned_to = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Number(limit) || 100, 500));

  const result = await db.query(
    `SELECT t.id, t.title, t.status, t.priority, t.raw_data, t.created_at, t.updated_at,
            d.subscriber_id, d.category, d.description, d.assigned_to, d.assigned_to_name,
            d.sla_due_at, d.first_response_at, d.resolved_at,
            (t.raw_data->>'messages') AS messages,
            (t.raw_data->>'phone') AS phone,
            (t.raw_data->>'subscriberName') AS subscriber_name
       FROM tickets t
       LEFT JOIN ticket_details d ON d.ticket_id = t.id
       ${where}
       ORDER BY t.created_at DESC
       LIMIT $${params.length}`,
    params,
  );
  return result.rows;
}

/**
 * Get one ticket with its message thread.
 */
async function getTicket(ticketId) {
  const ticket = await db.queryOne(
    `SELECT t.id, t.title, t.status, t.priority, t.raw_data, t.created_at, t.updated_at,
            d.subscriber_id, d.category, d.description, d.assigned_to, d.assigned_to_name,
            d.sla_due_at, d.first_response_at, d.resolved_at,
            (t.raw_data->>'messages') AS messages,
            (t.raw_data->>'phone') AS phone,
            (t.raw_data->>'subscriberName') AS subscriber_name
       FROM tickets t
       LEFT JOIN ticket_details d ON d.ticket_id = t.id
      WHERE t.id = $1`,
    [ticketId],
  );
  if (!ticket) return null;

  const messages = await db.query(
    'SELECT * FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC',
    [ticketId],
  );

  return { ...ticket, thread: messages.rows };
}

/**
 * Update the ticket status and, when applicable, the SLA / resolution stamps.
 */
async function updateStatus(ticketId, status, actor = {}) {
  const ticket = await db.queryOne('SELECT * FROM tickets WHERE id = $1', [ticketId]);
  if (!ticket) return null;

  const raw = ticket.raw_data || {};
  const normalized = String(status || '').toLowerCase();
  const now = new Date();

  const details = await db.queryOne('SELECT * FROM ticket_details WHERE ticket_id = $1', [ticketId]);
  const firstResponseAt = details?.first_response_at || (actor.isStaff ? now : null);
  const resolvedAt = normalized === 'resolved' ? now : details?.resolved_at || null;

  await db.transaction(async (client) => {
    // The status is mirrored into raw_data: the legacy admin store rebuilds
    // the tickets table from raw_data, so a mismatch there would undo it.
    await client.query(
      `UPDATE tickets
          SET status = $2::text,
              raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object('status', $2::text),
              updated_at = NOW()
        WHERE id = $1`,
      [ticketId, normalized],
    );
    await client.query(
      `UPDATE ticket_details
          SET first_response_at = COALESCE($2::timestamptz, first_response_at),
              resolved_at = $3::timestamptz,
              updated_at = NOW()
        WHERE ticket_id = $1`,
      [ticketId, firstResponseAt, resolvedAt],
    );
  });

  // Notify the subscriber about the change.
  const subscriberId = details?.subscriber_id || raw.subscriberId;
  const phone = raw.phone || raw.subscriberPhone;
  if (phone) {
    await sms.sendTemplate(
      'ticket_update',
      {
        name: raw.subscriberName || 'Customer',
        phone,
        ticketId,
        title: ticket.title,
        status: normalized,
      },
      { subscriberId },
    );
  }

  try {
    const notifications = require('../notifications');
    if (subscriberId) {
      await notifications.notifySubscriber(subscriberId, {
        type: 'ticket_status_changed',
        title: `Ticket #${ticketId} Status: ${normalized.toUpperCase()}`,
        message: `Your support ticket "${ticket.title}" status changed to ${normalized}.`,
        link: '/tickets',
        meta: { ticketId, status: normalized },
      });
    }
  } catch (notifErr) {
    logger.warn('ticket status notification failed', { error: notifErr.message });
  }

  return getTicket(ticketId);
}

/**
 * Assign a ticket to a technician.
 */
async function assignTicket(ticketId, technicianId) {
  const technician = await db.queryOne('SELECT * FROM technicians WHERE id = $1', [technicianId]);
  if (!technician) return null;

  const ticket = await db.queryOne('SELECT * FROM tickets WHERE id = $1', [ticketId]);
  if (!ticket) return null;

  const raw = { ...(ticket.raw_data || {}), assignedTo: technician.id, assignedToName: technician.name };

  await db.transaction(async (client) => {
    await client.query('UPDATE tickets SET raw_data = $2, updated_at = NOW() WHERE id = $1', [
      ticketId,
      JSON.stringify(raw),
    ]);
    await client.query(
      `UPDATE ticket_details SET assigned_to = $2, assigned_to_name = $3, updated_at = NOW() WHERE ticket_id = $1`,
      [ticketId, technician.id, technician.name],
    );
  });

  const details = await db.queryOne('SELECT subscriber_id FROM ticket_details WHERE ticket_id = $1', [ticketId]);
  const subscriberId = details?.subscriber_id || raw.subscriberId || null;
  if (subscriberId) {
    try {
      const notifications = require('../notifications');
      await notifications.notifySubscriber(subscriberId, {
        type: 'technician_assigned',
        title: `Technician Assigned (#${ticketId})`,
        message: `Technician ${technician.name} has been assigned to your ticket "${ticket.title}".`,
        link: '/dashboard/tickets',
        meta: { ticketId, technicianId: technician.id, technicianName: technician.name },
      });
    } catch (notifErr) {
      logger.warn('ticket assignment notification failed', { error: notifErr.message });
    }
  }

  logger.info('ticket assigned', { ticketId, technicianId });
  return getTicket(ticketId);
}

/**
 * Append a message to the ticket thread.
 */
async function addMessage(ticketId, { body, authorType = 'subscriber', authorId = null, authorName = null }) {
  const result = await db.queryOne(
    `INSERT INTO ticket_messages (ticket_id, author_type, author_id, author_name, body)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [ticketId, authorType, authorId, authorName, body],
  );

  // Mirror the message into the legacy raw_data so the existing admin UI
  // (which reads raw_data.messages) keeps showing the conversation.
  const ticket = await db.queryOne('SELECT title, raw_data FROM tickets WHERE id = $1', [ticketId]);
  if (ticket) {
    const raw = ticket.raw_data || {};
    const messages = Array.isArray(raw.messages) ? raw.messages : [];
    messages.push({
      id: String(result.id),
      author: authorType,
      authorName,
      body,
      timestamp: result.created_at,
    });
    await db.query('UPDATE tickets SET raw_data = $2, updated_at = NOW() WHERE id = $1', [
      ticketId,
      JSON.stringify({ ...raw, messages }),
    ]);

    try {
      const notifications = require('../notifications');
      const details = await db.queryOne('SELECT subscriber_id FROM ticket_details WHERE ticket_id = $1', [ticketId]);
      const subscriberId = details?.subscriber_id || raw.subscriberId || null;
      if (authorType !== 'subscriber' && subscriberId) {
        await notifications.notifySubscriber(subscriberId, {
          type: 'ticket_reply',
          title: `New Reply on Ticket #${ticketId}`,
          message: `${authorName || 'NextLink Support'}: ${String(body || '').slice(0, 140)}`,
          link: '/dashboard/tickets',
          meta: { ticketId, messageId: result.id },
        });
      } else if (authorType === 'subscriber') {
        await notifications.notifyAdmins({
          type: 'new_ticket',
          title: `Subscriber Reply on Ticket #${ticketId}`,
          message: `${authorName || subscriberId || 'Subscriber'}: ${String(body || '').slice(0, 140)}`,
          link: '/tickets',
          roleTarget: 'tickets',
          meta: { ticketId, messageId: result.id, subscriberId },
        });
      }
    } catch (notifErr) {
      logger.warn('ticket message notification failed', { error: notifErr.message });
    }
  }

  return result;
}

/**
 * SLA / CRM statistics.
 */
async function getStats() {
  const totals = await db.queryOne(
    `SELECT
       COUNT(*)::int                                              AS total,
       COUNT(*) FILTER (WHERE LOWER(status) = 'open')::int        AS open,
       COUNT(*) FILTER (WHERE LOWER(status) = 'in_progress')::int AS in_progress,
       COUNT(*) FILTER (WHERE LOWER(status) = 'resolved')::int    AS resolved,
       COUNT(*) FILTER (WHERE priority IN ('critical','high'))::int AS high_priority
     FROM tickets`,
  );

  const sla = await db.queryOne(
    `SELECT
       COUNT(*) FILTER (WHERE resolved_at IS NULL AND sla_due_at < NOW())::int AS breached,
       COUNT(*) FILTER (WHERE resolved_at IS NULL AND sla_due_at >= NOW())::int AS within_sla
     FROM ticket_details`,
  );

  const assigned = await db.query(
    `SELECT d.assigned_to, d.assigned_to_name, COUNT(*)::int AS open_jobs
       FROM ticket_details d
      WHERE d.assigned_to IS NOT NULL AND d.resolved_at IS NULL
      GROUP BY d.assigned_to, d.assigned_to_name
      ORDER BY open_jobs DESC`,
  );

  return { totals, sla, assigned };
}

/**
 * Tickets whose SLA deadline has passed without a resolution.
 */
async function findSlaBreaches() {
  const result = await db.query(
    `SELECT d.ticket_id, d.sla_due_at, d.assigned_to_name, t.title, t.priority
       FROM ticket_details d
       JOIN tickets t ON t.id = d.ticket_id
      WHERE d.resolved_at IS NULL
        AND d.sla_due_at IS NOT NULL
        AND d.sla_due_at < NOW()
      ORDER BY d.sla_due_at ASC`,
  );
  return result.rows;
}

module.exports = {
  SLA_HOURS,
  createTicket,
  listTickets,
  getTicket,
  updateStatus,
  assignTicket,
  addMessage,
  getStats,
  findSlaBreaches,
  autoAssign,
};
