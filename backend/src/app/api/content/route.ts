import { NextResponse } from 'next/server';
import { getSiteContent, saveSiteContent, saveAdminSection, getAdminStore } from '@/lib/db';
import type { Package } from '@/lib/mockData';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ContentPackageInput {
  id: string;
  name: string;
  speed?: number;
  downloadSpeed?: number;
  uploadSpeed?: number;
  price: number;
  bdixSpeed?: number;
  popular?: boolean;
  features?: string[];
  duration?: number;
  description?: string;
  subscriberCount?: number;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET() {
  try {
    const json = await getSiteContent();
    return NextResponse.json(json, { headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    await saveSiteContent(body);

    // If body contains packages array, also sync to packages in DB
    if (Array.isArray(body.packages) && body.packages.length > 0) {
      try {
        const adminStore = await getAdminStore();
        const existingPackages: Package[] = Array.isArray(adminStore.packages) ? adminStore.packages : [];
        const existingMap = new Map<string, Package>(existingPackages.map((p) => [p.id, p]));

        const updatedPackages: Package[] = (body.packages as ContentPackageInput[]).map((p) => {
          const prev = existingMap.get(p.id);
          return {
            id: p.id,
            name: p.name,
            downloadSpeed: p.speed || p.downloadSpeed || 50,
            uploadSpeed: p.uploadSpeed || p.speed || 50,
            price: p.price,
            duration: prev?.duration || 30,
            description: (p.features && p.features[0]) || prev?.description || 'Fiber Package',
            subscriberCount: prev?.subscriberCount || 0,
          };
        });

        await saveAdminSection('packages', updatedPackages);
      } catch (e) {
        console.error('Error syncing content packages to admin packages:', e);
      }
    }

    return NextResponse.json({ success: true, message: 'Content updated successfully in PostgreSQL', data: body }, { headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}

export async function PUT(request: Request) {
  return POST(request);
}
