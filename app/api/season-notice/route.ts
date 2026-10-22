import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { readOffseason } from '@/lib/season/schedule-window';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    const offseason = await readOffseason(pool, new Date());
    return NextResponse.json({ offseason }, { headers });
  } catch {
    return NextResponse.json({ offseason: false }, { status: 200, headers });
  }
}
