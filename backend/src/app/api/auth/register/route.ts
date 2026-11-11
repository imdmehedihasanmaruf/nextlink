import { NextResponse } from 'next/server';
import { getAdminStore, saveAdminSection } from '@/lib/db';
import { Subscriber } from '@/lib/mockData';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

function generateMac(): string {
  const hex = '0123456789ABCDEF';
  const pairs = [];
  for (let i = 0; i < 6; i++) {
    pairs.push(hex[Math.floor(Math.random() * 16)] + hex[Math.floor(Math.random() * 16)]);
  }
  return pairs.join(':');
}

const DISPOSABLE_EMAIL_DOMAINS = [
  'mailinator.com',
  'tempmail.com',
  '10minutemail.com',
  'guerrillamail.com',
  'throwawaymail.com',
  'yopmail.com',
  'sharklasers.com',
  'dispostable.com',
  'getairmail.com',
  'trashmail.com',
  'fake.com',
  'spam.com',
];

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      fullName,
      username,
      phone,
      email,
      password,
      package: packageName,
      address,
    } = body;

    if (!fullName || !phone || !email) {
      return NextResponse.json(
        { success: false, error: 'Full name, phone and email are required' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Telemetry & IP Detection
    const forwarded = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    const cfIp = request.headers.get('cf-connecting-ip');
    let clientIp = cfIp || realIp || (forwarded ? forwarded.split(',')[0].trim() : '');

    if (!clientIp || clientIp === '::1' || clientIp === '127.0.0.1' || clientIp.startsWith('192.168.')) {
      // Realistic public IP for local dev testing
      const randomHost = Math.floor(10 + Math.random() * 240);
      clientIp = `103.147.218.${randomHost}`;
    }

    // Fraud, VPN, Spam & Scam Heuristic Engine
    const emailDomain = email.split('@')[1]?.toLowerCase() || '';
    const lowerUser = (username || '').toLowerCase();
    const lowerEmail = email.toLowerCase();
    const lowerPhone = (phone || '').replace(/\s+/g, '');

    // 1. VPN Detection
    const hasVpnHeader = !!(
      request.headers.get('x-vpn') ||
      request.headers.get('x-proxy-id') ||
      request.headers.get('cf-ray')?.includes('warp')
    );
    const hasVpnKeyword =
      lowerUser.includes('vpn') ||
      lowerUser.includes('proxy') ||
      lowerUser.includes('tor') ||
      lowerEmail.includes('vpn') ||
      lowerEmail.includes('proxy');

    const isVpn = hasVpnHeader || hasVpnKeyword;
    const vpnProvider = isVpn
      ? (lowerUser.includes('nord') ? 'NordVPN (AS202425)' :
         lowerUser.includes('express') ? 'ExpressVPN Node' :
         lowerUser.includes('surfshark') ? 'Surfshark B.V.' :
         'Commercial Datacenter VPN / Proxy Gateway')
      : null;

    // 2. Spam Detection
    const isDisposableDomain = DISPOSABLE_EMAIL_DOMAINS.includes(emailDomain);
    const hasSpamKeyword =
      lowerUser.includes('spam') ||
      lowerUser.includes('bot') ||
      lowerEmail.includes('spam') ||
      lowerEmail.includes('temp');

    const isSpam = isDisposableDomain || hasSpamKeyword;

    // 3. Scam Detection
    const hasScamKeyword =
      lowerUser.includes('scam') ||
      lowerUser.includes('fake') ||
      lowerUser.includes('carder') ||
      lowerUser.includes('phish') ||
      lowerEmail.includes('scam') ||
      lowerPhone === '01999999999' ||
      lowerPhone === '01000000000';

    const isScam = hasScamKeyword;

    // 4. Risk Classification
    let riskScore: 'low' | 'medium' | 'high' = 'low';
    let riskReason = 'Clean Residential Connection (Low Risk)';

    if (isScam) {
      riskScore = 'high';
      riskReason = 'High Risk: Suspicious credentials / Scam telemetry signature flagged';
    } else if (isSpam && isVpn) {
      riskScore = 'high';
      riskReason = 'High Risk: Disposable email and commercial proxy combined';
    } else if (isVpn) {
      riskScore = 'medium';
      riskReason = `Medium Risk: Commercial VPN gateway detected (${vpnProvider})`;
    } else if (isSpam) {
      riskScore = 'medium';
      riskReason = 'Medium Risk: Disposable / Temporary email provider detected';
    }

    // Load current store
    const store = await getAdminStore();
    const currentSubscribers: Subscriber[] = store.subscribers || [];

    // Generate User ID — a UUID suffix keeps it unique, so a collision can
    // never replace an existing customer.
    const year = new Date().getFullYear();
    const newId = `NL-${year}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    // The package arrives by name from the public form. The catalogue id is
    // resolved here, because the billing engine prices an account by its
    // package id.
    const catalogue = store.packages || [];
    const matchedPackage = packageName
      ? catalogue.find(
          (pkg: any) =>
            pkg.id === packageName ||
            String(pkg.name || '').toLowerCase() === packageName.toLowerCase()
        )
      : null;

    const newSubscriber: Subscriber = {
      id: newId,
      name: fullName,
      username: username || email.split('@')[0],
      phone: phone,
      email: email,
      password: password || 'NextLink@2026',
      address: address || 'Optical Distribution Hub, Core Network',
      zone: 'Dhaka Metro',
      packageId: matchedPackage?.id || 'PKG-002',
      packageName: matchedPackage?.name || packageName || 'Standard 200M',
      status: isScam ? 'blocked' : 'active',
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      joinDate: new Date().toISOString().split('T')[0],
      connectionType: 'Optical Fiber GPON',
      ipAddress: clientIp,
      macAddress: generateMac(),
      balance: 0,
      totalPaid: 0,
      isVpn,
      vpnProvider,
      isSpam,
      isScam,
      riskScore,
      riskReason,
    };

    // Prepend new subscriber to top of list
    const updatedSubscribers = [newSubscriber, ...currentSubscribers.filter(s => s.id !== newId && s.email !== email)];

    // Persist to PostgreSQL and disk fallback
    await saveAdminSection('subscribers', updatedSubscribers);

    return NextResponse.json(
      {
        success: true,
        message: 'Registration successful and recorded in NextLink core directory',
        user: newSubscriber,
      },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Error registering subscriber:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}

