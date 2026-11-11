import { NextResponse } from 'next/server';
import { getAdminStore, saveAdminSection, getDbPool } from '@/lib/db';
import { Subscriber } from '@/lib/mockData';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

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
  return Array.from({ length: 6 }, () =>
    crypto.randomBytes(1).toString('hex').toUpperCase().padStart(2, '0'),
  ).join(':');
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

    // The server enforces the same rule as the form: a password with at least
    // six characters. A weaker account must never be created.
    const passwordValue = String(password || '');
    if (passwordValue.length < 6) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 6 characters' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Telemetry & IP Detection
    const forwarded = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    const cfIp = request.headers.get('cf-connecting-ip');
    let clientIp = cfIp || realIp || (forwarded ? forwarded.split(',')[0].trim() : '');

    if (!clientIp || clientIp === '::1' || clientIp === '127.0.0.1' || clientIp.startsWith('192.168.')) {
      if (process.env.NODE_ENV === 'production') {
        // A fabricated address in production is a false record — keep what the
        // request actually reported.
        clientIp = clientIp || '';
      } else {
        // Realistic public IP for local dev testing
        const randomHost = Math.floor(10 + Math.random() * 240);
        clientIp = `103.147.218.${randomHost}`;
      }
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

    // The password is hashed before it is stored anywhere. The hash lives in
    // subscriber_credentials — the table the billing API reads — so the new
    // customer can sign in at once. The plain password is never persisted.
    const usernameValue = username || email.split('@')[0];
    const passwordHash = await bcrypt.hash(passwordValue, 10);

    const newSubscriber: Subscriber = {
      id: newId,
      name: fullName,
      username: usernameValue,
      phone: phone,
      email: email,
      password: '',
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

    // The username and email must be unique before any record is created —
    // the registration fails with a clear reason instead of producing a
    // half-account that can never sign in.
    const pool = getDbPool();
    const usernameValueResolved = usernameValue;
    const clash = await pool.query(
      `SELECT 1 FROM subscriber_credentials WHERE LOWER(username) = LOWER($1)
       UNION
       SELECT 1 FROM subscribers WHERE LOWER(email) = LOWER($2)
       LIMIT 1`,
      [usernameValueResolved, email],
    );
    if (clash.rows.length > 0) {
      return NextResponse.json(
        { success: false, error: 'That username or email is already registered. Try signing in instead.' },
        { status: 409, headers: corsHeaders }
      );
    }

    // Prepend new subscriber to top of list
    const updatedSubscribers = [newSubscriber, ...currentSubscribers.filter(s => s.id !== newId && s.email !== email)];

    // Persist to PostgreSQL and disk fallback
    await saveAdminSection('subscribers', updatedSubscribers);

    // The credential lives in subscriber_credentials, hashed. The unique
    // index is the backstop for a race between two registrations at the same
    // time — the account fails with a clear reason rather than one quietly
    // replacing the other.
    try {
      await pool.query(
        `INSERT INTO subscriber_credentials
           (subscriber_id, username, password_hash, raw_data)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (subscriber_id) DO UPDATE SET
           username = EXCLUDED.username,
           password_hash = EXCLUDED.password_hash,
           updated_at = NOW()`,
        [newId, usernameValue, passwordHash, JSON.stringify({ source: 'registration' })],
      );
    } catch (credentialError: any) {
      // A unique-violation means a race lost to a concurrent registration —
      // the subscriber record was already written, so the account must be
      // removed again to avoid an orphan account that can never sign in.
      if (String(credentialError?.code || '') === '23505') {
        // The subscriber row and the JSON mirror entry both have to go —
        // otherwise the mirror would resurrect the account on restore.
        try {
          await getDbPool().query('DELETE FROM subscribers WHERE id = $1', [newId]);
        } catch (rollbackError) {
          console.error('Could not delete the raced account from the database:', rollbackError);
        }
        try {
          const fs = require('fs');
          const path = require('path');
          const dataDir = fs.existsSync(path.join(process.cwd(), 'data'))
            ? path.join(process.cwd(), 'data')
            : path.join(process.cwd(), '..', 'data');
          const storePath = path.join(dataDir, 'adminStore.json');
          if (fs.existsSync(storePath)) {
            const disk = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
            disk.subscribers = (disk.subscribers || []).filter((s: any) => s.id !== newId);
            disk.lastUpdated = new Date().toISOString();
            fs.writeFileSync(storePath, JSON.stringify(disk, null, 2), 'utf-8');
          }
        } catch (mirrorError) {
          console.error('Could not fix the JSON mirror after a username race:', mirrorError);
        }
        return NextResponse.json(
          { success: false, error: 'That username was just registered. Please choose another one.' },
          { status: 409, headers: corsHeaders }
        );
      }

      // The credential insert must not silently fail — the account would be
      // impossible to sign into. Surface the problem.
      console.error('Could not create the credential for the new subscriber:', credentialError);
      return NextResponse.json(
        {
          success: false,
          error: 'The account was created but the credential could not be stored. Please contact support.',
        },
        { status: 500, headers: corsHeaders }
      );
    }

    // The password never leaves this route in plain text or as a hash.
    const { password: _discarded, ...safeUser } = newSubscriber as any;

    return NextResponse.json(
      {
        success: true,
        message: 'Registration successful and recorded in NextLink core directory',
        user: safeUser,
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

