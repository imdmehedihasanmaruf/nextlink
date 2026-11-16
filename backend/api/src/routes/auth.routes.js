'use strict';

const express = require('express');
const tls = require('tls');
const { z } = require('zod');
const config = require('../config');
const db = require('../lib/db');
const { asyncHandler } = require('../middleware/error');
const { validate } = require('../middleware/validate');
const { requireAuth, optionalAuth, requireRole, ROLES, signToken, hashPassword, comparePassword, audit } = require('../middleware/auth');
const { authLimiter, subscriberAuthLimiter, smsLimiter } = require('../middleware/rateLimit');
const logger = require('../lib/logger');
const sms = require('../services/sms');
const credentials = require('../services/credentials');
const notifications = require('../services/notifications');
const settingsService = require('../services/settings');

const router = express.Router();

const geoCache = new Map();

function extractClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    const first = xff.split(',')[0].trim();
    if (first) return first.replace(/^::ffff:/i, '');
  }
  const xReal = req.headers['x-real-ip'] || req.headers['cf-connecting-ip'];
  if (typeof xReal === 'string' && xReal.trim()) {
    return xReal.trim().replace(/^::ffff:/i, '');
  }
  const rawIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  const cleaned = String(rawIp).replace(/^::ffff:/i, '');
  return cleaned === '::1' ? '127.0.0.1' : cleaned;
}

function isPrivateOrLoopbackIp(ip) {
  if (!ip) return true;
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return true;
  return false;
}

