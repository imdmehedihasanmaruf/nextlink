'use strict';

/**
 * Seed the RouterOS profile for each package.
 *
 * Without the mapping a subscriber on a gigabit plan is provisioned onto the
 * 10 Mbps fallback profile, so the line is shaped far below the plan they
 * pay for.
 *
 * Run with:  node scripts/seed-profiles.js
 */

const db = require('../src/lib/db');
const logger = require('../src/lib/logger');

/**
 * The profile name and the queue limit for a download speed in Mbps.
 */
function profileFor(speedMbps) {
  const speed = Number(speedMbps || 0);
  if (speed >= 2000) return { profile: 'nl-2g', limit: '2000M/2000M' };
  if (speed >= 1000) return { profile: 'nl-1g', limit: '1000M/1000M' };
  if (speed >= 500) return { profile: 'nl-500m', limit: '500M/500M' };
  if (speed >= 200) return { profile: 'nl-200m', limit: '200M/200M' };
  if (speed >= 100) return { profile: 'nl-100m', limit: '100M/100M' };
  if (speed >= 50) return { profile: 'nl-50m', limit: '50M/50M' };
  return { profile: 'nl-25m', limit: '25M/25M' };
}

async function run() {
  const packages = await db.query('SELECT id, name, speed, upload_speed FROM packages ORDER BY id');

  let updated = 0;
  for (const pkg of packages.rows) {
    const { profile, limit } = profileFor(pkg.speed);
    const result = await db.query(
      `UPDATE packages
          SET routeros_profile = $2, max_limit = $3, updated_at = NOW()
        WHERE id = $1
          AND (routeros_profile IS DISTINCT FROM $2 OR max_limit IS DISTINCT FROM $3)`,
      [pkg.id, profile, limit],
    );
    updated += result.rowCount;
    console.log(`  ${pkg.id} ${pkg.name} (${pkg.speed} Mbps) -> ${profile} / ${limit}`);
  }

  logger.info('package profiles seeded', { updated, total: packages.rowCount });
  console.log('');
  console.log(`${updated} of ${packages.rowCount} package(s) updated.`);
}

run()
  .then(async () => {
    await db.close();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error('profile seed failed', { message: error.message });
    await db.close();
    process.exit(1);
  });
