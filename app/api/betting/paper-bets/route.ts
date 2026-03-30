import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query, queryOne } from '@/lib/db';

const createBetSchema = z.object({
  gameId: z.union([z.number(), z.string()]),
  playerId: z.union([z.number(), z.string()]),
  playerName: z.string().nullable().optional(),
  sportsbook: z.string().nullable().optional(),
  propType: z.string().nullable().optional(),
  marketType: z.string().nullable().optional(),
  side: z.string().nullable().optional(),
  lineValue: z.number().nullable().optional(),
  oddsAmerican: z.number().nullable().optional(),
  impliedProbability: z.number().nullable().optional(),
  stakeUnits: z.number().positive().optional().default(1),
  ev: z.number().nullable().optional(),
  confidenceTier: z.enum(['high', 'medium', 'low']).nullable().optional(),
  calibrationVersion: z.string().nullable().optional(),
  decisionSnapshotAt: z.string().min(1),
  modelProbability: z.number().nullable().optional(),
  projection: z.number().nullable().optional(),
  evSelectedTrack: z.string().nullable().optional(),
});

function toStrId(v: number | string): string {
  return typeof v === 'number' ? String(v) : String(v).trim();
}

type BetRow = {
  id: string;
  created_at: string;
  status: string;
  game_id: string;
  player_id: string;
  player_name: string | null;
  sportsbook: string | null;
  prop_type: string | null;
  market_type: string | null;
  side: string | null;
  line_value: string | number | null;
  odds_american: number | null;
  implied_probability: string | number | null;
  stake_units: string | number;
  ev: string | number | null;
  confidence_tier: string | null;
  calibration_version: string | null;
  decision_snapshot_at: string;
  model_probability: string | number | null;
  projection: string | number | null;
  ev_selected_track: string | null;
  result: string | null;
  profit_units: string | number | null;
  settled_at: string | null;
};

function mapBet(r: BetRow) {
  return {
    id: r.id,
    createdAt: r.created_at,
    status: r.status,
    gameId: r.game_id,
    playerId: r.player_id,
    playerName: r.player_name,
    sportsbook: r.sportsbook,
    propType: r.prop_type,
    marketType: r.market_type,
    side: r.side,
    lineValue: r.line_value != null ? Number(r.line_value) : null,
    oddsAmerican: r.odds_american,
    impliedProbability: r.implied_probability != null ? Number(r.implied_probability) : null,
    stakeUnits: Number(r.stake_units),
    ev: r.ev != null ? Number(r.ev) : null,
    confidenceTier: r.confidence_tier,
    calibrationVersion: r.calibration_version,
    decisionSnapshotAt: r.decision_snapshot_at,
    modelProbability: r.model_probability != null ? Number(r.model_probability) : null,
    projection: r.projection != null ? Number(r.projection) : null,
    evSelectedTrack: r.ev_selected_track ?? null,
    result: r.result,
    profitUnits: r.profit_units != null ? Number(r.profit_units) : null,
    settledAt: r.settled_at,
  };
}

/**
 * GET /api/betting/paper-bets?status=open|settled|all&limit=&offset=
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const statusRaw = (sp.get('status') || 'all').toLowerCase();
    const limit = Math.min(500, Math.max(1, parseInt(sp.get('limit') || '100', 10) || 100));
    const offset = Math.max(0, parseInt(sp.get('offset') || '0', 10) || 0);

    let where = '';
    const params: unknown[] = [];
    if (statusRaw === 'open') {
      where = `WHERE status = 'open'`;
    } else if (statusRaw === 'settled') {
      where = `WHERE status = 'settled'`;
    }

    const countRow = await queryOne<{ c: string }>(
      `SELECT count(*)::text AS c FROM paper.bets ${where}`,
      params
    );
    const total = parseInt(countRow?.c ?? '0', 10) || 0;

    const lim = params.length + 1;
    const off = params.length + 2;
    const rows = await query<BetRow>(
      `SELECT id, created_at, status, game_id, player_id, player_name, sportsbook, prop_type, market_type, side,
              line_value, odds_american, implied_probability, stake_units, ev, confidence_tier, calibration_version,
              decision_snapshot_at, model_probability, projection, ev_selected_track,
              result, profit_units, settled_at
       FROM paper.bets
       ${where}
       ORDER BY
         CASE WHEN status = 'open' THEN 0 ELSE 1 END,
         COALESCE(settled_at, created_at) DESC
       LIMIT $${lim} OFFSET $${off}`,
      [...params, limit, offset]
    );

    return NextResponse.json({
      bets: rows.map(mapBet),
      meta: { total, limit, offset, status: statusRaw },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const missing = message.includes('paper.bets') && message.includes('does not exist');
    console.error('[paper-bets GET]', error);
    return NextResponse.json(
      {
        error: missing ? 'Paper bets table missing. Apply db/schemas/paper_schema.sql in Supabase.' : 'Failed to load paper bets',
        message,
        bets: [],
        meta: { total: 0, limit: 0, offset: 0, status: 'all' },
      },
      { status: missing ? 503 : 500 }
    );
  }
}

/**
 * POST /api/betting/paper-bets
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createBetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 });
    }
    const d = parsed.data;
    const gameId = toStrId(d.gameId);
    const playerId = toStrId(d.playerId);

    const inserted = await queryOne<BetRow>(
      `INSERT INTO paper.bets (
         status, game_id, player_id, player_name, sportsbook, prop_type, market_type, side,
         line_value, odds_american, implied_probability, stake_units, ev, confidence_tier, calibration_version,
         decision_snapshot_at, model_probability, projection, ev_selected_track
       ) VALUES (
         'open', $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13, $14,
         $15::timestamptz, $16, $17, $18
       )
       RETURNING id, created_at, status, game_id, player_id, player_name, sportsbook, prop_type, market_type, side,
                 line_value, odds_american, implied_probability, stake_units, ev, confidence_tier, calibration_version,
                 decision_snapshot_at, model_probability, projection, ev_selected_track,
                 result, profit_units, settled_at`,
      [
        gameId,
        playerId,
        d.playerName ?? null,
        d.sportsbook ?? null,
        d.propType ?? null,
        d.marketType ?? null,
        d.side ?? null,
        d.lineValue ?? null,
        d.oddsAmerican ?? null,
        d.impliedProbability ?? null,
        d.stakeUnits,
        d.ev ?? null,
        d.confidenceTier ?? null,
        d.calibrationVersion ?? null,
        d.decisionSnapshotAt,
        d.modelProbability ?? null,
        d.projection ?? null,
        d.evSelectedTrack ?? null,
      ]
    );

    if (!inserted) {
      return NextResponse.json({ error: 'Insert failed' }, { status: 500 });
    }

    return NextResponse.json({ bet: mapBet(inserted) });
  } catch (error: unknown) {
    console.error('[paper-bets POST]', error);
    return NextResponse.json(
      {
        error: 'Failed to create paper bet',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
