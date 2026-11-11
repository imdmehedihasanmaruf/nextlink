import { Pool } from 'pg';
import crypto from 'crypto';
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
      const pkgRes = await p.query('SELECT raw_data FROM packages ORDER BY (raw_data->>\'downloadSpeed\')::numeric ASC');
      if (pkgRes.rows.length > 0) {
        siteData.packages = pkgRes.rows.map((r) => {
          const p = r.raw_data;
          // Determine category if not set
          let category = p.category;
          if (!category) {
            if (p.name === 'Ultra' || p.name === 'Multi-Gig') category = 'Advanced Internet';
            else if (p.name === 'Business Pro') category = 'Business Internet';
            else category = 'Home Internet';
          }

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
            category: category,
            targetCustomer: p.targetCustomer || 'General Users',
            description: p.description || '',
            features: p.features || [
              `${p.downloadSpeed || p.speed || 100} Mbps Symmetrical Fiber`,
              `Unlimited Global Bandwidth`,
              `24/7 Dedicated Support`,
            ],
            // 17 Global Package Features
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
    console.warn('[PostgreSQL Frontend] Could not read siteData from DB:', err);
  }

  const siteDataPath = path.join(getDataDir(), 'siteData.json');
  if (fs.existsSync(siteDataPath)) {
    return JSON.parse(fs.readFileSync(siteDataPath, 'utf-8'));
  }
  return {};
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

    // Ensure orders table exists
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

    // Insert order record
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

    // The subscriber's package is NOT changed here. The plan changes when the
    // order is approved, so a pending order does not change what the customer
    // is billed for, and a cancelled order can be reverted.
    if (order.purchaseType === 'upgrade') {
      const subRes = await client.query('SELECT raw_data FROM subscribers WHERE id = $1', [order.customerId]);
      if (subRes.rows.length > 0) {
        const raw = subRes.rows[0].raw_data || {};
        // The pending plan is recorded, but the active plan is untouched.
        raw.pendingPackageId = order.packageId;
        raw.pendingPackageName = order.packageName;
        await client.query(
          `UPDATE subscribers 
           SET raw_data = $1, updated_at = NOW() 
           WHERE id = $2`,
          [JSON.stringify(raw), order.customerId]
        );
      }
    }

    // Insert invoice record into invoices table. The id is unique: the
    // previous value came from a space of a million numbers that repeated
    // every 16 minutes, so an invoice could be silently dropped.
    const invoiceId = `INV-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
    await client.query(
      `INSERT INTO invoices (id, subscriber_id, amount, status, due_date, raw_data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         amount = EXCLUDED.amount,
         status = EXCLUDED.status,
         due_date = EXCLUDED.due_date,
         raw_data = EXCLUDED.raw_data,
         updated_at = NOW()`,
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
          subscriberName: order.customerName,
          subscriberPhone: order.customerPhone,
          packageName: order.packageName,
          amount: Number(order.totalPayable || 0),
          status: 'paid',
          currency: 'USD',
          date: new Date().toISOString().split('T')[0],
          dueDate: order.nextBillingDate || new Date().toISOString().split('T')[0],
          paymentMethod: order.paymentMethod,
          paidVia: order.paymentMethod,
          trxId: order.trxId,
          package: order.packageName,
          purchaseType: order.purchaseType,
          source: 'package-order',
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
 * Get all orders belonging to a specific customer (Strict Customer Isolation)
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
      purchase_timestamp: row.raw_data?.purchase_timestamp || row.raw_data?.purchaseTimestamp || (row.created_at ? new Date(row.created_at).toLocaleDateString('en-GB') + ' · ' + new Date(row.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '09/11/2026 · 12:00PM'),
      purchaseTimestamp: row.raw_data?.purchase_timestamp || row.raw_data?.purchaseTimestamp || (row.created_at ? new Date(row.created_at).toLocaleDateString('en-GB') + ' · ' + new Date(row.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '09/11/2026 · 12:00PM'),
      session_geolocation: row.raw_data?.session_geolocation || row.raw_data?.sessionGeolocation || 'Azimpur, 1205, Dhaka Division, Bangladesh',
      sessionGeolocation: row.raw_data?.session_geolocation || row.raw_data?.sessionGeolocation || 'Azimpur, 1205, Dhaka Division, Bangladesh',
      purchase_type_label: row.raw_data?.purchase_type_label || row.raw_data?.purchaseTypeLabel || (row.purchase_type === 'upgrade' ? 'Package Plan Upgrade' : 'Additional Secondary Drop'),
      purchaseTypeLabel: row.raw_data?.purchase_type_label || row.raw_data?.purchaseTypeLabel || (row.purchase_type === 'upgrade' ? 'Package Plan Upgrade' : 'Additional Secondary Drop'),
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
    const res = await p.query(`SELECT * FROM orders ORDER BY created_at DESC`);
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
      purchase_timestamp: row.raw_data?.purchase_timestamp || row.raw_data?.purchaseTimestamp || (row.created_at ? new Date(row.created_at).toLocaleDateString('en-GB') + ' · ' + new Date(row.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '09/11/2026 · 12:00PM'),
      purchaseTimestamp: row.raw_data?.purchase_timestamp || row.raw_data?.purchaseTimestamp || (row.created_at ? new Date(row.created_at).toLocaleDateString('en-GB') + ' · ' + new Date(row.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '09/11/2026 · 12:00PM'),
      session_geolocation: row.raw_data?.session_geolocation || row.raw_data?.sessionGeolocation || 'Azimpur, 1205, Dhaka Division, Bangladesh',
      sessionGeolocation: row.raw_data?.session_geolocation || row.raw_data?.sessionGeolocation || 'Azimpur, 1205, Dhaka Division, Bangladesh',
      purchase_type_label: row.raw_data?.purchase_type_label || row.raw_data?.purchaseTypeLabel || (row.purchase_type === 'upgrade' ? 'Package Plan Upgrade' : 'Additional Secondary Drop'),
      purchaseTypeLabel: row.raw_data?.purchase_type_label || row.raw_data?.purchaseTypeLabel || (row.purchase_type === 'upgrade' ? 'Package Plan Upgrade' : 'Additional Secondary Drop'),
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

    // Update order status
    await client.query(
      `UPDATE orders SET order_status = $1, updated_at = NOW() WHERE id = $2`,
      [newStatus, orderId]
    );

    // If approved/activated, apply provisioning changes to subscriber
    if (newStatus === 'Active') {
      const subRes = await client.query('SELECT raw_data FROM subscribers WHERE id = $1', [order.customer_id]);
      if (subRes.rows.length > 0) {
        const raw = subRes.rows[0].raw_data || {};
        if (order.purchase_type === 'upgrade') {
          raw.packageId = order.package_id;
          raw.packageName = order.package_name;
          raw.speed = order.download_speed;
          raw.uploadSpeed = order.upload_speed;
        } else if (order.purchase_type === 'additional') {
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


