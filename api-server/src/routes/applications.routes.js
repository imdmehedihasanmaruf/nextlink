'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../lib/db');
const logger = require('../lib/logger');
const { asyncHandler } = require('../middleware/error');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole, ROLES, audit } = require('../middleware/auth');
const { applicationLimiter } = require('../middleware/rateLimit');
const applications = require('../services/applications');

const router = express.Router();

// ---------------------------------------------------------------------------
// Connection requests
// ---------------------------------------------------------------------------

/**
 * POST /api/applications
 * Public online connection request (SRS 3.1).
 */
router.post(
  '/',
  applicationLimiter,
  validate({
    body: z.object({
      fullName: z.string().min(3, 'Full name must be at least 3 characters'),
      phone: z.string().min(7, 'Enter a valid phone number'),
      email: z.string().email('Enter a valid email address').optional().or(z.literal('')),
      idNumber: z.string().min(6, 'Passport or Government ID must be at least 6 characters'),
      // The document is a base64 data URL, so the limit has to allow for the
      // encoding overhead on top of the file size.
      idDocumentDataUrl: z.string().max(9 * 1024 * 1024).optional().nullable(),
      address: z.string().min(10, 'Please provide the full installation address'),
      packageId: z.string().max(100).optional().nullable(),
      packageName: z.string().max(255).optional().nullable(),
      ontConfig: z.string().max(120).optional().nullable(),
      referral: z.string().max(120).optional().nullable(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.validatedBody;

    const created = await applications.createRequest({
      ...body,
      email: body.email || null,
    });

    await audit({
      actorId: created.id,
      actorRole: 'subscriber',
      action: 'connection_request.created',
      entityType: 'connection_request',
      entityId: created.id,
      details: { package: body.packageName },
      ip: req.ip,
    });

    return res.status(201).json({
      success: true,
      message: 'Your connection request has been received.',
      request: {
        id: created.id,
        status: created.status,
        createdAt: created.created_at,
      },
    });
  }),
);

/**
 * GET /api/applications
 * List connection requests (admin).
 */
router.get(
  '/',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING, ROLES.SUPPORT),
  asyncHandler(async (req, res) => {
    const requests = await applications.listRequests({
      status: req.query.status ? String(req.query.status) : null,
      limit: req.query.limit ? Number(req.query.limit) : 100,
    });
    res.json({ success: true, requests });
  }),
);

/**
 * PATCH /api/applications/:id
 * Update a connection request status.
 */
router.patch(
  '/:id',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN, ROLES.BILLING),
  validate({
    body: z.object({
      status: z.enum(['pending', 'approved', 'rejected', 'activated']),
      subscriberId: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const status = req.validatedBody.status;

    // Approving creates the customer. Without the account there was nothing
    // to bill, provision or suspend.
    if (status === 'approved' || status === 'activated') {
      const activation = await applications.approveRequest(req.params.id, {
        activate: status === 'activated',
      });

      if (!activation.success) {
        return res.status(404).json({ success: false, error: activation.error });
      }

      await audit({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'connection_request.activated',
        entityType: 'connection_request',
        entityId: req.params.id,
        details: { subscriberId: activation.subscriberId },
        ip: req.ip,
      });

      return res.json({
        success: true,
        request: activation.request,
        subscriberId: activation.subscriberId,
        // The temporary password is shown once so the operator can hand it
        // over; it is never stored in clear text.
        temporaryPassword: activation.alreadyActivated ? undefined : activation.temporaryPassword,
      });
    }

    const result = await applications.updateStatus(
      req.params.id,
      status,
      req.validatedBody.subscriberId || null,
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Connection request not found' });
    }

    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'connection_request.status_changed',
      entityType: 'connection_request',
      entityId: req.params.id,
      details: { status },
      ip: req.ip,
    });

    return res.json({ success: true, request: result });
  }),
);

/**
 * GET /api/applications/:id/document
 * Download the uploaded ID document (staff only).
 */
router.get(
  '/:id/document',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const request = await db.queryOne(
      'SELECT id_document_path FROM connection_requests WHERE id = $1',
      [req.params.id],
    );
    if (!request || !request.id_document_path) {
      return res.status(404).json({ success: false, error: 'No document uploaded for this request' });
    }

    const absolutePath = applications.idDocumentAbsolutePath(request.id_document_path);
    if (!absolutePath) {
      return res.status(400).json({ success: false, error: 'Invalid document path' });
    }

    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'connection_request.document_viewed',
      entityType: 'connection_request',
      entityId: req.params.id,
      ip: req.ip,
    });

    return res.sendFile(absolutePath);
  }),
);

module.exports = router;
