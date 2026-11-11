'use strict';

const express = require('express');
const { z } = require('zod');
const config = require('../config');
const db = require('../lib/db');
const { asyncHandler } = require('../middleware/error');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole, ROLES, signToken, hashPassword, comparePassword, audit } = require('../middleware/auth');
const sms = require('../services/sms');
const credentials = require('../services/credentials');

const router = express.Router();

/**
 * POST /api/auth/login
 * Staff login against the `api_users` table.
 */
router.post(
  '/login',
  validate({
    body: z.object({
      email: z.string().email('A valid email is required'),
      password: z.string().min(4, 'Password must be at least 4 characters'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.validatedBody;

    const user = await db.queryOne('SELECT * FROM api_users WHERE email = $1', [email.toLowerCase()]);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ success: false, error: 'Account is not active' });
    }

    const ok = await comparePassword(password, user.password_hash);
    if (!ok) {
      await audit({
        actorId: user.id,
        actorRole: user.role,
        action: 'auth.login_failed',
        entityType: 'api_user',
        entityId: user.id,
        ip: req.ip,
      });
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    await db.query('UPDATE api_users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const token = signToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      type: 'staff',
    });

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'auth.login',
      entityType: 'api_user',
      entityId: user.id,
      ip: req.ip,
    });

    return res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  }),
);

/**
 * POST /api/auth/subscriber-login
 * Authenticate a subscriber and issue a scoped JWT for the client portal.
 *
 * Passwords are verified against the bcrypt-hashed `subscriber_credentials`
 * store. Accounts created before hashing was introduced still carry a plain
 * password in `subscribers.raw_data`; those are verified once and migrated to
 * the hashed store automatically on a successful login.
 */
