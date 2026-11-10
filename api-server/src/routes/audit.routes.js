'use strict';

const express = require('express');
const db = require('../lib/db');
const { asyncHandler } = require('../middleware/error');
const { requireAuth, requireRole, ROLES } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/audit
 * Audit log (super admin only).
 */
router.get(
  '/',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const result = await db.query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1', [limit]);
    res.json({ success: true, entries: result.rows });
  }),
);

module.exports = router;
