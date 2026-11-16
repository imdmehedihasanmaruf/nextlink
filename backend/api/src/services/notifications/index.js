'use strict';

/**
 * End-to-End Notifications Service (Subscriber & Admin)
 *
 * Persists notifications in PostgreSQL (`notifications` table) with UTC
 * timestamps (`TIMESTAMPTZ`) and broadcasts real-time events to connected
 * Server-Sent Events (SSE) clients.
 */

const { EventEmitter } = require('events');
const db = require('../../lib/db');
const logger = require('../../lib/logger');
const { newId } = require('../../lib/utils');

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

const PREF_KEY_BY_TYPE = {
  invoice_generated: 'invoiceGenerated',
  payment_received: 'paymentReceived',
  payment_failed: 'paymentFailed',
  late_fee_applied: 'lateFeeApplied',
  ticket_reply: 'ticketReply',
  technician_assigned: 'technicianAssigned',
  boost_activated: 'boostActivated',
  referral_credited: 'referralCredited',
  new_ticket: 'adminNewTicket',
  new_user: 'adminNewUser',
  admin_failed_payment: 'adminFailedPayment',
};

async function isNotificationTypeEnabled(type) {
  try {
    const prefKey = PREF_KEY_BY_TYPE[type];
    if (!prefKey) return true;
    const row = await db.queryOne(
      "SELECT value FROM system_settings WHERE key = 'notifications'",
    );
    if (!row || !row.value || typeof row.value !== 'object') return true;
    if (row.value[prefKey] === false) return false;
    return true;
  } catch {
    return true;
  }
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    recipientType: row.recipient_type,
    roleTarget: row.role_target || null,
    type: row.type || 'system',
    title: row.title,
    message: row.message,
    link: row.link || null,
    isRead: Boolean(row.is_read),
    rawData: row.raw_data || null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

async function createNotification({
  userId,
  recipientType = 'subscriber',
  roleTarget = null,
  type = 'system',
  title,
  message,
  link = null,
  rawData = null,
}) {
  if (!userId || !title || !message) return null;

  const enabled = await isNotificationTypeEnabled(type);
  if (!enabled) {
    return null;
  }

  const id = newId('NTF');
  try {
    const res = await db.query(
      `INSERT INTO notifications
         (id, user_id, recipient_type, role_target, type, title, message, link, is_read, raw_data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, $9, NOW())
       RETURNING *`,
      [
        id,
        String(userId),
        recipientType === 'admin' ? 'admin' : 'subscriber',
        roleTarget || null,
        type || 'system',
        String(title).slice(0, 255),
        String(message),
        link ? String(link).slice(0, 500) : null,
        rawData ? JSON.stringify(rawData) : null,
      ],
    );
    const created = mapRow(res.rows[0]);
    if (created) {
      emitter.emit('notification', created);
    }
    return created;
  } catch (error) {
    logger.warn('failed to create notification', {
      userId,
      recipientType,
      type,
      message: error.message,
    });
    return null;
  }
}

async function notifySubscriber(subscriberId, { type = 'system', title, message, link = '/dashboard', rawData = null }) {
  if (!subscriberId) return null;
  return createNotification({
    userId: String(subscriberId),
    recipientType: 'subscriber',
    type,
    title,
    message,
    link,
    rawData,
  });
}

async function notifyAdmins({ type = 'system', title, message, link = '/dashboard', roleTarget = null, rawData = null }) {
  return createNotification({
    userId: 'ADMIN',
    recipientType: 'admin',
    roleTarget,
    type,
    title,
    message,
    link,
    rawData,
  });
}

async function listNotifications({ userId, recipientType = 'subscriber', role = null, limit = 60 }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 60, 1), 200);

  if (recipientType === 'admin') {
    const normRole = role ? String(role).trim().toLowerCase().replace(/\s+/g, '_') : null;
    const rows = await db.queryAll(
      `SELECT *
         FROM notifications
        WHERE recipient_type = 'admin'
          AND (user_id = $1 OR user_id = 'ADMIN')
          AND ($2::varchar IS NULL OR role_target IS NULL OR role_target = 'all' OR role_target = $2 OR $2 IN ('super_admin', 'admin'))
        ORDER BY created_at DESC
        LIMIT $3`,
      [String(userId || 'ADMIN'), normRole, safeLimit],
    );
    const unreadRow = await db.queryOne(
      `SELECT COUNT(*)::int AS count
         FROM notifications
        WHERE recipient_type = 'admin'
          AND (user_id = $1 OR user_id = 'ADMIN')
          AND ($2::varchar IS NULL OR role_target IS NULL OR role_target = 'all' OR role_target = $2 OR $2 IN ('super_admin', 'admin'))
          AND is_read = FALSE`,
      [String(userId || 'ADMIN'), normRole],
    );
    return {
      notifications: rows.map(mapRow),
      unreadCount: Number(unreadRow?.count || 0),
    };
  }

  const rows = await db.queryAll(
    `SELECT *
       FROM notifications
      WHERE recipient_type = 'subscriber'
        AND user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [String(userId), safeLimit],
  );
  const unreadRow = await db.queryOne(
    `SELECT COUNT(*)::int AS count
       FROM notifications
      WHERE recipient_type = 'subscriber'
        AND user_id = $1
        AND is_read = FALSE`,
    [String(userId)],
  );

  return {
    notifications: rows.map(mapRow),
    unreadCount: Number(unreadRow?.count || 0),
  };
}

async function setReadState({ id, userId, recipientType = 'subscriber', isRead = true }) {
  if (!id) return null;
  const res =
    recipientType === 'admin'
      ? await db.query(
          `UPDATE notifications
              SET is_read = $1
            WHERE id = $2
              AND recipient_type = 'admin'
              AND (user_id = $3 OR user_id = 'ADMIN')
            RETURNING *`,
          [Boolean(isRead), String(id), String(userId || 'ADMIN')],
        )
      : await db.query(
          `UPDATE notifications
              SET is_read = $1
            WHERE id = $2
              AND recipient_type = 'subscriber'
              AND user_id = $3
            RETURNING *`,
          [Boolean(isRead), String(id), String(userId)],
        );

  const updated = mapRow(res.rows[0]);
  if (updated) {
    emitter.emit('notification_updated', updated);
  }
  return updated;
}

async function markAllRead({ userId, recipientType = 'subscriber' }) {
  if (recipientType === 'admin') {
    await db.query(
      `UPDATE notifications
          SET is_read = TRUE
        WHERE recipient_type = 'admin'
          AND (user_id = $1 OR user_id = 'ADMIN')
          AND is_read = FALSE`,
      [String(userId || 'ADMIN')],
    );
  } else {
    await db.query(
      `UPDATE notifications
          SET is_read = TRUE
        WHERE recipient_type = 'subscriber'
          AND user_id = $1
          AND is_read = FALSE`,
      [String(userId)],
    );
  }
  emitter.emit('notification_bulk', { userId, recipientType, action: 'mark_all_read' });
  return { success: true };
}

async function deleteNotification({ id, userId, recipientType = 'subscriber' }) {
  if (!id) return false;
  const res =
    recipientType === 'admin'
      ? await db.query(
          `DELETE FROM notifications
            WHERE id = $1
              AND recipient_type = 'admin'
              AND (user_id = $2 OR user_id = 'ADMIN')`,
          [String(id), String(userId || 'ADMIN')],
        )
      : await db.query(
          `DELETE FROM notifications
            WHERE id = $1
              AND recipient_type = 'subscriber'
              AND user_id = $2`,
          [String(id), String(userId)],
        );
  if (res.rowCount > 0) {
    emitter.emit('notification_deleted', { id, userId, recipientType });
  }
  return res.rowCount > 0;
}

async function clearAllNotifications({ userId, recipientType = 'subscriber' }) {
  if (recipientType === 'admin') {
    await db.query(
      `DELETE FROM notifications
        WHERE recipient_type = 'admin'
          AND (user_id = $1 OR user_id = 'ADMIN')`,
      [String(userId || 'ADMIN')],
    );
  } else {
    await db.query(
      `DELETE FROM notifications
        WHERE recipient_type = 'subscriber'
          AND user_id = $1`,
      [String(userId)],
    );
  }
  emitter.emit('notification_bulk', { userId, recipientType, action: 'clear_all' });
  return { success: true };
}

function subscribe(listener) {
  emitter.on('notification', listener);
  emitter.on('notification_updated', listener);
  emitter.on('notification_deleted', listener);
  emitter.on('notification_bulk', listener);
  return () => {
    emitter.off('notification', listener);
    emitter.off('notification_updated', listener);
    emitter.off('notification_deleted', listener);
    emitter.off('notification_bulk', listener);
  };
}

module.exports = {
  createNotification,
  notifySubscriber,
  notifyAdmins,
  listNotifications,
  setReadState,
  markAllRead,
  deleteNotification,
  clearAllNotifications,
  subscribe,
};
