import { NextResponse } from 'next/server';
import { defaultRoles } from '@/lib/roles';
import { getAdminStore, saveAdminSection, saveSiteContent, getSiteContent } from '@/lib/db';
import { requireAdmin } from '@/lib/requireAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The origins allowed to call the admin API. The panel talks to this route
 * same-origin, so this is only a safety net — it must never be '*'.
 */
const ALLOWED_ORIGINS = (process.env.ADMIN_CORS_ORIGINS ||
  'http://localhost:8000,http://localhost:8001,http://localhost:3000').split(',');

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

/**
 * The collections the admin panel is allowed to write through this route.
 * Anything else is rejected — the previous version wrote any arbitrary key
 * into `app_settings`, including `siteData`.
 */
const COLLECTION_TYPES = new Set([
  'packages',
  'subscribers',
  'invoices',
  'tickets',
  'technicians',
  'roles',
  'adminUsers',
]);

const SETTINGS_TYPES = new Set([
  'referralRewards',
  'boostBandwidth',
  'liveLatency',
  'interfaceTraffic',
  'peeringHubs',
]);

const ALLOWED_TYPES = new Set([...COLLECTION_TYPES, ...SETTINGS_TYPES]);

/** A hard cap so a broken client cannot write an unbounded payload. */
const MAX_ITEMS = 5_000;

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401, headers: corsHeaders });
  }

  try {
    const current = await getAdminStore();

    // Ensure roles array exists
    if (!current.roles || current.roles.length === 0) {
      current.roles = defaultRoles;
    }

    // Remove any legacy demoMode field
    delete current.demoMode;

    return NextResponse.json(current, { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401, headers: corsHeaders });
  }

  try {
    const body = await request.json();

    // Partial update or full update
    if (body.type && body.data !== undefined) {
      const type = String(body.type);
      const data = body.data;

      if (!ALLOWED_TYPES.has(type)) {
        return NextResponse.json(
          { error: `The collection "${type}" is not writable through this route.` },
          { status: 400, headers: corsHeaders },
        );
      }

      if (COLLECTION_TYPES.has(type)) {
        if (!Array.isArray(data)) {
          return NextResponse.json(
            { error: `The collection "${type}" expects an array payload.` },
            { status: 400, headers: corsHeaders },
          );
        }
        if (data.length > MAX_ITEMS) {
          return NextResponse.json(
            { error: `The collection "${type}" exceeds the ${MAX_ITEMS}-row limit.` },
            { status: 413, headers: corsHeaders },
          );
        }
        // An empty array is almost always a failed load being saved back. The
        // caller must opt in explicitly or the table would be wiped.
        if (
          data.length === 0 &&
          !body.allowEmpty &&
          ['subscribers', 'invoices', 'packages'].includes(type)
        ) {
          return NextResponse.json(
            {
              error: `Saving an empty "${type}" collection was refused. If this is intentional, pass allowEmpty: true.`,
            },
            { status: 400, headers: corsHeaders },
          );
        }
      }

      await saveAdminSection(type, data);

      // If packages were updated, sync to siteData for frontend. Each package
      // is merged into the existing catalogue so the flags (bdixSpeed,
      // features, ddosProtection, …) are preserved.
      if (type === 'packages' && Array.isArray(data)) {
        try {
          const siteData = await getSiteContent();
          const existing: any[] = Array.isArray(siteData.packages) ? siteData.packages : [];
          siteData.packages = data.map((p: any) => {
            const previous =
              existing.find((item) => String(item.id) === String(p.id)) ||
              existing.find(
                (item) => String(item.name || '').toLowerCase() === String(p.name || '').toLowerCase(),
              ) ||
              {};
            return {
              ...previous,
              ...p,
              id: p.id,
              name: p.name,
              speed: p.downloadSpeed || p.speed || previous.speed || 100,
              uploadSpeed:
                p.uploadSpeed || p.downloadSpeed || p.speed || previous.uploadSpeed || 100,
              price: Number(p.price ?? previous.price ?? 0),
              bdixSpeed:
                previous.bdixSpeed ??
                ((p.downloadSpeed || p.speed || 100) >= 1000 ? 5000 : 1000),
              features: Array.isArray(p.features)
                ? p.features
                : previous.features ??
                  [
                    `${p.downloadSpeed || p.speed || 100} Mbps Symmetrical Fiber`,
                    'Unlimited Global Bandwidth',
                    '24/7 Dedicated Support',
                  ],
            };
          });
          await saveSiteContent(siteData);
        } catch (e) {
          console.error('Error syncing packages to siteData:', e);
        }
      }

      // Sync the 5 dashboard card features to siteData for instant frontend live reflection
      if (SETTINGS_TYPES.has(type)) {
        try {
          const siteData = await getSiteContent();
          siteData[type] = data;
          await saveSiteContent(siteData);
        } catch (e) {
          console.error(`Error syncing ${type} to siteData:`, e);
        }
      }
    } else {
      // Full object update — the same whitelist applies per key.
      for (const [key, val] of Object.entries(body || {})) {
        if (key === 'demoMode' || key === 'lastUpdated' || key === 'allowEmpty') continue;
        if (!ALLOWED_TYPES.has(key)) continue;
        await saveAdminSection(key, val);
      }
    }

    const updatedStore = await getAdminStore();
    return NextResponse.json(
      { success: true, message: 'Saved successfully to PostgreSQL & Disk', data: updatedStore },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
