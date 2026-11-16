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
    const [settingsRes, sysSettingsRes, pkgRes, covRes] = await Promise.all([
      p.query('SELECT key, value FROM app_settings'),
      p.query('SELECT key, value FROM system_settings').catch(() => ({ rows: [] as any[] })),
      p.query('SELECT id, name, speed, upload_speed, price, bdix_speed, popular, description, raw_data FROM packages ORDER BY price ASC, speed ASC'),
      p.query('SELECT id, zone, district, areas, status FROM coverage_areas ORDER BY zone ASC, district ASC').catch(() => ({ rows: [] as any[] })),
    ]);

    const settingsMap: Record<string, any> = {};
    for (const row of settingsRes.rows) {
      settingsMap[row.key] = row.value;
    }

    const sysSettingsMap: Record<string, any> = {};
    for (const row of sysSettingsRes.rows) {
      sysSettingsMap[row.key] = row.value;
    }

    const siteData: Record<string, any> =
      settingsMap.siteData && typeof settingsMap.siteData === 'object'
        ? { ...settingsMap.siteData }
        : {};

    // Merge standalone admin sections from app_settings so Backend /boost, /latency, /traffic, /peering, /referrals always sync to Frontend
    const standaloneKeys = [
      'referralRewards',
      'boostBandwidth',
      'liveLatency',
      'interfaceTraffic',
      'peeringHubs',
      'zones',
    ];
    for (const k of standaloneKeys) {
      if (settingsMap[k] !== undefined && settingsMap[k] !== null) {
        if (typeof settingsMap[k] === 'object' && !Array.isArray(settingsMap[k])) {
          if (Object.keys(settingsMap[k]).length > 0) {
            siteData[k] = { ...(siteData[k] || {}), ...settingsMap[k] };
          }
        } else if (Array.isArray(settingsMap[k])) {
          if (settingsMap[k].length > 0) {
            siteData[k] = settingsMap[k];
          }
        } else {
          siteData[k] = settingsMap[k];
        }
      }
    }

    // Merge system_settings.referral if updated via Backend /referrals API
    if (sysSettingsMap.referral && typeof sysSettingsMap.referral === 'object') {
      const refVal = sysSettingsMap.referral;
      const amt = Number(refVal.rewardAmount ?? refVal.bonusAmount ?? siteData.referralRewards?.rewardAmount ?? 20);
      siteData.referralRewards = {
        ...(siteData.referralRewards || {}),
        ...refVal,
        rewardAmount: amt,
        bonusAmount: amt,
      };
    }

    if (sysSettingsMap.billing && typeof sysSettingsMap.billing === 'object') {
      siteData.billingSettings = sysSettingsMap.billing;
    }

    // Sync coverageAreas from coverage_areas table when available
    if (covRes.rows.length > 0) {
      siteData.coverageAreas = covRes.rows.map((r: any) => ({
        id: r.id,
        zone: r.zone || 'Metro Core',
        district: r.district || 'Central',
        areas: Array.isArray(r.areas) ? r.areas.join(', ') : String(r.areas || ''),
        status:
          String(r.status || '').toLowerCase() === 'available' ||
          String(r.status || '').toLowerCase() === 'active'
            ? 'Active'
            : r.status || 'Active',
      }));
    }

    // Sync packages from packages table
    if (pkgRes.rows.length > 0) {
      siteData.packages = pkgRes.rows.map((r: any) => {
        const p = r.raw_data || {};
        const dlSpeed = Number(p.downloadSpeed || p.speed || r.speed || 100);
        const ulSpeed = Number(p.uploadSpeed || p.downloadSpeed || p.speed || r.upload_speed || dlSpeed);
        const pkgName = p.name || r.name || 'Plan';
        let category = p.category;
        if (!category) {
          if (pkgName === 'Ultra' || pkgName === 'Multi-Gig') category = 'Advanced Internet';
          else if (pkgName === 'Business Pro') category = 'Business Internet';
          else category = 'Home Internet';
        }

        return {
          id: r.id || p.id,
          name: pkgName,
          speed: dlSpeed,
          downloadSpeed: dlSpeed,
          uploadSpeed: ulSpeed,
          price: Number(p.price ?? r.price ?? 0),
          bdixSpeed: Number(p.bdixSpeed || r.bdix_speed || (dlSpeed >= 1000 ? 5000 : 1000)),
          popular: Boolean(p.popular ?? r.popular),
          badge: p.badge,
          speedLabel: p.speedLabel,
          category: category,
          targetCustomer: p.targetCustomer || 'General Users',
          description: p.description || r.description || '',
          features: p.features || [
            `${dlSpeed} Mbps Symmetrical Fiber`,
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

    if (Object.keys(siteData).length > 0) {
      return siteData;
    }
  } catch (err) {
    // In production the site content must not fall back to the disk copy: a
    // stale price or plan would be shown to customers. The error is surfaced
    // instead.
    if (process.env.NODE_ENV === 'production') {
      console.error('[PostgreSQL Frontend] Could not read siteData from DB:', err);
      throw new Error(`The site content could not be read: ${(err as Error)?.message || 'unknown error'}`);
    }
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
      `SELECT s.*, p.name AS joined_package_name
       FROM subscribers s
       LEFT JOIN packages p ON p.id = s.package_id
       WHERE s.id = $1 
          OR LOWER(s.name) = LOWER($1) 
          OR LOWER(s.email) = LOWER($1) 
          OR s.phone = $1 
          OR s.raw_data->>'username' = $1 
          OR LOWER(s.raw_data->>'username') = LOWER($1)
       LIMIT 1`,
      [clean]
    );

    if (res.rows.length > 0) {
      const row = res.rows[0];
      const raw = row.raw_data || {};
      const fullName = String(row.name || raw.name || '').trim();
      const nameParts = fullName ? fullName.split(/\s+/) : [];
      const firstName = row.first_name || raw.firstName || nameParts[0] || '';
      const lastName = row.last_name || raw.lastName || nameParts.slice(1).join(' ') || '';
      const activePackageName = row.joined_package_name || raw.packageName || raw.package || '';

      return {
        id: row.id,
        firstName,
        lastName,
        name: fullName || `${firstName} ${lastName}`.trim(),
        email: row.email,
        phone: row.phone,
        status: row.status,
        theme: row.theme || raw.theme || 'system',
        packageId: row.package_id || raw.packageId || raw.package_id || '',
        packageName: activePackageName,
        balance: Number(raw.balance || 0),
        dueDate: raw.dueDate || '',
        joinDate: raw.joinDate || raw.joinedAt || '',
        subscriptionStartedAt: raw.subscriptionStartedAt || null,
        subscriptionCancelledAt: raw.subscriptionCancelledAt || null,
        connectionType: raw.connectionType || '',
        ipAddress: raw.ipAddress || '',
        macAddress: raw.macAddress || '',
        address: raw.address || '',
        zone: raw.zone || '',
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

export async function getBillingFeeConfig(): Promise<{
  installationFee: number;
  taxFee: number;
  lateFeePercent: number;
  dueDay: number;
}> {
  try {
    const p = getDbPool();
    const res = await p.query(`SELECT value FROM system_settings WHERE key = 'billing' LIMIT 1`);
    const v = res.rows[0]?.value || {};
    return {
      installationFee: Number(v.installationFee ?? 8.99),
      taxFee: Number(v.taxFee ?? 0.99),
      lateFeePercent: Number(v.lateFeePercent ?? 2),
      dueDay: Number(v.dueDay ?? 10),
    };
  } catch {
    return { installationFee: 8.99, taxFee: 0.99, lateFeePercent: 2, dueDay: 10 };
  }
}

/**
 * Count a subscriber's overdue unpaid invoices (past the grace days).
 *
 * The billing engine carries the flat late fee into the NEXT bill when the
 * running month's bill stayed unpaid past the grace days. The same rule
 * applies to a one-off package purchase, so the wizard is consistent with
 * recurring billing.
 */
export async function countOverdueInvoices(subscriberId: string, graceDays = 5): Promise<number> {
  const p = getDbPool();
  const result = await p.query(
    `SELECT COUNT(*)::int AS count
       FROM invoices
      WHERE subscriber_id = $1
        AND status = 'unpaid'
        AND due_date <> ''
        AND due_date::date < (NOW() - ($2 || ' days')::interval)::date`,
    [subscriberId, graceDays],
  );
  return Number(result.rows[0]?.count || 0);
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
        payment_status VARCHAR(50) DEFAULT 'Payment Pending',
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
        // The payment is not verified until the gateway confirms it.
        order.paymentStatus || 'Payment Pending',
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
    if (String(order.purchaseType || '').toUpperCase() === 'UPGRADE') {
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

    // The invoice is created as UNPAID. The portal never marks an invoice as
    // paid on its own — the billing engine does that when the gateway
    // confirms the payment. Before this change the order route wrote the
    // invoice as 'paid' together with a locally invented transaction id, so
    // a purchase was "verified" without any gateway ever being contacted.
    const invoiceId = `INV-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
    const installFee = Number(order.installationFee || 0);
    const taxFee = Number(order.taxes || 0);
    const lateFee = Number(order.lateFee || 0);
    const carriedOver = Number(order.carriedOverAmount || 0);
    const monthlyBase = Number(order.monthlyPrice || 0);
    const speedMbps = Number(order.downloadSpeed || 0);
    const pkgLabel =
      order.packageLabel ||
      (speedMbps > 0 ? `${order.packageName} (${speedMbps} Mbps)` : order.packageName);

    const lines: Array<{ label: string; description?: string; amount: number; amountCents?: number; formattedAmount?: string; code: string; type?: string }> =
      Array.isArray(order.lines) && order.lines.length > 0
        ? order.lines
        : [
            {
              label: `${pkgLabel} monthly fee`,
              description: `${pkgLabel} monthly fee`,
              amount: monthlyBase,
              amountCents: Math.round(monthlyBase * 100),
              formattedAmount: `$${monthlyBase.toFixed(2)}`,
              code: 'monthly_fee',
              type: 'subscription',
            },
            ...(installFee > 0
              ? [
                  {
                    label: 'One-Time Installation Fee',
                    description: 'One-Time Installation Fee',
                    amount: installFee,
                    amountCents: Math.round(installFee * 100),
                    formattedAmount: `+$${installFee.toFixed(2)}`,
                    code: 'installation_fee',
                    type: 'installation_fee',
                  },
                ]
              : []),
            ...(taxFee > 0
              ? [
                  {
                    label: 'Tax Fee',
                    description: 'Tax Fee',
                    amount: taxFee,
                    amountCents: Math.round(taxFee * 100),
                    formattedAmount: `+$${taxFee.toFixed(2)}`,
                    code: 'tax_fee',
                    type: 'tax_fee',
                  },
                ]
              : []),
            ...(carriedOver > 0
              ? [
                  {
                    label: `${pkgLabel} previous month fee`,
                    description: `${pkgLabel} previous month fee`,
                    amount: carriedOver,
                    amountCents: Math.round(carriedOver * 100),
                    formattedAmount: `$${carriedOver.toFixed(2)}`,
                    code: 'previous_month_fee',
                    type: 'carried_over',
                  },
                ]
              : []),
            ...(lateFee > 0
              ? [
                  {
                    label: 'Late Fee (10%)',
                    description: 'Late Fee (10%)',
                    amount: lateFee,
                    amountCents: Math.round(lateFee * 100),
                    formattedAmount: `+$${lateFee.toFixed(2)}`,
                    code: 'late_fee',
                    type: 'late_fee',
                  },
                ]
              : []),
          ];

    await client.query(
      `INSERT INTO invoices (
         id, subscriber_id, amount, installation_fee, tax_fee, late_fee, carried_over_amount,
         status, due_date, raw_data, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         amount = EXCLUDED.amount,
         installation_fee = EXCLUDED.installation_fee,
         tax_fee = EXCLUDED.tax_fee,
         late_fee = EXCLUDED.late_fee,
         carried_over_amount = EXCLUDED.carried_over_amount,
         status = EXCLUDED.status,
         due_date = EXCLUDED.due_date,
         raw_data = EXCLUDED.raw_data,
         updated_at = NOW()`,
      [
        invoiceId,
        order.customerId,
        Number(order.totalPayable || 0),
        installFee,
        taxFee,
        lateFee,
        carriedOver,
        'unpaid',
        order.nextBillingDate || new Date().toISOString().split('T')[0],
        JSON.stringify({
          id: invoiceId,
          orderId: order.id,
          subscriberId: order.customerId,
          subscriberName: order.customerName,
          subscriberPhone: order.customerPhone,
          packageId: order.packageId,
          packageName: order.packageName,
          packageLabel: pkgLabel,
          packagePrice: monthlyBase,
          subscriptionAmount: monthlyBase,
          installationFee: installFee,
          taxFee,
          lateFee,
          carriedOverAmount: carriedOver,
          carriedFromInvoices: Array.isArray(order.unpaidInvoiceIds) ? order.unpaidInvoiceIds : [],
          scenario: order.scenario || 'NEW_SUBSCRIBER',
          badge: order.badge || 'New Subscription',
          lines,
          amount: Number(order.totalPayable || 0),
          status: 'unpaid',
          currency: 'USD',
          date: new Date().toISOString().split('T')[0],
          dueDate: order.nextBillingDate || new Date().toISOString().split('T')[0],
          paymentMethod: order.paymentMethod,
          package: order.packageName,
          purchaseType: order.purchaseType,
          source: 'package-order',
        }),
      ]
    );

    // If this order carries forward prior unpaid invoices (Scenario 3), mark them
    // as carried_forward with late_fee_applied = TRUE so they are never double-counted
    // or charged a late fee twice.
    if (Array.isArray(order.unpaidInvoiceIds) && order.unpaidInvoiceIds.length > 0) {
      await client.query(
        `UPDATE invoices
            SET status = 'carried_forward',
                late_fee_applied = TRUE,
                raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object(
                  'status', 'carried_forward',
                  'lateFeeApplied', true,
                  'carriedIntoInvoiceId', $2::text,
                  'carriedForwardAt', NOW()::text
                ),
                updated_at = NOW()
          WHERE id = ANY($1::text[])`,
        [order.unpaidInvoiceIds, invoiceId]
      );
    }

    await client.query('COMMIT');
    // The invoice id is returned so the caller can start the payment for it.
    return { ...order, invoiceId };
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
      purchase_timestamp: row.raw_data?.purchase_timestamp || row.raw_data?.purchaseTimestamp || (row.created_at ? new Date(row.created_at).toLocaleDateString('en-GB') + ' · ' + new Date(row.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''),
      purchaseTimestamp: row.raw_data?.purchase_timestamp || row.raw_data?.purchaseTimestamp || (row.created_at ? new Date(row.created_at).toLocaleDateString('en-GB') + ' · ' + new Date(row.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''),
      session_geolocation: row.raw_data?.session_geolocation || row.raw_data?.sessionGeolocation || '',
      sessionGeolocation: row.raw_data?.session_geolocation || row.raw_data?.sessionGeolocation || '',
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
      purchase_timestamp: row.raw_data?.purchase_timestamp || row.raw_data?.purchaseTimestamp || (row.created_at ? new Date(row.created_at).toLocaleDateString('en-GB') + ' · ' + new Date(row.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''),
      purchaseTimestamp: row.raw_data?.purchase_timestamp || row.raw_data?.purchaseTimestamp || (row.created_at ? new Date(row.created_at).toLocaleDateString('en-GB') + ' · ' + new Date(row.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''),
      session_geolocation: row.raw_data?.session_geolocation || row.raw_data?.sessionGeolocation || '',
      sessionGeolocation: row.raw_data?.session_geolocation || row.raw_data?.sessionGeolocation || '',
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


