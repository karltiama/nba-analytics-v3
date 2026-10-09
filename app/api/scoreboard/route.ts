import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { serveScoreboard } from '@/lib/scoreboard/serve';
import { createPgScoreboardStore } from '@/lib/scoreboard/store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const result = await serveScoreboard({
    env: process.env,
    params: request.nextUrl.searchParams,
    now: new Date(),
    store: () => createPgScoreboardStore(pool),
  });
  return NextResponse.json(result.body, { status: result.status, headers: result.headers });
}
