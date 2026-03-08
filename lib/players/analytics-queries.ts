/**
 * Player queries using analytics schema only.
 * Data sources: analytics.players, analytics.player_game_logs, analytics.player_season_averages.
 */

import { query, queryOne } from '@/lib/db';
import type { PlayerProfile, SeasonAverages, GameLog, PlayerRecentForm, PlayerVsOpponentHistory } from './types';

/**
 * Resolve a URL playerId to analytics player_id.
 * 1. Direct lookup in analytics.players
 * 2. Name-based match: public.players.player_id -> full_name -> analytics.players.player_id
 * 3. provider_id_map fallback
 */
export async function resolveAnalyticsPlayerId(playerId: string): Promise<string | null> {
  const inAnalytics = await queryOne(
    `SELECT player_id FROM analytics.players WHERE player_id = $1`,
    [playerId]
  );
  if (inAnalytics) return playerId;

  const byName = await queryOne(
    `SELECT ap.player_id FROM analytics.players ap
     JOIN public.players pp ON pp.full_name = ap.full_name
     WHERE pp.player_id = $1
     LIMIT 1`,
    [playerId]
  );
  if (byName) return String(byName.player_id);

  const mapped = await queryOne(
    `SELECT provider_id FROM provider_id_map
     WHERE entity_type = 'player' AND provider = 'balldontlie' AND internal_id = $1`,
    [playerId]
  );
  return mapped ? String(mapped.provider_id) : null;
}

export async function getAnalyticsPlayerInfo(playerId: string): Promise<PlayerProfile | null> {
  const row = await queryOne(
    `SELECT player_id, full_name, first_name, last_name, position, height, weight
     FROM analytics.players WHERE player_id = $1`,
    [playerId]
  );
  if (!row) return null;
  return {
    player_id: row.player_id,
    full_name: row.full_name,
    first_name: row.first_name ?? null,
    last_name: row.last_name ?? null,
    position: row.position ?? null,
    height: row.height ?? null,
    weight: row.weight ?? null,
    dob: null,
    active: null,
  };
}

export async function getAnalyticsPlayerSeasonStats(
  playerId: string,
  season: string | null = null
): Promise<SeasonAverages> {
  let sql = `
    SELECT 
      a.games_played,
      a.pts_avg as avg_points,
      a.reb_avg as avg_rebounds,
      a.ast_avg as avg_assists,
      a.stl_avg as avg_steals,
      a.blk_avg as avg_blocks,
      a.turnover_avg as avg_turnovers,
      a.pra_avg as pra_avg,
      a.fg_pct,
      a.fg3_pct as three_pct,
      a.ft_pct,
      COALESCE(t.total_3pm, 0)::int as total_3pm
    FROM analytics.player_season_averages a
    LEFT JOIN (
      SELECT player_id, season, SUM(three_pointers_made)::int as total_3pm
      FROM analytics.player_game_logs
      WHERE season IS NOT NULL AND season <> ''
      GROUP BY player_id, season
    ) t ON a.player_id = t.player_id AND a.season = t.season
    WHERE a.player_id = $1
  `;
  const params: (string | null)[] = [playerId];
  if (season) {
    sql += ` AND a.season = $2`;
    params.push(season);
  }
  sql += ` ORDER BY a.season DESC NULLS LAST LIMIT 1`;
  const row = await queryOne(sql, params);
  if (!row) return {};
  return {
    games_played: row.games_played ?? 0,
    games_active: row.games_played ?? 0,
    avg_points: row.avg_points != null ? Number(row.avg_points) : undefined,
    avg_rebounds: row.avg_rebounds != null ? Number(row.avg_rebounds) : undefined,
    avg_assists: row.avg_assists != null ? Number(row.avg_assists) : undefined,
    avg_steals: row.avg_steals != null ? Number(row.avg_steals) : undefined,
    avg_blocks: row.avg_blocks != null ? Number(row.avg_blocks) : undefined,
    avg_turnovers: row.avg_turnovers != null ? Number(row.avg_turnovers) : undefined,
    fg_pct: row.fg_pct != null ? Number(row.fg_pct) : undefined,
    three_pct: row.three_pct != null ? Number(row.three_pct) : undefined,
    ft_pct: row.ft_pct != null ? Number(row.ft_pct) : undefined,
    total_3pm: row.total_3pm != null ? Number(row.total_3pm) : undefined,
  };
}

