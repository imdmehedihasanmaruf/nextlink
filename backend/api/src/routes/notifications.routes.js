'use strict';

/**
 * Notifications REST + SSE Routes (/api/notifications)
 *
 * Supports both subscriber portal tokens and admin staff tokens.
 * Also supports `?token=<jwt>` for EventSource (SSE) connections.
 */

const express = require('express');
const config = require('../config');
const db = require('../lib/db');
const { verifyToken } = require('../middleware/auth');
const notifications = require('../services/notifications');

const router = express.Router();

function resolveRequestUser(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const queryToken = typeof req.query?.token === 'string' ? req.query.token.trim() : null;
  const token = bearer || queryToken;

  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.user = payload;
      return next();
    }
  }

  // In production, an authenticated JWT Bearer token is strictly required
  if (config.env === 'production') {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  // Fallback for Next.js session state when JWT is not attached (dev/test only)
  const subscriberId =
    req.headers['x-subscriber-id'] ||
    (typeof req.query?.subscriberId === 'string' ? req.query.subscriberId.trim() : null);
  if (subscriberId) {
    req.user = { id: String(subscriberId), sub: String(subscriberId), role: 'subscriber' };
    return next();
  }

  const adminRole =
    req.headers['x-admin-role'] ||
    (typeof req.query?.adminRole === 'string' ? req.query.adminRole.trim() : null);
  if (adminRole) {
    const adminId =
      req.headers['x-admin-id'] ||
      (typeof req.query?.adminId === 'string' ? req.query.adminId.trim() : 'ADM-001');
    req.user = { id: String(adminId), sub: String(adminId), role: String(adminRole) };
    return next();
  }

  return res.status(401).json({ success: false, error: 'Authentication required' });
}

async function checkAdminNotificationPermission(user) {
  if (!user) return false;
  const normalizedRole = String(user.role || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (normalizedRole === 'super_admin' || normalizedRole === 'admin') return true;
  try {
    const roleRow = await db.queryOne(
      `SELECT raw_data FROM roles
        WHERE LOWER(id) = LOWER($1)
           OR LOWER(name) = LOWER($1)
           OR LOWER(raw_data->>'key') = LOWER($2)
        LIMIT 1`,
      [String(user.role), normalizedRole],
    );
    if (roleRow && roleRow.raw_data && Array.isArray(roleRow.raw_data.permissions)) {
      const perms = roleRow.raw_data.permissions;
      if (perms.includes('notifications')) return true;
      return perms.includes('dashboard') || perms.includes('tickets') || perms.includes('billing');
    }
  } catch {
    // Fallback to standard staff roles
  }
  return ['super_admin', 'admin', 'billing', 'support', 'support_staff', 'network_engineer', 'technician'].includes(
    normalizedRole,
  );
}

function getContext(req) {
  const isSubscriber = req.user?.role === 'subscriber';
  return {
    isSubscriber,
    recipientType: isSubscriber ? 'subscriber' : 'admin',
    userId: String(req.user?.sub || req.user?.id || ''),
    role: String(req.user?.role || ''),
  };
}

router.use(resolveRequestUser);

// GET /api/notifications
router.get('/', async (req, res, next) => {
  try {
    const ctx = getContext(req);
    if (!ctx.isSubscriber) {
      const allowed = await checkAdminNotificationPermission(req.user);
      if (!allowed) {
        return res.status(403).json({
          success: false,
          error: 'Your role does not have permission to view notifications.',
          notifications: [],
          unreadCount: 0,
        });
      }
    }

    const result = await notifications.listNotifications({
      userId: ctx.userId,
      recipientType: ctx.recipientType,
      role: ctx.role,
      limit: Number(req.query.limit) || 60,
    });

    res.json({
      success: true,
      recipientType: ctx.recipientType,
      notifications: result.notifications,
      unreadCount: result.unreadCount,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/notifications/stream (Server-Sent Events for real-time delivery)
router.get('/stream', async (req, res) => {
  const ctx = getContext(req);
  if (!ctx.isSubscriber) {
    const allowed = await checkAdminNotificationPermission(req.user);
    if (!allowed) {
      return res.status(403).end();
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write(`data: ${JSON.stringify({ event: 'connected', ts: new Date().toISOString() })}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 15000);

  const unsubscribe = notifications.subscribe((payload) => {
    try {
      if (!payload) return;
      const matchesRecipient =
        ctx.recipientType === 'admin'
          ? payload.recipientType === 'admin'
          : payload.recipientType === 'subscriber' && String(payload.userId) === ctx.userId;

      if (matchesRecipient) {
        res.write(`data: ${JSON.stringify({ event: 'update', notification: payload })}\n\n`);
      }
    } catch {
      // Ignore write error on closed stream
    }
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', async (req, res, next) => {
  try {
    const ctx = getContext(req);
    if (!ctx.isSubscriber && !(await checkAdminNotificationPermission(req.user))) {
      return res.status(403).json({ success: false, error: 'Insufficient role permissions' });
    }
    const isRead = req.body?.isRead !== undefined ? Boolean(req.body.isRead) : true;
    const updated = await notifications.setReadState({
      id: req.params.id,
      userId: ctx.userId,
      recipientType: ctx.recipientType,
      isRead,
    });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Notification not found' });
    }
    res.json({ success: true, notification: updated });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/notifications/:id/unread
router.patch('/:id/unread', async (req, res, next) => {
  try {
    const ctx = getContext(req);
    if (!ctx.isSubscriber && !(await checkAdminNotificationPermission(req.user))) {
      return res.status(403).json({ success: false, error: 'Insufficient role permissions' });
    }
    const updated = await notifications.setReadState({
      id: req.params.id,
      userId: ctx.userId,
      recipientType: ctx.recipientType,
      isRead: false,
    });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Notification not found' });
    }
    res.json({ success: true, notification: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/mark-all-read
router.post('/mark-all-read', async (req, res, next) => {
  try {
    const ctx = getContext(req);
    if (!ctx.isSubscriber && !(await checkAdminNotificationPermission(req.user))) {
      return res.status(403).json({ success: false, error: 'Insufficient role permissions' });
    }
    await notifications.markAllRead({
      userId: ctx.userId,
      recipientType: ctx.recipientType,
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/notifications/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const ctx = getContext(req);
    if (!ctx.isSubscriber && !(await checkAdminNotificationPermission(req.user))) {
      return res.status(403).json({ success: false, error: 'Insufficient role permissions' });
    }
    const deleted = await notifications.deleteNotification({
      id: req.params.id,
      userId: ctx.userId,
      recipientType: ctx.recipientType,
    });
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Notification not found' });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/notifications (Clear all)
router.delete('/', async (req, res, next) => {
  try {
    const ctx = getContext(req);
    if (!ctx.isSubscriber && !(await checkAdminNotificationPermission(req.user))) {
      return res.status(403).json({ success: false, error: 'Insufficient role permissions' });
    }
    await notifications.clearAllNotifications({
      userId: ctx.userId,
      recipientType: ctx.recipientType,
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
