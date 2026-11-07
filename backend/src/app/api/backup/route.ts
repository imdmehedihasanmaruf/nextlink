import { NextResponse } from 'next/server';
import { getAdminStore, getSiteContent, saveAdminSection, saveSiteContent } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET() {
  try {
    const [siteContent, adminData] = await Promise.all([
      getSiteContent(),
      getAdminStore(),
    ]);

    const fullBackup = {
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      system: 'NextLink ISP Management (PostgreSQL)',
      siteContent,
      subscribers: adminData.subscribers || [],
      invoices: adminData.invoices || [],
      tickets: adminData.tickets || [],
      packages: adminData.packages || [],
      technicians: adminData.technicians || [],
      adminUsers: adminData.adminUsers || [],
      roles: adminData.roles || [],
      adminStore: adminData,
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
  try {
    const payload = await request.json();
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: 'Invalid backup file format' }, { status: 400, headers: corsHeaders });
    }

    // Restore adminStore data if present
    if (payload.adminStore && typeof payload.adminStore === 'object') {
      for (const [key, val] of Object.entries(payload.adminStore)) {
        if (key !== 'demoMode' && key !== 'lastUpdated') {
          await saveAdminSection(key, val);
        }
      }
    } else {
      const keys = ['packages', 'subscribers', 'invoices', 'tickets', 'technicians', 'adminUsers', 'roles'];
      for (const key of keys) {
        if (Array.isArray(payload[key])) {
          await saveAdminSection(key, payload[key]);
        }
      }
    }

    // If backup has siteContent, restore it
    if (payload.siteContent) {
      await saveSiteContent(payload.siteContent);
    } else if (payload.brand && payload.packages && !payload.subscribers) {
      await saveSiteContent(payload);
    }

    return NextResponse.json({
      success: true,
      message: 'Full backup restored successfully into PostgreSQL & Disk!',
      timestamp: new Date().toISOString(),
    }, { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
