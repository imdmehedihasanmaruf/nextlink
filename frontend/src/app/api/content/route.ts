import { NextResponse } from 'next/server';
import { getSiteContent } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const headers = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'Access-Control-Allow-Origin': '*',
};

export async function GET() {
  try {
    const json = await getSiteContent();
    return NextResponse.json(json, { headers });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500, headers });
  }
}
