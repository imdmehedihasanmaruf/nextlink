import { NextResponse } from 'next/server';
import { getAdminStore, saveAdminSection } from '@/lib/db';
import { Subscriber } from '@/lib/mockData';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET() {
  try {
    const store = await getAdminStore();
    return NextResponse.json({
      success: true,
      users: store.subscribers || [],
    }, { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const store = await getAdminStore();
    const subscribers: Subscriber[] = store.subscribers || [];

    const newSub: Subscriber = {
      id: body.id || `NL-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      name: body.name || 'Subscriber User',
      username: body.username || (body.email ? body.email.split('@')[0] : `user_${Date.now()}`),
      phone: body.phone || '01700000000',
      email: body.email || 'user@example.com',
      password: body.password || 'NextLink@2026',
      address: body.address || 'Dhaka Metro Fiber Loop',
      zone: body.zone || 'Dhaka Metro',
      packageId: body.packageId || 'pkg-gigabit',
      packageName: body.packageName || body.package || 'Gigabit Fiber',
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
    };

    const updated = [newSub, ...subscribers];
    await saveAdminSection('subscribers', updated);

    return NextResponse.json({ success: true, user: newSub, message: 'User created' }, { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders });
  }
}

export async function PUT(request: Request) {
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
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'User ID is required' }, { status: 400, headers: corsHeaders });
    }

    const store = await getAdminStore();
    const subscribers: Subscriber[] = store.subscribers || [];

    const filtered = subscribers.filter(s => s.id !== id);
    await saveAdminSection('subscribers', filtered);

    return NextResponse.json({
      success: true,
      message: 'User deleted permanently',
    }, { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders });
  }
}

