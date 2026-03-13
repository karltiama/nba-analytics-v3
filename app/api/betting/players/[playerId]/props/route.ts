import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/betting/players/[playerId]/props
 *
 * Returns current player props for the player from analytics.player_props_current.
 * Optional ?game_id=... to limit to one game.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ playerId: string }> }
) {
  try {
    const { playerId } = await params;
    const playerIdNum = parseInt(playerId, 10);
    if (Number.isNaN(playerIdNum)) {
      return NextResponse.json({ props: [] });
    }

    const { searchParams } = new URL(request.url);
    const gameIdParam = searchParams.get('game_id');
    const gameIdNum = gameIdParam != null ? parseInt(gameIdParam, 10) : null;
    const hasValidGameId = gameIdNum != null && !Number.isNaN(gameIdNum);

    const rows = await query<{
      game_id: number;
      player_id: number;
      player_name: string | null;
      sportsbook: string | null;
      prop_type: string | null;
      market_type: string | null;
      side: string | null;
      line_value: number | null;
      odds_american: number | null;
      odds_decimal: number | null;
      implied_probability: number | null;
      snapshot_at: string;
    }>(
      hasValidGameId
        ? `SELECT game_id, player_id, player_name, sportsbook, prop_type, market_type, side, line_value,
                odds_american, odds_decimal, implied_probability, snapshot_at
           FROM analytics.player_props_current
           WHERE player_id = $1 AND game_id = $2
           ORDER BY prop_type, side, line_value NULLS LAST, sportsbook`
        : `SELECT game_id, player_id, player_name, sportsbook, prop_type, market_type, side, line_value,
                odds_american, odds_decimal, implied_probability, snapshot_at
           FROM analytics.player_props_current
           WHERE player_id = $1
           ORDER BY prop_type, side, line_value NULLS LAST, sportsbook`,
      hasValidGameId ? [playerIdNum, gameIdNum] : [playerIdNum]
    );

    const props = rows.map((r) => ({
      gameId: r.game_id,
      playerId: r.player_id,
      playerName: r.player_name ?? null,
      sportsbook: r.sportsbook ?? null,
      propType: r.prop_type ?? null,
      marketType: r.market_type ?? null,
      side: r.side ?? null,
      lineValue: r.line_value != null ? Number(r.line_value) : null,
      oddsAmerican: r.odds_american ?? null,
      oddsDecimal: r.odds_decimal != null ? Number(r.odds_decimal) : null,
      impliedProbability: r.implied_probability != null ? Number(r.implied_probability) : null,
      snapshotAt: r.snapshot_at,
    }));

    return NextResponse.json({ props });
  } catch (error: unknown) {
    console.error('Error fetching player props:', error);
    return NextResponse.json(
      { error: 'Failed to fetch player props', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
