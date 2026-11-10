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
    const invoice = await db.queryOne('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    const raw = invoice.raw_data || {};
    const subscriber = await db.queryOne('SELECT * FROM subscribers WHERE id = $1', [invoice.subscriber_id]);
    const subscriberRaw = subscriber ? subscriber.raw_data || {} : {};

    const filePath = pdf.invoicePdfPath(invoice.id);
    const alreadyExists = require('fs').existsSync(filePath);

    if (!alreadyExists) {
      await pdf.generateInvoicePdf({
        id: invoice.id,
        subscriberId: invoice.subscriber_id,
        subscriberName: subscriber ? subscriber.name : raw.subscriberName,
        subscriberPhone: subscriber ? subscriber.phone : raw.subscriberPhone,
        subscriberAddress: subscriberRaw.address || '',
        packageName: raw.packageName || '',
        period: raw.period || '',
        amount: invoice.amount,
        dueDate: invoice.due_date,
        status: invoice.status,
        paidVia: raw.paidVia || '',
        transactionId: raw.transactionId || '',
        issuedAt: (invoice.created_at || new Date()).toISOString().slice(0, 10),
      });
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
    const invoice = await db.queryOne('SELECT id FROM invoices WHERE id = $1', [req.params.id]);
    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
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
 * GET /api/billing/settings
 * Effective billing configuration.
 */
router.get(
  '/settings',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      settings: {
        timezone: config.billing.timezone,
        dueDay: config.billing.dueDay,
        lateGraceDays: config.billing.lateGraceDays,
        suspendAfterDays: config.billing.suspendAfterDays,
        currency: config.billing.currency,
        currencySymbol: config.billing.currencySymbol,
        paymentMode: config.payments.mode,
      },
    });
  }),
);

module.exports = router;
