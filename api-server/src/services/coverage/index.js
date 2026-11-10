'use strict';

const crypto = require('crypto');
const db = require('../../lib/db');
const logger = require('../../lib/logger');

/**
 * Coverage finder service (SRS 3.1 — Interactive Coverage Map).
 *
 * Coverage data lives in the `coverage_areas` table so the admin panel and
 * the public location checker share one source of truth. The service also
 * falls back to the CMS `coverageAreas` collection when the table is empty,
 * which keeps the existing public website working before any area is added.
 */

/**
 * List every coverage area, optionally filtered.
 */
async function listAreas({ zone = null, district = null } = {}) {
  const conditions = [];
  const params = [];

  if (zone) {
    params.push(zone);
    conditions.push(`LOWER(zone) = LOWER($${params.length})`);
  }
  if (district) {
    params.push(district);
    conditions.push(`LOWER(district) = LOWER($${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db.query(
    `SELECT * FROM coverage_areas ${where} ORDER BY zone, district`,
    params,
  );
  return result.rows;
}

/**
 * Distinct zones and districts for the cascading dropdowns.
 */
async function listZones() {
  const result = await db.query(
    `SELECT zone,
            COUNT(*)::int AS area_count,
            COUNT(*) FILTER (WHERE status = 'available')::int AS available_count
       FROM coverage_areas
      GROUP BY zone
      ORDER BY zone`,
  );
  return result.rows;
}

/**
 * Distinct districts within a zone.
 */
async function listDistricts(zone) {
  const result = await db.query(
    `SELECT district,
            COUNT(*)::int AS area_count,
            COUNT(*) FILTER (WHERE status = 'available')::int AS available_count
       FROM coverage_areas
      WHERE LOWER(zone) = LOWER($1)
      GROUP BY district
      ORDER BY district`,
    [zone],
  );
  return result.rows;
}

/**
 * Check whether a specific area is covered.
 *
 * @param {object} query
 * @param {string} query.zone
 * @param {string} query.district
 * @param {string} query.area
 */
async function checkArea({ zone, district, area }) {
  const result = await db.query(
    `SELECT * FROM coverage_areas
      WHERE LOWER(zone) = LOWER($1)
        AND ($2::text IS NULL OR LOWER(district) = LOWER($2))
        AND ($3::text IS NULL OR LOWER(areas::text) LIKE LOWER('%' || $3 || '%'))
      LIMIT 5`,
    [zone, district || null, area || null],
  );

  if (result.rows.length === 0) {
    // No matching row — the area may still exist under a broader district.
    const districtMatch = await db.query(
      `SELECT * FROM coverage_areas
        WHERE LOWER(zone) = LOWER($1)
          AND ($2::text IS NULL OR LOWER(district) = LOWER($2))
        LIMIT 1`,
      [zone, district || null],
    );

    if (districtMatch.rows.length > 0) {
      return {
        covered: false,
        reason: 'district_known_area_unknown',
        zone,
        district: districtMatch.rows[0].district,
        availableAreas: districtMatch.rows[0].areas || [],
      };
    }

    return { covered: false, reason: 'zone_not_covered', zone, district: district || null };
  }

  const row = result.rows[0];
  return {
    covered: row.status === 'available',
    reason: row.status === 'available' ? 'available' : row.status,
    zone: row.zone,
    district: row.district,
    areas: row.areas || [],
    lat: row.lat === null ? null : Number(row.lat),
    lng: row.lng === null ? null : Number(row.lng),
    notes: row.notes,
  };
}

/**
 * Create or update a coverage area (admin).
 */
async function upsertArea(area) {
  // The id is derived from zone + district + areas so re-saving the same area
  // updates it instead of creating a duplicate. The full hash is used — a
  // truncated hash collides for areas that share a prefix.
  const key = `${area.zone}::${area.district || ''}::${(area.areas || []).join(',')}`;
  const id =
    area.id ||
    `COV-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16).toUpperCase()}`;
  const result = await db.queryOne(
    `INSERT INTO coverage_areas (id, zone, district, areas, status, lat, lng, notes, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
        zone = EXCLUDED.zone,
        district = EXCLUDED.district,
        areas = EXCLUDED.areas,
        status = EXCLUDED.status,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        notes = EXCLUDED.notes,
        updated_at = NOW()
     RETURNING *`,
    [
      id,
      area.zone,
      area.district || null,
      Array.isArray(area.areas) ? area.areas : [],
      area.status || 'available',
      area.lat ?? null,
      area.lng ?? null,
      area.notes || null,
      JSON.stringify(area.rawData || {}),
    ],
  );
  logger.info('coverage area saved', { id, zone: area.zone });
  return result;
}

/**
 * Delete a coverage area.
 */
async function deleteArea(id) {
  const result = await db.queryOne(
    'DELETE FROM coverage_areas WHERE id = $1 RETURNING *',
    [id],
  );
  return result;
}

/**
 * Seed the coverage table from the CMS `coverageAreas` collection when the
 * table is empty, so the public checker keeps working with existing content.
 */
async function seedFromSiteContent(siteContent) {
  const areas = siteContent && siteContent.coverageAreas;
  if (!Array.isArray(areas) || areas.length === 0) return { seeded: 0 };

  const existing = await db.queryOne('SELECT COUNT(*)::int AS count FROM coverage_areas');
  if (existing.count > 0) return { seeded: 0, reason: 'table_not_empty' };

  let seeded = 0;
  for (const entry of areas) {
    const zone = entry.zone || entry.district || 'Unassigned';
    await upsertArea({
      zone,
      district: entry.district || null,
      areas: Array.isArray(entry.areas) ? entry.areas : [],
      status: entry.status === 'unavailable' ? 'unavailable' : 'available',
      rawData: entry,
    });
    seeded += 1;
  }

  logger.info('coverage areas seeded from site content', { seeded });
  return { seeded };
}

module.exports = {
  listAreas,
  listZones,
  listDistricts,
  checkArea,
  upsertArea,
  deleteArea,
  seedFromSiteContent,
};
