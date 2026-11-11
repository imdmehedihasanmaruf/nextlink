'use strict';

/**
 * Staff (super_admin / billing / support) routes for the referral program and
 * Turbo Boost requests.
 */

const express = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../middleware/error');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole, ROLES, audit } = require('../middleware/auth');
const referrals = require('../services/referrals');
const turboBoost = require('../services/turboBoost');

const router = express.Router();
const STAFF = [ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT];

/** GET /api/staff/referrals?status=pending|qualified|credited|void */
router.get(
  '/referrals',
  requireAuth,
  requireRole(...STAFF),
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const rows = await referrals.listReferrals({ status, limit, offset });
    res.json({ success: true, referrals: rows });
  }),
);

/** GET /api/staff/referral-settings */
router.get(
  '/referral-settings',
  requireAuth,
  requireRole(...STAFF),
  asyncHandler(async (req, res) => {
    const settings = await referrals.getSettings();
    res.json({ success: true, settings });
  }),
);

/** PUT /api/staff/referral-settings */
router.put(
  '/referral-settings',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  validate({
    body: z.object({
      enabled: z.boolean().optional(),
      bonusAmount: z.number().positive().max(10000).optional(),
      title: z.string().min(1).max(200).optional(),
      description: z.string().min(1).max(1000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    try {
      const merged = await referrals.updateSettings(req.validatedBody, {
        id: req.user.id,
        role: req.user.role,
        ip: req.ip,
      });
      res.json({ success: true, settings: merged });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }),
);

/** POST /api/staff/referrals/:id/void */
router.post(
  '/referrals/:id/void',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  validate({
    body: z.object({ reason: z.string().min(1).max(500).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const updated = await referrals.voidReferral(req.params.id, req.validatedBody.reason, {
      id: req.user.id,
      role: req.user.role,
      ip: req.ip,
    });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Referral not found or already settled.' });
    }
    res.json({ success: true, referral: updated });
  }),
);

/** GET /api/staff/turbo-boost?status=requested|in_progress|completed|rejected */
router.get(
  '/turbo-boost',
  requireAuth,
  requireRole(...STAFF),
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const rows = await turboBoost.listForStaff({ status, limit, offset });
    res.json({ success: true, requests: rows });
  }),
);

/** POST /api/staff/turbo-boost/:id/approve|reject|complete */
router.post(
  '/turbo-boost/:id/:action',
  requireAuth,
  requireRole(...STAFF),
  validate({
    body: z.object({ note: z.string().max(500).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const action = String(req.params.action);
    if (!['approve', 'reject', 'complete'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Unknown action' });
    }
    try {
      const updated = await turboBoost.transition(
        req.params.id,
        action,
        { id: req.user.id, role: req.user.role, ip: req.ip, note: req.validatedBody.note },
      );
      if (!updated) {
        return res.status(404).json({
          success: false,
          error: 'Request not found or not in a state for that action.',
        });
      }
      if (req.validatedBody.note) {
        await audit({
          actorId: req.user.id,
          actorRole: req.user.role,
          action: `turbo_boost.${action}`,
          entityType: 'turbo_boost_request',
          entityId: req.params.id,
          details: { note: req.validatedBody.note },
          ip: req.ip,
        });
      }
      res.json({ success: true, request: updated });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }),
);

module.exports = router;
