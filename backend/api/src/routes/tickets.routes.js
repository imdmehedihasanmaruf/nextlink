'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../lib/db');
const { asyncHandler } = require('../middleware/error');
const { validate } = require('../middleware/validate');
const { requireAuth, optionalAuth, requireRole, requireSelfOrRole, ROLES, audit } = require('../middleware/auth');
const { ticketLimiter } = require('../middleware/rateLimit');
const crm = require('../services/crm');

const router = express.Router();

/**
 * Resolve the acting subscriber.
 * Staff may pass ?subscriberId= to act on a specific account.
 */
function resolveSubscriber(req) {
  if (req.user) {
    if (req.user.type === 'subscriber' || req.user.role === ROLES.SUBSCRIBER || String(req.user.role).toLowerCase() === 'subscriber') {
      return req.user.subscriberId || req.user.id;
    }
    return req.query.subscriberId ? String(req.query.subscriberId) : (req.user.subscriberId || req.user.id);
  }
  if (req.headers && req.headers['x-subscriber-id']) {
    return String(req.headers['x-subscriber-id']);
  }
  return req.query.subscriberId ? String(req.query.subscriberId) : null;
}

/**
 * POST /api/tickets
 * Create a support ticket (subscriber portal).
 */
router.post(
  '/',
  optionalAuth,
  ticketLimiter,
  validate({
    body: z.object({
      subject: z.string().min(5, 'Please describe the issue in at least 5 characters'),
      category: z.string().min(2, 'Please choose a category'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      description: z.string().min(10, 'Please provide at least 10 characters of detail'),
      subscriberId: z.string().optional(),
      attachment: z.object({
        name: z.string(),
        type: z.string(),
        size: z.number().max(5 * 1024 * 1024, 'Attachment must be 5MB or less'),
        url: z.string().optional(),
        data: z.string().optional(),
      }).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    // A ticket needs a session. An anonymous ticket could be used to send
    // SMS to any phone number and to fill the helpdesk.
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please sign in to raise a support ticket.',
      });
    }

    const body = req.validatedBody;
    const subscriberId = resolveSubscriber(req) || body.subscriberId || null;

    let subscriberName = null;
    let subscriberPhone = null;
    let subscriberZone = null;
    if (subscriberId) {
      const subscriber = await db.queryOne(
        'SELECT id, name, phone, raw_data FROM subscribers WHERE id = $1',
        [subscriberId],
      );
      if (subscriber) {
        subscriberName = subscriber.name;
        subscriberPhone = subscriber.phone;
        subscriberZone = (subscriber.raw_data || {}).zone || null;
      }
    }

    const result = await crm.createTicket({
      subscriberId,
      subscriberName,
      subscriberPhone,
      subscriberZone,
      subject: body.subject,
      category: body.category,
      priority: body.priority || 'medium',
      description: body.description,
      attachment: body.attachment || null,
    });

    await audit({
      actorId: req.user?.id || subscriberId,
      actorRole: req.user?.role || ROLES.SUBSCRIBER,
      action: 'ticket.created',
      entityType: 'ticket',
      entityId: result.id,
      details: { priority: body.priority, category: body.category },
      ip: req.ip,
    });

    return res.status(201).json({
      success: true,
      ticket: {
        id: result.id,
        status: 'open',
        priority: body.priority || 'medium',
        assignedTo: result.assignedTo?.name || null,
        slaDueAt: result.slaDueAt,
        createdAt: new Date().toISOString(),
      },
    });
  }),
);

/**
 * GET /api/tickets
 * List tickets. Subscribers see only their own.
 */
router.get(
  '/',
  optionalAuth,
  requireSelfOrRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT, ROLES.TECHNICIAN),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const subscriberId = resolveSubscriber(req);
    const tickets = await crm.listTickets({
      // A subscriber is always confined to their own tickets; staff may look
      // at another account when they pass ?subscriberId=.
      subscriberId: req.user.type === 'subscriber' ? subscriberId : subscriberId,
      status: req.query.status ? String(req.query.status) : null,
      assignedTo: req.query.assignedTo ? String(req.query.assignedTo) : null,
      limit: req.query.limit ? Number(req.query.limit) : 100,
    });

    return res.json({ success: true, tickets });
  }),
);

/**
 * GET /api/tickets/stats
 * CRM statistics (staff only).
 */
router.get(
  '/stats',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT, ROLES.TECHNICIAN),
  asyncHandler(async (_req, res) => {
    const stats = await crm.getStats();
    const totals = stats.totals || {};
    res.json({
      success: true,
      openCount: Number(totals.open || 0),
      open: Number(totals.open || 0),
      inProgressCount: Number(totals.in_progress || 0),
      resolvedCount: Number(totals.resolved || 0),
      totalCount: Number(totals.total || 0),
      ...stats,
    });
  }),
);

/**
 * GET /api/tickets/sla-breaches
 * Tickets that missed their SLA deadline.
 */
router.get(
  '/sla-breaches',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.SUPPORT),
  asyncHandler(async (req, res) => {
    const breaches = await crm.findSlaBreaches();
    res.json({ success: true, breaches });
  }),
);

