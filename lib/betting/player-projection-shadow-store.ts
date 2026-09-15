/**
 * SQL store for frozen PTS C / REB C shadow scoring.
 * Isolated from the Next.js request path.
 */

import {
  inspectShadowWriteSchema,
  type CollectionSchemaMode,
  type SqlQueryable,
} from '@/lib/db/schema-capability';
import type { LearnedEvalLog, TeamGameContextRow } from '@/lib/betting/player-projection-learned-features';
import type { ScheduledShadowGame, ShadowPredictionRecord, SettlementRecord } from '@/lib/betting/player-projection-shadow-scoring';
import { SHADOW_MODEL_VERSION, SHADOW_SEASON } from '@/lib/betting/player-projection-shadow-protocol';
import type { ShadowWindowAnchor } from '@/lib/betting/player-projection-shadow-timing';

export const INSERT_PREDICTION_SNAPSHOT_SQL = `
  INSERT INTO analytics.prediction_snapshots (
    player_id, game_id, scheduled_tipoff, intended_cutoff_at, generated_at, late,
    model_version, feature_spec_version, feature_values, predictions, minutes_late,
    delivery_status, eligibility, feature_order, feature_checksum, model_checksums,
    source_freshness, tipoff_revision, pred_a, pred_b
  ) VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, $9::jsonb, $10::jsonb, $11,
    $12, $13, $14::jsonb, $15, $16::jsonb,
    $17::jsonb, $18, $19::jsonb, $20::jsonb
  )
  ON CONFLICT (player_id, game_id, model_version, intended_cutoff_at) DO NOTHING
  RETURNING snapshot_id
`;

export const INSERT_SETTLEMENT_SQL = `
  INSERT INTO analytics.prediction_settlements (
    snapshot_id, settled_at, outcome_class, actual_pts, actual_reb
  ) VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (snapshot_id) DO NOTHING
`;

export const INSERT_SHADOW_RUN_SQL = `
  INSERT INTO analytics.shadow_run_records (
    run_at, finished_at, action, status, due_count, on_time_count, late_count,
    failed_count, missing_count, ineligible_count, settled_count, settlement_backlog,
    schema_mode, schema_enrichment, feature_input_age_hours, details
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7,
    $8, $9, $10, $11, $12,
    $13, $14, $15, $16::jsonb
  ) RETURNING run_id
`;

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : String(value);
}

export async function loadUpcomingGames(
  client: SqlQueryable,
  season = SHADOW_SEASON
): Promise<ScheduledShadowGame[]> {
  const res = await client.query(
    `SELECT game_id::text AS game_id,
            season::text AS season,
            start_time,
            home_team_id::text AS home_team_id,
            away_team_id::text AS away_team_id,
            status
       FROM analytics.games
      WHERE season = $1
        AND start_time IS NOT NULL`,
    [season]
  );
  return res.rows.map((row) => ({
    gameId: String(row.game_id),
    season: String(row.season),
    scheduledTipoff: iso(row.start_time as string)!,
    homeTeamId: String(row.home_team_id),
    awayTeamId: String(row.away_team_id),
    status: row.status == null ? null : String(row.status),
  }));
}

function mapLogRow(row: Record<string, unknown>): LearnedEvalLog {
  return {
    player_id: String(row.player_id),
    game_id: String(row.game_id),
    team_id: row.team_id == null ? null : String(row.team_id),
    home_team_id: row.home_team_id == null ? null : String(row.home_team_id),
    away_team_id: row.away_team_id == null ? null : String(row.away_team_id),
    start_time: iso(row.start_time as string)!,
    season: String(row.season ?? ''),
    minutes: row.minutes as number | string | null,
    points: row.points == null ? null : Number(row.points),
    rebounds: row.rebounds == null ? null : Number(row.rebounds),
    assists: row.assists == null ? null : Number(row.assists),
    three_pointers_made: row.three_pointers_made == null ? null : Number(row.three_pointers_made),
    field_goals_attempted: row.field_goals_attempted == null ? null : Number(row.field_goals_attempted),
    three_pointers_attempted:
      row.three_pointers_attempted == null ? null : Number(row.three_pointers_attempted),
    free_throws_attempted: row.free_throws_attempted == null ? null : Number(row.free_throws_attempted),
    // These queries do not join game_starters. Unknown is the honest as-of label;
    // C features must not use target-game starter.
    started: 'unknown',
  };
}

