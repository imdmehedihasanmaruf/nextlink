'use strict';

/**
 * Migrate every remaining plain-text subscriber password to bcrypt.
 *
 * The migration is safe to re-run: accounts that already have a hashed
 * credential are skipped.
 *
 * Run with:  node scripts/migrate-passwords.js
 */

const db = require('../src/lib/db');
const logger = require('../src/lib/logger');
const credentials = require('../src/services/credentials');

async function migrate() {
  const legacy = await db.query(
    `SELECT id, name, phone, email, raw_data
       FROM subscribers
      WHERE COALESCE(raw_data->>'password', '') <> ''
      ORDER BY id`,
  );

  console.log(`Found ${legacy.rows.length} account(s) with a plain-text password.`);

  let migrated = 0;
  let skipped = 0;

  for (const row of legacy.rows) {
    const raw = row.raw_data || {};
    const username = raw.username || raw.pppoeUsername || row.id;
    const plain = String(raw.password || '');

    if (!plain) {
      skipped += 1;
      continue;
    }

    const existing = await credentials.findBySubscriberId(row.id);
    if (existing) {
      // Already hashed — just clear the plain copy.
      await credentials.stripLegacyPassword(row.id);
      skipped += 1;
      continue;
    }

    await credentials.setCredentials({
      subscriberId: row.id,
      username,
      password: plain,
      legacyPassword: plain,
    });
    await credentials.stripLegacyPassword(row.id);
    migrated += 1;
    console.log(`  migrated ${row.id} (${username})`);
  }

  const remaining = await credentials.countLegacyPasswords();
  const hashed = await credentials.countHashedCredentials();

  console.log('');
  console.log(`Migrated: ${migrated}, skipped: ${skipped}`);
  console.log(`Plain-text passwords remaining: ${remaining}`);
  console.log(`Hashed credentials: ${hashed}`);

  if (remaining > 0) {
    logger.warn('some plain-text passwords remain', { remaining });
  }
}

migrate()
  .then(async () => {
    await db.close();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error('password migration failed', { message: error.message, stack: error.stack });
    await db.close();
    process.exit(1);
  });
