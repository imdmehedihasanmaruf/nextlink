'use strict';

const express = require('express');
const { z } = require('zod');
const config = require('../config');
const db = require('../lib/db');
const logger = require('../lib/logger');
const { asyncHandler } = require('../middleware/error');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole, ROLES, audit } = require('../middleware/auth');
const billing = require('../services/billing/engine');
const pdf = require('../services/billing/pdf');
const queue = require('../lib/queue');

const router = express.Router();

/**
 * GET /api/billing/overview
 * Aggregate billing numbers for the admin dashboard.
 */
router.get(
  '/overview',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  asyncHandler(async (req, res) => {
    const overview = await billing.getOverview();
    res.json({ success: true, ...overview });
  }),
);

/**
 * GET /api/billing/invoices
 * Paginated invoice list with subscriber details.
 */
router.get(
  '/invoices',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  asyncHandler(async (req, res) => {
    const status = req.query.status && req.query.status !== 'all' ? String(req.query.status) : null;
    const subscriberId = req.query.subscriberId ? String(req.query.subscriberId) : null;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const conditions = [];
    const params = [];
    if (status) {
      params.push(status);
      conditions.push(`i.status = $${params.length}`);
    }
    if (subscriberId) {
      params.push(subscriberId);
      conditions.push(`i.subscriber_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit, offset);
    const result = await db.query(
      `SELECT i.*, s.name AS subscriber_name, s.phone AS subscriber_phone, s.email AS subscriber_email
         FROM invoices i
         LEFT JOIN subscribers s ON s.id = i.subscriber_id
         ${where}
         ORDER BY i.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const countResult = await db.query(
      `SELECT COUNT(*) AS total FROM invoices i ${where}`,
      params.slice(0, params.length - 2),
    );

    res.json({
      success: true,
      invoices: result.rows,
      total: Number(countResult.rows[0]?.total || 0),
      limit,
      offset,
    });
  }),
);

/**
 * GET /api/billing/invoices/:id
 * Single invoice with full details.
 */
router.get(
  '/invoices/:id',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  asyncHandler(async (req, res) => {
    const invoice = await db.queryOne(
      `SELECT i.*, s.name AS subscriber_name, s.phone AS subscriber_phone, s.email AS subscriber_email
         FROM invoices i
         LEFT JOIN subscribers s ON s.id = i.subscriber_id
        WHERE i.id = $1`,
      [req.params.id],
    );
    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    const events = await db.query(
      'SELECT * FROM billing_events WHERE invoice_id = $1 ORDER BY created_at DESC',
      [req.params.id],
    );

    const transactions = await db.query(
      'SELECT * FROM payment_transactions WHERE invoice_id = $1 ORDER BY created_at DESC',
      [req.params.id],
    );

    return res.json({
      success: true,
      invoice,
      events: events.rows,
      transactions: transactions.rows,
    });
  }),
);

/**
 * GET /api/billing/invoices/:id/pdf
 * Download the auto-generated PDF invoice.
 */
router.get(
  '/invoices/:id/pdf',
  requireAuth,
  asyncHandler(async (req, res) => {
    const invoice = await db.queryOne(
      `SELECT i.*, s.name AS subscriber_name, s.phone AS subscriber_phone, s.email AS subscriber_email
         FROM invoices i
         LEFT JOIN subscribers s ON s.id = i.subscriber_id
        WHERE i.id = $1`,
      [req.params.id],
    );
    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    // A subscriber may only download their own invoice. Staff need a role
    // that is allowed to see the billing data.
    if (req.user.type === 'subscriber') {
      if (invoice.subscriber_id !== (req.user.subscriberId || req.user.id)) {
        return res.status(403).json({ success: false, error: 'You can only view your own invoices' });
      }
    } else if (![ROLES.SUPER_ADMIN, ROLES.BILLING].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'You are not allowed to view the billing documents',
      });
    }

    const raw = invoice.raw_data || {};
    const subscriber = await db.queryOne('SELECT * FROM subscribers WHERE id = $1', [invoice.subscriber_id]);
    const subscriberRaw = subscriber ? subscriber.raw_data || {} : {};

    const filePath = pdf.invoicePdfPath(invoice.id);
    const fs = require('fs');

    // The PDF is regenerated whenever the invoice changed. A cached copy would
    // keep saying "UNPAID" on an invoice that has already been paid.
    const stamp = `${invoice.status}|${invoice.amount}|${invoice.due_date}|${raw.paidAt || ''}|${invoice.invoice_type || raw.invoiceType || ''}|${JSON.stringify(raw.purchaseSession || {})}|${JSON.stringify(raw.cancelSession || {})}|${JSON.stringify(raw.lines || [])}`;
    const markerPath = `${filePath}.stamp`;
    const currentStamp = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf-8') : null;

    if (currentStamp !== stamp) {
      await pdf.generateInvoicePdf({
        id: invoice.id,
        invoiceType: invoice.invoice_type || raw.invoiceType || (invoice.id.includes('CANCEL') ? 'cancel' : 'subscription'),
        subscriberId: invoice.subscriber_id,
        subscriberName: subscriber ? subscriber.name : raw.subscriberName,
        subscriberPhone: subscriber ? subscriber.phone : raw.subscriberPhone,
        subscriberAddress: subscriberRaw.address || '',
        packageName: raw.packageName || '',
        period: raw.period || '',
        amount: invoice.amount,
        baseAmount: raw.baseAmount || 0,
        installationFee: Number(invoice.installation_fee ?? raw.installationFee ?? 0),
        taxFee: Number(invoice.tax_fee ?? raw.taxFee ?? 0),
        lateFee: Number(invoice.late_fee ?? raw.lateFee ?? 0),
        carriedOverAmount: Number(invoice.carried_over_amount ?? raw.carriedOverAmount ?? 0),
        lines: Array.isArray(raw.lines) ? raw.lines : null,
        dueDate: invoice.due_date,
        status: invoice.status,
        paidVia: raw.paidVia || '',
        transactionId: raw.transactionId || '',
        issuedAt: (invoice.created_at || new Date()).toISOString().slice(0, 10),
        raw_data: raw,
        purchaseSession: raw.purchaseSession || null,
        cancelSession: raw.cancelSession || null,
        cancellation: raw.cancellation || null,
      });
      fs.writeFileSync(markerPath, stamp, 'utf-8');
    }

    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'invoice.pdf_downloaded',
      entityType: 'invoice',
      entityId: invoice.id,
      ip: req.ip,
    });

    return res.sendFile(require('path').resolve(filePath));
  }),
);

