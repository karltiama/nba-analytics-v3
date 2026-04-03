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
      `SELECT ppc.player_id,
              COALESCE(NULLIF(TRIM(ppc.player_name), ''), p.full_name) AS player_name,
              ppc.prop_type, ppc.line_value, ppc.over_odds, ppc.under_odds, ppc.vendor
       FROM analytics.player_prop_current ppc
       LEFT JOIN analytics.players p ON p.player_id = ppc.player_id
       WHERE ppc.game_id = $1 AND ppc.vendor = $2
       ORDER BY COALESCE(NULLIF(TRIM(ppc.player_name), ''), p.full_name) NULLS LAST, ppc.prop_type, ppc.line_value`,
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