export async function getAnalyticsPlayerGames(
  playerId: string,
  season: string | null = null,
  limit: number = 20
): Promise<{ games: GameLog[] }> {
  let sql = `
    SELECT 
      l.game_id,
      l.game_date::text as game_date,
      COALESCE(g.start_time, l.game_date::timestamptz) as start_time,
      l.season,
      l.team_id,
      t_team.abbreviation as team_abbr,
      t_team.full_name as team_name,
      l.opponent_team_id as opponent_id,
      t_opp.abbreviation as opponent_abbr,
      t_opp.full_name as opponent_name,
      CASE WHEN l.is_home THEN 'home' ELSE 'away' END as location,
      CASE WHEN l.is_home THEN g.home_score ELSE g.away_score END as team_score,
      CASE WHEN l.is_home THEN g.away_score ELSE g.home_score END as opponent_score,
      CASE 
        WHEN g.status IS DISTINCT FROM 'Final' THEN NULL
        WHEN l.is_home AND g.home_score > g.away_score THEN 'W'
        WHEN l.is_home AND g.home_score < g.away_score THEN 'L'
        WHEN NOT l.is_home AND g.away_score > g.home_score THEN 'W'
        WHEN NOT l.is_home AND g.away_score < g.home_score THEN 'L'
        ELSE NULL
      END as result,
      l.minutes,
      l.points,
      l.rebounds,
      l.assists,
      l.steals,
      l.blocks,
      l.turnovers,
      l.field_goals_made,
      l.field_goals_attempted,
      l.three_pointers_made,
      l.three_pointers_attempted,
      l.free_throws_made,
      l.free_throws_attempted,
      l.plus_minus,
      NULL::boolean as started,
      NULL::text as dnp_reason,
      l.offensive_rebounds,
      l.defensive_rebounds,
      l.personal_fouls
    FROM analytics.player_game_logs l
    JOIN analytics.games g ON l.game_id = g.game_id
    JOIN analytics.teams t_team ON l.team_id = t_team.team_id
    JOIN analytics.teams t_opp ON l.opponent_team_id = t_opp.team_id
    WHERE l.player_id = $1
      AND g.status = 'Final'
      AND g.home_score IS NOT NULL
      AND g.away_score IS NOT NULL
  `;
  const params: (string | number | null)[] = [playerId];
  let nextParam = 2;
  if (season) {
    sql += ` AND l.season = $${nextParam}`;
    params.push(season);
    nextParam++;
  }
  sql += ` ORDER BY l.game_date DESC, g.start_time DESC NULLS LAST LIMIT $${nextParam}`;
  params.push(limit);

  const rows = await query(sql, params);
  const games: GameLog[] = rows.map((r: Record<string, unknown>) => ({
    game_id: String(r.game_id),
    game_date: r.game_date ? String(r.game_date) : '',
    start_time: r.start_time ? new Date(r.start_time as string).toISOString() : '',
    season: String(r.season ?? ''),
    team_id: String(r.team_id),
    team_abbr: String(r.team_abbr ?? ''),
    team_name: String(r.team_name ?? ''),
    opponent_id: String(r.opponent_id ?? ''),
    opponent_abbr: String(r.opponent_abbr ?? '???'),
    opponent_name: String(r.opponent_name ?? ''),
    location: (r.location === 'home' ? 'home' : 'away') as 'home' | 'away',
    result: (r.result as 'W' | 'L' | null) ?? null,
    team_score: r.team_score != null ? Number(r.team_score) : null,
    opponent_score: r.opponent_score != null ? Number(r.opponent_score) : null,
    minutes: r.minutes != null ? (typeof r.minutes === 'string' ? parseFloat(r.minutes) : Number(r.minutes)) : null,
    points: r.points != null ? Number(r.points) : null,
    rebounds: r.rebounds != null ? Number(r.rebounds) : null,
    assists: r.assists != null ? Number(r.assists) : null,
    steals: r.steals != null ? Number(r.steals) : null,
    blocks: r.blocks != null ? Number(r.blocks) : null,
    turnovers: r.turnovers != null ? Number(r.turnovers) : null,
    field_goals_made: r.field_goals_made != null ? Number(r.field_goals_made) : null,
    field_goals_attempted: r.field_goals_attempted != null ? Number(r.field_goals_attempted) : null,
    three_pointers_made: r.three_pointers_made != null ? Number(r.three_pointers_made) : null,
    three_pointers_attempted: r.three_pointers_attempted != null ? Number(r.three_pointers_attempted) : null,
    free_throws_made: r.free_throws_made != null ? Number(r.free_throws_made) : null,
    free_throws_attempted: r.free_throws_attempted != null ? Number(r.free_throws_attempted) : null,
    plus_minus: r.plus_minus != null ? Number(r.plus_minus) : null,
    started: r.started ?? null,
    dnp_reason: r.dnp_reason ?? null,
    offensive_rebounds: r.offensive_rebounds != null ? Number(r.offensive_rebounds) : null,
    defensive_rebounds: r.defensive_rebounds != null ? Number(r.defensive_rebounds) : null,
    personal_fouls: r.personal_fouls != null ? Number(r.personal_fouls) : null,
  }));
  return { games };
}

