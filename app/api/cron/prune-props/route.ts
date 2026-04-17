import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

const RETENTION_DAYS = 3;
const DELETE_BATCH = 50_000;

function cronSecret(): string | undefined {
  return process.env.CRON_SECRET;
}

function isAuthorized(request: NextRequest): boolean {
  const secret = cronSecret();
  if (!secret) return process.env.NODE_ENV !== 'production';
  const auth = request.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  const q = request.nextUrl.searchParams.get('secret');
  return bearer === secret || q === secret;
}

async function materializeClosingLines(): Promise<number> {
  const result = await pool.query(`
    INSERT INTO research.prop_decision_lines
      (game_id, player_id, player_name, team_id, sportsbook, prop_type,
       market_type, side, line_value, odds_american, odds_decimal,
       implied_probability, decision_at, game_start_time)
    SELECT DISTINCT ON (r.game_id, r.player_id, r.sportsbook, r.prop_type, r.side)
      g.game_id,
      r.player_id::text,
      r.player_name,
      r.team_id,
      r.sportsbook,
      r.prop_type,
      r.market_type,
      r.side,
      r.line_value,
      r.odds_american,
      r.odds_decimal,
      r.implied_probability,
      r.fetched_at,
      g.start_time
    FROM raw.player_prop_snapshots_v2 r
    INNER JOIN analytics.games g ON g.game_id = r.game_id::text
    WHERE g.status = 'Final'
      AND g.start_time IS NOT NULL
      AND r.fetched_at < g.start_time
      AND lower(coalesce(r.market_type, '')) = 'over_under'
      AND lower(r.side) IN ('over', 'under')
      AND NOT EXISTS (
        SELECT 1 FROM research.prop_decision_lines m
        WHERE m.game_id = g.game_id
          AND m.player_id = r.player_id::text
          AND m.sportsbook = r.sportsbook
          AND m.prop_type = r.prop_type
          AND m.side = r.side
      )
    ORDER BY
      r.game_id, r.player_id, r.sportsbook, r.prop_type, r.side,
      r.fetched_at DESC
    ON CONFLICT (game_id, player_id, sportsbook, prop_type, side) DO NOTHING
  `);
  return result.rowCount ?? 0;
}

async function pruneOldRows(): Promise<{ rawV2: number; analyticsCurrent: number }> {
  let rawV2 = 0;
  while (true) {
    const result = await pool.query(
      `WITH doomed AS (
         SELECT ctid
         FROM raw.player_prop_snapshots_v2
         WHERE fetched_at < now() - ($1::text || ' days')::interval
         LIMIT $2
       )
       DELETE FROM raw.player_prop_snapshots_v2 t
       USING doomed d
       WHERE t.ctid = d.ctid`,
      [String(RETENTION_DAYS), DELETE_BATCH]
    );
    const count = result.rowCount ?? 0;
    rawV2 += count;
    if (count === 0) break;
  }

  let analyticsCurrent = 0;
  while (true) {
    const result = await pool.query(
      `WITH doomed AS (
         SELECT p.ctid
         FROM analytics.player_props_current p
         INNER JOIN analytics.games g ON g.game_id = p.game_id::text
         WHERE g.status = 'Final'
           AND g.start_time < now() - ($1::text || ' days')::interval
         LIMIT $2
       )
       DELETE FROM analytics.player_props_current t
       USING doomed d
       WHERE t.ctid = d.ctid`,
      [String(RETENTION_DAYS), DELETE_BATCH]
    );
    const count = result.rowCount ?? 0;
    analyticsCurrent += count;
    if (count === 0) break;
  }

  return { rawV2, analyticsCurrent };
}

/**
 * GET /api/cron/prune-props
 * Daily cron: materialize closing lines for Final games, then prune raw snapshots
 * older than RETENTION_DAYS. Protected by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production' && !cronSecret()) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET must be set in production' },
      { status: 503 }
    );
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const materialized = await materializeClosingLines();
    const { rawV2, analyticsCurrent } = await pruneOldRows();

    return NextResponse.json({
      ok: true,
      materialized,
      prunedRawV2: rawV2,
      prunedAnalyticsCurrent: analyticsCurrent,
      retentionDays: RETENTION_DAYS,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[cron/prune-props]', error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
