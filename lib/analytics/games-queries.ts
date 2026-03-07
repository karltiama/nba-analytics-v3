/**
 * Schedule and next-game queries using analytics schema only.
 * Data sources: analytics.games, analytics.teams, analytics.player_game_logs.
 *
 * --- Schema verification: analytics.games (db/schemas/analytics_schema.sql) ---
 * - game_id (PK) -> id
 * - season
 * - start_time (timestamptz) -> game date and game_datetime (no separate game_date column)
 * - home_team_id, away_team_id
 * - home_score, away_score (not home_team_score/away_team_score)
 * - status
 * - is_postseason: not present in schema; omit unless added via migration
 *
 * Next game definition: earliest future game involving the team, ordered by start_time ASC.
 * "Future" = (start_time > now() OR start_time IS NULL with game in future) and status IS DISTINCT FROM 'Final'.
 * We use start_time > now() and status IS DISTINCT FROM 'Final' for safety.
 */

import { query, queryOne } from '@/lib/db';

export interface TeamMatchupGame {
  game_id: string;
  season: string;
  start_time: string | null;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  status: string | null;
  /** For the given team: opponent's team_id */
  opponent_team_id: string;
  opponent_abbr: string;
  opponent_name: string;
  /** True if the given team is the home team */
  is_home: boolean;
  /** Given team's abbreviation (for display) */
  team_abbr: string;
  team_name: string;
}

function rowToMatchup(row: Record<string, unknown>, teamId: string): TeamMatchupGame {
  const isHome = row.home_team_id === teamId;
  return {
    game_id: String(row.game_id),
    season: String(row.season ?? ''),
    start_time: row.start_time ? new Date(row.start_time as string).toISOString() : null,
    home_team_id: String(row.home_team_id),
    away_team_id: String(row.away_team_id),
    home_score: row.home_score != null ? Number(row.home_score) : null,
    away_score: row.away_score != null ? Number(row.away_score) : null,
    status: row.status != null ? String(row.status) : null,
    opponent_team_id: String(isHome ? row.away_team_id : row.home_team_id),
    opponent_abbr: String(isHome ? row.away_abbr : row.home_abbr),
    opponent_name: String(isHome ? row.away_name : row.home_name),
    is_home: isHome,
    team_abbr: String(isHome ? row.home_abbr : row.away_abbr),
    team_name: String(isHome ? row.home_name : row.away_name),
  };
}

const TEAM_GAME_SELECT = `
  SELECT
    g.game_id,
    g.season,
    g.start_time,
    g.home_team_id,
    g.away_team_id,
    g.home_score,
    g.away_score,
    g.status,
    t_home.abbreviation as home_abbr,
    t_home.full_name as home_name,
    t_away.abbreviation as away_abbr,
    t_away.full_name as away_name
  FROM analytics.games g
  JOIN analytics.teams t_home ON g.home_team_id = t_home.team_id
  JOIN analytics.teams t_away ON g.away_team_id = t_away.team_id
`;

/**
 * Next game for a team: earliest future game by start_time ASC.
 * Future = start_time > now() and status IS DISTINCT FROM 'Final'.
 */
export async function getNextGameForTeam(teamId: string): Promise<TeamMatchupGame | null> {
  const row = await queryOne(
    `${TEAM_GAME_SELECT}
     WHERE (g.home_team_id = $1 OR g.away_team_id = $1)
       AND g.start_time > now()
       AND (g.status IS NULL OR g.status IS DISTINCT FROM 'Final')
     ORDER BY g.start_time ASC NULLS LAST
     LIMIT 1`,
    [teamId]
  );
  if (!row) return null;
  return rowToMatchup(row as Record<string, unknown>, teamId);
}

/**
 * Current team is derived from the player's most recent game in analytics.player_game_logs
 * (analytics.players does not have team_id). Then returns getNextGameForTeam(teamId).
 */
export async function getNextGameForPlayer(playerId: string): Promise<TeamMatchupGame | null> {
  const latest = await queryOne(
    `SELECT l.team_id
     FROM analytics.player_game_logs l
     JOIN analytics.games g ON l.game_id = g.game_id
     WHERE l.player_id = $1
     ORDER BY l.game_date DESC NULLS LAST, g.start_time DESC NULLS LAST
     LIMIT 1`,
    [playerId]
  );
  if (!latest?.team_id) return null;
  return getNextGameForTeam(String(latest.team_id));
}

/**
 * Upcoming games for a team: future games ordered by start_time ASC.
 */
export async function getUpcomingGamesForTeam(
  teamId: string,
  limit: number = 5
): Promise<TeamMatchupGame[]> {
  const rows = await query(
    `${TEAM_GAME_SELECT}
     WHERE (g.home_team_id = $1 OR g.away_team_id = $1)
       AND g.start_time > now()
       AND (g.status IS NULL OR g.status IS DISTINCT FROM 'Final')
     ORDER BY g.start_time ASC NULLS LAST
     LIMIT $2`,
    [teamId, limit]
  );
  return rows.map((r) => rowToMatchup(r as Record<string, unknown>, teamId));
}

/**
 * Recent (past) games for a team: status = 'Final', ordered by start_time DESC.
 */
export async function getRecentGamesForTeam(
  teamId: string,
  limit: number = 5
): Promise<TeamMatchupGame[]> {
  const rows = await query(
    `${TEAM_GAME_SELECT}
     WHERE (g.home_team_id = $1 OR g.away_team_id = $1)
       AND g.status = 'Final'
     ORDER BY g.start_time DESC NULLS LAST
     LIMIT $2`,
    [teamId, limit]
  );
  return rows.map((r) => rowToMatchup(r as Record<string, unknown>, teamId));
}
