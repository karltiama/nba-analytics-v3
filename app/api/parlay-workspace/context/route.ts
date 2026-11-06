import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { loadTeammatesOut } from '@/lib/betting/teammates-out';
import { query, queryOne } from '@/lib/db';
import { isWorkspaceCurrentAnalysisEnabled } from '@/lib/parlay/workspace-current-analysis-flag';
import {
  WORKSPACE_CURRENT_MAX_PLAYERS,
  buildWorkspaceCurrentReplay,
  type PlayerInjuryRow,
} from '@/lib/parlay/workspace-current-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PLAYER_INJURY_SQL = `
  SELECT status, snapshot_at
    FROM analytics.player_injury_status_current
   WHERE player_id = $1
   ORDER BY snapshot_at DESC NULLS LAST
   LIMIT 1
`;

function parseBody(body: unknown): { gameId: string; playerIds: string[] } | null {
  if (!body || typeof body !== 'object') return null;
  const { gameId, playerIds } = body as { gameId?: unknown; playerIds?: unknown };
  if (typeof gameId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(gameId.trim())) return null;
  if (!Array.isArray(playerIds) || playerIds.length === 0 || playerIds.length > WORKSPACE_CURRENT_MAX_PLAYERS) {
    return null;
  }
  const ids = playerIds.map((id) => (typeof id === 'string' ? id.trim() : ''));
  if (ids.some((id) => !/^[A-Za-z0-9_-]{1,64}$/.test(id))) return null;
  return { gameId: gameId.trim(), playerIds: ids };
}

/**
 * POST /api/parlay-workspace/context
 * Replay context + deps for one game's current props, built from the DB as of now.
 * Outcome-free: prior games only, no projections, no market close. Off unless
 * PARLAY_WORKSPACE_CURRENT_ANALYSIS_ENABLED=1.
 */
export async function POST(request: NextRequest) {
  if (!isWorkspaceCurrentAnalysisEnabled(process.env)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const input = parseBody(body);
  if (!input) {
    return gate.withAuthCookies(NextResponse.json({ error: 'Invalid request' }, { status: 400 }));
  }

  try {
    const result = await buildWorkspaceCurrentReplay(input, {
      query: async <T,>(sql: string, params?: unknown[]) => (await query(sql, params)) as T[],
      loadTeammatesOut: (args) => loadTeammatesOut(args),
      loadPlayerInjury: async (playerId) => {
        const row = await queryOne<{ status: string | null; snapshot_at: string | Date | null }>(PLAYER_INJURY_SQL, [
          playerId,
        ]);
        return row ? ({ status: row.status, snapshotAt: row.snapshot_at } satisfies PlayerInjuryRow) : null;
      },
      env: process.env,
      now: new Date(),
    });
    if (!result.ok) {
      return gate.withAuthCookies(NextResponse.json({ error: result.code }, { status: 404 }));
    }
    return gate.withAuthCookies(NextResponse.json(result.replay, { headers: { 'Cache-Control': 'no-store' } }));
  } catch (error) {
    console.error('[parlay-workspace] context', error instanceof Error ? error.message : 'unknown');
    return gate.withAuthCookies(NextResponse.json({ error: 'Context unavailable' }, { status: 500 }));
  }
}
