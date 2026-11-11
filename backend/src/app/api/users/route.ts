import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAdminStore, saveAdminSection } from '@/lib/db';
import { Subscriber } from '@/lib/mockData';
import { requireAdmin } from '@/lib/requireAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALLOWED_ORIGINS = (process.env.ADMIN_CORS_ORIGINS ||
  'http://localhost:8000,http://localhost:8001,http://localhost:3000').split(',');

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: 401, headers: corsHeaders });
  }

  try {
    const store = await getAdminStore();
    // Credentials never leave this route.
    const users = (store.subscribers || []).map(({ password, ...rest }: any) => rest);
    return NextResponse.json({
      success: true,
      users,
    }, { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: 401, headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const store = await getAdminStore();
    const subscribers: Subscriber[] = store.subscribers || [];

    // The password is random and shown to the operator once — the previous
    // 'NextLink@2026' default was public knowledge.
    const generatedPassword = body.password || crypto.randomBytes(9).toString('base64url');

    const newSub: Subscriber = {
      id: body.id || `NL-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      name: body.name || 'Subscriber User',
      username: body.username || (body.email ? body.email.split('@')[0] : `user_${crypto.randomBytes(4).toString('hex')}`),
      phone: body.phone || '01700000000',
      email: body.email || 'user@example.com',
      password: generatedPassword,
      address: body.address || 'Dhaka Metro Fiber Loop',
      zone: body.zone || 'Dhaka Metro',
      packageId: body.packageId || 'PKG-002',
      packageName: body.packageName || body.package || 'Standard 200M',
      status: body.status || 'active',
      dueDate: body.dueDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      joinDate: body.joinDate || new Date().toISOString().split('T')[0],
      connectionType: body.connectionType || 'Optical Fiber GPON',
      ipAddress: body.ipAddress || `103.147.218.${Math.floor(10 + Math.random() * 240)}`,
      macAddress: body.macAddress || 'AA:BB:CC:DD:EE:FF',
      balance: body.balance || 0,
      totalPaid: body.totalPaid || 0,
      isVpn: !!body.isVpn,
      vpnProvider: body.vpnProvider || (body.isVpn ? 'Proxy/VPN' : null),
      isSpam: !!body.isSpam,
      isScam: !!body.isScam,
      riskScore: body.riskScore || 'low',
      riskReason: body.riskReason || 'Clean Connection',
    } as Subscriber;

    const updated = [newSub, ...subscribers];
    await saveAdminSection('subscribers', updated);

    return NextResponse.json({
      success: true,
      user: newSub,
      temporaryPassword: generatedPassword,
      message: 'User created',
    }, { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders });
  }
}

export async function PUT(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: 401, headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'User ID is required' }, { status: 400, headers: corsHeaders });
    }

    const store = await getAdminStore();
    const subscribers: Subscriber[] = store.subscribers || [];

    const index = subscribers.findIndex(s => s.id === id);
    if (index === -1) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404, headers: corsHeaders });
    }

    subscribers[index] = {
      ...subscribers[index],
      ...updates,
    };

    await saveAdminSection('subscribers', subscribers);

    return NextResponse.json({
      success: true,
      message: 'User updated successfully',
      user: subscribers[index],
    }, { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: 401, headers: corsHeaders });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'User ID is required' }, { status: 400, headers: corsHeaders });
    }

    const store = await getAdminStore();
    const subscribers: Subscriber[] = store.subscribers || [];

    // The customer is removed from the store. The billing account is NOT
    // deleted — the invoice history has to survive the account.
    const filtered = subscribers.filter(s => s.id !== id);
    await saveAdminSection('subscribers', filtered);

    return NextResponse.json({
      success: true,
      message: 'User removed from the subscriber list. The billing history is kept.',
    }, { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders });
  }
}
