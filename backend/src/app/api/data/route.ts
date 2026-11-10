import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { defaultRoles } from '@/lib/roles';
import { getAdminStore, saveAdminSection, saveSiteContent, getSiteContent } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(request: Request) {
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
  try {
    const body = await request.json();

    // Partial update or full update
    if (body.type && body.data !== undefined) {
      await saveAdminSection(body.type, body.data);

      // If packages were updated, sync to siteData for frontend
      if (body.type === 'packages' && Array.isArray(body.data)) {
        try {
          const siteData = await getSiteContent();
          siteData.packages = body.data.map((p: any) => ({
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
          }));
          await saveSiteContent(siteData);
        } catch (e) {
          console.error('Error syncing packages to siteData:', e);
        }
      }

      // Sync the 5 dashboard card features to siteData for instant frontend live reflection
      if (['referralRewards', 'boostBandwidth', 'liveLatency', 'interfaceTraffic', 'peeringHubs'].includes(body.type)) {
        try {
          const siteData = await getSiteContent();
          siteData[body.type] = body.data;
          await saveSiteContent(siteData);
        } catch (e) {
          console.error(`Error syncing ${body.type} to siteData:`, e);
        }
      }
    } else {
      // Full object update
      for (const [key, val] of Object.entries(body)) {
        if (key !== 'demoMode' && key !== 'lastUpdated') {
          await saveAdminSection(key, val);
        }
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
