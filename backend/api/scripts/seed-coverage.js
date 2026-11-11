'use strict';

/**
 * Seed the coverage_areas table with the network footprint so the public
 * location checker and the coverage map have data to work with.
 *
 * Run with:  node scripts/seed-coverage.js
 */

const db = require('../src/lib/db');
const logger = require('../src/lib/logger');
const coverage = require('../src/services/coverage');

/**
 * The area list mirrors the fallback data in the public website, with
 * coordinates so the coverage map can plot them.
 */
const AREAS = [
  {
    zone: 'North America',
    district: 'New York Metro',
    areas: ['Manhattan Financial District', 'Midtown Manhattan', 'Brooklyn DUMBO', 'Queens LIC', 'Jersey City Waterfront'],
    status: 'available',
    lat: 40.7128,
    lng: -74.006,
    notes: 'Primary Tier-1 aggregation point.',
  },
  {
    zone: 'North America',
    district: 'Silicon Valley',
    areas: ['San Jose Downtown', 'Palo Alto Stanford Corridor', 'Sunnyvale Tech Campus', 'San Francisco SoMa'],
    status: 'available',
    lat: 37.3382,
    lng: -121.8863,
    notes: 'BDIX-enabled with 10 Gbps transit.',
  },
  {
    zone: 'North America',
    district: 'Toronto & GTA',
    areas: ['Downtown Toronto Financial Core', 'Mississauga City Centre', 'Markham High-Tech Hub', 'Vaughan Metropolitan'],
    status: 'planned',
    lat: 43.6532,
    lng: -79.3832,
    notes: 'Planned expansion for the next cycle.',
  },
  {
    zone: 'Europe',
    district: 'London Central',
    areas: ['City of London', 'Westminster', 'Canary Wharf Financial Hub', 'Camden Tech Quarter'],
    status: 'available',
    lat: 51.5074,
    lng: -0.1278,
    notes: 'European core exchange — low latency peering.',
  },
  {
    zone: 'Europe',
    district: 'Frankfurt & Rhine',
    areas: ['Frankfurt Financial Centre', 'Offenbach Data Cluster', 'Wiesbaden Hub', 'Darmstadt Tech Corridor'],
    status: 'available',
    lat: 50.1109,
    lng: 8.6821,
    notes: 'DE-CIX peering with direct cloud on-ramp.',
  },
  {
    zone: 'Europe',
    district: 'Paris Metro',
    areas: ['Paris 8e Arrondissement', 'La Défense Business Park', 'Boulogne-Billancourt', 'Saint-Denis Pleyel'],
    status: 'unavailable',
    lat: 48.8566,
    lng: 2.3522,
    notes: 'Backbone migration scheduled — service paused.',
  },
  {
    zone: 'Asia-Pacific',
    district: 'Tokyo & Kanto',
    areas: ['Shinjuku High-Rise District', 'Shibuya Tech Hub', 'Chiyoda Marunouchi', 'Yokohama Minato Mirai', 'Roppongi'],
    status: 'available',
    lat: 35.6762,
    lng: 139.6503,
    notes: 'APAC core with JPIX peering.',
  },
  {
    zone: 'Asia-Pacific',
    district: 'Singapore CBD',
    areas: ['Marina Bay Financial Centre', 'Orchard Core', 'One-North Bio/Tech Park', 'Changi Business Park'],
    status: 'available',
    lat: 1.3521,
    lng: 103.8198,
    notes: 'Equinix SG peering and submarine landing point.',
  },
  {
    zone: 'Asia-Pacific',
    district: 'Sydney Metro',
    areas: ['Sydney CBD Financial Core', 'North Sydney', 'Parramatta Square', 'Surry Hills Creative Hub'],
    status: 'planned',
    lat: -33.8688,
    lng: 151.2093,
    notes: 'Australia edge rollout in progress.',
  },
  {
    zone: 'Middle East',
    district: 'Dubai & Abu Dhabi',
    areas: ['DIFC (Dubai Financial)', 'Business Bay', 'Downtown Dubai', 'Dubai Marina', 'Al Maryah Island'],
    status: 'available',
    lat: 25.2048,
    lng: 55.2708,
    notes: 'Regional POP with redundancy across two sites.',
  },
];

async function seed() {
  let created = 0;
  for (const area of AREAS) {
    await coverage.upsertArea(area);
    created += 1;
  }
  logger.info('coverage areas seeded', { created });

  const total = await db.queryOne('SELECT COUNT(*)::int AS count FROM coverage_areas');
  console.log(`Seeded ${created} coverage areas. Table now holds ${total.count} rows.`);
}

seed()
  .then(async () => {
    await db.close();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error('coverage seed failed', { message: error.message, stack: error.stack });
    await db.close();
    process.exit(1);
  });
