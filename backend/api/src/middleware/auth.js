'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('../lib/db');
const logger = require('../lib/logger');

/**
 * Authentication + role based access control.
 *
 * Staff (admin panel) authenticate with an email/password against the
 * `api_users` table and receive a JWT. Subscribers authenticate through the
 * existing Next.js flow and pass their subscriber id; both are accepted so the
 * portal and the admin panel can share this API.
 *
 * Roles map 1:1 to the SRS permission matrix:
 *   super_admin — full read/write + audit logs
 *   billing     — invoices, payments, reports
 *   support     — tickets, subscriber status
 *   technician  — field jobs, bandwidth reset
 *   subscriber  — own portal data only
 */

const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  BILLING: 'billing',
  SUPPORT: 'support',
  TECHNICIAN: 'technician',
  SUBSCRIBER: 'subscriber',
};

const PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: ['*'],
  [ROLES.ADMIN]: ['*'],
  [ROLES.BILLING]: [
    'billing:read',
    'billing:write',
    'payment:read',
    'payment:write',
    'reports:read',
    'subscriber:read',
    'mikrotik:read',
    'sms:read',
  ],
  [ROLES.SUPPORT]: [
    'ticket:read',
    'ticket:write',
    'subscriber:read',
    'mikrotik:read',
    'mikrotik:write',
    'sms:read',
    'sms:write',
  ],
  [ROLES.TECHNICIAN]: [
    'ticket:read',
    'ticket:write',
    'subscriber:read',
    'mikrotik:read',
    'mikrotik:write',
  ],
  [ROLES.SUBSCRIBER]: ['own:billing', 'own:payment', 'own:ticket'],
};

/**
 * Sign a JWT for an authenticated user.
 */
function signToken(payload) {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

/**
 * Verify a JWT and return its decoded payload, or null if invalid/expired.
 */
function verifyToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch {
    return null;
  }
}

/**
 * Hash a plaintext password.
 */
async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

/**
 * Compare a plaintext password against a stored hash.
 */
async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

/**
 * Extract a bearer token from the request.
 */
function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (req.headers['x-auth-token']) return String(req.headers['x-auth-token']);
  return null;
}

/**
 * Authenticate a staff user by email + password.
 */
async function authenticateStaff(email, password) {
  const user = await db.queryOne('SELECT * FROM api_users WHERE email = $1', [String(email || '').toLowerCase()]);
  if (!user) return { success: false, error: 'Invalid credentials' };
  if (user.status !== 'active') return { success: false, error: 'Account is not active' };

  const ok = await comparePassword(password, user.password_hash);
  if (!ok) return { success: false, error: 'Invalid credentials' };

  await db.query('UPDATE api_users SET last_login_at = NOW() WHERE id = $1', [user.id]);

  return {
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  };
}

/**
 * Express middleware: require a valid JWT.
 */
function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwt.secret);
      req.user = {
        id: payload.id,
        role: payload.role,
        type: payload.type || (payload.role === ROLES.SUBSCRIBER || String(payload.role).toLowerCase() === 'subscriber' ? 'subscriber' : 'staff'),
        subscriberId: payload.subscriberId || payload.id,
      };
      return next();
    } catch (error) {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
  }

  // Fallback to client x-subscriber-id header if present (dev/test only)
  if (req.headers && req.headers['x-subscriber-id']) {
    if (config.env === 'production') {
      return res.status(401).json({ success: false, error: 'Authentication required. Bearer token is mandatory in production.' });
    }
    const subId = String(req.headers['x-subscriber-id']);
    req.user = {
      id: subId,
      role: ROLES.SUBSCRIBER,
      type: 'subscriber',
      subscriberId: subId,
    };
    return next();
  }

  return res.status(401).json({ success: false, error: 'Authentication required' });
}

/**
 * Express middleware: require one of the given roles.
 */
function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    if (req.user.role === ROLES.SUPER_ADMIN) return next();
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `This action requires one of the following roles: ${allowed.join(', ')}`,
      });
    }
    return next();
  };
}

/**
 * Express middleware: allow a subscriber to act on their own data, and staff
 * only when their role is listed.
 *
 * Used by the routes that subscribers and staff share, where the subscriber
 * is confined to their own records and the staff side is role checked.
 *
 * @param {string[]} staffRoles  roles that may act on other accounts
 */
function requireSelfOrRole(...staffRoles) {
  const allowed = staffRoles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    if (req.user.role === ROLES.SUPER_ADMIN) return next();
    if (req.user.role === ROLES.SUBSCRIBER) return next();
    if (allowed.includes(req.user.role)) return next();
    return res.status(403).json({
      success: false,
      error: `This action requires one of the following roles: ${allowed.join(', ')}`,
    });
  };
}

/**
 * Express middleware: require a specific permission.
 */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const granted = PERMISSIONS[req.user.role] || [];
    if (granted.includes('*') || granted.includes(permission)) return next();
    return res.status(403).json({
      success: false,
      error: `Missing permission: ${permission}`,
    });
  };
}

/**
 * Optional authentication — populates req.user when a valid token is present.
 */
function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwt.secret);
      req.user = {
        id: payload.id,
        role: payload.role,
        type: payload.type || (payload.role === ROLES.SUBSCRIBER || String(payload.role).toLowerCase() === 'subscriber' ? 'subscriber' : 'staff'),
        subscriberId: payload.subscriberId || payload.id,
      };
      return next();
    } catch {
      /* ignore invalid token on optional routes */
    }
  }

  // Fallback to client x-subscriber-id header
  if (req.headers && req.headers['x-subscriber-id']) {
    const subId = String(req.headers['x-subscriber-id']);
    req.user = {
      id: subId,
      role: ROLES.SUBSCRIBER,
      type: 'subscriber',
      subscriberId: subId,
    };
  }

  return next();
}

/**
 * Write an entry to the audit log. Never throws.
 */
async function audit({ actorId, actorRole, action, entityType, entityId, details, ip }) {
  try {
    await db.query(
      `INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        actorId || null,
        actorRole || null,
        action,
        entityType || null,
        entityId ? String(entityId) : null,
        details ? JSON.stringify(details) : null,
        ip || null,
      ],
    );
  } catch (error) {
    logger.warn('audit log insert failed', { message: error.message });
  }
}

module.exports = {
  ROLES,
  PERMISSIONS,
  signToken,
  verifyToken,
  hashPassword,
  comparePassword,
  authenticateStaff,
  requireAuth,
  requireRole,
  requireSelfOrRole,
  requirePermission,
  optionalAuth,
  audit,
};
