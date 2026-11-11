'use strict';

/**
 * Seed the technicians table.
 *
 * The CRM auto-assignment reads the technicians table, and the admin panel
 * has its own technician list which it round-trips into that table — but
 * nothing has ever seeded the table, so every ticket could never be assigned
 * and stayed "Awaiting Helpdesk assignment" forever.
 *
 * The five records below are EXAMPLES. Replace them with the real field team
 * through the admin panel (Technicians page) or this script's data.
 *
 * Idempotent: rows that already exist are left untouched.
 *
 * Run with:  node scripts/seed-technicians.js            (report what would happen)
 *            node scripts/seed-technicians.js --apply     (actually seed)
 */

const db = require('../src/lib/db');
const logger = require('../src/lib/logger');

const APPLY = process.argv.includes('--apply');

/**
 * Example field technicians. The skills mirror the portal's ticket category
 * values so skill-based routing works.
 */
const EXAMPLE_TECHNICIANS = [
  {
    id: 'TECH-001',
    name: 'David Miller',
    phone: '+880 1711 000001',
    email: 'd.miller@nextlink.global',
    zone: 'Dhaka Metro',
    status: 'available',
    activeJobs: 0,
    completedJobs: 0,
    skills: ['Fiber / Optical Issue', 'Slow Speed'],
    demo: true,
  },
  {
    id: 'TECH-002',
    name: 'Oliver Smith',
    phone: '+880 1711 000002',
    email: 'o.smith@nextlink.global',
    zone: 'Dhaka Metro',
    status: 'available',
    activeJobs: 0,
    completedJobs: 0,
    skills: ['Configuration', 'Billing & Plan'],
    demo: true,
  },
  {
    id: 'TECH-003',
    name: 'Hans Weber',
    phone: '+880 1711 000003',
    email: 'h.weber@nextlink.global',
    zone: 'Chattogram Metro',
    status: 'available',
    activeJobs: 0,
    completedJobs: 0,
    skills: ['Slow Speed'],
    demo: true,
  },
  {
    id: 'TECH-004',
    name: 'Takashi Tanaka',
    phone: '+880 1711 000004',
    email: 't.tanaka@nextlink.global',
    zone: 'Dhaka Metro',
    status: 'available',
    activeJobs: 0,
    completedJobs: 0,
    skills: ['Fiber / Optical Issue', 'Slow Speed', 'Other'],
    demo: true,
  },
];

async function run() {
  const existing = await db.query('SELECT id FROM technicians');
  const existingIds = new Set(existing.rows.map((row) => row.id));

  console.log('');
  console.log('Technician seed report');
  console.log('');

  for (const technician of EXAMPLE_TECHNICIANS) {
    const present = existingIds.has(technician.id);
    console.log(`  ${present ? 'exists  ' : 'would add'} ${technician.id} ${technician.name} (${technician.zone})`);
    if (present || !APPLY) continue;

    await db.query(
      `INSERT INTO technicians (id, name, status, raw_data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        technician.id,
        technician.name,
        technician.status,
        JSON.stringify(technician),
      ],
    );
  }

  console.log('');
  if (APPLY) {
    const counts = await db.query('SELECT COUNT(*)::int AS count FROM technicians');
    logger.info('technicians seeded', { count: counts.rows[0].count });
    console.log(`Seeded. The table now holds ${counts.rows[0].count} technician(s).`);
    console.log('NOTE: the seeded records are examples marked demo=true. Replace them with the real field team.');
  } else {
    console.log('Nothing was written. Re-run with --apply to seed the examples.');
  }
}

run()
  .then(async () => {
    await db.close();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error('technician seed failed', { message: error.message });
    await db.close();
    process.exit(1);
  });
