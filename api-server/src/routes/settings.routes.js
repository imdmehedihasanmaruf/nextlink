'use strict';

const express = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../middleware/error');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole, ROLES, audit } = require('../middleware/auth');
const settings = require('../services/settings');

const router = express.Router();

/**
 * GET /api/settings/system
 * All system settings with the secrets masked.
 */
router.get(
  '/system',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const masked = await settings.getMasked();
    res.json({ success: true, settings: masked });
  }),
);

/**
 * PUT /api/settings/system/:group
 * Persist one settings group (MikroTik, SMS, payments, billing).
 */
router.put(
  '/system/:group',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN),
  validate({
    body: z.record(z.any()),
  }),
  asyncHandler(async (req, res) => {
    const group = String(req.params.group);
    if (!['mikrotik', 'sms', 'payments', 'billing'].includes(group)) {
      return res.status(400).json({ success: false, error: `Unknown settings group: ${group}` });
    }

    const merged = await settings.setGroup(group, req.validatedBody);

    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'settings.updated',
      entityType: 'settings',
      entityId: group,
      ip: req.ip,
    });

    return res.json({
      success: true,
      group,
      settings: settings.maskSecrets({ [group]: merged })[group],
    });
  }),
);

/**
 * POST /api/settings/mikrotik/test
 * Test the router connection.
 */
router.post(
  '/mikrotik/test',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const result = await settings.testMikrotik();
    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'settings.mikrotik_test',
      entityType: 'settings',
      entityId: 'mikrotik',
      details: { success: result.success },
      ip: req.ip,
    });
    res.json({ success: true, ...result });
  }),
);

module.exports = router;
