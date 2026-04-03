import { NextRequest, NextResponse } from 'next/server';
import {
  resolveAnalyticsPlayerId,
  getAnalyticsPlayerInfo,
  getAnalyticsPlayerSeasonStats,
  getAnalyticsPlayerGames,
} from '@/lib/players/analytics-queries';
import type { GameLog, PlayerProfile, SeasonAverages } from '@/lib/players/types';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 40;

/**
 * GET /api/betting/players/[playerId]/game-log-preview
 * Recent games + season averages for Props Explorer sidebar (client fetch).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ playerId: string }> }
) {
  try {
    const { playerId } = await params;
    if (!playerId?.trim()) {
      return NextResponse.json({ error: 'Missing playerId' }, { status: 400 });
    }

    const sp = request.nextUrl.searchParams;
    const season = sp.get('season')?.trim() || null;
    let limit = parseInt(sp.get('limit') || String(DEFAULT_LIMIT), 10);
    if (Number.isNaN(limit)) limit = DEFAULT_LIMIT;
    limit = Math.min(Math.max(limit, 1), MAX_LIMIT);

    const resolvedId = await resolveAnalyticsPlayerId(playerId.trim());
    if (!resolvedId) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }

    const [player, seasonAverages, gamesData] = await Promise.all([
      getAnalyticsPlayerInfo(resolvedId),
      getAnalyticsPlayerSeasonStats(resolvedId, season),
      getAnalyticsPlayerGames(resolvedId, season, limit),
    ]);

    if (!player) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }

    return NextResponse.json({
      player: player as PlayerProfile,
      seasonAverages: seasonAverages as SeasonAverages,
      games: (gamesData.games ?? []) as GameLog[],
      resolvedPlayerId: resolvedId,
    });
  } catch (error: unknown) {
    console.error('game-log-preview:', error);
    return NextResponse.json(
      {
        error: 'Failed to load preview',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
