import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The customer's approximate location, looked up from the public IP.
 *
 * When the lookup fails the honest answer is "unknown" — the previous code
 * answered with a fixed address in Dhaka and reported success, so a customer
 * from anywhere in the world was shown a made-up location.
 */
export async function GET(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const clientIp = (forwardedFor ? forwardedFor.split(',')[0].trim() : realIp) || '';

  try {
    const apiUrl = 'http://ip-api.com/json/';
    const res = await fetch(apiUrl, { cache: 'no-store' });
    const data = await res.json();

    if (data && data.status === 'success') {
      return NextResponse.json({
        success: true,
        city: data.city || '',
        postalCode: data.zip || '',
        state: data.regionName || '',
        country: data.country || '',
        ip: data.query || clientIp || '',
        isp: data.isp || ''
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: 'The location lookup did not answer. The address has to be entered manually.',
        city: '',
        postalCode: '',
        state: '',
        country: '',
        ip: clientIp,
        isp: ''
      },
      { status: 502 },
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        success: false,
        error: 'The location service could not be reached. The address has to be entered manually.',
        city: '',
        postalCode: '',
        state: '',
        country: '',
        ip: clientIp,
        isp: ''
      },
      { status: 502 },
    );
  }
}