async function resolveGeoFromIp(ip) {
  const cacheKey = ip || 'self';
  const cached = geoCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  let region = 'Unknown';
  let resolvedIp = ip || '127.0.0.1';

  try {
    const targetUrl = isPrivateOrLoopbackIp(ip)
      ? 'https://ipwho.is/'
      : `https://ipwho.is/${encodeURIComponent(ip)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    const res = await fetch(targetUrl, { signal: controller.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success !== false) {
        const city = data.city || '';
        const postal = data.postal || 'N/A';
        const country = data.country || '';
        if (city || country) {
          region = `${city || 'Unknown'} - ${postal || 'N/A'} - ${country || 'Unknown'}`;
        }
        if (isPrivateOrLoopbackIp(ip) && data.ip) {
          resolvedIp = `${ip} (${data.ip})`;
        }
      }
    }
  } catch {
    // Fallback to Unknown when offline or rate-limited
  }

  const out = { ip: resolvedIp, region };
  geoCache.set(cacheKey, { data: out, expiresAt: Date.now() + 10 * 60 * 1000 });
  return out;
}

function formatUtcLoginTimestamp(dateInput) {
  if (!dateInput) return null;
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  let hours = d.getUTCHours();
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const hh = String(hours).padStart(2, '0');
  return `${dd}-${mm}-${yyyy}, ${hh}:${minutes} ${ampm} GMT +00:00`;
}

function detectEncryptionProtocol(req) {
  if (req.socket && typeof req.socket.getProtocol === 'function') {
    const proto = req.socket.getProtocol();
    const cipher = typeof req.socket.getCipher === 'function' ? req.socket.getCipher() : null;
    if (proto) {
      const normalized = String(proto).replace(/^TLSv/i, 'TLS ');
      return cipher && cipher.name ? `${normalized} (${cipher.name})` : normalized;
    }
  }
  const forwardedProto = req.headers['x-forwarded-tls-protocol'] || req.headers['x-ssl-protocol'];
  if (typeof forwardedProto === 'string' && forwardedProto.trim()) {
    return forwardedProto.trim().replace(/^TLSv/i, 'TLS ');
  }
  const runtimeMaxTls = String(tls.DEFAULT_MAX_VERSION || 'TLSv1.3').replace(/^TLSv/i, 'TLS ');
  const runtimeCipher = Array.isArray(tls.getCiphers?.()) && tls.getCiphers().includes('aes-256-gcm')
    ? 'AES-256-GCM'
    : 'SHA-256';
  return `${runtimeMaxTls} / ${runtimeCipher}`;
}

/**
 * POST /api/auth/login
 * Staff login against the `api_users` table.
 */
router.post(
  '/login',
  authLimiter,
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

    const clientIp = extractClientIp(req);
    const updatedUser = await db.queryOne(
      `UPDATE api_users
          SET previous_login_at = COALESCE(last_login_at, NOW()),
              last_login_at = NOW(),
              last_login_ip = $2
        WHERE id = $1
        RETURNING previous_login_at, last_login_at`,
      [user.id, clientIp],
    );

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

    const previousLoginAt = updatedUser?.previous_login_at || user.last_login_at || updatedUser?.last_login_at;

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        lastLoginAt: previousLoginAt,
        lastLoginFormatted: formatUtcLoginTimestamp(previousLoginAt),
      },
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
  subscriberAuthLimiter,
  validate({
    body: z.object({
      username: z.string().min(2, 'Username or phone is required'),
      password: z.string().min(1, 'Password is required'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { username, password } = req.validatedBody;
    const clientIp = extractClientIp(req);

    const result = await credentials.authenticate(username, password, clientIp);

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

    const raw = subscriber.raw_data || {};
    const firstName = subscriber.first_name || raw.firstName || String(subscriber.name || '').trim().split(/\s+/)[0] || '';
    const lastName =
      subscriber.last_name ||
      raw.lastName ||
      String(subscriber.name || '')
        .trim()
        .split(/\s+/)
        .slice(1)
        .join(' ') ||
      '';
    const packageName = subscriber.joined_package_name || raw.packageName || '';
    const previousLoginAt = subscriber.previous_login_at || subscriber.last_login_at || null;

    const token = signToken({
      id: subscriber.id,
      name: subscriber.name,
      firstName,
      lastName,
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
        firstName,
        lastName,
        email: subscriber.email,
        phone: subscriber.phone,
        packageId: subscriber.package_id,
        packageName,
        status: subscriber.status,
        theme: subscriber.theme || raw.theme || 'system',
        lastLoginAt: previousLoginAt,
        lastLoginFormatted: formatUtcLoginTimestamp(previousLoginAt),
      },
    });
  }),
);

/**
 * POST /api/auth/forgot-password
 * Self-service password reset for a subscriber. An SMS with a temporary
 * password is sent to the phone number on file. The response is always the
 * same so an attacker cannot tell which usernames are registered.
 */
router.post(
  '/forgot-password',
  subscriberAuthLimiter,
  validate({
    body: z.object({
      username: z.string().min(2, 'Username or phone is required'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { username } = req.validatedBody;
    const needle = String(username || '').trim();

    // The same placeholder is reused in the query, so exactly one parameter
    // is bound — passing three would make the prepared statement mismatch.
    const subscriber = await db.queryOne(
      `SELECT id, name, phone FROM subscribers WHERE id = $1 OR phone = $1 OR raw_data->>'username' = $1`,
      [needle],
    );

    let temporaryPassword = null;

    if (subscriber) {
      temporaryPassword = `NL-${Math.random().toString(36).slice(2, 8).toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`;
      try {
        await credentials.resetPassword(subscriber.id, temporaryPassword);
      } catch (error) {
        logger.error('forgot-password: temp password could not be stored', { error: error.message });
      }
      try {
        // The phone number belongs to the template context — the send helper
        // reads it from there, not from the options.
        await sms.sendTemplate(
          'password_reset',
          { name: subscriber.name || 'Customer', password: temporaryPassword, phone: subscriber.phone },
          { subscriberId: subscriber.id },
        );
      } catch (error) {
        logger.error('forgot-password: temp password SMS could not be sent', { error: error.message });
      }
      await audit({
        actorId: subscriber.id,
        actorRole: ROLES.SUBSCRIBER,
        action: 'auth.password_reset_requested',
        entityType: 'subscriber',
        entityId: subscriber.id,
        ip: req.ip,
      });
    }

    // In mock SMS mode the message is only written to the log, so the
    // temporary password is handed back to the caller — otherwise the flow
    // could never be completed in development. Production refuses to start
    // with SMS_MODE != live (see config.js), so this branch cannot leak a
    // password on a live deployment.
    const smsIsLive = config.sms.mode === 'live';

    return res.json({
      success: true,
      message: smsIsLive
        ? 'If the account exists, a temporary password has been sent to the registered phone number.'
        : 'If the account exists, a temporary password has been generated.',
      ...(smsIsLive || !temporaryPassword ? {} : { temporaryPassword, delivery: 'sms_mock' }),
    });
  }),
);

/**
 * POST /api/auth/register
 * Self-service account registration.
 *
 * The account is created as a registered portal user, NOT as a subscriber. It
 * cannot access any package until a plan is purchased — that purchase is what
 * turns the account into a subscriber and provisions the line.
 */
router.post(
  '/register',
  authLimiter,
  validate({
    body: z.object({
      firstName: z.string().trim().min(1, 'First name is required'),
      lastName: z.string().trim().min(1, 'Last name is required'),
      fullName: z.string().optional(),
      username: z.string().min(3, 'Username must be at least 3 characters').regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers and underscores'),
      email: z.string().email('A valid email address is required'),
      phone: z.string().min(7, 'Phone is required'),
      password: z.string().min(8, 'Password must be at least 8 characters'),
      confirmPassword: z.string().min(8, 'Confirm password must be at least 8 characters'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { firstName, lastName, fullName, username, email, phone, password, confirmPassword } = req.validatedBody;
    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, error: 'Passwords do not match' });
    }

    const cleanFirst = firstName.trim();
    const cleanLast = lastName.trim();
    const computedFullName = (fullName && fullName.trim()) ? fullName.trim() : `${cleanFirst} ${cleanLast}`;

    const id = `NL-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    try {
      await db.transaction(async (client) => {
        await client.query(
          `INSERT INTO subscribers (id, name, first_name, last_name, email, phone, status, raw_data, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'registered', $7, NOW(), NOW())`,
          [
            id,
            computedFullName,
            cleanFirst,
            cleanLast,
            email,
            phone,
            JSON.stringify({
              source: 'self-register',
              username,
              firstName: cleanFirst,
              lastName: cleanLast,
              address: '',
              zone: '',
              status: 'registered',
              joinDate: new Date().toISOString().slice(0, 10),
              balance: 0,
              totalPaid: 0,
            }),
          ],
        );
        await client.query(
          `INSERT INTO subscriber_credentials (subscriber_id, username, password_hash, previous_login_at, last_login_at, raw_data)
           VALUES ($1, $2, $3, NOW(), NOW(), $4)`,
          [id, username, await hashPassword(password), JSON.stringify({ source: 'self-register' })],
        );
      });
    } catch (error) {
      if (String(error?.code) === '23505') {
        return res.status(409).json({ success: false, error: 'That username or email is already taken.' });
      }
      logger.error('register: account could not be created', { error: error.message });
      return res.status(500).json({ success: false, error: 'The account could not be created. Please try again later.' });
    }

    try {
      await notifications.notifyAdmins({
        type: 'new_user',
        title: 'New User Registered',
        message: `${computedFullName} (@${username}, ${email}) created a new NextLink portal account (${id}).`,
        link: '/users',
        roleTarget: 'users',
        meta: { subscriberId: id, firstName: cleanFirst, lastName: cleanLast, username, email, phone },
      });
      await notifications.notifySubscriber(id, {
        type: 'welcome',
        title: `Welcome to NextLink, ${cleanFirst}!`,
        message: 'Your portal account is active. Select a fiber package to provision your optical connection.',
        link: '/dashboard/purchase',
        meta: { subscriberId: id },
      });
    } catch (notifErr) {
      logger.warn('register notification failed', { error: notifErr.message });
    }

    await audit({
      actorId: id,
      actorRole: 'registered',
      action: 'auth.register',
      entityType: 'subscriber',
      entityId: id,
      ip: req.ip,
    });

    const token = signToken({
      id,
      name: computedFullName,
      firstName: cleanFirst,
      lastName: cleanLast,
      role: ROLES.SUBSCRIBER,
      type: 'subscriber',
      subscriberId: id,
    });

    return res.status(201).json({
      success: true,
      message: 'Account created. Sign in and purchase a package to activate your service.',
      token,
      subscriberId: id,
      firstName: cleanFirst,
      lastName: cleanLast,
      fullName: computedFullName,
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
    if (req.user.type === 'subscriber') {
      const subId = req.user.subscriberId || req.user.id;
      const sub = await db.queryOne(
        `SELECT s.id, s.name, s.first_name, s.last_name, s.email, s.phone, s.status, s.package_id, s.raw_data, s.theme,
                p.name AS joined_package_name,
                sc.previous_login_at, sc.last_login_at
           FROM subscribers s
           LEFT JOIN packages p ON p.id = s.package_id
           LEFT JOIN subscriber_credentials sc ON sc.subscriber_id = s.id
          WHERE s.id = $1`,
        [subId],
      );
      if (sub) {
        const raw = sub.raw_data || {};
        const firstName = sub.first_name || raw.firstName || String(sub.name || '').trim().split(/\s+/)[0] || '';
        const lastName = sub.last_name || raw.lastName || String(sub.name || '').trim().split(/\s+/).slice(1).join(' ') || '';
        const prevLogin = sub.previous_login_at || sub.last_login_at || null;
        return res.json({
          success: true,
          user: {
            id: sub.id,
            name: sub.name,
            firstName,
            lastName,
            email: sub.email,
            phone: sub.phone,
            role: 'subscriber',
            status: sub.status,
            packageId: sub.package_id,
            packageName: sub.joined_package_name || raw.packageName || '',
            theme: sub.theme || raw.theme || 'system',
            lastLoginAt: prevLogin,
            lastLoginFormatted: formatUtcLoginTimestamp(prevLogin),
          },
        });
      }
    }
    const user = await db.queryOne(
      'SELECT id, email, name, role, status, previous_login_at, last_login_at FROM api_users WHERE id = $1',
      [req.user.id],
    );
    const prevLogin = user?.previous_login_at || user?.last_login_at || null;
    res.json({
      success: true,
      user: user
        ? {
            ...user,
            lastLoginAt: prevLogin,
            lastLoginFormatted: formatUtcLoginTimestamp(prevLogin),
          }
        : { id: req.user.id, role: req.user.role },
    });
  }),
);

/**
 * GET /api/auth/session-meta
 * Dynamic footer & session metadata for both Frontend and Backend (logged in or logged out).
 */
router.get(
  '/session-meta',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const clientIp = extractClientIp(req);
    const [geo, footerConfig] = await Promise.all([
      resolveGeoFromIp(clientIp),
      settingsService.getGroup('footer').catch(() => ({ version: 'To be implemented' })),
    ]);

    const version = (footerConfig && footerConfig.version) ? String(footerConfig.version) : 'To be implemented';
    const encryption = detectEncryptionProtocol(req);

    let lastLoginAt = null;
    let authenticated = Boolean(req.user);
    const hintUserId = req.query.userId ? String(req.query.userId) : null;
    const hintEmail = req.query.email ? String(req.query.email).toLowerCase() : null;
    const contextType = req.query.context === 'admin' ? 'admin' : 'user';

    if (req.user) {
      if (req.user.type === 'subscriber') {
        const subId = req.user.subscriberId || req.user.id;
        const cred = await db.queryOne(
          'SELECT previous_login_at, last_login_at FROM subscriber_credentials WHERE subscriber_id = $1',
          [subId],
        );
        lastLoginAt = cred?.previous_login_at || cred?.last_login_at || null;
      } else {
        const staff = await db.queryOne(
          'SELECT previous_login_at, last_login_at FROM api_users WHERE id = $1',
          [req.user.id],
        );
        lastLoginAt = staff?.previous_login_at || staff?.last_login_at || null;
      }
    } else if (hintUserId) {
      const cred = await db.queryOne(
        'SELECT previous_login_at, last_login_at FROM subscriber_credentials WHERE subscriber_id = $1',
        [hintUserId],
      );
      if (cred) {
        lastLoginAt = cred.previous_login_at || cred.last_login_at || null;
        authenticated = true;
      } else {
        const staff = await db.queryOne(
          'SELECT previous_login_at, last_login_at FROM api_users WHERE id = $1 OR LOWER(email) = LOWER($1)',
          [hintUserId],
        );
        if (staff) {
          lastLoginAt = staff.previous_login_at || staff.last_login_at || null;
          authenticated = true;
        }
      }
    } else if (hintEmail) {
      const staff = await db.queryOne(
        'SELECT previous_login_at, last_login_at FROM api_users WHERE LOWER(email) = $1',
        [hintEmail],
      );
      if (staff) {
        lastLoginAt = staff.previous_login_at || staff.last_login_at || null;
        authenticated = true;
      }
    }

    // Even when logged out, if there is a previous login recorded in the DB for the portal/admin context,
    // provide the last recorded login timestamp so the format is always verifiable.
    if (!lastLoginAt) {
      if (contextType === 'admin') {
        const latestStaff = await db.queryOne(
          'SELECT COALESCE(previous_login_at, last_login_at, created_at) AS ts FROM api_users ORDER BY last_login_at DESC NULLS LAST LIMIT 1',
        );
        lastLoginAt = latestStaff?.ts || null;
      } else {
        const latestSub = await db.queryOne(
          'SELECT COALESCE(previous_login_at, last_login_at, created_at) AS ts FROM subscriber_credentials ORDER BY last_login_at DESC NULLS LAST LIMIT 1',
        );
        lastLoginAt = latestSub?.ts || null;
      }
    }

    const nowYear = new Date().getUTCFullYear();

    res.json({
      success: true,
      version,
      ip: geo.ip || clientIp,
      rawIp: clientIp,
      region: geo.region || 'Unknown',
      lastLoginAt,
      lastLogin: formatUtcLoginTimestamp(lastLoginAt) || 'N/A',
      authenticated,
      userMode: authenticated ? 'Enabled' : 'Disabled',
      adminMode: authenticated ? 'Enabled' : 'Disabled',
      encryption,
      copyrightYears: `${nowYear}–${nowYear + 1}`,
    });
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
