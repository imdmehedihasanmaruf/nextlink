const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:Maruf%402000%23@localhost:5432/nextlink_db';

async function seed() {
  const client = new Client({ connectionString });
  await client.connect();
  console.log('Connected to PostgreSQL successfully!');

  const rootDir = path.resolve(__dirname, '..');
  const adminStorePath = path.join(rootDir, 'data', 'adminStore.json');
  const siteDataPath = path.join(rootDir, 'data', 'siteData.json');

  let adminData = {};
  if (fs.existsSync(adminStorePath)) {
    adminData = JSON.parse(fs.readFileSync(adminStorePath, 'utf8'));
  }

  let siteData = {};
  if (fs.existsSync(siteDataPath)) {
    siteData = JSON.parse(fs.readFileSync(siteDataPath, 'utf8'));
  }

  // 1. Seed Packages
  const packages = adminData.packages || [];
  for (const p of packages) {
    await client.query(`
      INSERT INTO packages (id, name, speed, upload_speed, price, duration, description, subscriber_count, raw_data, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        speed = EXCLUDED.speed,
        upload_speed = EXCLUDED.upload_speed,
        price = EXCLUDED.price,
        duration = EXCLUDED.duration,
        description = EXCLUDED.description,
        subscriber_count = EXCLUDED.subscriber_count,
        raw_data = EXCLUDED.raw_data,
        updated_at = NOW();
    `, [
      String(p.id),
      p.name || 'Unnamed Package',
      Number(p.downloadSpeed || p.speed || 50),
      Number(p.uploadSpeed || p.speed || 50),
      Number(p.price || 0),
      Number(p.duration || 30),
      p.description || '',
      Number(p.subscriberCount || 0),
      JSON.stringify(p),
    ]);
  }
  console.log(`Seeded ${packages.length} packages`);

  // 2. Seed Subscribers
  const subscribers = adminData.subscribers || [];
  for (const s of subscribers) {
    await client.query(`
      INSERT INTO subscribers (id, name, email, phone, package_id, status, raw_data, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        package_id = EXCLUDED.package_id,
        status = EXCLUDED.status,
        raw_data = EXCLUDED.raw_data,
        updated_at = NOW();
    `, [
      String(s.id),
      s.name || '',
      s.email || '',
      s.phone || '',
      s.packageId || s.package_id || '',
      s.status || 'active',
      JSON.stringify(s),
    ]);
  }
  console.log(`Seeded ${subscribers.length} subscribers`);

  // 3. Seed Invoices
  const invoices = adminData.invoices || [];
  for (const inv of invoices) {
    await client.query(`
      INSERT INTO invoices (id, subscriber_id, amount, status, due_date, raw_data, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (id) DO UPDATE SET
        subscriber_id = EXCLUDED.subscriber_id,
        amount = EXCLUDED.amount,
        status = EXCLUDED.status,
        due_date = EXCLUDED.due_date,
        raw_data = EXCLUDED.raw_data,
        updated_at = NOW();
    `, [
      String(inv.id),
      inv.subscriberId || inv.subscriber_id || '',
      Number(inv.amount || 0),
      inv.status || 'unpaid',
      inv.dueDate || inv.due_date || '',
      JSON.stringify(inv),
    ]);
  }
  console.log(`Seeded ${invoices.length} invoices`);

  // 4. Seed Tickets
  const tickets = adminData.tickets || [];
  for (const t of tickets) {
    await client.query(`
      INSERT INTO tickets (id, title, status, priority, raw_data, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        status = EXCLUDED.status,
        priority = EXCLUDED.priority,
        raw_data = EXCLUDED.raw_data,
        updated_at = NOW();
    `, [
      String(t.id),
      t.title || t.subject || '',
      t.status || 'open',
      t.priority || 'medium',
      JSON.stringify(t),
    ]);
  }
  console.log(`Seeded ${tickets.length} tickets`);

  // 5. Seed Technicians
  const technicians = adminData.technicians || [];
  for (const tech of technicians) {
    await client.query(`
      INSERT INTO technicians (id, name, status, raw_data, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        raw_data = EXCLUDED.raw_data,
        updated_at = NOW();
    `, [
      String(tech.id),
      tech.name || '',
      tech.status || 'active',
      JSON.stringify(tech),
    ]);
  }
  console.log(`Seeded ${technicians.length} technicians`);

  // 6. Seed Admin Users
  const adminUsers = adminData.adminUsers || [];
  for (const u of adminUsers) {
    await client.query(`
      INSERT INTO admin_users (id, name, email, role, status, raw_data, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        role = EXCLUDED.role,
        status = EXCLUDED.status,
        raw_data = EXCLUDED.raw_data,
        updated_at = NOW();
    `, [
      String(u.id),
      u.name || '',
      u.email || '',
      u.role || 'admin',
      u.status || 'active',
      JSON.stringify(u),
    ]);
  }
  console.log(`Seeded ${adminUsers.length} admin users`);

  // 7. Seed Roles
  const roles = adminData.roles || [];
  for (const r of roles) {
    await client.query(`
      INSERT INTO roles (id, name, raw_data, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        raw_data = EXCLUDED.raw_data,
        updated_at = NOW();
    `, [
      String(r.id),
      r.name || '',
      JSON.stringify(r),
    ]);
  }
  console.log(`Seeded ${roles.length} roles`);

  // 8. Seed app_settings (referralRewards, boostBandwidth, liveLatency, interfaceTraffic, peeringHubs, zones, siteData, etc.)
  const settingsKeys = [
    'referralRewards',
    'boostBandwidth',
    'liveLatency',
    'interfaceTraffic',
    'peeringHubs',
    'zones',
    'revenueHistory',
    'subscriberGrowth'
  ];

  for (const key of settingsKeys) {
    if (adminData[key] !== undefined) {
      await client.query(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = NOW();
      `, [key, JSON.stringify(adminData[key])]);
    }
  }

  // Also seed siteData into app_settings
  await client.query(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('siteData', $1, NOW())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = NOW();
  `, [JSON.stringify(siteData)]);
  console.log('Seeded app_settings and siteData');

  await client.end();
  console.log('PostgreSQL database seeded successfully!');
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});

