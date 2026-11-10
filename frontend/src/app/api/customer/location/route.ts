import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const forwardedFor = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    let clientIp = (forwardedFor ? forwardedFor.split(',')[0].trim() : realIp) || '';

    let apiUrl = 'http://ip-api.com/json/';
    if (clientIp && !clientIp.startsWith('127.') && !clientIp.startsWith('192.168.') && !clientIp.startsWith('10.') && clientIp !== '::1') {
      apiUrl = `http://ip-api.com/json/${clientIp}`;
    }

    const res = await fetch(apiUrl, { cache: 'no-store' });
    const data = await res.json();

    if (data && data.status === 'success') {
      return NextResponse.json({
        success: true,
        city: data.city || 'Azimpur',
        postalCode: data.zip || '1205',
        state: data.regionName || 'Dhaka Division',
        country: data.country || 'Bangladesh',
        ip: data.query || clientIp || '103.88.24.167',
        isp: data.isp || 'NextLink Optical Fiber'
      });
    }

    return NextResponse.json({
      success: true,
      city: 'Azimpur',
      postalCode: '1205',
      state: 'Dhaka Division',
      country: 'Bangladesh',
      ip: '103.88.24.167',
      isp: 'NextLink Optical Fiber'
    });
  } catch (e: any) {
    return NextResponse.json({
      success: true,
      city: 'Azimpur',
      postalCode: '1205',
      state: 'Dhaka Division',
      country: 'Bangladesh',
      ip: '103.88.24.167',
      isp: 'NextLink Optical Fiber'
    });
  }
}

