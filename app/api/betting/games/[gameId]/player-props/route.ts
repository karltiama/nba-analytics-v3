import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

function preferredVendor(): string {
  return (
    process.env.PREFERRED_VENDOR?.trim() ||
    process.env.PLAYER_PROPS_PREFERRED_VENDOR?.trim() ||
    'draftkings'
  );
}

/**
 * GET /api/betting/games/[gameId]/player-props
 *
 * Aggregates over/under rows from analytics.player_props_current (BDL snapshot) for one
 * sportsbook (default DraftKings). Case-insensitive sportsbook match so props still load
 * if legacy player_prop_current was empty due to vendor string casing.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await params;
    const vendor = preferredVendor();

    const rows = await query<{
      player_id: string;
      player_name: string | null;
      prop_type: string;
      line_value: string | number;
      over_odds: number | null;
      under_odds: number | null;
    }>(
      `SELECT x.player_id,
              x.player_name,
              x.prop_type,
              x.line_value,
              x.over_odds,
              x.under_odds
       FROM (
         SELECT
           p.player_id::text AS player_id,
           COALESCE(NULLIF(TRIM(MAX(p.player_name)), ''), MAX(pl.full_name)) AS player_name,
           p.prop_type,
           p.line_value,
           MAX(CASE WHEN lower(p.side) = 'over' THEN p.odds_american END) AS over_odds,
           MAX(CASE WHEN lower(p.side) = 'under' THEN p.odds_american END) AS under_odds
         FROM analytics.player_props_current p
         LEFT JOIN analytics.players pl ON pl.player_id = p.player_id::text
         WHERE p.game_id::text = $1
           AND lower(trim(p.sportsbook)) = lower(trim($2))
           AND lower(coalesce(p.market_type, '')) = 'over_under'
         GROUP BY p.player_id, p.prop_type, p.line_value
       ) x
       ORDER BY x.player_name NULLS LAST, x.prop_type, x.line_value`,
      [gameId, vendor]
    );

    const playerProps = rows.map((r) => ({
      playerId: r.player_id,
      playerName: r.player_name ?? 'Unknown',
      propType: r.prop_type,
      lineValue: Number(r.line_value),
      overOdds: r.over_odds,
      underOdds: r.under_odds,
      vendor,
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
