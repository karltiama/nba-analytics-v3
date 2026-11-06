import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { loadTeammatesOut } from '@/lib/betting/teammates-out';
import { query, queryOne } from '@/lib/db';
import { isWorkspaceCurrentAnalysisEnabled } from '@/lib/parlay/workspace-current-analysis-flag';
import { WORKSPACE_CURRENT_MAX_GAMES } from '@/lib/parlay/workspace-analysis';
import {
  WORKSPACE_CURRENT_MAX_PLAYERS,
  buildWorkspaceCurrentReplays,
  type PlayerInjuryRow,
  type WorkspaceCurrentGamesRequest,
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

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function parseGame(raw: unknown): { gameId: string; playerIds: string[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const { gameId, playerIds } = raw as { gameId?: unknown; playerIds?: unknown };
  if (typeof gameId !== 'string' || !ID.test(gameId.trim())) return null;
  if (!Array.isArray(playerIds) || playerIds.length === 0) return null;
  const ids = playerIds.map((id) => (typeof id === 'string' ? id.trim() : ''));
  if (ids.some((id) => !ID.test(id))) return null;
  return { gameId: gameId.trim(), playerIds: ids };
}

/** `{ games: [{ gameId, playerIds }] }`, or the older single-game `{ gameId, playerIds }`. */
function parseBody(body: unknown): WorkspaceCurrentGamesRequest | null {
  if (!body || typeof body !== 'object') return null;
  const rawGames = 'games' in body ? (body as { games: unknown }).games : [body];
  if (!Array.isArray(rawGames) || rawGames.length === 0 || rawGames.length > WORKSPACE_CURRENT_MAX_GAMES) return null;
  const games = rawGames.map(parseGame);
  if (games.some((game) => game == null)) return null;
  const parsed = games as { gameId: string; playerIds: string[] }[];
  if (new Set(parsed.map((game) => game.gameId)).size !== parsed.length) return null;
  const totalPlayers = parsed.reduce((sum, game) => sum + game.playerIds.length, 0);
  if (totalPlayers > WORKSPACE_CURRENT_MAX_PLAYERS) return null;
  return { games: parsed };
}

/**
 * POST /api/parlay-workspace/context
 * Replay context + deps per game for current props, built from the DB as of now.
 * Response: `{ replays: [{ context, deps }] }`, one per requested game, in request order.
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
    const result = await buildWorkspaceCurrentReplays(input, {
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
    return gate.withAuthCookies(NextResponse.json({ replays: result.replays }, { headers: { 'Cache-Control': 'no-store' } }));
  } catch (error) {
    console.error('[parlay-workspace] context', error instanceof Error ? error.message : 'unknown');
    return gate.withAuthCookies(NextResponse.json({ error: 'Context unavailable' }, { status: 500 }));
  }
}
