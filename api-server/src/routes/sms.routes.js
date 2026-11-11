'use strict';

const express = require('express');
const { z } = require('zod');
const config = require('../config');
const { asyncHandler } = require('../middleware/error');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole, ROLES, audit } = require('../middleware/auth');
const { smsLimiter } = require('../middleware/rateLimit');
const sms = require('../services/sms');

const router = express.Router();

/**
 * GET /api/sms/messages
 * SMS log (admin).
 */
router.get(
  '/messages',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  asyncHandler(async (req, res) => {
    const messages = await sms.listMessages({
      subscriberId: req.query.subscriberId ? String(req.query.subscriberId) : null,
      status: req.query.status ? String(req.query.status) : null,
      limit: req.query.limit ? Number(req.query.limit) : 100,
    });
    res.json({ success: true, mode: config.sms.mode, messages });
  }),
);

/**
 * POST /api/sms/send
 * Send an ad-hoc SMS.
 */
router.post(
  '/send',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  smsLimiter,
  validate({
    body: z.object({
      phone: z.string().min(6, 'phone is required'),
      body: z.string().min(1, 'body is required'),
      subscriberId: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await sms.send(req.validatedBody);
    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'sms.sent',
      entityType: 'sms',
      entityId: String(result.id),
      details: { phone: req.validatedBody.phone },
      ip: req.ip,
    });
    res.status(result.success ? 200 : 502).json(result);
  }),
);

module.exports = router;
