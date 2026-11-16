'use strict';

/**
 * Idempotent database migration.
 *
 * Applies backend/api/schema.sql (CREATE TABLE IF NOT EXISTS only — no drops,
 * no destructive changes to the legacy tables) and seeds the staff accounts
 * used by the admin panel.
 */

const fs = require('fs');
const path = require('path');
const db = require('../src/lib/db');
const logger = require('../src/lib/logger');
const { hashPassword } = require('../src/middleware/auth');

const STAFF_SEED = [
  { id: 'ADM-001', email: 'admin@nextlink.com', password: 'admin123', name: 'System Administrator', role: 'super_admin' },
  { id: 'ADM-002', email: 'billing@nextlink.com', password: 'billing123', name: 'Billing Manager', role: 'billing' },
  { id: 'ADM-003', email: 'support@nextlink.com', password: 'support123', name: 'Technical Support Lead', role: 'support' },
  { id: 'ADM-004', email: 'field@nextlink.com', password: 'field123', name: 'Field Technician', role: 'technician' },
];

async function migrate() {
  const schemaPath = path.join(__dirname, '..', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  // Repair credentials before the schema is applied (only if table exists).
  //
  // Two subscribers can share a phone number, and the credential store uses
  // the phone as the username — so the live database contains a duplicate
  // username. The unique index added below would fail if we left that in
  // place, so the later duplicate is renamed with a suffix that keeps the
  // account reachable instead of deleting it.
  const credsExists = await db.queryOne(`
    SELECT to_regclass('public.subscriber_credentials') AS tbl
  `);
  if (credsExists && credsExists.tbl) {
    logger.info('repairing duplicate credential usernames');
    await db.query(`
      WITH ranked AS (
        SELECT ctid, username,
               ROW_NUMBER() OVER (PARTITION BY username ORDER BY created_at ASC, migrated_at ASC NULLS FIRST) AS rn,
               COUNT(*) OVER (PARTITION BY username) AS dupes
          FROM subscriber_credentials
         WHERE username IS NOT NULL
      )
      UPDATE subscriber_credentials c
         SET username = c.username || '-' || c.subscriber_id,
             raw_data = COALESCE(c.raw_data, '{}'::jsonb)
                        || jsonb_build_object('renamedFrom', c.username),
             updated_at = NOW()
        FROM ranked
       WHERE ranked.ctid = c.ctid
         AND ranked.dupes > 1
         AND ranked.rn > 1
    `);

    // The legacy plain-text password column must not keep its values. The API no
    // longer writes to it, and these ten rows should not remain readable.
    logger.info('clearing legacy plain-text passwords');
    await db.query('UPDATE subscriber_credentials SET legacy_password = NULL WHERE legacy_password IS NOT NULL');

    // The unique index replaces the plain one; both would be redundant.
    await db.query('DROP INDEX IF EXISTS idx_subscriber_credentials_username');
  }

  logger.info('applying schema');
  await db.query(sql);
  logger.info('schema applied');

  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const seedAllowed = String(process.env.SEED_STAFF_PASSWORDS || '').toLowerCase() === 'true';

  if (isProduction && !seedAllowed) {
    // The default staff passwords are published in the repository, so they
    // must never be created in a production database. An operator who really
    // wants them has to set SEED_STAFF_PASSWORDS=true explicitly.
    logger.warn(
      'production mode — default staff accounts were NOT seeded. ' +
        'Set SEED_STAFF_PASSWORDS=true to seed them, and change the passwords immediately.',
    );
  } else {
    for (const staff of STAFF_SEED) {
      const existing = await db.queryOne('SELECT id FROM api_users WHERE email = $1', [staff.email]);
      if (existing) continue;

      const hash = await hashPassword(staff.password);
      await db.query(
        `INSERT INTO api_users (id, email, password_hash, name, role, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         ON CONFLICT (email) DO NOTHING`,
        [staff.id, staff.email, hash, staff.name, staff.role],
      );
      logger.info('seeded staff account', { email: staff.email, role: staff.role });
    }
  }

  // Backfill billing profiles for existing subscribers so the engine can run
  // against the current data without manual setup.
  const result = await db.query(
    `INSERT INTO subscriber_billing (subscriber_id, package_id, amount, next_invoice_date, status, raw_data)
     SELECT s.id,
            s.package_id,
            COALESCE(p.price, 0),
            CURRENT_DATE + ($1 || ' days')::interval,
            CASE WHEN s.status = 'active' THEN 'active' ELSE 'inactive' END,
            '{"seeded": true}'::jsonb
       FROM subscribers s
       LEFT JOIN packages p ON p.id = s.package_id
      ON CONFLICT (subscriber_id) DO NOTHING`,
    [10],
  );
  logger.info('billing profiles backfilled', { rows: result.rowCount });

  // Clean up any corrupted subscriber row with id = 'undefined'
  await db.query(`DELETE FROM subscribers WHERE id = 'undefined' OR TRIM(id) = ''`);

  // Backfill first_name and last_name on subscribers from name / raw_data
  await db.query(`
    UPDATE subscribers
       SET first_name = COALESCE(
             NULLIF(TRIM(first_name), ''),
             NULLIF(TRIM(raw_data->>'firstName'), ''),
             NULLIF(TRIM(SPLIT_PART(TRIM(name), ' ', 1)), ''),
             'Subscriber'
           ),
           last_name = COALESCE(
             NULLIF(TRIM(last_name), ''),
             NULLIF(TRIM(raw_data->>'lastName'), ''),
             CASE
               WHEN POSITION(' ' IN TRIM(name)) > 0
               THEN TRIM(SUBSTRING(TRIM(name) FROM POSITION(' ' IN TRIM(name)) + 1))
               ELSE ''
             END
           )
     WHERE first_name IS NULL OR TRIM(first_name) = '' OR last_name IS NULL
  `);

  // Sync raw_data firstName, lastName, and authoritative packageName from packages table
  await db.query(`
    UPDATE subscribers s
       SET raw_data = COALESCE(s.raw_data, '{}'::jsonb)
                      || jsonb_build_object(
                           'firstName', COALESCE(s.first_name, ''),
                           'lastName', COALESCE(s.last_name, ''),
                           'packageName', COALESCE(p.name, s.raw_data->>'packageName', ''),
                           'package', COALESCE(p.name, s.raw_data->>'package', '')
                         )
      FROM packages p
     WHERE p.id = s.package_id
  `);

  await db.query(`
    UPDATE subscribers s
       SET raw_data = COALESCE(s.raw_data, '{}'::jsonb)
                      || jsonb_build_object(
                           'firstName', COALESCE(s.first_name, ''),
                           'lastName', COALESCE(s.last_name, '')
                         )
     WHERE s.package_id IS NULL OR s.package_id = ''
  `);

  // Sync subscriber_billing amount with authoritative package price
  await db.query(`
    UPDATE subscriber_billing sb
       SET package_id = s.package_id,
           amount = COALESCE(p.price, sb.amount, 0),
           updated_at = NOW()
      FROM subscribers s
      LEFT JOIN packages p ON p.id = s.package_id
     WHERE sb.subscriber_id = s.id
       AND s.package_id IS NOT NULL
       AND s.package_id != ''
  `);

  // Backfill previous_login_at on credentials and staff users if null
  await db.query(`
    UPDATE subscriber_credentials
       SET previous_login_at = COALESCE(previous_login_at, last_login_at, created_at)
     WHERE previous_login_at IS NULL
  `);
  await db.query(`
    UPDATE api_users
       SET previous_login_at = COALESCE(previous_login_at, last_login_at, created_at)
     WHERE previous_login_at IS NULL
  `);

  // Ensure configurable billing fees ($8.99 installation, $0.99 tax, 10% late fee) exist in system_settings
  await db.query(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (
      'billing',
      '{"dueDay": 10, "lateGraceDays": 5, "suspendAfterDays": 10, "currency": "USD", "timezone": "UTC", "installationFee": 8.99, "taxFee": 0.99, "late_fee_type": "percent", "late_fee_value": 10, "lateFeeType": "percent", "lateFeeValue": 10, "lateFeePercent": 10}'::jsonb,
      NOW()
    )
    ON CONFLICT (key) DO UPDATE
      SET value = jsonb_build_object(
            'dueDay', COALESCE((system_settings.value->>'dueDay')::int, 10),
            'lateGraceDays', COALESCE((system_settings.value->>'lateGraceDays')::int, 5),
            'suspendAfterDays', COALESCE((system_settings.value->>'suspendAfterDays')::int, 10),
            'currency', COALESCE(system_settings.value->>'currency', 'USD'),
            'timezone', COALESCE(system_settings.value->>'timezone', 'UTC'),
            'installationFee', COALESCE((system_settings.value->>'installationFee')::numeric, 8.99),
            'taxFee', COALESCE((system_settings.value->>'taxFee')::numeric, 0.99),
            'late_fee_type', COALESCE(system_settings.value->>'late_fee_type', system_settings.value->>'lateFeeType', 'percent'),
            'late_fee_value', COALESCE((system_settings.value->>'late_fee_value')::numeric, (system_settings.value->>'lateFeeValue')::numeric, 10),
            'lateFeeType', COALESCE(system_settings.value->>'late_fee_type', system_settings.value->>'lateFeeType', 'percent'),
            'lateFeeValue', COALESCE((system_settings.value->>'late_fee_value')::numeric, (system_settings.value->>'lateFeeValue')::numeric, 10),
            'lateFeePercent', COALESCE((system_settings.value->>'late_fee_value')::numeric, (system_settings.value->>'lateFeeValue')::numeric, 10)
          ),
          updated_at = NOW()
  `);

  // Ensure footer config and notification preferences exist in system_settings
  await db.query(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES ('footer', '{"version": "To be implemented"}'::jsonb, NOW())
    ON CONFLICT (key) DO NOTHING
  `);

  await db.query(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (
      'notifications',
      '{"invoiceGenerated": true, "paymentReceived": true, "paymentFailed": true, "lateFeeApplied": true, "ticketReply": true, "technicianAssigned": true, "boostActivated": true, "referralCredited": true, "adminNewTicket": true, "adminNewUser": true, "adminFailedPayment": true}'::jsonb,
      NOW()
    )
    ON CONFLICT (key) DO NOTHING
  `);

  // Remove legacy hardcoded mock arrays from referral settings in system_settings & app_settings
  await db.query(`
    UPDATE system_settings
       SET value = (value - 'referrals' - 'defaultCode' - 'friendsJoinedCount' - 'totalSavedAmount')
     WHERE key = 'referral'
  `);
  await db.query(`
    UPDATE app_settings
       SET value = (value - 'referrals' - 'defaultCode' - 'friendsJoinedCount' - 'totalSavedAmount')
     WHERE key = 'referralRewards'
  `);
  await db.query(`
    UPDATE app_settings
       SET value = (value - 'history')
     WHERE key = 'boostBandwidth'
  `);

  // Ensure roles in PostgreSQL exist and include the 'notifications' permission
  const roleRows = await db.queryAll('SELECT * FROM roles');
  if (roleRows.length === 0) {
    const defaultRolesSeed = [
      {
        id: 'ROLE-001',
        name: 'Super Admin',
        key: 'super_admin',
        description: 'Full root access to all ISP infrastructure, billing, and system configuration',
        permissions: [
          'dashboard', 'subscribers', 'packages', 'billing', 'view_cancel_invoices', 'export_cancel_invoices', 'tickets', 'technicians', 
          'referral_rewards', 'boost_bandwidth', 'live_latency', 'interface_traffic', 'peering_hubs',
          'reports', 'cms', 'settings', 'roles', 'notifications'
        ],
        userCount: 1,
        isSystem: true,
      },
      {
        id: 'ROLE-002',
        name: 'Billing Operations Manager',
        key: 'billing',
        description: 'Manages billing statements, invoices, receipts, and accounting reports',
        permissions: ['dashboard', 'subscribers', 'billing', 'view_cancel_invoices', 'export_cancel_invoices', 'referral_rewards', 'reports', 'notifications'],
        userCount: 1,
        isSystem: true,
      },
      {
        id: 'ROLE-003',
        name: 'Tier-3 Technical Support Lead',
        key: 'support',
        description: 'Handles support tickets, customer communications, and network diagnostics',
        permissions: ['dashboard', 'subscribers', 'tickets', 'technicians', 'boost_bandwidth', 'live_latency', 'notifications'],
        userCount: 1,
        isSystem: true,
      },
      {
        id: 'ROLE-004',
        name: 'Field Optical Engineer',
        key: 'technician',
        description: 'Assigned to physical optical fiber drops, field maintenance, and installations',
        permissions: ['dashboard', 'tickets', 'technicians', 'live_latency', 'interface_traffic', 'notifications'],
        userCount: 1,
        isSystem: true,
      },
      {
        id: 'ROLE-005',
        name: 'NOC Network Operator',
        key: 'noc_operator',
        description: 'Monitors real-time BGP routing, POP latency, and gateway health',
        permissions: ['dashboard', 'reports', 'tickets', 'live_latency', 'interface_traffic', 'peering_hubs', 'notifications'],
        userCount: 2,
        isSystem: false,
      },
    ];
    for (const r of defaultRolesSeed) {
      await db.query(
        `INSERT INTO roles (id, name, raw_data, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [r.id, r.name, JSON.stringify(r)]
      );
    }
  } else {
    for (const r of roleRows) {
      const raw = r.raw_data || {};
      const perms = Array.isArray(raw.permissions) ? raw.permissions : [];
      if (!perms.includes('notifications')) {
        perms.push('notifications');
        raw.permissions = perms;
        await db.query('UPDATE roles SET raw_data = $2, updated_at = NOW() WHERE id = $1', [r.id, JSON.stringify(raw)]);
      }
    }
  }

  // Ensure initial real notifications exist from current database records
  const notifCountRow = await db.queryOne('SELECT COUNT(*)::int AS cnt FROM notifications');
  if ((notifCountRow?.cnt || 0) === 0) {
    const subs = await db.queryAll('SELECT id, name, email FROM subscribers LIMIT 10');
    for (const s of subs) {
      await db.query(
        `INSERT INTO notifications (id, user_id, recipient_type, type, title, message, link, is_read, raw_data, created_at)
         VALUES ($1, $2, 'subscriber', 'welcome', $3, $4, '/dashboard/orders', FALSE, $5, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          `NTF-INIT-${s.id}`,
          s.id,
          'NextLink Fiber Portal Active',
          'View your active subscription, live optical telemetry, and billing history in real time.',
          JSON.stringify({ subscriberId: s.id }),
        ],
      );
    }
    await db.query(
      `INSERT INTO notifications (id, user_id, recipient_type, role_target, type, title, message, link, is_read, raw_data, created_at)
       VALUES ('NTF-ADMIN-INIT-1', 'ADMIN', 'admin', 'all', 'new_ticket', 'Operations Notification Center Ready', 'Real-time notifications for tickets, user registrations, and failed payments are active.', '/tickets', FALSE, '{}'::jsonb, NOW())
       ON CONFLICT (id) DO NOTHING`,
    );
  }

  // Ensure network_devices table exists and has real OLT / Core Router hardware telemetry
  await db.query(`
    CREATE TABLE IF NOT EXISTS network_devices (
      id VARCHAR(100) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      type VARCHAR(100) NOT NULL,
      ip VARCHAR(100),
      location VARCHAR(255),
      status VARCHAR(50) DEFAULT 'online',
      raw_data JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Ensure cancellations table and invoice_type column exist
  await db.query(`
    CREATE TABLE IF NOT EXISTS cancellations (
      id VARCHAR(100) PRIMARY KEY,
      subscriber_id VARCHAR(100) NOT NULL REFERENCES subscribers(id),
      package_id VARCHAR(100),
      package_name VARCHAR(255),
      cancel_invoice_id VARCHAR(100),
      reason VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      buy_again_date VARCHAR(50),
      not_sure_buy_again BOOLEAN DEFAULT FALSE,
      cancel_date VARCHAR(20) NOT NULL,
      cancel_time VARCHAR(20) NOT NULL,
      city VARCHAR(100) DEFAULT 'Unknown',
      postal_code VARCHAR(50) DEFAULT 'Unknown',
      state VARCHAR(100) DEFAULT 'Unknown',
      country VARCHAR(100) DEFAULT 'Unknown',
      client_ip VARCHAR(100),
      timezone VARCHAR(50) DEFAULT 'UTC',
      status VARCHAR(50) DEFAULT 'Cancelled',
      effective_date VARCHAR(50),
      outstanding_balance NUMERIC(12, 2) DEFAULT 0.00,
      raw_data JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_type VARCHAR(50) DEFAULT 'subscription';
    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS theme VARCHAR(20) DEFAULT 'system';
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id VARCHAR(64) PRIMARY KEY,
      theme VARCHAR(20) DEFAULT 'system',
      theme_color VARCHAR(30) DEFAULT 'blue',
      font_size VARCHAR(10) DEFAULT 'md',
      language VARCHAR(10) DEFAULT 'en',
      auto_save BOOLEAN DEFAULT true,
      raw_data JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Ensure default cancellation settings exist
  await db.query(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (
      'cancellation',
      '{"reasons": ["Too expensive", "Slow speed", "Frequent disconnections", "Moving to another location", "Switching provider", "Poor support", "Temporary pause", "Other"], "effectiveDateRule": "immediate", "allowNotSureBuyAgain": true, "rechargeAfterCancelTreatAsNew": true}'::jsonb,
      NOW()
    )
    ON CONFLICT (key) DO NOTHING
  `);

  await db.query(`
    INSERT INTO network_devices (id, name, type, ip, location, status, raw_data)
    VALUES
      ('OLT-DHK-01', 'Huawei MA5800-X7 Optical Line Terminal', 'OLT', '103.88.24.2', 'Dhaka Metro Core POP', 'online', '{"uptime": "54d 18h 12m", "cpuLoad": 16, "memoryPercent": 32, "signalDbm": -18.2, "txPowerDbm": 2.4, "oltPort": "GPON-0/1/4", "firmware": "V800R021C00"}'::jsonb),
      ('RTR-CORE-01', 'MikroTik CCR2116-12G-4S+ Core Router', 'ROUTER', '103.88.24.1', 'Dhaka IXP Gateway', 'online', '{"uptime": "89d 06h 45m", "cpuLoad": 12, "memoryPercent": 28, "firmware": "RouterOS v7.14.2"}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `);

  logger.info('migration complete');
}

migrate()
  .then(async () => {
    await db.close();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error('migration failed', { message: error.message, stack: error.stack });
    await db.close();
    process.exit(1);
  });