function mapRowToGameLog(r: Record<string, unknown>): GameLog {
  return {
    game_id: String(r.game_id),
    game_date: r.game_date ? String(r.game_date) : '',
    start_time: r.start_time ? new Date(r.start_time as string).toISOString() : '',
    season: String(r.season ?? ''),
    team_id: String(r.team_id),
    team_abbr: String(r.team_abbr ?? ''),
    team_name: String(r.team_name ?? ''),
    opponent_id: String(r.opponent_id ?? ''),
    opponent_abbr: String(r.opponent_abbr ?? '???'),
    opponent_name: String(r.opponent_name ?? ''),
    location: (r.location === 'home' ? 'home' : 'away') as 'home' | 'away',
    result: (r.result as 'W' | 'L' | null) ?? null,
    team_score: r.team_score != null ? Number(r.team_score) : null,
    opponent_score: r.opponent_score != null ? Number(r.opponent_score) : null,
    minutes: r.minutes != null ? (typeof r.minutes === 'string' ? parseFloat(r.minutes) : Number(r.minutes)) : null,
    points: r.points != null ? Number(r.points) : null,
    rebounds: r.rebounds != null ? Number(r.rebounds) : null,
    assists: r.assists != null ? Number(r.assists) : null,
    steals: r.steals != null ? Number(r.steals) : null,
    blocks: r.blocks != null ? Number(r.blocks) : null,
    turnovers: r.turnovers != null ? Number(r.turnovers) : null,
    field_goals_made: r.field_goals_made != null ? Number(r.field_goals_made) : null,
    field_goals_attempted: r.field_goals_attempted != null ? Number(r.field_goals_attempted) : null,
    three_pointers_made: r.three_pointers_made != null ? Number(r.three_pointers_made) : null,
    three_pointers_attempted: r.three_pointers_attempted != null ? Number(r.three_pointers_attempted) : null,
    free_throws_made: r.free_throws_made != null ? Number(r.free_throws_made) : null,
    free_throws_attempted: r.free_throws_attempted != null ? Number(r.free_throws_attempted) : null,
    plus_minus: r.plus_minus != null ? Number(r.plus_minus) : null,
    started: r.started ?? null,
    dnp_reason: r.dnp_reason ?? null,
    offensive_rebounds: r.offensive_rebounds != null ? Number(r.offensive_rebounds) : null,
    defensive_rebounds: r.defensive_rebounds != null ? Number(r.defensive_rebounds) : null,
    personal_fouls: r.personal_fouls != null ? Number(r.personal_fouls) : null,
  };
}

const GAME_LOG_SELECT = `
  SELECT 
    l.game_id,
    l.game_date::text as game_date,
    COALESCE(g.start_time, l.game_date::timestamptz) as start_time,
    l.season,
    l.team_id,
    t_team.abbreviation as team_abbr,
    t_team.full_name as team_name,
    l.opponent_team_id as opponent_id,
    t_opp.abbreviation as opponent_abbr,
    t_opp.full_name as opponent_name,
    CASE WHEN l.is_home THEN 'home' ELSE 'away' END as location,
    CASE WHEN l.is_home THEN g.home_score ELSE g.away_score END as team_score,
    CASE WHEN l.is_home THEN g.away_score ELSE g.home_score END as opponent_score,
    CASE 
      WHEN g.status IS DISTINCT FROM 'Final' THEN NULL
      WHEN l.is_home AND g.home_score > g.away_score THEN 'W'
      WHEN l.is_home AND g.home_score < g.away_score THEN 'L'
      WHEN NOT l.is_home AND g.away_score > g.home_score THEN 'W'
      WHEN NOT l.is_home AND g.away_score < g.home_score THEN 'L'
      ELSE NULL
    END as result,
    l.minutes,
    l.points,
    l.rebounds,
    l.assists,
    l.steals,
    l.blocks,
    l.turnovers,
    l.field_goals_made,
    l.field_goals_attempted,
    l.three_pointers_made,
    l.three_pointers_attempted,
    l.free_throws_made,
    l.free_throws_attempted,
    l.plus_minus,
    NULL::boolean as started,
    NULL::text as dnp_reason,
    l.offensive_rebounds,
    l.defensive_rebounds,
    l.personal_fouls
  FROM analytics.player_game_logs l
  JOIN analytics.games g ON l.game_id = g.game_id
  JOIN analytics.teams t_team ON l.team_id = t_team.team_id
  JOIN analytics.teams t_opp ON l.opponent_team_id = t_opp.team_id
  WHERE l.player_id = $1
    AND g.status = 'Final'
    AND g.home_score IS NOT NULL
    AND g.away_score IS NOT NULL
`;

