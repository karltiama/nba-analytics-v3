/**
 * analytics.games adapter for frequent status sync.
 * Per-statement upserts (no slate-wide transaction) so one bad row cannot roll back others.
 * Reuses ANALYTICS_GAMES_FINAL_PRESERVE_UPSERT_SQL. Does not import lib/db.ts (that module
 * throws at load if SUPABASE_DB_URL is missing, which would break the freeze path).
 */

import { Pool } from 'pg';
import { ANALYTICS_GAMES_FINAL_PRESERVE_UPSERT_SQL } from '@/lib/betting/final-preserve';
import { classifyAuthoritativeGameState, FINALIZATION_CLOCK_UPSERT_SQL } from '@/lib/games/finalization-clock';
import { createLambdaPgPool } from '@/lib/runtime/lambda-pg-pool';
import type { GameStatusStore, LocalGameRow } from './status-sync';
import type { ReadinessGameRow } from './season-phase-readiness';

export type ClosableGameStatusStore = GameStatusStore & {
  close(): Promise<void>;
};

const SELECT_GAME_SQL = `
  select game_id, season, start_time, status, home_team_id, away_team_id, home_score, away_score, venue
  from analytics.games
  where game_id = $1
`;

const SELECT_FINALIZATION_SQL = `
  select game_id, season, start_time, status, home_team_id, away_team_id, home_score, away_score, venue,
         finalized_at, status_observed_at
  from analytics.games
  where game_id = $1
`;

/** All three columns from MIGRATION_analytics_games_finalization_clock.sql must exist. */
export const FINALIZATION_COLUMNS_SQL = `
  select count(*)::int as n
  from information_schema.columns
  where table_schema = 'analytics' and table_name = 'games'
    and column_name in ('finalized_at', 'status_observed_at', 'finalization_state')
`;

/** Both columns from db/schemas/MIGRATION_analytics_games_season_phase.sql must exist. */
export const SEASON_PHASE_COLUMNS_SQL = `
  select count(*)::int as n
  from information_schema.columns
  where table_schema = 'analytics' and table_name = 'games'
    and column_name in ('season_phase', 'season_phase_source')
`;

/** Read-only. Loads by ET date regardless of season so cross-season rows are reported, not hidden. */
export const READINESS_ROWS_SQL = `
  select game_id, season, start_time, season_phase, season_phase_source
  from analytics.games
  where (start_time at time zone 'America/New_York')::date between $1::date and $2::date
  order by start_time, game_id
`;

/** Only fills an UNCLASSIFIED row; never downgrades or overwrites an existing phase. */
export const APPLY_SEASON_PHASE_SQL = `
  update analytics.games
  set season_phase = $2, season_phase_source = $3
  where game_id = $1 and season_phase = 'UNCLASSIFIED' and $2 <> 'UNCLASSIFIED'
`;

function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const raw = String(value);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

function mapRow(row: {
  game_id: string;
  season: string;
  start_time: unknown;
  status: string | null;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  venue: string | null;
  finalized_at?: unknown;
  status_observed_at?: unknown;
}): LocalGameRow {
  const clockPresent = 'finalized_at' in row || 'status_observed_at' in row;
  return {
    gameId: String(row.game_id),
    season: String(row.season),
    startTime: toIso(row.start_time),
    status: row.status,
    homeTeamId: String(row.home_team_id),
    awayTeamId: String(row.away_team_id),
    homeScore: row.home_score == null ? null : Number(row.home_score),
    awayScore: row.away_score == null ? null : Number(row.away_score),
    venue: row.venue,
    ...(clockPresent
      ? {
          finalizedAt: toIso(row.finalized_at),
          statusObservedAt: toIso(row.status_observed_at),
          finalizationClock: row.finalized_at == null ? ('missing' as const) : ('recorded' as const),
        }
      : {}),
  };
}

/** One small pool shared by the game store and the acquisition ledger writer. */
export function createStatusSyncPool(env: Record<string, string | undefined> = process.env): Pool {
  return createLambdaPgPool(env);
}

/** `pool` given → the caller owns it and close() does not end it. */
export function createPostgresGameStatusStore(
  env: Record<string, string | undefined> = process.env,
  pool?: Pool
): ClosableGameStatusStore {
  const ownsPool = !pool;
  const db = pool ?? createStatusSyncPool(env);
  let seasonPhaseSupport: Promise<boolean> | null = null;
  let finalizationSupport: Promise<boolean> | null = null;
  const supportsFinalization = () => {
    finalizationSupport ??= db.query(FINALIZATION_COLUMNS_SQL).then((r) => Number(r.rows[0]?.n ?? 0) === 3);
    return finalizationSupport;
  };
  const supportsSeasonPhase = () => {
    seasonPhaseSupport ??= db.query(SEASON_PHASE_COLUMNS_SQL).then((r) => Number(r.rows[0]?.n ?? 0) === 2);
    return seasonPhaseSupport;
  };

  return {
    async getById(gameId) {
      const clock = await supportsFinalization();
      const result = await db.query(clock ? SELECT_FINALIZATION_SQL : SELECT_GAME_SQL, [gameId]);
      if (result.rowCount === 0) return null;
      return mapRow(result.rows[0]);
    },
    async upsert(row) {
      if (await supportsFinalization()) {
        await db.query(FINALIZATION_CLOCK_UPSERT_SQL, [
          row.gameId,
          row.season,
          row.startTime,
          row.status,
          row.homeTeamId,
          row.awayTeamId,
          row.homeScore,
          row.awayScore,
          row.venue,
          row.observedAt ?? null,
          classifyAuthoritativeGameState(row.status),
        ]);
        return;
      }
      await db.query(ANALYTICS_GAMES_FINAL_PRESERVE_UPSERT_SQL, [
        row.gameId,
        row.season,
        row.startTime,
        row.status,
        row.homeTeamId,
        row.awayTeamId,
        row.homeScore,
        row.awayScore,
        row.venue,
      ]);
    },
    supportsSeasonPhase,
    async applySeasonPhase(gameId, phase) {
      if (phase.phase === 'PRESEASON') {
        throw new Error(`game-status-sync refuses to label ${gameId} PRESEASON in analytics.games`);
      }
      await db.query(APPLY_SEASON_PHASE_SQL, [gameId, phase.phase, phase.source]);
    },
    async loadReadinessRows(startDate, endDate) {
      if (!(await supportsSeasonPhase())) return null;
      const result = await db.query(READINESS_ROWS_SQL, [startDate, endDate]);
      return result.rows.map(
        (r: Record<string, unknown>): ReadinessGameRow => ({
          gameId: String(r.game_id),
          season: String(r.season),
          startTime: toIso(r.start_time),
          seasonPhase: r.season_phase == null ? null : String(r.season_phase),
          seasonPhaseSource: r.season_phase_source == null ? null : String(r.season_phase_source),
        })
      );
    },
    async close() {
      if (ownsPool) await db.end();
    },
  };
}