export async function loadTeamAppearances(
  client: SqlQueryable,
  teamIds: string[],
  beforeIso: string
): Promise<LearnedEvalLog[]> {
  if (teamIds.length === 0) return [];
  const res = await client.query(
    `SELECT l.player_id::text AS player_id,
            l.game_id::text AS game_id,
            l.team_id::text AS team_id,
            g.home_team_id::text AS home_team_id,
            g.away_team_id::text AS away_team_id,
            COALESCE(g.start_time, l.game_date::timestamptz) AS start_time,
            g.season::text AS season,
            l.minutes, l.points, l.rebounds, l.assists, l.three_pointers_made,
            l.field_goals_attempted, l.three_pointers_attempted, l.free_throws_attempted
       FROM analytics.player_game_logs l
       JOIN analytics.games g ON g.game_id = l.game_id
      WHERE l.team_id = ANY($1::text[])
        AND COALESCE(g.start_time, l.game_date::timestamptz) < $2::timestamptz`,
    [teamIds, beforeIso]
  );
  return res.rows.map(mapLogRow);
}

export async function loadPlayerLogs(
  client: SqlQueryable,
  playerIds: string[],
  beforeIso: string
): Promise<LearnedEvalLog[]> {
  if (playerIds.length === 0) return [];
  const res = await client.query(
    `SELECT l.player_id::text AS player_id,
            l.game_id::text AS game_id,
            l.team_id::text AS team_id,
            g.home_team_id::text AS home_team_id,
            g.away_team_id::text AS away_team_id,
            COALESCE(g.start_time, l.game_date::timestamptz) AS start_time,
            g.season::text AS season,
            l.minutes, l.points, l.rebounds, l.assists, l.three_pointers_made,
            l.field_goals_attempted, l.three_pointers_attempted, l.free_throws_attempted
       FROM analytics.player_game_logs l
       JOIN analytics.games g ON g.game_id = l.game_id
      WHERE l.player_id = ANY($1::text[])
        AND COALESCE(g.start_time, l.game_date::timestamptz) < $2::timestamptz`,
    [playerIds, beforeIso]
  );
  return res.rows.map(mapLogRow);
}

export async function loadTeamGameStats(
  client: SqlQueryable,
  beforeIso: string,
  season = SHADOW_SEASON
): Promise<TeamGameContextRow[]> {
  const res = await client.query(
    `SELECT t.game_id::text AS game_id,
            t.team_id::text AS team_id,
            t.opponent_team_id::text AS opponent_team_id,
            t.season::text AS season,
            g.start_time,
            t.team_points, t.team_fga, t.team_3pa, t.team_fta, t.team_turnovers,
            t.offensive_rebounds, t.points_allowed, t.opponent_fga, t.opponent_fta,
            t.opponent_turnovers, t.opponent_offensive_rebounds
       FROM analytics.team_game_stats t
       JOIN analytics.games g ON g.game_id = t.game_id
      WHERE g.start_time < $1::timestamptz
        AND t.season = ANY($2::text[])`,
    [beforeIso, [String(Number(season) - 1), season]]
  );
  return res.rows.map((row) => ({
    game_id: String(row.game_id),
    team_id: String(row.team_id),
    opponent_team_id: row.opponent_team_id == null ? null : String(row.opponent_team_id),
    season: String(row.season ?? ''),
    start_time: iso(row.start_time as string)!,
    team_points: row.team_points == null ? null : Number(row.team_points),
    team_fga: row.team_fga == null ? null : Number(row.team_fga),
    team_3pa: row.team_3pa == null ? null : Number(row.team_3pa),
    team_fta: row.team_fta == null ? null : Number(row.team_fta),
    team_turnovers: row.team_turnovers == null ? null : Number(row.team_turnovers),
    offensive_rebounds: row.offensive_rebounds == null ? null : Number(row.offensive_rebounds),
    points_allowed: row.points_allowed == null ? null : Number(row.points_allowed),
    opponent_fga: row.opponent_fga == null ? null : Number(row.opponent_fga),
    opponent_fta: row.opponent_fta == null ? null : Number(row.opponent_fta),
    opponent_turnovers: row.opponent_turnovers == null ? null : Number(row.opponent_turnovers),
    opponent_offensive_rebounds:
      row.opponent_offensive_rebounds == null ? null : Number(row.opponent_offensive_rebounds),
  }));
}

