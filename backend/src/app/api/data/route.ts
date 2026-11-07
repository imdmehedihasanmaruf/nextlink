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
