/**
 * User-scoped paper.bets queries. Always bind authenticated user_id on
 * user-facing list/create/delete/analytics. Settlement is a separate system path.
 */

import { query, queryOne } from '@/lib/db';

export const PAPER_BETS_OWNER_PREDICATE = 'user_id = $1::uuid';

export const PAPER_BETS_LIST_SQL = `
SELECT id, user_id, created_at, status, game_id, player_id, player_name, sportsbook, prop_type, market_type, side,
       line_value, odds_american, implied_probability, stake_units, ev, confidence_tier, calibration_version,
       decision_snapshot_at, model_probability, projection, ev_selected_track,
       result, profit_units, settled_at
FROM paper.bets
WHERE user_id = $1::uuid
  AND ($2::text = 'all' OR status = $2)
ORDER BY
  CASE WHEN status = 'open' THEN 0 ELSE 1 END,
  COALESCE(settled_at, created_at) DESC
LIMIT $3 OFFSET $4
`;

export const PAPER_BETS_COUNT_SQL = `
SELECT count(*)::text AS c
FROM paper.bets
WHERE user_id = $1::uuid
  AND ($2::text = 'all' OR status = $2)
`;

export const PAPER_BETS_INSERT_SQL = `
INSERT INTO paper.bets (
  user_id, status, game_id, player_id, player_name, sportsbook, prop_type, market_type, side,
  line_value, odds_american, implied_probability, stake_units, ev, confidence_tier, calibration_version,
  decision_snapshot_at, model_probability, projection, ev_selected_track
) VALUES (
  $1::uuid, 'open', $2, $3, $4, $5, $6, $7, $8,
  $9, $10, $11, $12, $13, $14, $15,
  $16::timestamptz, $17, $18, $19
)
RETURNING id, user_id, created_at, status, game_id, player_id, player_name, sportsbook, prop_type, market_type, side,
          line_value, odds_american, implied_probability, stake_units, ev, confidence_tier, calibration_version,
          decision_snapshot_at, model_probability, projection, ev_selected_track,
          result, profit_units, settled_at
`;

export const PAPER_BETS_DELETE_SQL = `
DELETE FROM paper.bets
WHERE id = $1::uuid AND user_id = $2::uuid AND status = 'open'
RETURNING id
`;

export const PAPER_ANALYTICS_OWNER_WHERE = `status = 'settled' AND user_id = $1::uuid`;

const ANALYTICS_AGG = `
  count(*)::text AS count,
  count(*) FILTER (WHERE result = 'win')::text AS wins,
  count(*) FILTER (WHERE result = 'loss')::text AS losses,
  count(*) FILTER (WHERE result = 'push')::text AS pushes,
  count(*) FILTER (WHERE result = 'void')::text AS voids,
  coalesce(sum(stake_units), 0)::text AS stake_sum,
  coalesce(sum(profit_units), 0)::text AS profit_sum
`;

export const PAPER_ANALYTICS_BY_PROP_SQL = `
SELECT coalesce(prop_type, '(none)') AS key, ${ANALYTICS_AGG}
FROM paper.bets
WHERE ${PAPER_ANALYTICS_OWNER_WHERE}
GROUP BY 1
ORDER BY count(*) DESC
`;

export const PAPER_ANALYTICS_BY_CONFIDENCE_SQL = `
SELECT coalesce(confidence_tier, '(none)') AS key, ${ANALYTICS_AGG}
FROM paper.bets
WHERE ${PAPER_ANALYTICS_OWNER_WHERE}
GROUP BY 1
ORDER BY count(*) DESC
`;

export const PAPER_ANALYTICS_BY_CALIBRATION_SQL = `
SELECT coalesce(calibration_version, '(none)') AS key, ${ANALYTICS_AGG}
FROM paper.bets
WHERE ${PAPER_ANALYTICS_OWNER_WHERE}
GROUP BY 1
ORDER BY count(*) DESC
`;

export const PAPER_ANALYTICS_BY_EV_SQL = `
SELECT
  CASE
    WHEN ev IS NULL THEN 'unknown'
    WHEN ev < 0 THEN 'neg'
    WHEN ev < 0.02 THEN '0_2pct'
    WHEN ev < 0.05 THEN '2_5pct'
    ELSE '5pct_plus'
  END AS key,
  ${ANALYTICS_AGG}
FROM paper.bets
WHERE ${PAPER_ANALYTICS_OWNER_WHERE}
GROUP BY 1
ORDER BY min(CASE
  WHEN ev IS NULL THEN 0
  WHEN ev < 0 THEN 1
  WHEN ev < 0.02 THEN 2
  WHEN ev < 0.05 THEN 3
  ELSE 4
END)
`;

export type PaperBetStatusFilter = 'open' | 'settled' | 'all';

