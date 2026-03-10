import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

const PREFERRED_VENDOR = 'draftkings';

/**
 * GET /api/betting/games/[gameId]/player-props
 *
 * Returns current player props for the game from analytics.player_prop_current.
 * Uses a single preferred vendor to avoid duplicate lines.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await params;

    const rows = await query<{
      player_id: string;
      player_name: string | null;
      prop_type: string;
      line_value: number;
      over_odds: number | null;
      under_odds: number | null;
      vendor: string;
    }>(
      `SELECT player_id, player_name, prop_type, line_value, over_odds, under_odds, vendor
       FROM analytics.player_prop_current
       WHERE game_id = $1 AND vendor = $2
       ORDER BY player_name NULLS LAST, prop_type, line_value`,
      [gameId, PREFERRED_VENDOR]
    );

    const playerProps = rows.map((r) => ({
      playerId: r.player_id,
      playerName: r.player_name ?? 'Unknown',
      propType: r.prop_type,
      lineValue: Number(r.line_value),
      overOdds: r.over_odds,
      underOdds: r.under_odds,
      vendor: r.vendor,
    }));

    return NextResponse.json({ playerProps });
  } catch (error: unknown) {
    console.error('Error fetching player props:', error);
    return NextResponse.json(
      { error: 'Failed to fetch player props', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
