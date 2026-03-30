import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * Settled-bet aggregates for paper trading Summary breakdowns.
 * EV buckets: unknown | neg | 0_2pct | 2_5pct | 5pct_plus (ev is decimal edge, same as stored column).
 */
export type PaperAnalyticsSegment = {
  key: string;
  count: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  stakeSum: number;
  profitSum: number;
};

type AggRow = {
  key: string;
  count: string;
  wins: string;
  losses: string;
  pushes: string;
  voids: string;
  stake_sum: string;
  profit_sum: string;
};

function mapRow(r: AggRow): PaperAnalyticsSegment {
  return {
    key: r.key,
    count: parseInt(r.count, 10) || 0,
    wins: parseInt(r.wins, 10) || 0,
    losses: parseInt(r.losses, 10) || 0,
    pushes: parseInt(r.pushes, 10) || 0,
    voids: parseInt(r.voids, 10) || 0,
    stakeSum: Number(r.stake_sum) || 0,
    profitSum: Number(r.profit_sum) || 0,
  };
}

const BASE_AGG = `
  count(*)::text AS count,
  count(*) FILTER (WHERE result = 'win')::text AS wins,
  count(*) FILTER (WHERE result = 'loss')::text AS losses,
  count(*) FILTER (WHERE result = 'push')::text AS pushes,
  count(*) FILTER (WHERE result = 'void')::text AS voids,
  coalesce(sum(stake_units), 0)::text AS stake_sum,
  coalesce(sum(profit_units), 0)::text AS profit_sum
`;

/**
 * GET /api/betting/paper-bets/analytics
 * Returns aggregates for status = settled only.
 */
export async function GET() {
  try {
    const [byPropType, byConfidence, byCalibration, byEvBucket] = await Promise.all([
      query<AggRow>(
        `SELECT coalesce(prop_type, '(none)') AS key, ${BASE_AGG}
         FROM paper.bets WHERE status = 'settled' GROUP BY 1 ORDER BY count(*) DESC`
      ),
      query<AggRow>(
        `SELECT coalesce(confidence_tier, '(none)') AS key, ${BASE_AGG}
         FROM paper.bets WHERE status = 'settled' GROUP BY 1 ORDER BY count(*) DESC`
      ),
      query<AggRow>(
        `SELECT coalesce(calibration_version, '(none)') AS key, ${BASE_AGG}
         FROM paper.bets WHERE status = 'settled' GROUP BY 1 ORDER BY count(*) DESC`
      ),
      query<AggRow>(
        `SELECT
           CASE
             WHEN ev IS NULL THEN 'unknown'
             WHEN ev < 0 THEN 'neg'
             WHEN ev < 0.02 THEN '0_2pct'
             WHEN ev < 0.05 THEN '2_5pct'
             ELSE '5pct_plus'
           END AS key,
           ${BASE_AGG}
         FROM paper.bets WHERE status = 'settled'
         GROUP BY 1
         ORDER BY min(CASE
           WHEN ev IS NULL THEN 0
           WHEN ev < 0 THEN 1
           WHEN ev < 0.02 THEN 2
           WHEN ev < 0.05 THEN 3
           ELSE 4
         END)`
      ),
    ]);

    return NextResponse.json({
      byPropType: byPropType.map(mapRow),
      byConfidence: byConfidence.map(mapRow),
      byCalibration: byCalibration.map(mapRow),
      byEvBucket: byEvBucket.map(mapRow),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const missing = message.includes('paper.bets') && message.includes('does not exist');
    console.error('[paper-bets/analytics]', error);
    return NextResponse.json(
      {
        error: missing ? 'Paper bets table missing. Apply db/schemas/paper_schema.sql in Supabase.' : 'Failed to load analytics',
        message,
        byPropType: [],
        byConfidence: [],
        byCalibration: [],
        byEvBucket: [],
      },
      { status: missing ? 503 : 500 }
    );
  }
}
