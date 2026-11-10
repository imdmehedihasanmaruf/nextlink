'use strict';

const express = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../middleware/error');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole, ROLES, audit } = require('../middleware/auth');
const coverage = require('../services/coverage');

const router = express.Router();

/**
 * GET /api/coverage/zones
 * Available zones with coverage counts.
 */
router.get(
  '/zones',
  asyncHandler(async (req, res) => {
    const zones = await coverage.listZones();
    res.json({ success: true, zones });
  }),
);

/**
 * GET /api/coverage/districts?zone=
 * Districts within a zone.
 */
router.get(
  '/districts',
  asyncHandler(async (req, res) => {
    const zone = String(req.query.zone || '');
    if (!zone) {
      return res.status(400).json({ success: false, error: 'zone is required' });
    }
    const districts = await coverage.listDistricts(zone);
    res.json({ success: true, zone, districts });
  }),
);

/**
 * GET /api/coverage/areas
 * Every coverage area (with coordinates for the map).
 */
router.get(
  '/areas',
  asyncHandler(async (req, res) => {
    const areas = await coverage.listAreas({
      zone: req.query.zone ? String(req.query.zone) : null,
      district: req.query.district ? String(req.query.district) : null,
    });
    res.json({ success: true, areas });
  }),
);

/**
 * GET /api/coverage/check?zone=&district=&area=
 * Check whether a location is covered.
 */
router.get(
  '/check',
  validate({
    query: z.object({
      zone: z.string().min(1, 'zone is required'),
      district: z.string().optional(),
      area: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await coverage.checkArea(req.validatedQuery);
    res.json({ success: true, ...result });
  }),
);

/**
 * POST /api/coverage/areas
 * Create or update a coverage area (admin).
 */
router.post(
  '/areas',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN),
  validate({
    body: z.object({
      id: z.string().optional(),
      zone: z.string().min(1, 'zone is required'),
      district: z.string().optional().nullable(),
      areas: z.array(z.string()).optional(),
      status: z.enum(['available', 'unavailable', 'planned']).optional(),
      lat: z.coerce.number().optional().nullable(),
      lng: z.coerce.number().optional().nullable(),
      notes: z.string().optional().nullable(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const area = await coverage.upsertArea(req.validatedBody);
    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'coverage.area_saved',
      entityType: 'coverage_area',
      entityId: area.id,
      ip: req.ip,
    });
    res.json({ success: true, area });
  }),
);

/**
 * DELETE /api/coverage/areas/:id
 */
router.delete(
  '/areas/:id',
  requireAuth,
  requireRole(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const area = await coverage.deleteArea(req.params.id);
    if (!area) {
      return res.status(404).json({ success: false, error: 'Coverage area not found' });
    }
    await audit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'coverage.area_deleted',
      entityType: 'coverage_area',
      entityId: req.params.id,
      ip: req.ip,
    });
    res.json({ success: true, message: 'Coverage area deleted' });
  }),
);

module.exports = router;
