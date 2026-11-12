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
      p.query(
        `SELECT id, name, speed, upload_speed, price, duration, description,
                subscriber_count, bdix_speed, popular, raw_data
           FROM packages ORDER BY created_at ASC`,
      ),
      p.query(
        `SELECT id, name, email, phone, package_id, status, created_at, raw_data
           FROM subscribers ORDER BY created_at ASC`,
      ),
      p.query(
        `SELECT id, subscriber_id, amount, status, due_date, created_at, raw_data
           FROM invoices ORDER BY created_at ASC`,
      ),
      p.query(
        `SELECT id, title, status, priority, created_at, raw_data
           FROM tickets ORDER BY created_at ASC`,
      ),
      p.query(`SELECT id, name, status, created_at, raw_data FROM technicians ORDER BY created_at ASC`),
      p.query(
        `SELECT id, name, email, role, status, created_at, raw_data
           FROM admin_users ORDER BY created_at ASC`,
      ),
      p.query(`SELECT id, name, created_at, raw_data FROM roles ORDER BY created_at ASC`),
      p.query('SELECT key, value FROM app_settings'),
    ]);

    // The rows are merged with their `raw_data` instead of returning the JSON
    // blob alone. The API engine writes the identity fields into real columns
    // (id, name, email, phone, status) and only the extra fields into
    // `raw_data` — so an account that registered itself on the portal came
    // back with an empty id, no name and no status, and the admin panel showed
    // a blank row for it. The column is the authority for the identity and
    // the lifecycle status; `raw_data` carries everything else.
    const result: Record<string, any> = {
      packages: packagesRes.rows.map((r) => {
        const raw = r.raw_data || {};
        return {
          ...raw,
          id: r.id,
          name: r.name || raw.name || '',
          downloadSpeed: raw.downloadSpeed ?? r.speed,
          uploadSpeed: raw.uploadSpeed ?? r.upload_speed,
          price: Number(raw.price ?? r.price ?? 0),
          duration: Number(raw.duration ?? r.duration ?? 30),
          description: raw.description ?? r.description ?? '',
          subscriberCount: Number(raw.subscriberCount ?? r.subscriber_count ?? 0),
          bdixSpeed: raw.bdixSpeed ?? r.bdix_speed,
          popular: raw.popular ?? r.popular,
        };
      }),
      subscribers: subscribersRes.rows.map((r) => {
        const raw = r.raw_data || {};
        return {
          ...raw,
          id: r.id,
          name: raw.name || r.name || '',
          email: raw.email || r.email || '',
          phone: raw.phone || r.phone || '',
          username: raw.username || '',
          packageId: raw.packageId || raw.package_id || r.package_id || '',
          status: r.status || raw.status || 'active',
          joinDate: raw.joinDate || raw.joinedAt || r.created_at || '',
        };
      }),
      invoices: invoicesRes.rows.map((r) => {
        const raw = r.raw_data || {};
        return {
          ...raw,
          id: r.id,
          invoiceNumber: raw.invoiceNumber || r.id,
          subscriberId: raw.subscriberId || raw.subscriber_id || r.subscriber_id || '',
          amount: Number(raw.amount ?? r.amount ?? 0),
          status: r.status || raw.status || 'unpaid',
          dueDate: raw.dueDate || r.due_date || '',
          issueDate: raw.issueDate || r.created_at || '',
        };
      }),
      tickets: ticketsRes.rows.map((r) => {
        const raw = r.raw_data || {};
        return {
          ...raw,
          id: r.id,
          title: raw.title || r.title || '',
          status: r.status || raw.status || 'open',
          priority: raw.priority || r.priority || 'medium',
          createdAt: raw.createdAt || r.created_at || '',
        };
      }),
      technicians: techniciansRes.rows.map((r) => {
        const raw = r.raw_data || {};
        return {
          ...raw,
          id: r.id,
          name: r.name || raw.name || '',
          status: r.status || raw.status || 'active',
        };
      }),
      adminUsers: adminUsersRes.rows.map((r) => {
        const raw = r.raw_data || {};
        return {
          ...raw,
          id: r.id,
          name: r.name || raw.name || '',
          email: r.email || raw.email || '',
          role: r.role || raw.role || 'admin',
          status: r.status || raw.status || 'active',
        };
      }),
      roles: rolesRes.rows.map((r) => {
        const raw = r.raw_data || {};
        return {
          ...raw,
          id: r.id,
          name: r.name || raw.name || '',
          key: raw.key || r.id,
        };
      }),
      lastUpdated: new Date().toISOString(),
    };

    // Populate settings (referralRewards, boostBandwidth, liveLatency, interfaceTraffic, peeringHubs, zones, etc.)
    settingsRes.rows.forEach((row) => {
      if (row.key !== 'siteData') {
        result[row.key] = row.value;
      }
    });

    // Nothing is seeded or written here any more. The previous code re-seeded
    // the 8 mock packages and the mock subscribers whenever the table held
    // one or zero rows — which replaced the operator's pricing with the
    // built-in 8 plans and overwrote the existing customers with plaintext
    // mock accounts. A read path must never write.
    return result;
  } catch (error) {
    console.warn('[PostgreSQL] Could not read from DB, falling back to disk:', error);
    const storePath = path.join(getDataDir(), 'adminStore.json');
    if (fs.existsSync(storePath)) {
      const diskData = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
      if (!diskData.subscribers || !Array.isArray(diskData.subscribers)) diskData.subscribers = [];
      if (!diskData.packages || !Array.isArray(diskData.packages)) diskData.packages = [];
      return diskData;
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
      // Packages are an upsert instead of delete-and-reinsert. A table rewrite
      // between the DELETE and the INSERT left the catalogue empty for a
      // moment, and it silently dropped the RouterOS profile columns
      // (routeros_profile, max_limit), which are not part of the admin
      // payload — so every gigabit customer was shaped back to 10 Mbps.
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
      // The billing engine also writes to the subscribers table (it
      // suspends and restores accounts), so this is an upsert instead of a
      // delete-and-reinsert. A full rewrite would resurrect the suspended
      // accounts and reset the creation date of every subscriber.
      const subscriberIds = data.map((item: any) => String(item.id));
      for (const item of data) {
        await p.query(
          `INSERT INTO subscribers (id, name, email, phone, package_id, status, raw_data, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE((SELECT created_at FROM subscribers WHERE id = $1::varchar), NOW()), NOW())
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
      // The subscribers are not deleted here either — the billing engine
      // suspends and restores accounts, and the admin panel may hold a
      // partial list.
    } else if (type === 'invoices' && Array.isArray(data)) {
      // The invoices table is also written by the billing engine, so this is
      // an upsert instead of a delete-and-reinsert. A full rewrite would
      // reset every paid invoice to "unpaid" and reset the creation date.
      //
      // The subscriber id may be missing from the admin payload — the billing
      // engine writes it but the legacy admin store does not round-trip it.
      // An empty value must never overwrite the real one, otherwise a payment
      // can no longer find its account and no overdue account is ever cut.
      // A paid invoice is also never flipped back to unpaid.
      for (const item of data) {
        // The store holds the invoice either as the legacy shape (id) or as
        // the billing engine's raw_data (invoiceNumber, never an id). Without
        // this, String(item.id) produced the literal string "undefined" and
        // every engine invoice collapsed onto one corrupted row.
        const resolvedId = String(item.id || item.invoiceNumber || item.invoice_number || '');
        if (!resolvedId || resolvedId === 'undefined') {
          console.warn('[PostgreSQL] skipping an invoice without an id in the save payload');
          continue;
        }
        await p.query(
          `INSERT INTO invoices (id, subscriber_id, amount, status, due_date, raw_data, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, COALESCE((SELECT created_at FROM invoices WHERE id = $1::varchar), NOW()), NOW())
           ON CONFLICT (id) DO UPDATE SET
             subscriber_id = COALESCE(NULLIF(EXCLUDED.subscriber_id, ''), invoices.subscriber_id),
             amount = CASE WHEN invoices.status = 'paid' THEN invoices.amount ELSE EXCLUDED.amount END,
             status = CASE WHEN invoices.status = 'paid' THEN invoices.status ELSE EXCLUDED.status END,
             due_date = CASE WHEN invoices.status = 'paid' THEN invoices.due_date ELSE EXCLUDED.due_date END,
             raw_data = EXCLUDED.raw_data,
             updated_at = NOW()`,
          [
            resolvedId,
            item.subscriberId || item.subscriber_id || '',
            Number(item.amount || 0),
            item.status || 'unpaid',
            item.dueDate || item.due_date || '',
            JSON.stringify(item.id ? item : { ...item, id: resolvedId }),
          ]
        );
      }
      // Nothing is deleted here. The billing engine owns the invoices and may
      // hold rows the admin panel has not loaded yet, so removing the rows
      // that are missing from the payload would drop real billing records.
      // A deletion goes through the billing API instead.
    } else if (type === 'tickets' && Array.isArray(data)) {
      const ticketIds = data.map((item: any) => String(item.id));
      for (const item of data) {
        await p.query(
          `INSERT INTO tickets (id, title, status, priority, raw_data, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, COALESCE((SELECT created_at FROM tickets WHERE id = $1::varchar), NOW()), NOW())
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
      // A ticket that the admin panel removed is deleted through the CRM API,
      // so the ticket details and the message thread stay consistent.
    } else if (type === 'technicians' && Array.isArray(data)) {
      // The delete and the re-insert are one transaction — a failure halfway
      // used to leave the technicians table empty, and the CRM
      // auto-assignment then found nobody to assign.
      const client = await p.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM technicians');
        for (const item of data) {
          await client.query(
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
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } else if (type === 'adminUsers' && Array.isArray(data)) {
      const client = await p.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM admin_users');
        for (const item of data) {
          await client.query(
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
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } else if (type === 'roles' && Array.isArray(data)) {
      const client = await p.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM roles');
        for (const item of data) {
          await client.query(
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
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
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
    // The error is re-thrown so the caller can report the failure. Swallowing
    // it made the admin panel show "Saved successfully" even when nothing was
    // written.
    console.error(`[PostgreSQL] Error updating ${type}:`, error);
    throw error;
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
      const pkgRes = await p.query('SELECT raw_data FROM packages ORDER BY (raw_data->>\'price\')::numeric ASC');
      if (pkgRes.rows.length > 0) {
        siteData.packages = pkgRes.rows.map((r) => {
          const p = r.raw_data;
          return {
            id: p.id,
            name: p.name,
            speed: p.downloadSpeed || p.speed || 100,
            uploadSpeed: p.uploadSpeed || p.downloadSpeed || p.speed || 100,
            price: Number(p.price || 0),
            bdixSpeed: (p.downloadSpeed || p.speed || 100) >= 1000 ? 5000 : 1000,
            popular: !!p.popular,
            badge: p.badge,
            speedLabel: p.speedLabel,
            category: p.category || 'Home Internet',
            targetCustomer: p.targetCustomer || 'Regular Users',
            description: p.description || '',
            features: p.features || [
              `${p.downloadSpeed || p.speed || 100} Mbps Symmetrical Fiber`,
              `Unlimited Global Bandwidth`,
              `24/7 Dedicated Support`,
            ],
            unlimitedData: p.unlimitedData ?? true,
            symmetricalSpeed: p.symmetricalSpeed ?? true,
            fiberConnection: p.fiberConnection ?? true,
            ipv6Support: p.ipv6Support ?? false,
            gamingOptimized: p.gamingOptimized ?? false,
            streaming4k8k: p.streaming4k8k ?? false,
            staticIp: p.staticIp ?? 'Add-on',
            prioritySupport: p.prioritySupport ?? false,
            dedicatedBandwidth: p.dedicatedBandwidth ?? '—',
            businessSla: p.businessSla ?? '—',
            support24_7: p.support24_7 ?? false,
            lowLatencyRouting: p.lowLatencyRouting ?? false,
            directCloudPeering: p.directCloudPeering ?? false,
            hardwareReady: p.hardwareReady ?? 'Gigabit ONU',
            ddosProtection: p.ddosProtection ?? 'Basic',
            bgpFailover: p.bgpFailover ?? '—',
            cirGuarantee: p.cirGuarantee ?? '—',
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

/**
 * Delete a row from an admin-owned table.
 *
 * Used for technicians, roles and admin user accounts — collections the admin
 * panel owns outright. The delete actually removes the row, so the record does
 * not reappear on the next refresh.
 *
 * Returns false when the type is not a deletable admin-owned table or the row
 * does not exist.
 */
export async function deleteAdminRecord(
  type: 'technicians' | 'roles' | 'adminUsers',
  id: string,
): Promise<boolean> {
  const table = type === 'adminUsers' ? 'admin_users' : type;
  const p = getDbPool();
  const result = await p.query(`DELETE FROM ${table} WHERE id = $1`, [String(id)]);
  return (result.rowCount || 0) > 0;
}

/**
 * Find subscriber by username, email, phone, or subscriber ID
 */
export async function findSubscriber(identifier: string): Promise<any | null> {
  try {
    const p = getDbPool();
    const clean = identifier.trim();
    const res = await p.query(
      `SELECT * FROM subscribers 
       WHERE id = $1 
          OR LOWER(name) = LOWER($1) 
          OR LOWER(email) = LOWER($1) 
          OR phone = $1 
          OR raw_data->>'username' = $1 
          OR LOWER(raw_data->>'username') = LOWER($1)
       LIMIT 1`,
      [clean]
    );

    if (res.rows.length > 0) {
      const row = res.rows[0];
      const raw = row.raw_data || {};
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        status: row.status,
        packageId: row.package_id || raw.packageId || raw.package_id || 'PKG-003',
        packageName: raw.packageName || raw.package || 'Advanced',
        balance: Number(raw.balance || 0),
        dueDate: raw.dueDate || '2026-02-15',
        joinDate: raw.joinDate || '2024-01-01',
        // Subscription lifecycle dates — written by the billing engine when a
        // plan is purchased and when the subscription is cancelled. They stay
        // on the account after a cancellation.
        subscriptionStartedAt: raw.subscriptionStartedAt || null,
        subscriptionCancelledAt: raw.subscriptionCancelledAt || null,
        connectionType: raw.connectionType || 'Optical Fiber GPON',
        ipAddress: raw.ipAddress || '198.51.100.12',
        macAddress: raw.macAddress || 'AA:BB:CC:DD:EE:01',
        address: raw.address || 'Connected Premises',
        zone: raw.zone || 'Global Network',
        username: raw.username || clean.toLowerCase(),
        password: raw.password || '',
        raw_data: raw,
      };
    }
  } catch (err) {
    console.error('[PostgreSQL findSubscriber Error]', err);
  }
  return null;
}

/**
 * Get subscriber by primary ID
 */
export async function getSubscriberById(id: string): Promise<any | null> {
  return findSubscriber(id);
}

/**
 * Create a new customer package purchase order
 */
export async function createOrderRecord(order: any): Promise<any> {
  const p = getDbPool();
  const client = await p.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(50) PRIMARY KEY,
        customer_id VARCHAR(50) NOT NULL,
        customer_name VARCHAR(150),
        connection_id VARCHAR(100),
        package_id VARCHAR(50) NOT NULL,
        package_name VARCHAR(100) NOT NULL,
        purchase_type VARCHAR(50) NOT NULL,
        current_package_id VARCHAR(50),
        current_package_name VARCHAR(100),
        download_speed INT DEFAULT 100,
        upload_speed INT DEFAULT 100,
        monthly_price NUMERIC(10,2) DEFAULT 0.00,
        prorated_adjustment NUMERIC(10,2) DEFAULT 0.00,
        installation_fee NUMERIC(10,2) DEFAULT 0.00,
        taxes NUMERIC(10,2) DEFAULT 0.00,
        discount NUMERIC(10,2) DEFAULT 0.00,
        total_payable NUMERIC(10,2) DEFAULT 0.00,
        payment_method VARCHAR(50),
        payment_status VARCHAR(50) DEFAULT 'Payment Verified',
        order_status VARCHAR(50) DEFAULT 'Pending Activation',
        trx_id VARCHAR(100),
        next_billing_date VARCHAR(50),
        expected_activation_time VARCHAR(100),
        raw_data JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(
      `INSERT INTO orders (
        id, customer_id, customer_name, connection_id, package_id, package_name,
        purchase_type, current_package_id, current_package_name, download_speed, upload_speed,
        monthly_price, prorated_adjustment, installation_fee, taxes, discount, total_payable,
        payment_method, payment_status, order_status, trx_id, next_billing_date,
        expected_activation_time, raw_data, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, NOW(), NOW()
      )`,
      [
        order.id,
        order.customerId,
        order.customerName,
        order.connectionId,
        order.packageId,
        order.packageName,
        order.purchaseType,
        order.currentPackageId,
        order.currentPackageName,
        Number(order.downloadSpeed || 100),
        Number(order.uploadSpeed || 100),
        Number(order.monthlyPrice || 0),
        Number(order.proratedAdjustment || 0),
        Number(order.installationFee || 0),
        Number(order.taxes || 0),
        Number(order.discount || 0),
        Number(order.totalPayable || 0),
        order.paymentMethod,
        order.paymentStatus || 'Payment Verified',
        order.orderStatus || (order.purchaseType === 'upgrade' ? 'Active' : 'Pending Activation'),
        order.trxId,
        order.nextBillingDate,
        order.expectedActivationTime,
        JSON.stringify(order),
      ]
    );

    if (order.purchaseType === 'upgrade') {
      const subRes = await client.query('SELECT raw_data FROM subscribers WHERE id = $1', [order.customerId]);
      if (subRes.rows.length > 0) {
        const raw = subRes.rows[0].raw_data || {};
        raw.packageId = order.packageId;
        raw.packageName = order.packageName;
        raw.speed = order.downloadSpeed;
        raw.uploadSpeed = order.uploadSpeed;

        await client.query(
          `UPDATE subscribers 
           SET package_id = $1, raw_data = $2, updated_at = NOW() 
           WHERE id = $3`,
          [order.packageId, JSON.stringify(raw), order.customerId]
        );
      }
    }

    const invoiceId = `INV-${Date.now().toString().slice(-6)}`;
    await client.query(
      `INSERT INTO invoices (id, subscriber_id, amount, status, due_date, raw_data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        invoiceId,
        order.customerId,
        Number(order.totalPayable || 0),
        'paid',
        order.nextBillingDate || new Date().toISOString().split('T')[0],
        JSON.stringify({
          id: invoiceId,
          orderId: order.id,
          subscriberId: order.customerId,
          amount: Number(order.totalPayable || 0),
          status: 'paid',
          date: new Date().toISOString().split('T')[0],
          paymentMethod: order.paymentMethod,
          trxId: order.trxId,
          package: order.packageName,
          purchaseType: order.purchaseType,
        }),
      ]
    );

    await client.query('COMMIT');
    return order;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PostgreSQL createOrderRecord Error]', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get all orders belonging to a specific customer
 */
export async function getCustomerOrders(customerId: string): Promise<any[]> {
  try {
    const p = getDbPool();
    const res = await p.query(
      `SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC`,
      [customerId]
    );
    return res.rows.map((row) => ({
      ...row,
      id: row.id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      connectionId: row.connection_id,
      packageId: row.package_id,
      packageName: row.package_name,
      purchaseType: row.purchase_type,
      currentPackageId: row.current_package_id,
      currentPackageName: row.current_package_name,
      downloadSpeed: row.download_speed,
      uploadSpeed: row.upload_speed,
      monthlyPrice: Number(row.monthly_price),
      proratedAdjustment: Number(row.prorated_adjustment),
      installationFee: Number(row.installation_fee),
      taxes: Number(row.taxes),
      totalPayable: Number(row.total_payable),
      paymentMethod: row.payment_method,
      paymentStatus: row.payment_status,
      orderStatus: row.order_status,
      order_status: row.order_status,
      trxId: row.trx_id,
      trx_id: row.trx_id,
      nextBillingDate: row.next_billing_date,
      expectedActivationTime: row.expected_activation_time,
      createdAt: row.created_at,
      raw_data: row.raw_data,
    }));
  } catch (err) {
    console.error('[PostgreSQL getCustomerOrders Error]', err);
    return [];
  }
}

/**
 * Get all orders for Admin Panel
 */
export async function getAllOrders(): Promise<any[]> {
  try {
    const p = getDbPool();
    // The subscriber status is joined in so the page can tell a live
    // subscriber from an account whose subscription was cancelled.
    const res = await p.query(
      `SELECT o.*, s.status AS subscriber_status
         FROM orders o
         LEFT JOIN subscribers s ON s.id = o.customer_id
        ORDER BY o.created_at DESC`,
    );
    return res.rows.map((row) => ({
      ...row,
      id: row.id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      connectionId: row.connection_id,
      packageId: row.package_id,
      packageName: row.package_name,
      purchaseType: row.purchase_type,
      currentPackageId: row.current_package_id,
      currentPackageName: row.current_package_name,
      downloadSpeed: row.download_speed,
      uploadSpeed: row.upload_speed,
      monthlyPrice: Number(row.monthly_price),
      proratedAdjustment: Number(row.prorated_adjustment),
      installationFee: Number(row.installation_fee),
      taxes: Number(row.taxes),
      totalPayable: Number(row.total_payable),
      paymentMethod: row.payment_method,
      paymentStatus: row.payment_status,
      orderStatus: row.order_status,
      order_status: row.order_status,
      subscriberStatus: row.subscriber_status || null,
      trxId: row.trx_id,
      trx_id: row.trx_id,
      nextBillingDate: row.next_billing_date,
      expectedActivationTime: row.expected_activation_time,
      createdAt: row.created_at,
      raw_data: row.raw_data,
    }));
  } catch (err) {
    console.error('[PostgreSQL getAllOrders Error]', err);
    return [];
  }
}

/**
 * Update Order Status (Admin Approval / Provisioning)
 */
export async function updateOrderStatus(orderId: string, newStatus: string): Promise<boolean> {
  const p = getDbPool();
  const client = await p.connect();

  try {
    await client.query('BEGIN');

    const orderRes = await client.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    const order = orderRes.rows[0];

    await client.query(
      `UPDATE orders SET order_status = $1, updated_at = NOW() WHERE id = $2`,
      [newStatus, orderId]
    );

    if (newStatus === 'Active') {
      const subRes = await client.query('SELECT raw_data FROM subscribers WHERE id = $1', [order.customer_id]);
      if (subRes.rows.length > 0) {
        const raw = subRes.rows[0].raw_data || {};
        if (String(order.purchase_type || '').toUpperCase() === 'UPGRADE') {
          // The plan only changes now, on approval. A pending or cancelled
          // order leaves the account on its current plan.
          raw.packageId = order.package_id;
          raw.packageName = order.package_name;
          raw.speed = order.download_speed;
          raw.uploadSpeed = order.upload_speed;
          delete raw.pendingPackageId;
          delete raw.pendingPackageName;
        } else if (String(order.purchase_type || '').toUpperCase() === 'ADDITIONAL') {
          if (!raw.additionalConnections) raw.additionalConnections = [];
          raw.additionalConnections.push({
            orderId: order.id,
            packageId: order.package_id,
            packageName: order.package_name,
            speed: order.download_speed,
            activatedAt: new Date().toISOString(),
          });
        }

        await client.query(
          `UPDATE subscribers 
           SET package_id = $1, raw_data = $2, updated_at = NOW() 
           WHERE id = $3`,
          [raw.packageId || order.package_id, JSON.stringify(raw), order.customer_id]
        );
      }
    }

    if (newStatus === 'Cancelled') {
      // The account goes back to the plan it had before the order.
      const subRes = await client.query('SELECT raw_data FROM subscribers WHERE id = $1', [order.customer_id]);
      if (subRes.rows.length > 0) {
        const raw = subRes.rows[0].raw_data || {};
        if (raw.pendingPackageId) {
          raw.packageId = order.current_package_id || raw.packageId;
          raw.packageName = order.current_package_name || raw.packageName;
          delete raw.pendingPackageId;
          delete raw.pendingPackageName;

          await client.query(
            `UPDATE subscribers 
             SET package_id = $1, raw_data = $2, updated_at = NOW() 
             WHERE id = $3`,
            [raw.packageId || order.current_package_id || '', JSON.stringify(raw), order.customer_id]
          );
        }
      }
    }

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PostgreSQL updateOrderStatus Error]', err);
    return false;
  } finally {
    client.release();
  }
}