/**
 * DELETE /api/billing/invoices/:id
 * Remove an invoice and its payment records (admin action).
 */
router.delete(
  '/invoices/:id',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  asyncHandler(async (req, res) => {
    const invoice = await db.queryOne('SELECT id, status, raw_data, invoice_type FROM invoices WHERE id = $1', [req.params.id]);
    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    // Cancellation records and cancel invoices must NEVER be deleted (auditable record)
    const isCancel =
      String(invoice.invoice_type || invoice.raw_data?.invoiceType || '').toLowerCase() === 'cancel' ||
      String(invoice.id).includes('CANCEL');
    if (isCancel) {
      return res.status(403).json({
        success: false,
        error: 'Cancelled invoices cannot be deleted. Cancellation and audit records are permanently retained.',
      });
    }

    // A paid invoice is a revenue record — it is never deleted. The admin can
    // still remove an invoice that was generated in error.
    if (String(invoice.status).toLowerCase() === 'paid') {
      return res.status(409).json({
        success: false,
        error: 'A paid invoice cannot be deleted. Revenue records are preserved.',
      });
    }

    await db.transaction(async (client) => {
      await client.query('DELETE FROM payment_transactions WHERE invoice_id = $1', [req.params.id]);
      await client.query('DELETE FROM billing_events WHERE invoice_id = $1', [req.params.id]);
      await client.query('DELETE FROM invoices WHERE id = $1', [req.params.id]);
    });

    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'invoice.deleted',
      entityType: 'invoice',
      entityId: req.params.id,
      ip: req.ip,
    });

    return res.json({ success: true, message: `Invoice ${req.params.id} deleted` });
  }),
);