/**
 * GET /api/tickets/:id
 * A ticket with its conversation thread.
 */
router.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const ticket = await crm.getTicket(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    // A subscriber may only read their own ticket.
    if (req.user.type === 'subscriber') {
      const owner = ticket.subscriber_id || (ticket.raw_data || {}).subscriberId;
      if (owner !== (req.user.subscriberId || req.user.id)) {
        return res.status(403).json({ success: false, error: 'You can only view your own tickets' });
      }
    }

    return res.json({ success: true, ticket });
  }),
);

/**
 * PATCH /api/tickets/:id/status
 * Update a ticket's status.
 */
router.patch(
  '/:id/status',
  optionalAuth,
  validate({
    body: z.object({
      status: z.enum(['open', 'in_progress', 'resolved', 'closed']),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const ticket = await crm.getTicket(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    const isStaff = req.user.type !== 'subscriber' && req.user.role !== ROLES.SUBSCRIBER;
    if (!isStaff) {
      const owner = ticket.subscriber_id || (ticket.raw_data || {}).subscriberId;
      if (owner !== (req.user.subscriberId || req.user.id)) {
        return res.status(403).json({ success: false, error: 'You can only update your own tickets' });
      }
      if (!['closed', 'resolved'].includes(req.validatedBody.status)) {
        return res.status(403).json({ success: false, error: 'Subscribers can only close or resolve their tickets' });
      }
    }

    const result = await crm.updateStatus(req.params.id, req.validatedBody.status, {
      isStaff,
      actorId: req.user.id,
    });

    await audit({
      actorId: req.user.id,
      actorRole: req.user.role || (isStaff ? 'staff' : ROLES.SUBSCRIBER),
      action: 'ticket.status_changed',
      entityType: 'ticket',
      entityId: req.params.id,
      details: { status: req.validatedBody.status },
      ip: req.ip,
    });

    // Notify admins if subscriber closed it
    if (!isStaff) {
      try {
        const notifications = require('../services/notifications');
        await notifications.notifyAdmins({
          type: 'ticket_closed',
          title: `Ticket #${req.params.id} Closed`,
          message: `Subscriber marked ticket #${req.params.id} as ${req.validatedBody.status}.`,
          link: '/tickets',
          roleTarget: 'tickets',
          meta: { ticketId: req.params.id, status: req.validatedBody.status },
        });
      } catch {}
    }

    return res.json({ success: true, ticket: result });
  }),
);

/**
 * POST /api/tickets/:id/assign
 * Assign a ticket to a technician.
 */
router.post(
  '/:id/assign',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.SUPPORT),
  validate({
    body: z.object({
      technicianId: z.string().min(1, 'technicianId is required'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await crm.assignTicket(req.params.id, req.validatedBody.technicianId);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Ticket or technician not found' });
    }

    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'ticket.assigned',
      entityType: 'ticket',
      entityId: req.params.id,
      details: { technicianId: req.validatedBody.technicianId },
      ip: req.ip,
    });

    res.json({ success: true, ticket: result });
  }),
);

/**
 * POST /api/tickets/:id/messages
 * Append a message to the ticket thread.
 */
router.post(
  '/:id/messages',
  optionalAuth,
  requireSelfOrRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  validate({
    body: z.object({
      body: z.string().min(1, 'Message body is required'),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const ticket = await crm.getTicket(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    const isStaff = req.user.type !== 'subscriber';
    if (!isStaff) {
      const owner = ticket.subscriber_id || (ticket.raw_data || {}).subscriberId;
      if (owner !== (req.user.subscriberId || req.user.id)) {
        return res.status(403).json({ success: false, error: 'You can only reply to your own tickets' });
      }
    }

    const message = await crm.addMessage(req.params.id, {
      body: req.validatedBody.body,
      authorType: isStaff ? 'staff' : 'subscriber',
      authorId: req.user.id,
      authorName: isStaff ? req.user.id : (ticket.raw_data || {}).subscriberName,
    });

    // The first staff reply stamps the SLA response time.
    if (isStaff && !ticket.first_response_at) {
      await crm.updateStatus(req.params.id, ticket.status, { isStaff: true, actorId: req.user.id });
    }

    res.status(201).json({ success: true, message });
  }),
);

/**
 * DELETE /api/tickets/:id
 * Permanently remove a ticket (admin action).
 *
 * Used when the admin panel deletes a ticket. The detail row, the message
 * thread and the ticket itself are removed together, and the deletion is
 * recorded in the audit log.
 */
router.delete(
  '/:id',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  asyncHandler(async (req, res) => {
    const ticket = await crm.getTicket(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    await db.transaction(async (client) => {
      await client.query('DELETE FROM ticket_messages WHERE ticket_id = $1', [req.params.id]);
      await client.query('DELETE FROM ticket_details WHERE ticket_id = $1', [req.params.id]);
      await client.query('DELETE FROM tickets WHERE id = $1', [req.params.id]);
    });

    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'ticket.deleted',
      entityType: 'ticket',
      entityId: req.params.id,
      details: { title: ticket.title },
      ip: req.ip,
    });

    res.json({ success: true, message: 'Ticket deleted' });
  }),
);

module.exports = router;
