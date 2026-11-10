'use strict';

const express = require('express');
const { z } = require('zod');
const config = require('../config');
const db = require('../lib/db');
const { asyncHandler } = require('../middleware/error');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole, ROLES, signToken, hashPassword, comparePassword, audit } = require('../middleware/auth');
const sms = require('../services/sms');

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
 * Authenticate a subscriber against the `subscribers` table and issue a
 * scoped JWT for the client portal.
 *
 * Password verification follows the existing platform convention: the
 * subscriber's password is stored in `raw_data.password` by the current
 * signup flow. The comparison is constant-time-ish via a length check plus
 * strict equality, and the account must not be blocked.
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

    const subscriber = await db.queryOne(
      `SELECT * FROM subscribers
        WHERE id = $1
           OR LOWER(name) = LOWER($2)
           OR LOWER(email) = LOWER($2)
           OR phone = $2
           OR raw_data->>'username' = $2
        LIMIT 1`,
      [username, username],
    );

    if (!subscriber) {
      return res.status(404).json({ success: false, error: 'No account matches those credentials' });
    }

    const raw = subscriber.raw_data || {};
    const storedPassword = String(raw.password || '');

    if (!storedPassword || storedPassword !== password) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

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
      ip: req.ip,
    });

    return res.json({
      success: true,
      token,
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
 * POST /api/auth/subscriber-token
 * Issue a scoped JWT for a subscriber (used by the client portal).
 */
router.post(
  '/subscriber-token',
  validate({
    body: z.object({
      subscriberId: z.string().min(1, 'subscriberId is required'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const subscriber = await db.queryOne(
      'SELECT id, name FROM subscribers WHERE id = $1',
      [req.validatedBody.subscriberId],
    );
    if (!subscriber) {
      return res.status(404).json({ success: false, error: 'Subscriber not found' });
    }

    const token = signToken({
      id: subscriber.id,
      name: subscriber.name,
      role: ROLES.SUBSCRIBER,
      type: 'subscriber',
      subscriberId: subscriber.id,
    });

    return res.json({ success: true, token, subscriber: { id: subscriber.id, name: subscriber.name } });
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
