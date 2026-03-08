/**
 * Team queries using analytics schema only.
 * Data sources: analytics.teams, analytics.team_game_stats, analytics.team_season_averages.
 */

import { query, queryOne } from '@/lib/db';
import type { TeamInfo, TeamGameStats, TeamSeasonAverages, TeamAdvancedMetrics, TeamTrendPoint } from './types';

/**
 * Resolve a team identifier (team_id or abbreviation) to an analytics team_id.
 */
export async function resolveAnalyticsTeamId(teamIdOrAbbr: string): Promise<string | null> {
  const byId = await queryOne<{ team_id: string }>(
    `SELECT team_id FROM analytics.teams WHERE team_id = $1`,
    [teamIdOrAbbr]
  );
  if (byId) return byId.team_id;

  const byAbbr = await queryOne<{ team_id: string }>(
    `SELECT team_id FROM analytics.teams WHERE abbreviation = $1`,
    [teamIdOrAbbr.toUpperCase()]
  );
  return byAbbr?.team_id ?? null;
}

/**
 * Basic team profile from analytics.teams.
 */
export async function getTeamById(teamId: string): Promise<TeamInfo | null> {
  const row = await queryOne(
    `SELECT team_id, abbreviation, full_name, name, city, conference, division
     FROM analytics.teams WHERE team_id = $1`,
    [teamId]
  );
  if (!row) return null;
  return {
    team_id: row.team_id,
    abbreviation: row.abbreviation,
    full_name: row.full_name,
    name: row.name,
    city: row.city ?? null,
    conference: row.conference ?? null,
    division: row.division ?? null,
  };
}

/**
 * Team season averages + record for the given (or latest) season.
 */
export async function getTeamSeasonAverages(
  teamId: string,
  season?: string
): Promise<TeamSeasonAverages | null> {
  let sql = `
    SELECT team_id, season, games_played,
           avg_points, avg_rebounds, avg_assists, avg_steals, avg_blocks, avg_turnovers,
           avg_fgm, avg_fga, avg_3pm, avg_3pa, avg_ftm, avg_fta,
           avg_points_allowed, wins, losses, win_pct,
           home_wins, home_losses, away_wins, away_losses,
           avg_offensive_rating, avg_defensive_rating, avg_pace, avg_efg_pct, avg_tov_pct, avg_orb_pct
    FROM analytics.team_season_averages
    WHERE team_id = $1
  `;
  const params: string[] = [teamId];
  if (season) {
    sql += ` AND season = $2`;
    params.push(season);
  }
  sql += ` ORDER BY season DESC LIMIT 1`;

  const row = await queryOne(sql, params);
  if (!row) return null;
  return {
    team_id: row.team_id,
    season: row.season,
    games_played: Number(row.games_played),
    avg_points: row.avg_points != null ? Number(row.avg_points) : null,
    avg_rebounds: row.avg_rebounds != null ? Number(row.avg_rebounds) : null,
    avg_assists: row.avg_assists != null ? Number(row.avg_assists) : null,
    avg_steals: row.avg_steals != null ? Number(row.avg_steals) : null,
    avg_blocks: row.avg_blocks != null ? Number(row.avg_blocks) : null,
    avg_turnovers: row.avg_turnovers != null ? Number(row.avg_turnovers) : null,
    avg_fgm: row.avg_fgm != null ? Number(row.avg_fgm) : null,
    avg_fga: row.avg_fga != null ? Number(row.avg_fga) : null,
    avg_3pm: row.avg_3pm != null ? Number(row.avg_3pm) : null,
    avg_3pa: row.avg_3pa != null ? Number(row.avg_3pa) : null,
    avg_ftm: row.avg_ftm != null ? Number(row.avg_ftm) : null,
    avg_fta: row.avg_fta != null ? Number(row.avg_fta) : null,
    avg_points_allowed: row.avg_points_allowed != null ? Number(row.avg_points_allowed) : null,
    wins: Number(row.wins),
    losses: Number(row.losses),
    win_pct: row.win_pct != null ? Number(row.win_pct) : null,
    home_wins: Number(row.home_wins ?? 0),
    home_losses: Number(row.home_losses ?? 0),
    away_wins: Number(row.away_wins ?? 0),
    away_losses: Number(row.away_losses ?? 0),
    avg_offensive_rating: row.avg_offensive_rating != null ? Number(row.avg_offensive_rating) : null,
    avg_defensive_rating: row.avg_defensive_rating != null ? Number(row.avg_defensive_rating) : null,
    avg_pace: row.avg_pace != null ? Number(row.avg_pace) : null,
    avg_efg_pct: row.avg_efg_pct != null ? Number(row.avg_efg_pct) : null,
    avg_tov_pct: row.avg_tov_pct != null ? Number(row.avg_tov_pct) : null,
    avg_orb_pct: row.avg_orb_pct != null ? Number(row.avg_orb_pct) : null,
  };
}

/**
 * Advanced metrics for a team (from analytics.team_season_averages).
 */