/**
 * POST /api/billing/cycle/run
 * Trigger the recurring billing cycle.
 */
router.post(
  '/cycle/run',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  validate({
    body: z.object({
      period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      dryRun: z.boolean().optional(),
      background: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.validatedBody || {};
    const period = body.period || require('../lib/utils').periodKey();

    if (body.background) {
      const jobId = await queue.enqueue('billing.cycle.run', { period, dryRun: Boolean(body.dryRun) });
      await audit({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'billing.cycle_queued',
        entityType: 'billing_cycle',
        entityId: period,
        details: { jobId },
        ip: req.ip,
      });
      return res.status(202).json({ success: true, queued: true, jobId, period });
    }

    const result = await billing.runMonthlyCycle({ period, dryRun: Boolean(body.dryRun) });

    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'billing.cycle_run',
      entityType: 'billing_cycle',
      entityId: period,
      details: { invoiceCount: result.invoiceCount, totalAmount: result.totalAmount, dryRun: result.dryRun },
      ip: req.ip,
    });

    return res.json({ success: true, ...result });
  }),
);

/**
 * GET /api/billing/cycles
 * Billing cycle history.
 */
router.get(
  '/cycles',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  asyncHandler(async (req, res) => {
    const result = await db.query('SELECT * FROM billing_cycles ORDER BY started_at DESC LIMIT 50');
    res.json({ success: true, cycles: result.rows });
  }),
);

/**
 * POST /api/billing/suspend-overdue
 * Auto-disconnect subscribers whose bill is past the grace period.
 */
router.post(
  '/suspend-overdue',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  asyncHandler(async (req, res) => {
    const result = await billing.autoSuspendOverdue();
    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'billing.auto_suspend_overdue',
      entityType: 'billing',
      details: result,
      ip: req.ip,
    });
    res.json({ success: true, ...result });
  }),
);

/**
 * GET /api/billing/events
 * Billing audit trail.
 */
router.get(
  '/events',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const result = await db.query(
      'SELECT * FROM billing_events ORDER BY created_at DESC LIMIT $1',
      [limit],
    );
    res.json({ success: true, events: result.rows });
  }),
);

/**
 * GET /api/billing/cancellations
 * List all package cancellation records (Admin view).
 */