export async function loadUnresolvedPlayerIds(
  client: SqlQueryable,
  playerIds: string[]
): Promise<Set<string>> {
  if (playerIds.length === 0) return new Set();
  const known = await client.query(
    `SELECT player_id::text AS player_id FROM analytics.players WHERE player_id = ANY($1::text[])`,
    [playerIds]
  );
  const have = new Set(known.rows.map((row) => String(row.player_id)));
  return new Set(playerIds.filter((id) => !have.has(id)));
}

export async function latestFinalLogAt(client: SqlQueryable): Promise<string | null> {
  const res = await client.query(
    `SELECT max(g.start_time) AS ts
       FROM analytics.player_game_logs l
       JOIN analytics.games g ON g.game_id = l.game_id
      WHERE g.status = 'Final'`
  );
  return iso(res.rows[0]?.ts as string | null);
}

export async function loadCurrentWindowAnchor(
  client: SqlQueryable,
  season = SHADOW_SEASON
): Promise<ShadowWindowAnchor | null> {
  const res = await client.query(
    `SELECT season, first_regular_season_tipoff, observed_at, source, revision, previous_tipoff
       FROM analytics.shadow_window_anchors
      WHERE season = $1
      ORDER BY revision DESC
      LIMIT 1`,
    [season]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    season: String(row.season),
    firstRegularSeasonTipoff: iso(row.first_regular_season_tipoff as string)!,
    observedAt: iso(row.observed_at as string)!,
    source: String(row.source),
    revision: Number(row.revision),
    previousTipoff: iso(row.previous_tipoff as string | null),
  };
}

export async function insertWindowAnchor(
  client: SqlQueryable,
  anchor: ShadowWindowAnchor
): Promise<void> {
  await client.query(
    `INSERT INTO analytics.shadow_window_anchors (
       season, first_regular_season_tipoff, observed_at, source, revision, previous_tipoff
     ) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (season, revision) DO NOTHING`,
    [
      anchor.season,
      anchor.firstRegularSeasonTipoff,
      anchor.observedAt,
      anchor.source,
      anchor.revision,
      anchor.previousTipoff,
    ]
  );
}

export async function insertPredictionSnapshot(
  client: SqlQueryable,
  record: ShadowPredictionRecord
): Promise<{ snapshotId: number | null; accepted: boolean }> {
  const minutesLate =
    record.delivery === 'late'
      ? Math.max(
          0,
          (Date.parse(record.generatedAt) - Date.parse(record.intendedCutoffAt)) / 60_000
        )
      : 0;
  const res = await client.query(INSERT_PREDICTION_SNAPSHOT_SQL, [
    record.playerId,
    record.gameId,
    record.scheduledTipoff,
    record.intendedCutoffAt,
    record.generatedAt,
    record.late,
    record.modelVersion,
    record.featureSpecVersion,
    JSON.stringify(record.featureValues),
    JSON.stringify(record.predC),
    minutesLate,
    record.delivery,
    record.eligibility,
    JSON.stringify(record.featureOrder),
    record.featureChecksum,
    JSON.stringify(record.modelChecksums),
    JSON.stringify(record.sourceFreshness),
    record.tipoffRevision,
    JSON.stringify(record.predA),
    JSON.stringify(record.predB),
  ]);
  const snapshotId = res.rows[0]?.snapshot_id == null ? null : Number(res.rows[0].snapshot_id);
  return { snapshotId, accepted: snapshotId != null };
}

export async function loadUnsettledFinalSnapshots(client: SqlQueryable): Promise<
  Array<{
    snapshotId: number;
    logicalKey: string;
    playerId: string;
    gameId: string;
    status: string | null;
    actualPts: number | null;
    actualReb: number | null;
    minutes: string | number | null;
  }>
> {
  const res = await client.query(
    `SELECT s.snapshot_id, s.player_id::text AS player_id, s.game_id::text AS game_id,
            s.model_version, s.intended_cutoff_at, g.status,
            l.points AS actual_pts, l.rebounds AS actual_reb, l.minutes
       FROM analytics.prediction_snapshots s
       JOIN analytics.games g ON g.game_id = s.game_id
       LEFT JOIN analytics.prediction_settlements t ON t.snapshot_id = s.snapshot_id
       LEFT JOIN analytics.player_game_logs l
         ON l.game_id = s.game_id AND l.player_id = s.player_id
      WHERE t.snapshot_id IS NULL
        AND s.model_version = $1
        AND (
          g.status = 'Final'
          OR lower(coalesce(g.status, '')) IN ('postponed', 'cancelled')
        )`,
    [SHADOW_MODEL_VERSION]
  );
  return res.rows.map((row) => ({
    snapshotId: Number(row.snapshot_id),
    logicalKey: `${row.player_id}|${row.game_id}|${row.model_version}|${iso(row.intended_cutoff_at as string)}`,
    playerId: String(row.player_id),
    gameId: String(row.game_id),
    status: row.status == null ? null : String(row.status),
    actualPts: row.actual_pts == null ? null : Number(row.actual_pts),
    actualReb: row.actual_reb == null ? null : Number(row.actual_reb),
    minutes: row.minutes as string | number | null,
  }));
}

