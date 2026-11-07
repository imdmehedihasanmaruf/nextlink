import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

let pool: Pool | null = null;

export function getDbPool(): Pool {
  if (!pool) {
    const connectionString =
      process.env.DATABASE_URL ||
      'postgresql://postgres:Maruf%402000%23@localhost:5432/nextlink_db';

    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 4000,
    });

    pool.on('error', (err) => {
      console.error('[PostgreSQL Pool Error]', err);
    });
  }
  return pool;
}

function getDataDir(): string {
  const p1 = path.join(process.cwd(), 'data');
  const p2 = path.join(process.cwd(), '..', 'data');
  if (fs.existsSync(p1)) return p1;
  if (fs.existsSync(p2)) return p2;
  return p1;
}

export async function isDatabaseConnected(): Promise<boolean> {
  try {
    const p = getDbPool();
    const res = await p.query('SELECT 1');
    return res.rowCount !== null && res.rowCount > 0;
  } catch (e) {
    return false;
  }
}

/**
 * Load complete admin store from PostgreSQL, or fallback to adminStore.json
 */
export async function getAdminStore(): Promise<Record<string, any>> {
  try {
    const p = getDbPool();

    // Query tables concurrently
    const [
      packagesRes,
      subscribersRes,
      invoicesRes,
      ticketsRes,
      techniciansRes,
      adminUsersRes,
      rolesRes,
      settingsRes,
    ] = await Promise.all([
      p.query('SELECT raw_data FROM packages ORDER BY created_at ASC'),
      p.query('SELECT raw_data FROM subscribers ORDER BY created_at ASC'),
      p.query('SELECT raw_data FROM invoices ORDER BY created_at ASC'),
      p.query('SELECT raw_data FROM tickets ORDER BY created_at ASC'),
      p.query('SELECT raw_data FROM technicians ORDER BY created_at ASC'),
      p.query('SELECT raw_data FROM admin_users ORDER BY created_at ASC'),
      p.query('SELECT raw_data FROM roles ORDER BY created_at ASC'),
      p.query('SELECT key, value FROM app_settings'),
    ]);

    const result: Record<string, any> = {
      packages: packagesRes.rows.map((r) => r.raw_data).filter(Boolean),
      subscribers: subscribersRes.rows.map((r) => r.raw_data).filter(Boolean),
      invoices: invoicesRes.rows.map((r) => r.raw_data).filter(Boolean),
      tickets: ticketsRes.rows.map((r) => r.raw_data).filter(Boolean),
      technicians: techniciansRes.rows.map((r) => r.raw_data).filter(Boolean),
      adminUsers: adminUsersRes.rows.map((r) => r.raw_data).filter(Boolean),
      roles: rolesRes.rows.map((r) => r.raw_data).filter(Boolean),
      lastUpdated: new Date().toISOString(),
    };

    // Populate settings (referralRewards, boostBandwidth, liveLatency, interfaceTraffic, peeringHubs, zones, etc.)
    settingsRes.rows.forEach((row) => {
      if (row.key !== 'siteData') {
        result[row.key] = row.value;
      }
    });

    return result;
  } catch (error) {
    console.warn('[PostgreSQL] Could not read from DB, falling back to disk:', error);
    const storePath = path.join(getDataDir(), 'adminStore.json');
    if (fs.existsSync(storePath)) {
      return JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    }
    return {
      packages: [],
      subscribers: [],
      invoices: [],
      tickets: [],
      technicians: [],
      adminUsers: [],
      roles: [],
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * Save or update section in PostgreSQL and sync to adminStore.json
 */
export async function saveAdminSection(type: string, data: any): Promise<void> {
  const dataDir = getDataDir();
  const storePath = path.join(dataDir, 'adminStore.json');

  // Always keep JSON mirror updated for offline backup
  try {
    let currentDisk: Record<string, any> = {};
    if (fs.existsSync(storePath)) {
      currentDisk = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    }
    currentDisk[type] = data;
    currentDisk.lastUpdated = new Date().toISOString();
    fs.writeFileSync(storePath, JSON.stringify(currentDisk, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error writing disk fallback:', e);
  }

  // Update in PostgreSQL
  try {
    const p = getDbPool();

    if (type === 'packages' && Array.isArray(data)) {
      await p.query('DELETE FROM packages');
      for (const item of data) {
        await p.query(
          `INSERT INTO packages (id, name, speed, upload_speed, price, duration, description, subscriber_count, raw_data, updated_at)
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
             updated_at = NOW()`,
          [
            String(item.id),
            item.name || 'Unnamed',
            Number(item.downloadSpeed || item.speed || 50),
            Number(item.uploadSpeed || item.speed || 50),
            Number(item.price || 0),
            Number(item.duration || 30),
            item.description || '',
            Number(item.subscriberCount || 0),
            JSON.stringify(item),
          ]
        );
      }
    } else if (type === 'subscribers' && Array.isArray(data)) {
      await p.query('DELETE FROM subscribers');
      for (const item of data) {
        await p.query(
          `INSERT INTO subscribers (id, name, email, phone, package_id, status, raw_data, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             email = EXCLUDED.email,
             phone = EXCLUDED.phone,
             package_id = EXCLUDED.package_id,
             status = EXCLUDED.status,
             raw_data = EXCLUDED.raw_data,
             updated_at = NOW()`,
          [
            String(item.id),
            item.name || '',
            item.email || '',
            item.phone || '',
            item.packageId || item.package_id || '',
            item.status || 'active',
            JSON.stringify(item),
          ]
        );
      }
    } else if (type === 'invoices' && Array.isArray(data)) {
      await p.query('DELETE FROM invoices');
      for (const item of data) {
        await p.query(
          `INSERT INTO invoices (id, subscriber_id, amount, status, due_date, raw_data, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (id) DO UPDATE SET
             subscriber_id = EXCLUDED.subscriber_id,
             amount = EXCLUDED.amount,
             status = EXCLUDED.status,
             due_date = EXCLUDED.due_date,
             raw_data = EXCLUDED.raw_data,
             updated_at = NOW()`,
          [
            String(item.id),
            item.subscriberId || item.subscriber_id || '',
            Number(item.amount || 0),
            item.status || 'unpaid',
            item.dueDate || item.due_date || '',
            JSON.stringify(item),
          ]
        );
      }
    } else if (type === 'tickets' && Array.isArray(data)) {
      await p.query('DELETE FROM tickets');
      for (const item of data) {
        await p.query(
          `INSERT INTO tickets (id, title, status, priority, raw_data, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title,
             status = EXCLUDED.status,
             priority = EXCLUDED.priority,
             raw_data = EXCLUDED.raw_data,
             updated_at = NOW()`,
          [
            String(item.id),
            item.title || item.subject || '',
            item.status || 'open',
            item.priority || 'medium',
            JSON.stringify(item),
          ]
        );
      }
    } else if (type === 'technicians' && Array.isArray(data)) {
      await p.query('DELETE FROM technicians');
      for (const item of data) {
        await p.query(
          `INSERT INTO technicians (id, name, status, raw_data, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             status = EXCLUDED.status,
             raw_data = EXCLUDED.raw_data,
             updated_at = NOW()`,
          [
            String(item.id),
            item.name || '',
            item.status || 'active',
            JSON.stringify(item),
          ]
        );
      }
    } else if (type === 'adminUsers' && Array.isArray(data)) {
      await p.query('DELETE FROM admin_users');
      for (const item of data) {
        await p.query(
          `INSERT INTO admin_users (id, name, email, role, status, raw_data, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             email = EXCLUDED.email,
             role = EXCLUDED.role,
             status = EXCLUDED.status,
             raw_data = EXCLUDED.raw_data,
             updated_at = NOW()`,
          [
            String(item.id),
            item.name || '',
            item.email || '',
            item.role || 'admin',
            item.status || 'active',
            JSON.stringify(item),
          ]
        );
      }
    } else if (type === 'roles' && Array.isArray(data)) {
      await p.query('DELETE FROM roles');
      for (const item of data) {
        await p.query(
          `INSERT INTO roles (id, name, raw_data, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             raw_data = EXCLUDED.raw_data,
             updated_at = NOW()`,
          [
            String(item.id),
            item.name || '',
            JSON.stringify(item),
          ]
        );
      }
    } else {
      // Store into app_settings
      await p.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           updated_at = NOW()`,
        [type, JSON.stringify(data)]
      );
    }
  } catch (error) {
    console.error(`[PostgreSQL] Error updating ${type}:`, error);
  }
}

/**
 * Get Site Data from PostgreSQL app_settings or fallback to siteData.json
 */
export async function getSiteContent(): Promise<Record<string, any>> {
  try {
    const p = getDbPool();
    const res = await p.query("SELECT value FROM app_settings WHERE key = 'siteData'");
    if (res.rows.length > 0 && res.rows[0].value) {
      const siteData = res.rows[0].value;
      // Also ensure packages are synced if needed
      const pkgRes = await p.query('SELECT raw_data FROM packages');
      if (pkgRes.rows.length > 0) {
        siteData.packages = pkgRes.rows.map((r) => {
          const p = r.raw_data;
          return {
            id: p.id,
            name: p.name,
            speed: p.downloadSpeed || p.speed || 50,
            uploadSpeed: p.uploadSpeed || p.downloadSpeed || p.speed || 50,
            price: p.price,
            bdixSpeed: (p.downloadSpeed || p.speed || 50) >= 500 ? 1000 : 500,
            popular: p.subscriberCount > 50 || (p.name && p.name.toLowerCase().includes('ultra')),
            features: [
              `${p.downloadSpeed || p.speed || 50} Mbps Symmetrical Fiber`,
              `Unlimited Global Bandwidth`,
              `24/7 Dedicated Support`,
            ],
          };
        });
      }
      return siteData;
    }
  } catch (err) {
    console.warn('[PostgreSQL] Could not read siteData from DB:', err);
  }

  const siteDataPath = path.join(getDataDir(), 'siteData.json');
  if (fs.existsSync(siteDataPath)) {
    return JSON.parse(fs.readFileSync(siteDataPath, 'utf-8'));
  }
  return {};
}

/**
 * Save Site Data to PostgreSQL and siteData.json
 */
export async function saveSiteContent(data: Record<string, any>): Promise<void> {
  const dataDir = getDataDir();
  const siteDataPath = path.join(dataDir, 'siteData.json');

  // Update disk
  try {
    fs.writeFileSync(siteDataPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error writing siteData.json:', e);
  }

  // Update DB
  try {
    const p = getDbPool();
    await p.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('siteData', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      [JSON.stringify(data)]
    );
  } catch (err) {
    console.error('[PostgreSQL] Error writing siteData to DB:', err);
  }
}

