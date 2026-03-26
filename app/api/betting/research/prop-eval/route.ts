import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

const MAX_LIMIT = 500;

type EvalRow = {
  game_id: string;
  player_id: string;
  player_name: string | null;
  game_date: string | null;
  sportsbook: string | null;
  prop_type: string | null;
  side: string | null;
  line_value: string | number | null;
  decision_at: string;
  odds_american: number | null;
  odds_decimal: string | number | null;
  implied_probability: string | number | null;
  game_start_time: string | null;
  stat_actual: string | number | null;
  bet_won: boolean | null;
};

function buildWhere(sp: URLSearchParams): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let n = 1;

  const before = sp.get('before')?.trim();
  const after = sp.get('after')?.trim();
  const propType = sp.get('prop_type')?.trim();

  if (before && /^\d{4}-\d{2}-\d{2}$/.test(before)) {
    conditions.push(`game_date < $${n}::date`);
    params.push(before);
    n++;
  }
  if (after && /^\d{4}-\d{2}-\d{2}$/.test(after)) {
    conditions.push(`game_date >= $${n}::date`);
    params.push(after);
    n++;
  }
  if (propType) {
    conditions.push(`lower(prop_type) = lower($${n})`);
    params.push(propType);
    n++;
  }

  const sql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { sql, params };
}

function toNum(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

/**
 * GET /api/betting/research/prop-eval
 *
 * Read-only rows from research.v_prop_eval_units (closing-line snapshot + outcome).
 * Query: before=YYYY-MM-DD (exclusive), after=YYYY-MM-DD (inclusive), prop_type, limit, offset.
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    let limit = parseInt(sp.get('limit') || '100', 10);
    if (Number.isNaN(limit)) limit = 100;
    limit = Math.min(Math.max(1, limit), MAX_LIMIT);
    let offset = parseInt(sp.get('offset') || '0', 10);
    if (Number.isNaN(offset)) offset = 0;
    offset = Math.max(0, offset);

    const { sql: whereSql, params: whereParams } = buildWhere(sp);

    const countRow = await queryOne<{ c: string }>(
      `SELECT count(*)::text AS c FROM research.v_prop_eval_units ${whereSql}`,
      whereParams
    );
    const totalMatching = parseInt(countRow?.c ?? '0', 10) || 0;

    const limitIdx = whereParams.length + 1;
    const offsetIdx = whereParams.length + 2;
    const rows = await query<EvalRow>(
      `SELECT
         game_id,
         player_id,
         player_name,
         game_date::text AS game_date,
         sportsbook,
         prop_type,
         side,
         line_value,
         decision_at,
         odds_american,
         odds_decimal,
         implied_probability,
         game_start_time,
         stat_actual,
         bet_won
       FROM research.v_prop_eval_units
       ${whereSql}
       ORDER BY game_date DESC NULLS LAST, decision_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...whereParams, limit, offset]
    );

    const rangeRow = await queryOne<{ mn: string | null; mx: string | null }>(
      `SELECT min(game_date)::text AS mn, max(game_date)::text AS mx FROM research.v_prop_eval_units ${whereSql}`,
      whereParams
    );

    const mapped = rows.map((r) => ({
      gameId: r.game_id,
      playerId: r.player_id,
      playerName: r.player_name,
      gameDate: r.game_date,
      sportsbook: r.sportsbook,
      propType: r.prop_type,
      side: r.side,
      lineValue: toNum(r.line_value as number | string | null),
      decisionAt: r.decision_at,
      oddsAmerican: r.odds_american,
      oddsDecimal: toNum(r.odds_decimal as number | string | null),
      impliedProbability: toNum(r.implied_probability as number | string | null),
      gameStartTime: r.game_start_time,
      statActual: toNum(r.stat_actual as number | string | null),
      betWon: r.bet_won,
    }));

    return NextResponse.json({
      rows: mapped,
      meta: {
        totalMatching,
        limit,
        offset,
        dateRange:
          rangeRow?.mn && rangeRow?.mx
            ? { min: rangeRow.mn, max: rangeRow.mx }
            : { min: null as string | null, max: null as string | null },
      },
    });
  } catch (error: unknown) {
    console.error('[research/prop-eval]', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    const isMissingRelation = message.includes('does not exist') || message.includes('research.v_prop_eval_units');
    return NextResponse.json(
      {
        error: isMissingRelation
          ? 'Research views not installed. Apply db/schemas/research_*.sql in Supabase.'
          : 'Query failed',
        message,
        rows: [],
        meta: { totalMatching: 0, limit: 0, offset: 0, dateRange: { min: null, max: null } },
      },
      { status: isMissingRelation ? 503 : 500 }
    );
  }
}