export async function insertSettlementRow(
  client: SqlQueryable,
  args: { snapshotId: number; settledAt: string; outcome: SettlementRecord['outcome']; actualPts: number | null; actualReb: number | null }
): Promise<boolean> {
  await client.query(INSERT_SETTLEMENT_SQL, [
    args.snapshotId,
    args.settledAt,
    args.outcome,
    args.actualPts,
    args.actualReb,
  ]);
  return true;
}

export async function countSettlementBacklog(client: SqlQueryable): Promise<number> {
  const res = await client.query(
    `SELECT count(*)::int AS n
       FROM analytics.prediction_snapshots s
       JOIN analytics.games g ON g.game_id = s.game_id
       LEFT JOIN analytics.prediction_settlements t ON t.snapshot_id = s.snapshot_id
      WHERE t.snapshot_id IS NULL
        AND s.model_version = $1
        AND g.status = 'Final'`,
    [SHADOW_MODEL_VERSION]
  );
  return Number(res.rows[0]?.n ?? 0);
}

export type ShadowRunRecordWrite = {
  runAt: string;
  finishedAt: string;
  action: 'score' | 'settle';
  status: 'success' | 'error' | 'skipped' | 'preflight_failed';
  dueCount: number;
  onTimeCount: number;
  lateCount: number;
  failedCount: number;
  missingCount: number;
  ineligibleCount: number;
  settledCount: number;
  settlementBacklog: number | null;
  schemaMode: CollectionSchemaMode | null;
  schemaEnrichment: 'available' | 'unavailable' | null;
  featureInputAgeHours: number | null;
  details: Record<string, unknown>;
};

export async function insertShadowRunRecord(
  client: SqlQueryable,
  row: ShadowRunRecordWrite
): Promise<number | null> {
  const schema = await inspectShadowWriteSchema(client);
  if (!schema.shadowRunRecords) return null;
  const res = await client.query(INSERT_SHADOW_RUN_SQL, [
    row.runAt,
    row.finishedAt,
    row.action,
    row.status,
    row.dueCount,
    row.onTimeCount,
    row.lateCount,
    row.failedCount,
    row.missingCount,
    row.ineligibleCount,
    row.settledCount,
    row.settlementBacklog,
    row.schemaMode,
    row.schemaEnrichment,
    row.featureInputAgeHours,
    JSON.stringify(row.details),
  ]);
  return res.rows[0]?.run_id == null ? null : Number(res.rows[0].run_id);
}

export async function loadShadowHealthRows(client: SqlQueryable): Promise<{
  lastSuccessAt: string | null;
  lastFailedAt: string | null;
  lastIncomplete: Record<string, unknown> | null;
  lastRun: Record<string, unknown> | null;
}> {
  const schema = await inspectShadowWriteSchema(client);
  if (!schema.shadowRunRecords) {
    return { lastSuccessAt: null, lastFailedAt: null, lastIncomplete: null, lastRun: null };
  }
  const success = await client.query(
    `SELECT max(finished_at) AS ts FROM analytics.shadow_run_records WHERE status = 'success'`
  );
  const failed = await client.query(
    `SELECT max(finished_at) AS ts FROM analytics.shadow_run_records WHERE status IN ('error', 'preflight_failed')`
  );
  const last = await client.query(
    `SELECT * FROM analytics.shadow_run_records ORDER BY run_id DESC LIMIT 1`
  );
  return {
    lastSuccessAt: iso(success.rows[0]?.ts as string | null),
    lastFailedAt: iso(failed.rows[0]?.ts as string | null),
    lastIncomplete: last.rows[0]?.status === 'error' ? (last.rows[0] as Record<string, unknown>) : null,
    lastRun: (last.rows[0] as Record<string, unknown>) ?? null,
  };
}
