'use strict';

const express = require('express');
const { z } = require('zod');
const config = require('../config');
const db = require('../lib/db');
const { asyncHandler } = require('../middleware/error');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole, ROLES, audit } = require('../middleware/auth');
const mikrotik = require('../services/mikrotik');

const router = express.Router();

/**
 * Resolve the MikroTik username for a subscriber (delegated to the service so
 * the resolution order stays consistent everywhere).
 */
const resolveUsername = mikrotik.resolveUsername;

/**
 * GET /api/mikrotik/status
 * Router connectivity + mode.
 */
router.get(
  '/status',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT, ROLES.TECHNICIAN),
  asyncHandler(async (req, res) => {
    const result = await mikrotik.testConnection();
    res.json({
      success: true,
      mode: mikrotik.isSimulator() ? 'simulator' : 'live',
      configuredHost: mikrotik.isSimulator() ? 'simulator' : config.mikrotik.host,
      ...result,
    });
  }),
);

/**
 * GET /api/mikrotik/secrets
 * List PPPoE secrets known to the router.
 */
router.get(
  '/secrets',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT, ROLES.TECHNICIAN),
  asyncHandler(async (req, res) => {
    const client = mikrotik.getClient();
    try {
      await client.connect();
      const secrets = await client.listPppoeSecrets();
      const sessions = await client.listActiveSessions();
      const queues = await client.listQueues();
      res.json({ success: true, mode: mikrotik.isSimulator() ? 'simulator' : 'live', secrets, sessions, queues });
    } catch (error) {
      res.status(502).json({ success: false, error: error.message });
    } finally {
      if (!mikrotik.isSimulator()) await client.close().catch(() => {});
    }
  }),
);

/**
 * GET /api/mikrotik/sessions
 * Active PPPoE sessions.
 */
router.get(
  '/sessions',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT, ROLES.TECHNICIAN),
  asyncHandler(async (req, res) => {
    const client = mikrotik.getClient();
    try {
      await client.connect();
      const sessions = await client.listActiveSessions();
      res.json({ success: true, sessions });
    } catch (error) {
      res.status(502).json({ success: false, error: error.message });
    } finally {
      if (!mikrotik.isSimulator()) await client.close().catch(() => {});
    }
  }),
);

/**
 * POST /api/mikrotik/suspend
 * Disable a subscriber's PPPoE secret (service suspension).
 */
router.post(
  '/suspend',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  validate({
    body: z.object({
      subscriberId: z.string().min(1, 'subscriberId is required'),
      username: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.validatedBody;
    const username = await resolveUsername(body.subscriberId, body.username);
    if (!username) {
      return res.status(404).json({ success: false, error: 'Subscriber not found' });
    }

    const result = await mikrotik.suspendSubscriber({
      subscriberId: body.subscriberId,
      username,
    });

    if (result.success) {
      // The status is mirrored into raw_data because the legacy admin store
      // rebuilds the subscribers table from raw_data.
      await db.query(
        `UPDATE subscribers
            SET status = 'suspended',
                raw_data = COALESCE(raw_data, '{}'::jsonb) || '{"status":"suspended"}'::jsonb,
                updated_at = NOW()
          WHERE id = $1`,
        [body.subscriberId],
      );
      await db.query(
        `UPDATE subscriber_billing SET status = 'suspended', updated_at = NOW() WHERE subscriber_id = $1`,
        [body.subscriberId],
      );
    }

    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'mikrotik.suspend',
      entityType: 'subscriber',
      entityId: body.subscriberId,
      details: result,
      ip: req.ip,
    });

    return res.json(result);
  }),
);

/**
 * POST /api/mikrotik/restore
 * Enable a subscriber's PPPoE secret (auto-reconnection).
 */
