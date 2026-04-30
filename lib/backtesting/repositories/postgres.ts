/**
 * Read-only Postgres repository for backtesting inputs.
 *
 * This module intentionally returns plain `PlayerGameLog[]` rows for the pure
 * strategy layer. It does not run strategies, persist summaries, or write S3
 * artifacts. Slice 3's key invariant is the lookback window: fetch from season
 * start through evaluationEndDate so strategies can compute pre-window
 * baselines while only emitting signals inside the requested evaluation window.
 */

import { query, queryOne } from '@/lib/db';
import type { PlayerGameLog } from '@/lib/backtesting/types';

export type FetchPlayerGameLogsArgs = {
  season: number;
  evaluationEndDate: string;
};

export type PlayerGameLogRepositoryResult = {
  seasonStartDate: string;
  evaluationEndDate: string;
  logs: PlayerGameLog[];
};

type SeasonStartRow = {
  season_start_date: string | null;
};

type PlayerGameLogRow = {
  player_id: string;
  player_name: string | null;
  game_id: string;
  game_date: string;
  team_abbr: string | null;
  opponent_abbr: string | null;
  minutes: string | number | null;
  points: string | number | null;
  rebounds: string | number | null;
  assists: string | number | null;
  threes: string | number | null;
};

export const SEASON_START_SQL = `
  SELECT
    to_char(min((g.start_time AT TIME ZONE 'America/New_York')::date), 'YYYY-MM-DD') AS season_start_date
  FROM analytics.games g
  WHERE g.season = $1::text
    AND g.start_time IS NOT NULL
`;

export const PLAYER_GAME_LOGS_FOR_BACKTEST_SQL = `
  SELECT
    pgl.player_id::text AS player_id,
    p.full_name AS player_name,
    pgl.game_id::text AS game_id,
    to_char(
      COALESCE(pgl.game_date, (g.start_time AT TIME ZONE 'America/New_York')::date),
      'YYYY-MM-DD'
    ) AS game_date,
    team.abbreviation AS team_abbr,
    opponent.abbreviation AS opponent_abbr,
    pgl.minutes,
    COALESCE(pgl.points, 0) AS points,
    COALESCE(pgl.rebounds, 0) AS rebounds,
    COALESCE(pgl.assists, 0) AS assists,
    COALESCE(pgl.three_pointers_made, 0) AS threes
  FROM analytics.player_game_logs pgl
  JOIN analytics.games g ON g.game_id = pgl.game_id
  LEFT JOIN analytics.players p ON p.player_id = pgl.player_id
  LEFT JOIN analytics.teams team ON team.team_id = pgl.team_id
  LEFT JOIN analytics.teams opponent
    ON opponent.team_id = COALESCE(
      pgl.opponent_team_id,
      CASE
        WHEN pgl.team_id = g.home_team_id THEN g.away_team_id
        WHEN pgl.team_id = g.away_team_id THEN g.home_team_id
        ELSE NULL
      END
    )
  WHERE g.season = $1::text
    AND COALESCE(pgl.game_date, (g.start_time AT TIME ZONE 'America/New_York')::date) >= $2::date
    AND COALESCE(pgl.game_date, (g.start_time AT TIME ZONE 'America/New_York')::date) <= $3::date
  ORDER BY pgl.player_id, COALESCE(pgl.game_date, (g.start_time AT TIME ZONE 'America/New_York')::date), pgl.game_id
`;

function asNumber(value: string | number | null): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse common basketball minutes shapes safely:
 * - number: 32
 * - decimal-ish string: "32", "32.5"
 * - clock-ish string: "32:14" -> 32 (matches existing app display semantics)
 */
function parseMinutes(value: string | number | null): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = value.trim().match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function mapRow(row: PlayerGameLogRow): PlayerGameLog {
  return {
    player_id: String(row.player_id),
    player_name: row.player_name ?? null,
    game_id: String(row.game_id),
    game_date: String(row.game_date),
    team_abbr: row.team_abbr ?? null,
    opponent_abbr: row.opponent_abbr ?? null,
    minutes: parseMinutes(row.minutes),
    points: asNumber(row.points),
    rebounds: asNumber(row.rebounds),
    assists: asNumber(row.assists),
    threes: asNumber(row.threes),
  };
}

export async function fetchPlayerGameLogsForBacktest(
  args: FetchPlayerGameLogsArgs
): Promise<PlayerGameLogRepositoryResult> {
  const seasonStart = await queryOne<SeasonStartRow>(SEASON_START_SQL, [String(args.season)]);
  if (!seasonStart?.season_start_date) {
    throw new Error(`No analytics.games rows found for season=${args.season}`);
  }

  const rows = await query<PlayerGameLogRow>(PLAYER_GAME_LOGS_FOR_BACKTEST_SQL, [
    String(args.season),
    seasonStart.season_start_date,
    args.evaluationEndDate,
  ]);

  return {
    seasonStartDate: seasonStart.season_start_date,
    evaluationEndDate: args.evaluationEndDate,
    logs: rows.map(mapRow),
  };
}
