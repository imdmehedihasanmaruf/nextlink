import { NextResponse } from 'next/server';
import { getAdminStore, getSiteContent, saveAdminSection, saveSiteContent } from '@/lib/db';
import { requireAdmin } from '@/lib/requireAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The only store collections a restore may write. Without this, a crafted
 * backup could inject arbitrary `app_settings` keys into the store.
 */
const RESTORABLE_COLLECTIONS = new Set([
  'packages',
  'subscribers',
  'invoices',
  'tickets',
  'technicians',
  'adminUsers',
  'roles',
  'referralRewards',
  'boostBandwidth',
  'liveLatency',
  'interfaceTraffic',
  'peeringHubs',
]);

const ALLOWED_ORIGINS = (process.env.ADMIN_CORS_ORIGINS ||
  'http://localhost:8000,http://localhost:8001,http://localhost:3000').split(',');

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

/**
 * Strip credentials from every record before it is exported or returned.
 */
function redactCredentials(record: any) {
  if (!record || typeof record !== 'object') return record;
  const copy = { ...record };
  for (const key of Object.keys(copy)) {
    if (/pass(word)?(_hash)?|legacy_password|api_?key|secret/i.test(key)) {
      delete copy[key];
    }
  }
  // A raw_data blob may carry the same keys.
  if (copy.raw_data && typeof copy.raw_data === 'object') {
    copy.raw_data = { ...copy.raw_data };
    for (const key of Object.keys(copy.raw_data)) {
      if (/pass(word)?(_hash)?|legacy_password|api_?key|secret/i.test(key)) {
        delete copy.raw_data[key];
      }
    }
  }
  return copy;
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request, 'cms');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401, headers: corsHeaders });
  }

  try {
    const [siteContent, adminData] = await Promise.all([
      getSiteContent(),
      getAdminStore(),
    ]);

    // The real staff list lives in the API's api_users table. The admin
    // panel's admin_users mirror is a stale seed, so the backup carries the
    // live list alongside it. (Server-to-server call with the caller's own
    // token, the same pattern requireAdmin uses.)
    let staffUsers: any[] | null = null;
    try {
      const API_BASE =
        process.env.NEXT_PUBLIC_BILLING_API_URL?.replace(/\/api$/, '') ||
        'http://localhost:3001';
      const headerToken = request.headers.get('authorization') || '';
      const staffRes = await fetch(`${API_BASE}/api/settings/staff`, {
        headers: { Authorization: headerToken },
        cache: 'no-store',
      });
      if (staffRes.ok) {
        const payload = await staffRes.json();
        if (Array.isArray(payload?.staff)) staffUsers = payload.staff;
      }
    } catch {
      staffUsers = null; // The mirror is included either way; report it as unavailable.
    }

    const fullBackup = {
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      system: 'NextLink ISP Management (PostgreSQL)',
      siteContent,
      // Credentials never leave the server, even for a break-glass export.
      subscribers: (adminData.subscribers || []).map(redactCredentials),
      invoices: adminData.invoices || [],
      tickets: adminData.tickets || [],
      packages: adminData.packages || [],
      technicians: adminData.technicians || [],
      staffUsers,
      adminUsers: (adminData.adminUsers || []).map(redactCredentials),
      adminUsersMirrorNote:
        'admin_users in the admin panel is a stale seed; the authoritative staff list is staffUsers (from the auth service).',
      roles: adminData.roles || [],
      adminStore: {
        ...adminData,
        subscribers: (adminData.subscribers || []).map(redactCredentials),
        adminUsers: (adminData.adminUsers || []).map(redactCredentials),
      },
    };

    return new Response(JSON.stringify(fullBackup, null, 2), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="nextlink-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request, 'cms');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401, headers: corsHeaders });
  }

  try {
    const payload = await request.json();
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: 'Invalid backup file format' }, { status: 400, headers: corsHeaders });
    }

    // Validate everything BEFORE touching the database. The previous version
    // wrote the collections one by one, so a half-valid file left the store
    // half-restored with the live data already replaced.
    // The dashboard-card configs (referralRewards, boostBandwidth, …) are
    // objects, not arrays — they must round-trip too, or a restore silently
    // loses them.
    const SETTINGS_KEYS = new Set([
      'referralRewards',
      'boostBandwidth',
      'liveLatency',
      'interfaceTraffic',
      'peeringHubs',
    ]);
    const collections: Record<string, any> = {};
    const collect = (key: string, val: any) => {
      if (key === 'demoMode' || key === 'lastUpdated') return;
      if (!RESTORABLE_COLLECTIONS.has(key)) return;
      if (SETTINGS_KEYS.has(key)) {
        if (val && typeof val === 'object') collections[key] = val;
      } else if (Array.isArray(val)) {
        collections[key] = val;
      }
    };
    if (payload.adminStore && typeof payload.adminStore === 'object') {
      for (const [key, val] of Object.entries(payload.adminStore)) collect(key, val);
    } else {
      for (const key of RESTORABLE_COLLECTIONS) collect(key, payload[key]);
    }

    if (Object.keys(collections).length === 0) {
      return NextResponse.json(
        { error: 'The backup file contains no recognised collections.' },
        { status: 400, headers: corsHeaders },
      );
    }

    // The restore runs collection by collection. An empty array is never
    // restored — an empty subscribers array would delete every customer.
    const restored: string[] = [];
    for (const [key, data] of Object.entries(collections)) {
      if (Array.isArray(data) && data.length === 0) {
        console.warn(`[backup] skipping the empty "${key}" collection in the restore`);
        continue;
      }
      await saveAdminSection(key, data);
      restored.push(key);
    }

    // If backup has siteContent, restore it
    if (payload.siteContent && typeof payload.siteContent === 'object') {
      await saveSiteContent(payload.siteContent);
    } else if (payload.brand && payload.packages && !payload.subscribers) {
      await saveSiteContent(payload);
    }

    return NextResponse.json({
      success: true,
      message: `Backup restored successfully into PostgreSQL & Disk (${restored.join(', ')}).`,
      timestamp: new Date().toISOString(),
    }, { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
