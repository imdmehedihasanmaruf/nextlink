'use strict';

const express = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../middleware/error');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole, ROLES, audit } = require('../middleware/auth');
const db = require('../lib/db');
const settings = require('../services/settings');

const router = express.Router();

/**
 * GET /api/settings
 * Root settings route: returns masked system settings for authorized staff roles.
 */
router.get(
  '/',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT, ROLES.TECHNICIAN),
  asyncHandler(async (_req, res) => {
    const all = await settings.getMasked();
    res.json({ success: true, settings: all });
  })
);

/**
 * GET /api/settings/public
 * Publicly readable non-secret configuration (billing fees & footer version).
 */
router.get(
  '/public',
  asyncHandler(async (_req, res) => {
    const all = await settings.getAll();
    const lateFeeType = String(all.billing?.late_fee_type || all.billing?.lateFeeType || 'percent').toLowerCase() === 'flat' ? 'flat' : 'percent';
    const lateFeeValue = Number(all.billing?.late_fee_value ?? all.billing?.lateFeeValue ?? all.billing?.lateFeePercent ?? 10);
    res.json({
      success: true,
      billing: {
        currency: all.billing?.currency || 'USD',
        dueDay: Number(all.billing?.dueDay ?? 10),
        lateGraceDays: Number(all.billing?.lateGraceDays ?? 5),
        suspendAfterDays: Number(all.billing?.suspendAfterDays ?? 10),
        installationFee: Number(all.billing?.installationFee ?? 8.99),
        taxFee: Number(all.billing?.taxFee ?? 0.99),
        late_fee_type: lateFeeType,
        late_fee_value: lateFeeValue,
        lateFeeType,
        lateFeeValue,
        lateFeePercent: lateFeeValue,
        timezone: all.billing?.timezone || 'UTC',
      },
      footer: {
        version: all.footer?.version || 'To be implemented',
      },
      cancellation: {
        reasons: all.cancellation?.reasons || [
          'Too expensive',
          'Slow speed',
          'Frequent disconnections',
          'Moving to another location',
          'Switching provider',
          'Poor support',
          'Temporary pause',
          'Other',
        ],
        effectiveDateRule: all.cancellation?.effectiveDateRule || 'immediate',
        allowNotSureBuyAgain: all.cancellation?.allowNotSureBuyAgain ?? true,
      },
    });
  }),
);

/**
 * GET /api/settings/system
 * All system settings with the secrets masked.
 */
router.get(
  '/system',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  asyncHandler(async (req, res) => {
    const masked = await settings.getMasked();
    res.json({ success: true, settings: masked });
  }),
);

/**
 * PUT /api/settings/system/:group
 * Persist one settings group (MikroTik, SMS, payments, billing, footer, notifications).
 */
router.put(
  '/system/:group',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  validate({
    body: z.record(z.any()),
  }),
  asyncHandler(async (req, res) => {
    const group = String(req.params.group);
    if (!['mikrotik', 'sms', 'payments', 'billing', 'footer', 'notifications', 'cancellation'].includes(group)) {
      return res.status(400).json({ success: false, error: `Unknown settings group: ${group}` });
    }

    // A masked value means the operator did not change the secret. Sending it
    // back would overwrite the stored credential with the mask.
    const incoming = { ...req.validatedBody };
    for (const [key, value] of Object.entries(incoming)) {
      if (typeof value === 'string' && value.includes('•')) {
        delete incoming[key];
      }
    }

    const merged = await settings.setGroup(group, incoming);

    // The MikroTik client reads the stored configuration, so its cache has to
    // be dropped when the router settings change.
    if (group === 'mikrotik') {
      // eslint-disable-next-line global-require
      require('../services/mikrotik').invalidateSettings();
    }

    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'settings.updated',
      entityType: 'settings',
      entityId: group,
      ip: req.ip,
    });

    return res.json({
      success: true,
      group,
      settings: settings.maskSecrets({ [group]: merged })[group],
    });
  }),
);

/**
 * POST /api/settings/mikrotik/test
 * Test the router connection.
 */
router.post(
  '/mikrotik/test',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const result = await settings.testMikrotik();
    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'settings.mikrotik_test',
      entityType: 'settings',
      entityId: 'mikrotik',
      details: { success: result.success },
      ip: req.ip,
    });
    res.json({ success: true, ...result });
  }),
);

/**
 * GET /api/settings/staff
 * The live list of staff accounts (the table the login verifies against) —
 * super_admin only. Anything the admin panel shows as "staff" must come
 * from here; the admin panel's own admin_users table is a stale seed.
 */
router.get(
  '/staff',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT id, email, name, role, status, last_login_at, created_at
         FROM api_users
        ORDER BY created_at ASC`,
    );
    res.json({ success: true, staff: rows });
  }),
);

/**
 * DELETE /api/settings/staff/:id
 * Remove a staff account — super_admin only. Refuses to remove the last
 * super_admin or the caller's own account (lockout protection).
 */
router.delete(
  '/staff/:id',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const targetId = String(req.params.id);

    if (targetId === String(req.user.id)) {
      return res.status(400).json({
        success: false,
        error: 'You cannot delete the account you are signed in with.',
      });
    }

    const target = await db.queryOne(
      'SELECT id, email, role FROM api_users WHERE id = $1',
      [targetId],
    );
    if (!target) {
      return res.status(404).json({ success: false, error: 'Staff account not found.' });
    }

    if (String(target.role) === 'super_admin') {
      const { rows } = await db.query(
        `SELECT count(*)::int AS count FROM api_users WHERE role = 'super_admin' AND status = 'active'`,
      );
      if (rows[0].count <= 1) {
        return res.status(400).json({
          success: false,
          error: 'Refusing to delete the last active super_admin.',
        });
      }
    }

    await db.query('DELETE FROM api_users WHERE id = $1', [targetId]);

    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'settings.staff_deleted',
      entityType: 'staff_user',
      entityId: targetId,
      details: { email: target.email },
      ip: req.ip,
    });

    return res.json({ success: true, message: `Staff account ${target.email} deleted.` });
  }),
);

module.exports = router;