router.get(
  '/cancellations',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const search = String(req.query.search || '').trim().toLowerCase();
    const reason = String(req.query.reason || '').trim();

    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(
        `(LOWER(c.id) LIKE $${params.length} OR LOWER(c.subscriber_id) LIKE $${params.length} OR LOWER(s.name) LIKE $${params.length} OR LOWER(c.package_name) LIKE $${params.length} OR LOWER(c.reason) LIKE $${params.length} OR LOWER(c.description) LIKE $${params.length})`,
      );
    }

    if (reason && reason !== 'all') {
      params.push(reason);
      conditions.push(`c.reason = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);

    const result = await db.query(
      `SELECT c.*, s.name AS subscriber_name, s.email AS subscriber_email, s.phone AS subscriber_phone
         FROM cancellations c
         LEFT JOIN subscribers s ON s.id = c.subscriber_id
        ${where}
        ORDER BY c.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total
         FROM cancellations c
         LEFT JOIN subscribers s ON s.id = c.subscriber_id
        ${where}`,
      params.slice(0, params.length - 2),
    );

    res.json({
      success: true,
      cancellations: result.rows,
      total: Number(countResult.rows[0]?.total || 0),
      limit,
      offset,
    });
  }),
);

/**
 * POST /api/billing/quote
 * GET  /api/billing/quote
 * Single source of truth for Subscriber Plan Invoice Preview (Step 4, Step 5,
 * final invoice, My Orders, and payment gateway request).
 */
async function handleQuoteRequest(req, res) {
  const source = req.method === 'GET' ? req.query : req.body || {};
  if (
    source.simulateFailure === true ||
    source.simulateFailure === 'true' ||
    req.headers['x-simulate-quote-failure'] === '1'
  ) {
    return res.status(503).json({
      success: false,
      error: 'Billing engine quote service is temporarily unavailable. Please retry.',
    });
  }

  let subscriberId = String(source.subscriberId || source.customerId || '').trim();
  const packageId = String(source.packageId || '').trim();
  const purchaseType = String(source.purchaseType || 'NEW').trim();

  // If an Authorization token is present, validate it and enforce subscriber ownership
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const { verifyToken } = require('../middleware/auth');
    const decoded = verifyToken(authHeader.slice(7).trim());
    if (decoded) {
      const tokenSubId = decoded.subscriberId || decoded.id;
      if (decoded.type === 'subscriber' || decoded.role === ROLES.SUBSCRIBER) {
        if (subscriberId && subscriberId !== tokenSubId) {
          return res.status(403).json({
            success: false,
            error: 'You are not authorized to request a billing quote for another subscriber.',
          });
        }
        subscriberId = tokenSubId;
      }
    }
  }

  if (!subscriberId) {
    return res.status(400).json({
      success: false,
      error: 'subscriberId (or customerId) is required to calculate a billing quote.',
    });
  }

  const quote = await billing.calculateQuote({
    subscriberId,
    packageId,
    purchaseType,
  });

  return res.json({
    success: true,
    quote,
    calculation: quote,
  });
}

router.post('/quote', asyncHandler(handleQuoteRequest));
router.get('/quote', asyncHandler(handleQuoteRequest));

/**
 * GET /api/billing/settings
 * Effective billing configuration (including configurable installation, tax, and late fees).
 */
router.get(
  '/settings',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  asyncHandler(async (req, res) => {
    const feeConfig = await billing.getFeeConfig();
    res.json({
      success: true,
      settings: {
        timezone: feeConfig.timezone || config.billing.timezone,
        dueDay: feeConfig.dueDay,
        lateGraceDays: feeConfig.lateGraceDays,
        suspendAfterDays: feeConfig.suspendAfterDays,
        installationFee: feeConfig.installationFee,
        installation_fee: feeConfig.installationFee,
        taxFee: feeConfig.taxFee,
        tax_fee: feeConfig.taxFee,
        late_fee_type: feeConfig.late_fee_type,
        late_fee_value: feeConfig.late_fee_value,
        lateFeeType: feeConfig.lateFeeType,
        lateFeeValue: feeConfig.lateFeeValue,
        lateFeePercent: feeConfig.lateFeePercent,
        currency: config.billing.currency,
        currencySymbol: config.billing.currencySymbol,
        paymentMode: config.payments.mode,
      },
    });
  }),
);

/**
 * PUT /api/billing/settings
 * Update configurable billing fee values ($8.99 installation, $0.99 tax, 10% late fee, etc.).
 */
router.put(
  '/settings',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  validate({
    body: z.object({
      installationFee: z.number().min(0).max(10000).optional(),
      installation_fee: z.number().min(0).max(10000).optional(),
      taxFee: z.number().min(0).max(10000).optional(),
      tax_fee: z.number().min(0).max(10000).optional(),
      late_fee_type: z.enum(['percent', 'flat']).optional(),
      lateFeeType: z.enum(['percent', 'flat']).optional(),
      late_fee_value: z.number().min(0).max(10000).optional(),
      lateFeeValue: z.number().min(0).max(10000).optional(),
      lateFeePercent: z.number().min(0).max(100).optional(),
      dueDay: z.number().int().min(1).max(31).optional(),
      lateGraceDays: z.number().int().min(0).max(60).optional(),
      suspendAfterDays: z.number().int().min(1).max(90).optional(),
      timezone: z.string().min(1).max(60).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const settingsService = require('../services/settings');
    const updated = await settingsService.setGroup('billing', req.validatedBody || {}, {
      id: req.user.id,
      role: req.user.role,
      ip: req.ip,
    });
    res.json({
      success: true,
      settings: {
        ...updated,
        currency: config.billing.currency,
        currencySymbol: config.billing.currencySymbol,
        paymentMode: config.payments.mode,
      },
    });
  }),
);

module.exports = router;
