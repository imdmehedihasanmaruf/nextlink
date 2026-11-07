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
  const pBackend = path.join(process.cwd(), '..', 'backend', 'data');
  const p1 = path.join(process.cwd(), 'data');
  const p2 = path.join(process.cwd(), '..', 'data');
  if (fs.existsSync(pBackend)) return pBackend;
  if (fs.existsSync(p1)) return p1;
  if (fs.existsSync(p2)) return p2;
  return pBackend;
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
    console.warn('[PostgreSQL Frontend] Could not read siteData from DB:', err);
  }

  const siteDataPath = path.join(getDataDir(), 'siteData.json');
  if (fs.existsSync(siteDataPath)) {
    return JSON.parse(fs.readFileSync(siteDataPath, 'utf-8'));
  }
  return {};
}

