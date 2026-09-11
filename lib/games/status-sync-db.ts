/**
 * analytics.games adapter for frequent status sync.
 * Per-statement upserts (no slate-wide transaction) so one bad row cannot roll back others.
 * Reuses ANALYTICS_GAMES_FINAL_PRESERVE_UPSERT_SQL. Does not import lib/db.ts (that module
 * throws at load if SUPABASE_DB_URL is missing, which would break the freeze path).
 */

import { Pool } from 'pg';
import { ANALYTICS_GAMES_FINAL_PRESERVE_UPSERT_SQL } from '@/lib/betting/final-preserve';
import type { GameStatusStore, LocalGameRow } from './status-sync';

export type ClosableGameStatusStore = GameStatusStore & {
  close(): Promise<void>;
};

const SELECT_GAME_SQL = `
  select game_id, season, start_time, status, home_team_id, away_team_id, home_score, away_score, venue
  from analytics.games
  where game_id = $1
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
}): LocalGameRow {
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
  };
}

export function createPostgresGameStatusStore(
  env: Record<string, string | undefined> = process.env
): ClosableGameStatusStore {
  const connectionString = (env.SUPABASE_DB_URL ?? '').trim();
  if (!connectionString) {
    throw new Error('Missing SUPABASE_DB_URL environment variable');
  }
  const useSsl =
    connectionString.includes('supabase.co') || connectionString.includes('pooler.supabase.com');
  const pool = new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: Number(env.DB_CONNECTION_TIMEOUT_MS ?? 10_000),
    statement_timeout: Number(env.DB_STATEMENT_TIMEOUT_MS ?? 15_000),
  });

  return {
    async getById(gameId) {
      const result = await pool.query(SELECT_GAME_SQL, [gameId]);
      if (result.rowCount === 0) return null;
      return mapRow(result.rows[0]);
    },
    async upsert(row) {
      await pool.query(ANALYTICS_GAMES_FINAL_PRESERVE_UPSERT_SQL, [
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
    async close() {
      await pool.end();
    },
  };
}
