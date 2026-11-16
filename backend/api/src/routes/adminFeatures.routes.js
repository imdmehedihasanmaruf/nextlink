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
    if (!['approve', 'reject', 'complete', 'activate', 'deactivate'].includes(action)) {
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

const db = require('../lib/db');

function sanitizeSubscriberRow(row) {
  const copy = { ...row };
  delete copy.password;
  delete copy.password_hash;
  delete copy.legacy_password;
  if (copy.raw_data && typeof copy.raw_data === 'object') {
    const rawCopy = { ...copy.raw_data };
    delete rawCopy.password;
    delete rawCopy.password_hash;
    delete rawCopy.legacy_password;
    delete rawCopy.tempPassword;
    copy.raw_data = rawCopy;
  }
  return copy;
}

/** GET /api/admin/orders & GET /api/orders */
router.get(
  '/orders',
  requireAuth,
  requireRole(...STAFF),
  asyncHandler(async (_req, res) => {
    const result = await db.query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json({ success: true, orders: result.rows });
  })
);

/** POST /api/admin/orders & POST /api/orders */
router.post(
  '/orders',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userRole = req.user?.role;
    const userType = req.user?.type;
    const effectiveSubId = req.user?.subscriberId || req.user?.id;
    const requestedCustomerId = req.body?.customerId || effectiveSubId;

    if ((userType === 'subscriber' || userRole === 'subscriber') && requestedCustomerId !== effectiveSubId) {
      return res.status(403).json({
        success: false,
        error: 'You can only create orders for your own subscriber account',
      });
    }

    if (!requestedCustomerId) {
      return res.status(400).json({ success: false, error: 'customerId is required' });
    }

    const packageId = req.body?.packageId;
    if (!packageId) {
      return res.status(400).json({ success: false, error: 'packageId is required' });
    }

    const subscriber = await db.queryOne('SELECT * FROM subscribers WHERE id = $1', [requestedCustomerId]);
    if (!subscriber) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    const packageRow = await db.queryOne('SELECT * FROM packages WHERE id = $1', [packageId]);
    if (!packageRow) {
      return res.status(404).json({ success: false, error: 'Package not found' });
    }

    const monthlyPrice = Number(packageRow.price || 0);
    const purchaseType = req.body?.purchaseType || 'New Connection';

    const existingActive = await db.queryOne(
      "SELECT id FROM orders WHERE customer_id = $1 AND (UPPER(order_status) = 'ACTIVE' OR LOWER(payment_status) = 'paid') LIMIT 1",
      [subscriber.id]
    );
    const isFirstPurchase = !existingActive;

    const installationFee = isFirstPurchase ? 8.99 : 0.00;
    const taxFee = isFirstPurchase ? 0.99 : 0.00;
    const totalPayable = Math.round((monthlyPrice + installationFee + taxFee) * 100) / 100;

    const year = new Date().getFullYear();
    const random = Math.random().toString(36).substring(2, 10).toUpperCase();
    const orderId = `ORD-${year}-${random}`;

    const safeRawData = {
      customerId: subscriber.id,
      packageId: packageRow.id,
      packageName: packageRow.name,
      purchaseType,
      monthlyPrice,
      installationFee,
      taxes: taxFee,
      totalPayable,
      paymentMethod: req.body?.paymentMethod || 'bKash',
      notes: req.body?.notes || null,
    };

    const newOrder = await db.queryOne(
      `INSERT INTO orders
         (id, customer_id, customer_name, package_id, package_name, purchase_type,
          download_speed, upload_speed, monthly_price, installation_fee, taxes, total_payable,
          payment_method, payment_status, order_status, raw_data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'Payment Pending', 'Pending Activation', $14, NOW(), NOW())
       RETURNING *`,
      [
        orderId,
        subscriber.id,
        subscriber.name,
        packageRow.id,
        packageRow.name,
        purchaseType,
        Number(packageRow.speed || 100),
        Number(packageRow.upload_speed || packageRow.speed || 100),
        monthlyPrice,
        installationFee,
        taxFee,
        totalPayable,
        req.body?.paymentMethod || 'bKash',
        JSON.stringify(safeRawData),
      ]
    );

    return res.status(201).json({
      success: true,
      order: newOrder,
    });
  })
);

/** PUT /api/admin/orders & PATCH /api/admin/orders/:id */
const handleUpdateOrderStatus = asyncHandler(async (req, res) => {
  const orderId = req.params.id || req.body?.orderId;
  if (!orderId) return res.status(400).json({ success: false, error: 'Order ID is required' });
  const order = await db.queryOne('SELECT * FROM orders WHERE id = $1', [orderId]);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

  const status = req.body?.status || req.body?.order_status || order.order_status;
  const paymentStatus = req.body?.paymentStatus || req.body?.payment_status || order.payment_status;

  const updated = await db.queryOne(
    `UPDATE orders SET order_status = $1, payment_status = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
    [status, paymentStatus, orderId]
  );

  res.json({
    success: true,
    message: 'Order updated successfully',
    order: updated,
    provisioning: { attempted: status === 'Active', success: true },
  });
});

router.put('/orders', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING), handleUpdateOrderStatus);
router.patch('/orders/:id', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING), handleUpdateOrderStatus);
router.patch('/orders/:id/status', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING), handleUpdateOrderStatus);

/** GET /api/users & GET /api/subscribers */
const handleListUsers = asyncHandler(async (_req, res) => {
  const result = await db.query('SELECT * FROM subscribers ORDER BY created_at DESC');
  const sanitized = result.rows.map(sanitizeSubscriberRow);
  res.json({ success: true, users: sanitized, subscribers: sanitized });
});

router.get('/users', requireAuth, requireRole(...STAFF), handleListUsers);
router.get('/subscribers', requireAuth, requireRole(...STAFF), handleListUsers);

module.exports = router;
