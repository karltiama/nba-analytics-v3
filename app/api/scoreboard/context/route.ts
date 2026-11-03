import { NextResponse, type NextRequest } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { serveCardContext } from '@/lib/scoreboard/card-context/serve';
import { createPgScoreboardStore } from '@/lib/scoreboard/store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireBettingAuth(request);
  if (!auth.ok) return auth.response;

  const result = await serveCardContext({
    env: process.env,
    params: request.nextUrl.searchParams,
    now: new Date(),
    loadGames: async (date) => {
      const { default: pool } = await import('@/lib/db');
      return createPgScoreboardStore(pool).loadGamesForDate(date);
    },
    query: async (text, params) => {
      const { default: pool } = await import('@/lib/db');
      const queried = await pool.query(text, params);
      return queried.rows as Record<string, unknown>[];
    },
  });

  return auth.withAuthCookies(
    NextResponse.json(result.body, { status: result.status, headers: result.headers })
  );
}
