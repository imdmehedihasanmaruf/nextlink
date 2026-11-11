import { NextResponse } from 'next/server';
import { getSiteContent, saveSiteContent, saveAdminSection, getAdminStore } from '@/lib/db';
import { requireAdmin, hasRolePermission } from '@/lib/requireAdmin';
import type { Package } from '@/lib/mockData';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The origins allowed to call the content API. The site content is public, so
 * GET is open — the writes are not.
 */
const ALLOWED_ORIGINS = (process.env.ADMIN_CORS_ORIGINS ||
  'http://localhost:8000,http://localhost:8001,http://localhost:3000').split(',');

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin',
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
  const auth = await requireAdmin(request, 'cms');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401, headers: corsHeaders });
  }

  try {
    const body = await request.json();

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { error: 'The content payload must be an object.' },
        { status: 400, headers: corsHeaders },
      );
    }

    // The CMS save also rewrites the storefront package catalogue. Editing
    // that portion requires the packages permission, not only the CMS one.
    if (Array.isArray(body.packages) && body.packages.length > 0
      && !(await hasRolePermission(auth.principal!.role, 'packages'))) {
      return NextResponse.json(
        { error: 'Your role does not have permission to edit the package catalogue.' },
        { status: 403, headers: corsHeaders },
      );
    }

    await saveSiteContent(body);

    // If body contains a packages array, also sync to packages in DB.
    //
    // Every existing package is spread first and the incoming fields are
    // applied on top. The previous version returned only seven fields, which
    // dropped popular, category, targetCustomer, badge, bdixSpeed, the
    // feature flags and the description of every plan and re-wrote the
    // catalogue with those seven.
    if (Array.isArray(body.packages) && body.packages.length > 0) {
      try {
        const adminStore = await getAdminStore();
        const existingPackages: Package[] = Array.isArray(adminStore.packages)
          ? adminStore.packages
          : [];
        const existingMap = new Map<string, Package>(
          existingPackages.map((p) => [String(p.id), p]),
        );

        const updatedPackages = (body.packages as any[]).map((p) => {
          const prev = existingMap.get(String(p.id));
          return {
            ...(prev || {}),
            ...p,
            id: p.id ?? prev?.id,
            name: p.name ?? prev?.name,
            downloadSpeed: p.speed ?? p.downloadSpeed ?? prev?.downloadSpeed ?? 50,
            uploadSpeed: p.uploadSpeed ?? p.speed ?? prev?.uploadSpeed ?? 50,
            price: Number(p.price ?? prev?.price ?? 0),
            duration: prev?.duration ?? 30,
            description: p.description ?? prev?.description ?? 'Fiber Package',
            subscriberCount: prev?.subscriberCount ?? 0,
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
