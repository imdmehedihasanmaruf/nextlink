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

/**
 * GET /api/packages & GET /api/customer/packages
 * Public package catalogue list ordered by price.
 */
const handleListPackages = asyncHandler(async (_req, res) => {
  const result = await db.query('SELECT * FROM packages ORDER BY price ASC');
  res.json({ success: true, packages: result.rows });
});

router.get('/', handleListPackages);
router.get('/packages', handleListPackages);

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
 * Activate or submit a 1 Gbps On-Demand Turbo Boost.
 */
router.post(
  '/turbo-boost',
  requireAuth,
  portalLimiter,
  validate({
    body: z.object({
      durationHours: z.number().int().min(1).max(24).optional(),
      requestedMbps: z.number().int().min(1).max(10000).optional(),
      immediate: z.boolean().optional(),
      action: z.enum(['activate', 'request']).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const subscriberId = resolveSubscriber(req);
    if (!subscriberId) return res.status(400).json({ success: false, error: 'subscriberId is required' });
    try {
      const durationHours = req.validatedBody.durationHours || 2;
      const requestedMbps = req.validatedBody.requestedMbps || 1000;
      if (req.validatedBody.immediate === false || req.validatedBody.action === 'request') {
        const created = await turboBoost.request(subscriberId, { durationHours, requestedMbps });
        return res.status(201).json({
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
      }
      const activated = await turboBoost.activate(subscriberId, { durationHours, requestedMbps });
      return res.status(201).json({
        success: true,
        reference: activated.reference,
        boost: activated,
        request: activated,
      });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }),
);

/**
 * POST /api/customer/turbo-boost/activate
 * Immediate 1 Gbps On-Demand Turbo Boost activation.
 */
router.post(
  '/turbo-boost/activate',
  requireAuth,
  portalLimiter,
  validate({
    body: z.object({
      durationHours: z.number().int().min(1).max(24).optional(),
      requestedMbps: z.number().int().min(1).max(10000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const subscriberId = resolveSubscriber(req);
    if (!subscriberId) return res.status(400).json({ success: false, error: 'subscriberId is required' });
    try {
      const activated = await turboBoost.activate(subscriberId, {
        durationHours: req.validatedBody?.durationHours || 2,
        requestedMbps: req.validatedBody?.requestedMbps || 1000,
      });
      res.status(201).json({ success: true, boost: activated });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }),
);

/**
 * POST /api/customer/turbo-boost/deactivate
 * Deactivate an active 1 Gbps On-Demand Turbo Boost.
 */
router.post(
  '/turbo-boost/deactivate',
  requireAuth,
  portalLimiter,
  validate({
    body: z.object({
      id: z.string().optional().nullable(),
      requestId: z.string().optional().nullable(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const subscriberId = resolveSubscriber(req);
    if (!subscriberId) return res.status(400).json({ success: false, error: 'subscriberId is required' });
    try {
      const deactivated = await turboBoost.deactivate(subscriberId, {
        requestId: req.validatedBody?.requestId || req.validatedBody?.id || null,
        actor: { id: req.user.id, role: req.user.role },
      });
      res.json({ success: true, boost: deactivated, request: deactivated });
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

/**
 * POST /api/customer/subscription/change-package
 */
router.post(
  '/subscription/change-package',
  requireAuth,
  requireSelfOrRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  portalLimiter,
  asyncHandler(async (req, res) => {
    const subscriberId = resolveSubscriber(req);
    if (!subscriberId) return res.status(400).json({ success: false, error: 'subscriberId is required' });
    const newPackageId = String(req.body?.packageId || req.body?.newPackageId || '').trim();
    if (!newPackageId) return res.status(400).json({ success: false, error: 'packageId is required' });

    const pkg = await db.queryOne('SELECT * FROM packages WHERE id = $1', [newPackageId]);
    if (!pkg) return res.status(404).json({ success: false, error: 'Package not found' });

    const sub = await db.queryOne('SELECT * FROM subscribers WHERE id = $1', [subscriberId]);
    if (!sub) return res.status(404).json({ success: false, error: 'Subscriber not found' });

    await db.transaction(async (client) => {
      await client.query(
        `UPDATE subscribers
            SET package_id = $1,
                raw_data = jsonb_set(
                  jsonb_set(COALESCE(raw_data, '{}'::jsonb), '{packageName}', to_jsonb($2::text), true),
                  '{packagePrice}', to_jsonb($3::numeric), true
                ),
                updated_at = NOW()
          WHERE id = $4`,
        [pkg.id, pkg.name, Number(pkg.price), subscriberId]
      );
      await client.query(
        `INSERT INTO subscriber_billing (subscriber_id, package_id, amount, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (subscriber_id) DO UPDATE SET package_id = EXCLUDED.package_id, amount = EXCLUDED.amount, updated_at = NOW()`,
        [subscriberId, pkg.id, Number(pkg.price)]
      );
    });

    res.json({
      success: true,
      message: `Package successfully changed to ${pkg.name}`,
      packageId: pkg.id,
      packageName: pkg.name,
      packagePrice: Number(pkg.price),
    });
  })
);

/**
 * GET /api/customer/orders
 */
router.get(
  '/orders',
  requireAuth,
  requireSelfOrRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  asyncHandler(async (req, res) => {
    const subscriberId = resolveSubscriber(req) || (req.query.customerId ? String(req.query.customerId) : null);
    if (!subscriberId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const result = await db.query(
      'SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC',
      [subscriberId]
    );
    res.json({ success: true, orders: result.rows });
  })
);

/**
 * POST /api/customer/orders/create-and-pay
 */
router.post(
  '/orders/create-and-pay',
  requireAuth,
  requireSelfOrRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  asyncHandler(async (req, res) => {
    const subscriberId = resolveSubscriber(req);
    if (!subscriberId) return res.status(401).json({ success: false, error: 'Authentication required' });

    if (req.body?.acceptedTerms !== undefined && !req.body.acceptedTerms) {
      return res.status(400).json({
        success: false,
        error: 'You must accept the terms and conditions before placing an order',
      });
    }

    const packageId = req.body?.packageId;
    if (!packageId) return res.status(400).json({ success: false, error: 'packageId is required' });

    const packageRow = await db.queryOne('SELECT * FROM packages WHERE id = $1', [packageId]);
    if (!packageRow) return res.status(404).json({ success: false, error: 'Selected package not found in catalog' });

    const subscriber = await db.queryOne('SELECT * FROM subscribers WHERE id = $1', [subscriberId]);
    if (!subscriber) return res.status(404).json({ success: false, error: 'Subscriber not found' });

    const monthlyPrice = Number(packageRow.price || 0);
    const installationFee = 8.99;
    const taxFee = 0.99;
    const totalPayable = Math.round((monthlyPrice + installationFee + taxFee) * 100) / 100;

    const year = new Date().getFullYear();
    const random = Math.random().toString(36).substring(2, 10).toUpperCase();
    const orderId = `ORD-${year}-${random}`;
    const invoiceId = `INV-PURCHASE-${year}-${random}`;

    const purchaseType = req.body?.purchaseType || 'New Connection';
    const paymentMethod = req.body?.paymentMethod || 'bkash';

    const safeRawData = {
      customerId: subscriber.id,
      packageId: packageRow.id,
      packageName: packageRow.name,
      purchaseType,
      paymentMethod,
      invoiceId,
      purchaseSession: {
        purchaseDate: new Date().toLocaleDateString('en-GB'),
        purchaseTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        city: req.body?.sessionGeolocation?.city || 'Unknown',
        postalCode: req.body?.sessionGeolocation?.postalCode || 'Unknown',
        state: req.body?.sessionGeolocation?.state || 'Unknown',
        country: req.body?.sessionGeolocation?.country || 'Unknown',
        clientIp: req.ip,
      },
    };

    const { order, invoice } = await db.transaction(async (client) => {
      const ordRes = await client.query(
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
          paymentMethod,
          JSON.stringify(safeRawData),
        ]
      );

      const invRes = await client.query(
        `INSERT INTO invoices
           (id, subscriber_id, amount, installation_fee, tax_fee, late_fee,
            invoice_type, status, due_date, raw_data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 0, 'purchase', 'unpaid', CURRENT_DATE, $6, NOW(), NOW())
         RETURNING *`,
        [
          invoiceId,
          subscriber.id,
          totalPayable,
          installationFee,
          taxFee,
          JSON.stringify({
            orderId,
            packageId: packageRow.id,
            packageName: packageRow.name,
            packageSpeed: Number(packageRow.speed || 100),
            packagePrice: monthlyPrice,
            source: 'package-order',
            purchaseSession: safeRawData.purchaseSession,
          }),
        ]
      );

      return { order: ordRes.rows[0], invoice: invRes.rows[0] };
    });

    return res.status(201).json({
      success: true,
      message: 'Order created and ready for payment',
      order,
      payment: {
        invoiceId: invoice.id,
        amount: totalPayable,
        currency: 'USD',
        gateway: paymentMethod,
      },
    });
  })
);

/**
 * GET /api/customer/profile & POST /api/customer/profile
 */
router.get(
  '/profile',
  requireAuth,
  requireSelfOrRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  asyncHandler(async (req, res) => {
    const subscriberId = resolveSubscriber(req);
    if (!subscriberId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const sub = await db.queryOne('SELECT * FROM subscribers WHERE id = $1', [subscriberId]);
    if (!sub) return res.status(404).json({ success: false, error: 'Subscriber not found' });
    const raw = sub.raw_data || {};
    res.json({
      success: true,
      user: {
        id: sub.id,
        firstName: sub.first_name || raw.firstName || '',
        lastName: sub.last_name || raw.lastName || '',
        name: sub.name,
        email: sub.email,
        phone: sub.phone,
        address: raw.address || '',
        packageId: sub.package_id,
        status: sub.status,
      },
    });
  })
);

router.post(
  '/profile',
  requireAuth,
  requireSelfOrRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  asyncHandler(async (req, res) => {
    const subscriberId = resolveSubscriber(req);
    if (!subscriberId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const sub = await db.queryOne('SELECT * FROM subscribers WHERE id = $1', [subscriberId]);
    if (!sub) return res.status(404).json({ success: false, error: 'Subscriber not found' });

    const firstName = req.body?.firstName !== undefined ? String(req.body.firstName) : (sub.first_name || '');
    const lastName = req.body?.lastName !== undefined ? String(req.body.lastName) : (sub.last_name || '');
    const email = req.body?.email !== undefined ? String(req.body.email) : sub.email;
    const phone = req.body?.phone !== undefined ? String(req.body.phone) : sub.phone;
    const name = `${firstName} ${lastName}`.trim() || sub.name;
    const raw = { ...(sub.raw_data || {}) };
    if (req.body?.address !== undefined) raw.address = String(req.body.address);
    delete raw.password;
    delete raw.password_hash;
    delete raw.legacy_password;
    delete raw.tempPassword;

    const updated = await db.queryOne(
      `UPDATE subscribers
          SET first_name = $1, last_name = $2, name = $3, email = $4, phone = $5, raw_data = $6, updated_at = NOW()
        WHERE id = $7
        RETURNING *`,
      [firstName, lastName, name, email, phone, JSON.stringify(raw), subscriberId]
    );
    res.json({ success: true, message: 'Profile saved.', user: updated });
  })
);

module.exports = router;