/**
 * Last N games aggregated (pts, reb, ast, pra, minutes) for matchup "Recent Form".
 */
export async function getPlayerRecentForm(
  playerId: string,
  limit: number = 5
): Promise<PlayerRecentForm> {
  const sql = `
    WITH last_n AS (
      ${GAME_LOG_SELECT}
      ORDER BY l.game_date DESC, g.start_time DESC NULLS LAST
      LIMIT $2
    )
    SELECT
      COUNT(*)::int as games_played,
      AVG(points)::numeric as avg_pts,
      AVG(rebounds)::numeric as avg_reb,
      AVG(assists)::numeric as avg_ast,
      AVG((COALESCE(points,0) + COALESCE(rebounds,0) + COALESCE(assists,0)))::numeric as avg_pra,
      AVG(CASE WHEN minutes IS NOT NULL AND minutes ~ '^[0-9]+\.?[0-9]*$' THEN minutes::numeric ELSE NULL END)::numeric as avg_minutes
    FROM last_n
  `;
  const row = await queryOne(sql, [playerId, limit]);
  if (!row || Number(row.games_played) === 0) {
    return {
      games_played: 0,
      avg_pts: 0,
      avg_reb: 0,
      avg_ast: 0,
      avg_pra: 0,
      avg_minutes: null,
    };
  }
  const avgMin = row.avg_minutes != null ? Number(row.avg_minutes) : null;
  return {
    games_played: Number(row.games_played),
    avg_pts: Number(row.avg_pts ?? 0),
    avg_reb: Number(row.avg_reb ?? 0),
    avg_ast: Number(row.avg_ast ?? 0),
    avg_pra: Number(row.avg_pra ?? 0),
    avg_minutes: avgMin,
  };
}

/**
 * Player's stats vs a specific opponent (for "Vs Opponent History").
 */
export async function getPlayerVsOpponentHistory(
  playerId: string,
  opponentTeamId: string,
  season?: string | null
): Promise<PlayerVsOpponentHistory> {
  let sql = GAME_LOG_SELECT + ` AND l.opponent_team_id = $2 `;
  const params: (string | number | null)[] = [playerId, opponentTeamId];
  let nextParam = 3;
  if (season) {
    sql += ` AND l.season = $${nextParam}`;
    params.push(season);
    nextParam++;
  }
  sql += ` ORDER BY l.game_date ASC, g.start_time ASC NULLS LAST`;

  const rows = await query(sql, params);
  const games: GameLog[] = rows.map((r) => mapRowToGameLog(r as Record<string, unknown>));

  if (games.length === 0) {
    return { games_played: 0, avg_pts: 0, avg_reb: 0, avg_ast: 0, avg_pra: 0, games: [] };
  }

  const sumPts = games.reduce((a, g) => a + (g.points ?? 0), 0);
  const sumReb = games.reduce((a, g) => a + (g.rebounds ?? 0), 0);
  const sumAst = games.reduce((a, g) => a + (g.assists ?? 0), 0);
  const sumPra = games.reduce((a, g) => a + (g.points ?? 0) + (g.rebounds ?? 0) + (g.assists ?? 0), 0);
  const n = games.length;

  return {
    games_played: n,
    avg_pts: sumPts / n,
    avg_reb: sumReb / n,
    avg_ast: sumAst / n,
    avg_pra: sumPra / n,
    games,
  };
}