router.post(
  '/restore',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  validate({
    body: z.object({
      subscriberId: z.string().min(1, 'subscriberId is required'),
      username: z.string().optional(),
      profile: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.validatedBody;
    const username = await resolveUsername(body.subscriberId, body.username);
    if (!username) {
      return res.status(404).json({ success: false, error: 'Subscriber not found' });
    }

    const result = await mikrotik.restoreSubscriber({
      subscriberId: body.subscriberId,
      username,
      profile: body.profile,
    });

    if (result.success) {
      await db.query(
        `UPDATE subscribers
            SET status = 'active',
                raw_data = COALESCE(raw_data, '{}'::jsonb) || '{"status":"active"}'::jsonb,
                updated_at = NOW()
          WHERE id = $1`,
        [body.subscriberId],
      );
      await db.query(
        `UPDATE subscriber_billing SET status = 'active', updated_at = NOW() WHERE subscriber_id = $1`,
        [body.subscriberId],
      );
    }

    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'mikrotik.restore',
      entityType: 'subscriber',
      entityId: body.subscriberId,
      details: result,
      ip: req.ip,
    });

    return res.json(result);
  }),
);

/**
 * POST /api/mikrotik/disconnect
 * Force-drop the live session (bandwidth reset / manual kick).
 */
router.post(
  '/disconnect',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.SUPPORT, ROLES.TECHNICIAN),
  validate({
    body: z.object({
      subscriberId: z.string().optional(),
      username: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.validatedBody;
    const username = body.username || (body.subscriberId ? await resolveUsername(body.subscriberId) : null);

    const result = await mikrotik.disconnectSession({
      subscriberId: body.subscriberId,
      username,
    });

    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'mikrotik.disconnect',
      entityType: 'subscriber',
      entityId: body.subscriberId || username,
      details: result,
      ip: req.ip,
    });

    return res.json(result);
  }),
);

/**
 * POST /api/mikrotik/apply-profile
 * Change the bandwidth profile (package change / Turbo Boost).
 */
router.post(
  '/apply-profile',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT, ROLES.TECHNICIAN),
  validate({
    body: z.object({
      subscriberId: z.string().min(1, 'subscriberId is required'),
      username: z.string().optional(),
      profileName: z.string().min(1, 'profileName is required'),
      maxLimit: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.validatedBody;
    const username = await resolveUsername(body.subscriberId, body.username);
    if (!username) {
      return res.status(404).json({ success: false, error: 'Subscriber not found' });
    }

    const result = await mikrotik.applyBandwidthProfile({
      subscriberId: body.subscriberId,
      username,
      profileName: body.profileName,
      maxLimit: body.maxLimit,
    });

    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'mikrotik.apply_profile',
      entityType: 'subscriber',
      entityId: body.subscriberId,
      details: result,
      ip: req.ip,
    });

    return res.json(result);
  }),
);

/**
 * POST /api/mikrotik/provision
 * Ensure the PPPoE secret exists for a new subscriber.
 */
router.post(
  '/provision',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.SUPPORT, ROLES.TECHNICIAN),
  validate({
    body: z.object({
      subscriberId: z.string().min(1, 'subscriberId is required'),
      username: z.string().min(1, 'username is required'),
      password: z.string().min(1, 'password is required'),
      profile: z.string().optional(),
      remoteAddress: z.string().optional(),
      address: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.validatedBody;
    const result = await mikrotik.ensureSecret({
      subscriberId: body.subscriberId,
      username: body.username,
      password: body.password,
      profile: body.profile || 'default-10m',
      remoteAddress: body.remoteAddress,
      address: body.address,
    });

    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'mikrotik.provision',
      entityType: 'subscriber',
      entityId: body.subscriberId,
      details: result,
      ip: req.ip,
    });

    return res.json(result);
  }),
);

/**
 * GET /api/mikrotik/log
 * Router operation log.
 */
router.get(
  '/log',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT, ROLES.TECHNICIAN),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const subscriberId = req.query.subscriberId ? String(req.query.subscriberId) : null;

    const result = subscriberId
      ? await db.query(
          'SELECT * FROM mikrotik_sync_log WHERE subscriber_id = $1 ORDER BY created_at DESC LIMIT $2',
          [subscriberId, limit],
        )
      : await db.query('SELECT * FROM mikrotik_sync_log ORDER BY created_at DESC LIMIT $1', [limit]);

    res.json({ success: true, log: result.rows });
  }),
);

module.exports = router;