export async function getTeamAdvancedMetrics(
  teamId: string,
  season?: string
): Promise<TeamAdvancedMetrics | null> {
  let sql = `
    SELECT team_id, season, games_played, wins, losses,
           avg_offensive_rating, avg_defensive_rating, avg_pace, avg_efg_pct, avg_tov_pct, avg_orb_pct
    FROM analytics.team_season_averages
    WHERE team_id = $1
  `;
  const params: string[] = [teamId];
  if (season) {
    sql += ` AND season = $2`;
    params.push(season);
  }
  sql += ` ORDER BY season DESC LIMIT 1`;

  const row = await queryOne(sql, params);
  if (!row) return null;
  return {
    team_id: row.team_id,
    season: row.season,
    games_played: Number(row.games_played),
    wins: Number(row.wins),
    losses: Number(row.losses),
    avg_offensive_rating: row.avg_offensive_rating != null ? Number(row.avg_offensive_rating) : null,
    avg_defensive_rating: row.avg_defensive_rating != null ? Number(row.avg_defensive_rating) : null,
    avg_pace: row.avg_pace != null ? Number(row.avg_pace) : null,
    avg_efg_pct: row.avg_efg_pct != null ? Number(row.avg_efg_pct) : null,
    avg_tov_pct: row.avg_tov_pct != null ? Number(row.avg_tov_pct) : null,
    avg_orb_pct: row.avg_orb_pct != null ? Number(row.avg_orb_pct) : null,
  };
}

/**
 * Recent games for a team, most recent first. Includes opponent info.
 */
export async function getTeamRecentGames(
  teamId: string,
  limit: number = 10,
  season?: string
): Promise<TeamGameStats[]> {
  let sql = `
    SELECT
      tgs.team_id, tgs.game_id, tgs.season,
      tgs.game_date::text as game_date,
      tgs.opponent_team_id,
      opp.abbreviation as opponent_abbr,
      opp.full_name as opponent_name,
      tgs.is_home,
      tgs.team_points, tgs.team_rebounds, tgs.team_assists,
      tgs.team_steals, tgs.team_blocks, tgs.team_turnovers,
      tgs.team_fgm, tgs.team_fga, tgs.team_3pm, tgs.team_3pa,
      tgs.team_ftm, tgs.team_fta,
      tgs.points_allowed, tgs.result
    FROM analytics.team_game_stats tgs
    JOIN analytics.teams opp ON opp.team_id = tgs.opponent_team_id
    WHERE tgs.team_id = $1
      AND tgs.points_allowed IS NOT NULL
      AND tgs.result IS NOT NULL
  `;
  const params: (string | number)[] = [teamId];
  let nextParam = 2;
  if (season) {
    sql += ` AND tgs.season = $${nextParam}`;
    params.push(season);
    nextParam++;
  }
  sql += ` ORDER BY tgs.game_date DESC NULLS LAST LIMIT $${nextParam}`;
  params.push(limit);

  const rows = await query(sql, params);
  return rows.map((r: Record<string, unknown>) => ({
    team_id: String(r.team_id),
    game_id: String(r.game_id),
    season: String(r.season),
    game_date: String(r.game_date ?? ''),
    opponent_team_id: String(r.opponent_team_id),
    opponent_abbr: String(r.opponent_abbr ?? ''),
    opponent_name: String(r.opponent_name ?? ''),
    is_home: Boolean(r.is_home),
    team_points: Number(r.team_points),
    team_rebounds: Number(r.team_rebounds),
    team_assists: Number(r.team_assists),
    team_steals: Number(r.team_steals),
    team_blocks: Number(r.team_blocks),
    team_turnovers: Number(r.team_turnovers),
    team_fgm: Number(r.team_fgm),
    team_fga: Number(r.team_fga),
    team_3pm: Number(r.team_3pm),
    team_3pa: Number(r.team_3pa),
    team_ftm: Number(r.team_ftm),
    team_fta: Number(r.team_fta),
    points_allowed: r.points_allowed != null ? Number(r.points_allowed) : null,
    result: (r.result as 'W' | 'L' | null) ?? null,
  }));
}

/**
 * Trend data for charting — points scored and points allowed over recent games.
 * Returns oldest-first for chart rendering.
 */
export async function getTeamTrendData(
  teamId: string,
  limit: number = 20,
  season?: string
): Promise<TeamTrendPoint[]> {
  let sql = `
    SELECT
      tgs.game_date::text as game_date,
      opp.abbreviation as opponent_abbr,
      tgs.is_home,
      tgs.team_points,
      tgs.points_allowed,
      tgs.result
    FROM analytics.team_game_stats tgs
    JOIN analytics.teams opp ON opp.team_id = tgs.opponent_team_id
    WHERE tgs.team_id = $1
      AND tgs.points_allowed IS NOT NULL
      AND tgs.result IS NOT NULL
  `;
  const params: (string | number)[] = [teamId];
  let nextParam = 2;
  if (season) {
    sql += ` AND tgs.season = $${nextParam}`;
    params.push(season);
    nextParam++;
  }
  sql += ` ORDER BY tgs.game_date DESC NULLS LAST LIMIT $${nextParam}`;
  params.push(limit);

  const rows = await query(sql, params);
  return rows
    .map((r: Record<string, unknown>) => ({
      game_date: String(r.game_date ?? ''),
      opponent_abbr: String(r.opponent_abbr ?? ''),
      is_home: Boolean(r.is_home),
      team_points: Number(r.team_points),
      points_allowed: r.points_allowed != null ? Number(r.points_allowed) : null,
      result: (r.result as 'W' | 'L' | null) ?? null,
    }))
    .reverse();
}