export type PaperBetRow = {
  id: string;
  user_id?: string | null;
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

export type PaperBet = {
  id: string;
  userId: string | null;
  createdAt: string;
  status: string;
  gameId: string;
  playerId: string;
  playerName: string | null;
  sportsbook: string | null;
  propType: string | null;
  marketType: string | null;
  side: string | null;
  lineValue: number | null;
  oddsAmerican: number | null;
  impliedProbability: number | null;
  stakeUnits: number;
  ev: number | null;
  confidenceTier: string | null;
  calibrationVersion: string | null;
  decisionSnapshotAt: string;
  modelProbability: number | null;
  projection: number | null;
  evSelectedTrack: string | null;
  result: string | null;
  profitUnits: number | null;
  settledAt: string | null;
};

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

export function mapPaperBet(r: PaperBetRow): PaperBet {
  return {
    id: r.id,
    userId: r.user_id ?? null,
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

function mapAnalyticsRow(r: AggRow): PaperAnalyticsSegment {
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

export function normalizePaperBetStatus(raw: string | null): PaperBetStatusFilter {
  const status = (raw || 'all').toLowerCase();
  if (status === 'open' || status === 'settled') return status;
  return 'all';
}

export type InsertPaperBetInput = {
  userId: string;
  gameId: string;
  playerId: string;
  playerName?: string | null;
  sportsbook?: string | null;
  propType?: string | null;
  marketType?: string | null;
  side?: string | null;
  lineValue?: number | null;
  oddsAmerican?: number | null;
  impliedProbability?: number | null;
  stakeUnits: number;
  ev?: number | null;
  confidenceTier?: string | null;
  calibrationVersion?: string | null;
  decisionSnapshotAt: string;
  modelProbability?: number | null;
  projection?: number | null;
  evSelectedTrack?: string | null;
};

export async function listPaperBetsForUser(input: {
  userId: string;
  status?: PaperBetStatusFilter;
  limit: number;
  offset: number;
}): Promise<{ bets: PaperBet[]; total: number }> {
  const status = input.status ?? 'all';
  const countRow = await queryOne<{ c: string }>(PAPER_BETS_COUNT_SQL, [input.userId, status]);
  const total = parseInt(countRow?.c ?? '0', 10) || 0;
  const rows = await query<PaperBetRow>(PAPER_BETS_LIST_SQL, [
    input.userId,
    status,
    input.limit,
    input.offset,
  ]);
  return { bets: rows.map(mapPaperBet), total };
}

export async function insertPaperBetForUser(input: InsertPaperBetInput): Promise<PaperBet | null> {
  const row = await queryOne<PaperBetRow>(PAPER_BETS_INSERT_SQL, [
    input.userId,
    input.gameId,
    input.playerId,
    input.playerName ?? null,
    input.sportsbook ?? null,
    input.propType ?? null,
    input.marketType ?? null,
    input.side ?? null,
    input.lineValue ?? null,
    input.oddsAmerican ?? null,
    input.impliedProbability ?? null,
    input.stakeUnits,
    input.ev ?? null,
    input.confidenceTier ?? null,
    input.calibrationVersion ?? null,
    input.decisionSnapshotAt,
    input.modelProbability ?? null,
    input.projection ?? null,
    input.evSelectedTrack ?? null,
  ]);
  return row ? mapPaperBet(row) : null;
}

export async function deleteOpenPaperBetForUser(input: {
  userId: string;
  id: string;
}): Promise<string | null> {
  const deleted = await queryOne<{ id: string }>(PAPER_BETS_DELETE_SQL, [input.id, input.userId]);
  return deleted?.id ?? null;
}

export async function listPaperAnalyticsForUser(userId: string): Promise<{
  byPropType: PaperAnalyticsSegment[];
  byConfidence: PaperAnalyticsSegment[];
  byCalibration: PaperAnalyticsSegment[];
  byEvBucket: PaperAnalyticsSegment[];
}> {
  const [byPropType, byConfidence, byCalibration, byEvBucket] = await Promise.all([
    query<AggRow>(PAPER_ANALYTICS_BY_PROP_SQL, [userId]),
    query<AggRow>(PAPER_ANALYTICS_BY_CONFIDENCE_SQL, [userId]),
    query<AggRow>(PAPER_ANALYTICS_BY_CALIBRATION_SQL, [userId]),
    query<AggRow>(PAPER_ANALYTICS_BY_EV_SQL, [userId]),
  ]);
  return {
    byPropType: byPropType.map(mapAnalyticsRow),
    byConfidence: byConfidence.map(mapAnalyticsRow),
    byCalibration: byCalibration.map(mapAnalyticsRow),
    byEvBucket: byEvBucket.map(mapAnalyticsRow),
  };
}
