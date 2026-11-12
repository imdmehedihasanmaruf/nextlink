'use strict';

/**
 * Customer-facing routes for the referral program and Turbo Boost requests.
 * Everything here is subscriber-scoped: a subscriber sees and drives only
 * their own records.
 */

const express = require('express');
const { z } = require('zod');
const db = require('../lib/db');
const { asyncHandler } = require('../middleware/error');
const { validate } = require('../middleware/validate');
const { requireAuth, requireSelfOrRole, ROLES } = require('../middleware/auth');
const { portalLimiter } = require('../middleware/rateLimit');
const referrals = require('../services/referrals');
const turboBoost = require('../services/turboBoost');
const subscriptions = require('../services/subscriptions');

const router = express.Router();

function resolveSubscriber(req) {
  if (req.user.type === 'subscriber') return req.user.subscriberId || req.user.id;
  return req.query.subscriberId ? String(req.query.subscriberId) : null;
}

/**
 * GET /api/customer/referral
 * The caller's referral code, program settings, stats and history.
 */
router.get(
  '/referral',
  requireAuth,
  requireSelfOrRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  asyncHandler(async (req, res) => {
    const subscriberId = resolveSubscriber(req);
    if (!subscriberId) return res.status(400).json({ success: false, error: 'subscriberId is required' });
    const info = await referrals.getInfo(subscriberId);
    res.json({ success: true, ...info });
  }),
);

/**
 * GET /api/customer/referral/code
 * Same data, kept so the portal can call a lean endpoint when it only needs
 * the code.
 */
router.get(
  '/referral/code',
  requireAuth,
  requireSelfOrRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  asyncHandler(async (req, res) => {
    const subscriberId = resolveSubscriber(req);
    if (!subscriberId) return res.status(400).json({ success: false, error: 'subscriberId is required' });
    const info = await referrals.getInfo(subscriberId);
    res.json({ success: true, code: info.code, enabled: info.enabled });
  }),
);

/**
 * POST /api/customer/referral/validate
 * Validate a referral code the signed-in (or prospect) user intends to use.
 */
router.post(
  '/referral/validate',
  portalLimiter,
  validate({
    body: z.object({
      code: z.string().min(4).max(40),
      phone: z.string().max(40).optional().nullable(),
    }),
  }),
  asyncHandler(async (req, res) => {
    try {
      const result = await referrals.validateCode(req.validatedBody.code, req.validatedBody.phone);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }),
);

/**
 * GET /api/customer/turbo-boost
 * Turbo Boost eligibility and the caller's request history.
 */
router.get(
  '/turbo-boost',
  requireAuth,
  requireSelfOrRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  asyncHandler(async (req, res) => {
    const subscriberId = resolveSubscriber(req);
    if (!subscriberId) return res.status(400).json({ success: false, error: 'subscriberId is required' });
    const info = await turboBoost.getInfo(subscriberId);
    res.json({ success: true, ...info });
  }),
);

/**
 * POST /api/customer/turbo-boost
 * Submit a Turbo Boost request. Stored in the database and mirrored into the
 * ticket queue for the support team.
 */
router.post(
  '/turbo-boost',
  requireAuth,
  portalLimiter,
  validate({
    body: z.object({
      durationHours: z.number().int().min(1).max(24),
      requestedMbps: z.number().int().min(1).max(10000),
    }),
  }),
  asyncHandler(async (req, res) => {
    const subscriberId = resolveSubscriber(req);
    if (!subscriberId) return res.status(400).json({ success: false, error: 'subscriberId is required' });
    try {
      const created = await turboBoost.request(subscriberId, req.validatedBody);
      res.status(201).json({
        success: true,
        reference: created.reference,
        request: {
          id: created.id,
          reference: created.reference,
          status: created.status,
          durationHours: created.duration_hours,
          requestedMbps: created.requested_mbps,
          ticketId: created.ticket_id,
          createdAt: created.created_at,
        },
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }),
);

/**
 * GET /api/customer/subscription
 * The caller's subscription state: whether they are a subscriber, the plan they
 * are on, when the plan started and when it was cancelled.
 */
router.get(
  '/subscription',
  requireAuth,
  requireSelfOrRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  asyncHandler(async (req, res) => {
    const subscriberId = resolveSubscriber(req);
    if (!subscriberId) return res.status(400).json({ success: false, error: 'subscriberId is required' });
    const subscription = await subscriptions.getSubscription(subscriberId);
    if (!subscription) return res.status(404).json({ success: false, error: 'Account not found' });
    res.json({ success: true, subscription });
  }),
);

/**
 * POST /api/customer/subscription/activate
 * Called by the portal after a package purchase has been paid. A registered
 * account becomes a subscriber here — with a billing profile and a router line.
 */
router.post(
  '/subscription/activate',
  requireAuth,
  requireSelfOrRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  portalLimiter,
  validate({
    body: z.object({
      packageId: z.string().min(1, 'packageId is required'),
      packageName: z.string().max(255).optional().nullable(),
      orderId: z.string().max(64).optional().nullable(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const subscriberId = resolveSubscriber(req);
    if (!subscriberId) return res.status(400).json({ success: false, error: 'subscriberId is required' });
    try {
      const result = await subscriptions.activateAfterPurchase({
        subscriberId,
        packageId: req.validatedBody.packageId,
        packageName: req.validatedBody.packageName || null,
        orderId: req.validatedBody.orderId || null,
      });
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }),
);

/**
 * POST /api/customer/subscription/cancel
 * Cancel the caller's subscription. The account leaves the subscriber list but
 * the purchase and cancellation dates stay on the profile.
 */
router.post(
  '/subscription/cancel',
  requireAuth,
  requireSelfOrRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  portalLimiter,
  validate({
    body: z.object({
      reason: z.string().max(500).optional().nullable(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const subscriberId = resolveSubscriber(req);
    if (!subscriberId) return res.status(400).json({ success: false, error: 'subscriberId is required' });
    try {
      const result = await subscriptions.cancel({
        subscriberId,
        reason: req.validatedBody.reason || null,
      });
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }),
);

module.exports = router;