router.post(
  '/subscriber-login',
  validate({
    body: z.object({
      username: z.string().min(2, 'Username or phone is required'),
      password: z.string().min(1, 'Password is required'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { username, password } = req.validatedBody;

    const result = await credentials.authenticate(username, password);

    if (!result.success) {
      return res.status(result.error === 'No account matches those credentials' ? 404 : 401).json({
        success: false,
        error: result.error,
      });
    }

    const subscriber = result.subscriber;

    if (subscriber.status === 'blocked') {
      return res.status(403).json({ success: false, error: 'This account is blocked. Contact support.' });
    }

    const token = signToken({
      id: subscriber.id,
      name: subscriber.name,
      role: ROLES.SUBSCRIBER,
      type: 'subscriber',
      subscriberId: subscriber.id,
    });

    await audit({
      actorId: subscriber.id,
      actorRole: ROLES.SUBSCRIBER,
      action: 'auth.subscriber_login',
      entityType: 'subscriber',
      entityId: subscriber.id,
      details: { migrated: result.migrated },
      ip: req.ip,
    });

    return res.json({
      success: true,
      token,
      migrated: result.migrated,
      subscriber: {
        id: subscriber.id,
        name: subscriber.name,
        email: subscriber.email,
        phone: subscriber.phone,
        packageId: subscriber.package_id,
        status: subscriber.status,
      },
    });
  }),
);

/**
 * POST /api/auth/subscriber-password
 * Change the signed-in subscriber's own password.
 */
router.post(
  '/subscriber-password',
  requireAuth,
  validate({
    body: z.object({
      currentPassword: z.string().min(1, 'Current password is required'),
      newPassword: z.string().min(8, 'The new password must be at least 8 characters'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.validatedBody;
    const subscriberId = req.user.subscriberId || req.user.id;

    const check = await credentials.authenticate(subscriberId, currentPassword);
    if (!check.success) {
      return res.status(401).json({ success: false, error: 'The current password is incorrect' });
    }

    await credentials.changePassword(subscriberId, newPassword);

    await audit({
      actorId: subscriberId,
      actorRole: req.user.role,
      action: 'auth.password_changed',
      entityType: 'subscriber',
      entityId: subscriberId,
      ip: req.ip,
    });

    return res.json({ success: true, message: 'Your password has been updated' });
  }),
);

/**
 * POST /api/auth/admin/reset-password
 * Reset a subscriber's password (staff only). The password is stored hashed.
 */
router.post(
  '/admin/reset-password',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN),
  validate({
    body: z.object({
      subscriberId: z.string().min(1, 'subscriberId is required'),
      newPassword: z.string().min(8, 'The new password must be at least 8 characters'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { subscriberId, newPassword } = req.validatedBody;

    const result = await credentials.resetPassword(subscriberId, newPassword);
    if (!result.success) {
      return res.status(404).json({ success: false, error: result.error });
    }

    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'auth.password_reset',
      entityType: 'subscriber',
      entityId: subscriberId,
      ip: req.ip,
    });

    return res.json({ success: true, message: 'Password updated' });
  }),
);

/**
 * POST /api/auth/admin/set-plain-password
 * Write a plain-text password back into the subscriber record and remove the
 * hashed credential, so the legacy migration path can be verified.
 * Staff only — used by the migration test and by an intentional rollback.
 */
router.post(
  '/admin/set-plain-password',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN),
  validate({
    body: z.object({
      subscriberId: z.string().min(1, 'subscriberId is required'),
      password: z.string().min(1, 'password is required'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { subscriberId, password } = req.validatedBody;

    const subscriber = await db.queryOne('SELECT raw_data FROM subscribers WHERE id = $1', [subscriberId]);
    if (!subscriber) {
      return res.status(404).json({ success: false, error: 'Subscriber not found' });
    }

    const raw = subscriber.raw_data || {};
    await db.query(
      `UPDATE subscribers
          SET raw_data = jsonb_set(raw_data, '{password}', to_jsonb($2::text)), updated_at = NOW()
        WHERE id = $1`,
      [subscriberId, password],
    );
    await db.query('DELETE FROM subscriber_credentials WHERE subscriber_id = $1', [subscriberId]);

    return res.json({ success: true, subscriberId, username: raw.username || subscriberId });
  }),
);

/**
 * GET /api/auth/legacy-test-account
 * Return a subscriber that still carries a plain-text password, so the
 * migration path can be exercised (staff only).
 */
router.get(
  '/legacy-test-account',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const row = await db.queryOne(
      `SELECT id, raw_data->>'username' AS username, raw_data->>'password' AS password
         FROM subscribers
        WHERE COALESCE(raw_data->>'password', '') <> ''
        ORDER BY id
        LIMIT 1`,
    );

    if (!row) {
      return res.json({ success: true, subscriberId: null });
    }
    return res.json({
      success: true,
      subscriberId: row.id,
      username: row.username || row.id,
      password: row.password,
    });
  }),
);

/**
 * POST /api/auth/admin/forget-hashed
 * Remove the hashed credential of a subscriber so the plain-text path is used
 * again. Used to verify the migration flow (staff only).
 */
router.post(
  '/admin/forget-hashed',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN),
  validate({
    body: z.object({
      subscriberId: z.string().min(1, 'subscriberId is required'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await db.query(
      'DELETE FROM subscriber_credentials WHERE subscriber_id = $1 RETURNING subscriber_id',
      [req.validatedBody.subscriberId],
    );
    res.json({ success: true, removed: result.rowCount > 0 });
  }),
);

/**
 * GET /api/auth/credential-status
 * How many subscriber passwords are still plain text (staff only).
 */
router.get(
  '/credential-status',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const legacy = await credentials.countLegacyPasswords();
    const hashed = await credentials.countHashedCredentials();
    res.json({
      success: true,
      legacyPasswords: legacy,
      hashedCredentials: hashed,
      note:
        legacy > 0
          ? 'Plain-text passwords are migrated to bcrypt on the next successful login.'
          : 'All subscriber passwords are hashed.',
    });
  }),
);

/**
 * GET /api/auth/me
 * Current principal.
 */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await db.queryOne(
      'SELECT id, email, name, role, status, last_login_at FROM api_users WHERE id = $1',
      [req.user.id],
    );
    res.json({ success: true, user: user || { id: req.user.id, role: req.user.role } });
  }),
);

/**
 * GET /api/auth/permissions
 * Permission matrix for the current role.
 */
router.get(
  '/permissions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { PERMISSIONS } = require('../middleware/auth');
    res.json({ success: true, role: req.user.role, permissions: PERMISSIONS[req.user.role] || [] });
  }),
);

module.exports = router;
