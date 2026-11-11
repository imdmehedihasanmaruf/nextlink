import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { deleteAdminRecord } from '@/lib/db';
import { requireAdmin, hasRolePermission } from '@/lib/requireAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALLOWED_ORIGINS = (process.env.ADMIN_CORS_ORIGINS ||
  'http://localhost:8000,http://localhost:8001,http://localhost:3000').split(',');

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin',
};

const DELETABLE = new Set(['technicians', 'roles', 'adminUsers']);

/** Technicians are managed with the technicians permission; roles and staff
 * accounts are governance, not directory management. */
const DELETE_PERMISSIONS: Record<string, string> = {
  technicians: 'technicians',
  roles: 'roles',
  adminUsers: 'roles',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401, headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const type = String(body?.type || '');
    const id = String(body?.id || '');

    if (!DELETABLE.has(type) || !id) {
      return NextResponse.json(
        { error: 'Only technicians, roles and admin user accounts can be deleted here.' },
        { status: 400, headers: corsHeaders },
      );
    }

    const permission = DELETE_PERMISSIONS[type];
    if (!(await hasRolePermission(auth.principal!.role, permission))) {
      return NextResponse.json(
        { error: `Your role does not have permission to delete ${type}.` },
        { status: 403, headers: corsHeaders },
      );
    }

    // The delete is a real row delete in PostgreSQL. It never touches the
    // billing or ticket tables.
    const deleted = await deleteAdminRecord(type as 'technicians' | 'roles' | 'adminUsers', id);
    if (!deleted) {
      return NextResponse.json(
        { error: 'The record was not found.' },
        { status: 404, headers: corsHeaders },
      );
    }

    // The JSON mirror is also updated so the record does not come back.
    const dataDir = fs.existsSync(path.join(process.cwd(), 'data'))
      ? path.join(process.cwd(), 'data')
      : path.join(process.cwd(), '..', 'data');
    const storePath = path.join(dataDir, 'adminStore.json');
    try {
      if (fs.existsSync(storePath)) {
        const disk = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
        if (Array.isArray(disk[type])) {
          disk[type] = disk[type].filter((item: any) => String(item.id) !== id);
          disk.lastUpdated = new Date().toISOString();
          fs.writeFileSync(storePath, JSON.stringify(disk, null, 2), 'utf-8');
        }
      }
    } catch {
      // The database is the source of truth — a mirror write failure is not fatal.
    }

    return NextResponse.json({ success: true, message: 'Record deleted' }, { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
