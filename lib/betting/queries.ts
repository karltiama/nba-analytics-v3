import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';
import { fetchLineupsFromBallDontLie } from '@/lib/balldontlie/lineups';
import type {
  PlayerPropLineComparisonRow,
  PlayerPropLineShoppingResponse,
  PlayerPropLineBookEntry,
  PlayerPropLineBestEntry,
} from '@/lib/betting/types';

/**
 * Betting Dashboard Query Functions
 * 
 * Schedule/games sourced from analytics.games (BDL).
 * Team stats sourced from bbref_team_game_stats.
 * Odds sourced from analytics.game_odds_current.
 */

// ============================================
// GAMES QUERIES
// ============================================

export interface ScheduledGame {
  game_id: string;
  game_date: string;
  start_time: string;
  home_team_id: string;
  away_team_id: string;
  home_team_name: string;
  away_team_name: string;
  home_team_abbr: string;
  away_team_abbr: string;
  home_record: string;
  away_record: string;
  status: string;
}

export interface TeamRatings {
  team_id: string;
  offensive_rating: number;
  defensive_rating: number;
  pace: number;
  avg_points: number;
  avg_points_against: number;
  wins: number;
  losses: number;
}

/**
 * Get games for a specific date from analytics.games (BDL-sourced).
 * Game IDs match analytics.game_odds_current for odds lookups.
 */
export async function getGamesForDate(date: string) {
  // Use ET timezone range so late-night ET games (stored as next-day UTC) are included
  // and early-morning UTC games from the prior ET day are excluded.
  const gamesResult = await query(`
    SELECT
      g.game_id,
      (g.start_time AT TIME ZONE 'America/New_York')::date AS game_date,
      g.start_time,
      g.home_team_id,
      g.away_team_id,
      ht.full_name AS home_team_name,
      at.full_name AS away_team_name,
      ht.abbreviation AS home_team_abbr,
      at.abbreviation AS away_team_abbr,
      g.home_score,
      g.away_score,
      g.status
    FROM analytics.games g
    JOIN analytics.teams ht ON g.home_team_id = ht.team_id
    JOIN analytics.teams at ON g.away_team_id = at.team_id
    WHERE g.start_time >= ($1::timestamp AT TIME ZONE 'America/New_York')
      AND g.start_time <  (($1::timestamp + interval '1 day') AT TIME ZONE 'America/New_York')
    ORDER BY g.start_time ASC
  `, [date]);

  return gamesResult;
}

/**
 * Get today's games (ET timezone)
 */
export async function getTodaysGames() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return getGamesForDate(today);
}

/**
 * Get recent completed games for the dashboard
 */
export async function getRecentGames(limit: number = 10) {
  const result = await query(`
    SELECT
      g.game_id,
      g.start_time::date AS game_date,
      g.start_time,
      g.home_team_id,
      g.away_team_id,
      ht.full_name AS home_team_name,
      at.full_name AS away_team_name,
      ht.abbreviation AS home_team_abbr,
      at.abbreviation AS away_team_abbr,
      g.home_score,
      g.away_score,
      g.status
    FROM analytics.games g
    JOIN analytics.teams ht ON g.home_team_id = ht.team_id
    JOIN analytics.teams at ON g.away_team_id = at.team_id
    WHERE g.status = 'Final'
    ORDER BY g.start_time DESC
    LIMIT $1
  `, [limit]);

  return result;
}

/**
 * Get team ratings (offensive/defensive) for all teams
 */
export async function getAllTeamRatings(): Promise<Record<string, TeamRatings>> {
  const result = await query(`
    SELECT
      team_id,
      avg_offensive_rating as offensive_rating,
      avg_defensive_rating as defensive_rating,
      avg_pace as pace,
      avg_points,
      avg_points_allowed as avg_points_against,
      wins,
      losses
    FROM analytics.team_season_averages
    ORDER BY team_id
  `);

  const ratingsMap: Record<string, TeamRatings> = {};
  result.forEach((row: any) => {
    ratingsMap[row.team_id] = {
      team_id: row.team_id,
      offensive_rating: parseFloat(row.offensive_rating) || 0,
      defensive_rating: parseFloat(row.defensive_rating) || 0,
      pace: parseFloat(row.pace) || 0,
      avg_points: parseFloat(row.avg_points) || 0,
      avg_points_against: parseFloat(row.avg_points_against) || 0,
      wins: parseInt(row.wins) || 0,
      losses: parseInt(row.losses) || 0,
    };
  });

  return ratingsMap;
}

/**
 * Get team's recent form (last 5 games)
 */
export async function getTeamRecentForm(teamId: string, limit: number = 5) {
  const result = await query(`
    SELECT
      tgs.game_id,
      tgs.game_date,
      tgs.is_home,
      tgs.team_points as team_score,
      tgs.points_allowed as opponent_score,
      tgs.result,
      opp.abbreviation as opponent_abbr
    FROM analytics.team_game_stats tgs
    JOIN analytics.teams opp ON opp.team_id = tgs.opponent_team_id
    WHERE tgs.team_id = $1
      AND tgs.result IS NOT NULL
      AND tgs.points_allowed IS NOT NULL
    ORDER BY tgs.game_date DESC NULLS LAST
    LIMIT $2
  `, [teamId, limit]);

  return result;
}

// ============================================
// PLAYER QUERIES
// ============================================

export interface TrendingPlayer {
  player_id: string;
  full_name: string;
  team_id: string;
  team_abbr: string;
  position: string;
  games_played: number;
  // Season averages
  season_avg_points: number;
  season_avg_rebounds: number;
  season_avg_assists: number;
  // L5 averages
  l5_avg_points: number;
  l5_avg_rebounds: number;
  l5_avg_assists: number;
  // Recent game scores for sparkline
  recent_points: number[];
  recent_rebounds: number[];
  recent_assists: number[];
  // Trend percentage (L5 vs Season)
  points_trend_pct: number;
  trend_direction: 'up' | 'down';
}

/**
 * Get trending players (players performing above/below their average)
 */
export async function getTrendingPlayers(limit: number = 10): Promise<TrendingPlayer[]> {
  // Get season stats and L5 stats for all active players
  const result = await query(`
    WITH player_season AS (
      SELECT 
        bpgs.player_id,
        p.full_name,
        bpgs.team_id,
        t.abbreviation as team_abbr,
        p.position,
        COUNT(DISTINCT bpgs.game_id) as games_played,
        AVG(bpgs.points) as season_avg_points,
        AVG(bpgs.rebounds) as season_avg_rebounds,
        AVG(bpgs.assists) as season_avg_assists
      FROM bbref_player_game_stats bpgs
      JOIN players p ON bpgs.player_id = p.player_id
      JOIN teams t ON bpgs.team_id = t.team_id
      JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
      WHERE bg.status = 'Final'
        AND bpgs.dnp_reason IS NULL
        AND bpgs.minutes > 10
      GROUP BY bpgs.player_id, p.full_name, bpgs.team_id, t.abbreviation, p.position
      HAVING COUNT(DISTINCT bpgs.game_id) >= 5
    ),
    player_l5 AS (
      SELECT 
        player_id,
        AVG(points) as l5_avg_points,
        AVG(rebounds) as l5_avg_rebounds,
        AVG(assists) as l5_avg_assists
      FROM (
        SELECT 
          bpgs.player_id,
          bpgs.points,
          bpgs.rebounds,
          bpgs.assists,
          ROW_NUMBER() OVER (PARTITION BY bpgs.player_id ORDER BY bg.game_date DESC) as rn
        FROM bbref_player_game_stats bpgs
        JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
        WHERE bg.status = 'Final'
          AND bpgs.dnp_reason IS NULL
          AND bpgs.minutes > 10
      ) recent
      WHERE rn <= 5
      GROUP BY player_id
    )
    SELECT 
      ps.player_id,
      ps.full_name,
      ps.team_id,
      ps.team_abbr,
      ps.position,
      ps.games_played,
      ps.season_avg_points,
      ps.season_avg_rebounds,
      ps.season_avg_assists,
      pl5.l5_avg_points,
      pl5.l5_avg_rebounds,
      pl5.l5_avg_assists,
      -- Calculate trend percentage
      CASE 
        WHEN ps.season_avg_points > 0 THEN 
          ((pl5.l5_avg_points - ps.season_avg_points) / ps.season_avg_points) * 100
        ELSE 0
      END as points_trend_pct
    FROM player_season ps
    JOIN player_l5 pl5 ON ps.player_id = pl5.player_id
    WHERE ps.season_avg_points >= 10
    ORDER BY ABS(((pl5.l5_avg_points - ps.season_avg_points) / NULLIF(ps.season_avg_points, 0)) * 100) DESC
    LIMIT $1
  `, [limit]);

  // Get recent game scores for each player
  const playerIds = result.map((r: any) => r.player_id);
  
  if (playerIds.length === 0) {
    return [];
  }

  const recentGamesResult = await query(`
    SELECT 
      player_id,
      points,
      rebounds,
      assists,
      game_date
    FROM (
      SELECT 
        bpgs.player_id,
        bpgs.points,
        bpgs.rebounds,
        bpgs.assists,
        bg.game_date,
        ROW_NUMBER() OVER (PARTITION BY bpgs.player_id ORDER BY bg.game_date DESC) as rn
      FROM bbref_player_game_stats bpgs
      JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
      WHERE bpgs.player_id = ANY($1)
        AND bg.status = 'Final'
        AND bpgs.dnp_reason IS NULL
    ) recent
    WHERE rn <= 5
    ORDER BY player_id, game_date ASC
  `, [playerIds]);

  // Group recent games by player
  const recentGamesMap: Record<string, { points: number[], rebounds: number[], assists: number[] }> = {};
  recentGamesResult.forEach((row: any) => {
    if (!recentGamesMap[row.player_id]) {
      recentGamesMap[row.player_id] = { points: [], rebounds: [], assists: [] };
    }
    recentGamesMap[row.player_id].points.push(row.points);
    recentGamesMap[row.player_id].rebounds.push(row.rebounds);
    recentGamesMap[row.player_id].assists.push(row.assists);
  });

  // Combine data
  return result.map((row: any) => {
    const recentGames = recentGamesMap[row.player_id] || { points: [], rebounds: [], assists: [] };
    const trendPct = parseFloat(row.points_trend_pct) || 0;
    
    return {
      player_id: row.player_id,
      full_name: row.full_name,
      team_id: row.team_id,
      team_abbr: row.team_abbr,
      position: row.position || 'N/A',
      games_played: parseInt(row.games_played),
      season_avg_points: parseFloat(row.season_avg_points) || 0,
      season_avg_rebounds: parseFloat(row.season_avg_rebounds) || 0,
      season_avg_assists: parseFloat(row.season_avg_assists) || 0,
      l5_avg_points: parseFloat(row.l5_avg_points) || 0,
      l5_avg_rebounds: parseFloat(row.l5_avg_rebounds) || 0,
      l5_avg_assists: parseFloat(row.l5_avg_assists) || 0,
      recent_points: recentGames.points,
      recent_rebounds: recentGames.rebounds,
      recent_assists: recentGames.assists,
      points_trend_pct: trendPct,
      trend_direction: trendPct >= 0 ? 'up' : 'down',
    };
  });
}

/** Current NBA season start year (e.g. 2025 for 2025-26). */
const CURRENT_ANALYTICS_SEASON = '2025';

/**
 * Get trending players from analytics schema (same shape as getTrendingPlayers).
 * Uses analytics.player_season_averages, analytics.player_game_logs, analytics.players, analytics.teams.
 * Returns analytics player_id so dashboard links work with the player page.
 */
export async function getTrendingPlayersFromAnalytics(limit: number = 10): Promise<TrendingPlayer[]> {
  const result = await query(
    `
    WITH player_team AS (
      SELECT DISTINCT ON (player_id) player_id, team_id
      FROM analytics.player_game_logs
      WHERE season = $1 AND game_date IS NOT NULL
      ORDER BY player_id, game_date DESC NULLS LAST
    ),
    player_l5 AS (
      SELECT 
        pgl.player_id,
        AVG(pgl.points)::numeric as l5_avg_points,
        AVG(pgl.rebounds)::numeric as l5_avg_rebounds,
        AVG(pgl.assists)::numeric as l5_avg_assists
      FROM (
        SELECT 
          pgl.player_id,
          pgl.points,
          pgl.rebounds,
          pgl.assists,
          ROW_NUMBER() OVER (PARTITION BY pgl.player_id ORDER BY pgl.game_date DESC NULLS LAST) as rn
        FROM analytics.player_game_logs pgl
        JOIN analytics.games g ON pgl.game_id = g.game_id
        WHERE g.status = 'Final'
          AND pgl.points IS NOT NULL
      ) pgl
      WHERE rn <= 5
      GROUP BY player_id
    )
    SELECT 
      p.player_id,
      p.full_name,
      pt.team_id,
      t.abbreviation as team_abbr,
      COALESCE(p.position, 'N/A') as position,
      psa.games_played,
      psa.pts_avg as season_avg_points,
      psa.reb_avg as season_avg_rebounds,
      psa.ast_avg as season_avg_assists,
      pl5.l5_avg_points,
      pl5.l5_avg_rebounds,
      pl5.l5_avg_assists,
      CASE 
        WHEN psa.pts_avg > 0 THEN 
          ((pl5.l5_avg_points - psa.pts_avg) / psa.pts_avg) * 100
        ELSE 0
      END as points_trend_pct
    FROM analytics.player_season_averages psa
    JOIN analytics.players p ON p.player_id = psa.player_id
    JOIN player_team pt ON pt.player_id = psa.player_id
    JOIN analytics.teams t ON t.team_id = pt.team_id
    JOIN player_l5 pl5 ON pl5.player_id = psa.player_id
    WHERE psa.season = $1
      AND psa.games_played >= 5
      AND psa.pts_avg >= 10
    ORDER BY ABS(((pl5.l5_avg_points - psa.pts_avg) / NULLIF(psa.pts_avg, 0)) * 100) DESC
    LIMIT $2
    `,
    [CURRENT_ANALYTICS_SEASON, limit]
  );

  const playerIds = result.map((r: any) => r.player_id);
  if (playerIds.length === 0) return [];

  const recentGamesResult = await query(
    `
    SELECT 
      player_id,
      points,
      rebounds,
      assists,
      game_date
    FROM (
      SELECT 
        pgl.player_id,
        pgl.points,
        pgl.rebounds,
        pgl.assists,
        pgl.game_date,
        ROW_NUMBER() OVER (PARTITION BY pgl.player_id ORDER BY pgl.game_date DESC NULLS LAST) as rn
      FROM analytics.player_game_logs pgl
      JOIN analytics.games g ON pgl.game_id = g.game_id
      WHERE pgl.player_id = ANY($1)
        AND g.status = 'Final'
        AND pgl.points IS NOT NULL
    ) recent
    WHERE rn <= 5
    ORDER BY player_id, game_date ASC
    `,
    [playerIds]
  );

  const recentGamesMap: Record<string, { points: number[]; rebounds: number[]; assists: number[] }> = {};
  recentGamesResult.forEach((row: any) => {
    if (!recentGamesMap[row.player_id]) {
      recentGamesMap[row.player_id] = { points: [], rebounds: [], assists: [] };
    }
    recentGamesMap[row.player_id].points.push(row.points);
    recentGamesMap[row.player_id].rebounds.push(row.rebounds);
    recentGamesMap[row.player_id].assists.push(row.assists);
  });

  return result.map((row: any) => {
    const recentGames = recentGamesMap[row.player_id] || { points: [], rebounds: [], assists: [] };
    const trendPct = parseFloat(row.points_trend_pct) || 0;
    return {
      player_id: row.player_id,
      full_name: row.full_name,
      team_id: row.team_id,
      team_abbr: row.team_abbr,
      position: row.position || 'N/A',
      games_played: parseInt(row.games_played) || 0,
      season_avg_points: parseFloat(row.season_avg_points) || 0,
      season_avg_rebounds: parseFloat(row.season_avg_rebounds) || 0,
      season_avg_assists: parseFloat(row.season_avg_assists) || 0,
      l5_avg_points: parseFloat(row.l5_avg_points) || 0,
      l5_avg_rebounds: parseFloat(row.l5_avg_rebounds) || 0,
      l5_avg_assists: parseFloat(row.l5_avg_assists) || 0,
      recent_points: recentGames.points,
      recent_rebounds: recentGames.rebounds,
      recent_assists: recentGames.assists,
      points_trend_pct: trendPct,
      trend_direction: trendPct >= 0 ? 'up' : 'down',
    };
  });
}

/**
 * Get player's upcoming opponent info
 */
export async function getPlayerNextOpponent(playerId: string) {
  // For now, return null since we don't have scheduled games yet
  // This will be populated when we add odds API
  return null;
}

// ============================================
// TRENDING STRIP QUERIES
// ============================================

export type TrendingStat = 'pts' | 'reb' | 'ast' | '3pm' | 'pra';

export interface TrendingStripPlayer {
  player_id: string;
  full_name: string;
  team_abbr: string;
  next_opponent_abbr: string | null;
  /** L5 average for the selected stat */
  l5_avg: number;
  /** Season average for the selected stat */
  season_avg: number;
  /** trend_score = l5_avg - season_avg */
  trend_score: number;
  /** All trend scores for badge logic */
  trends: {
    pts: number;
    reb: number;
    ast: number;
    threePM: number;
    pra: number;
  };
}

/**
 * Get trending players for the horizontal strip.
 * Computes trend_score = L5_avg - season_avg for all 5 stat categories,
 * then sorts by ABS(trend_score) of the requested stat.
 *
 * Only returns players trending UPWARD (positive trend_score) for the selected stat.
 */
export async function getTrendingPlayersStrip(
  stat: TrendingStat = 'pts',
  limit: number = 15,
): Promise<TrendingStripPlayer[]> {
  // Map stat param → SQL expressions for L5 and season columns
  const statCol: Record<TrendingStat, { l5: string; season: string }> = {
    pts:  { l5: 'pl5.l5_pts',  season: 'season_src.s_pts'  },
    reb:  { l5: 'pl5.l5_reb',  season: 'season_src.s_reb'  },
    ast:  { l5: 'pl5.l5_ast',  season: 'season_src.s_ast'  },
    '3pm': { l5: 'pl5.l5_3pm', season: 'season_src.s_3pm'  },
    pra:  { l5: 'pl5.l5_pra',  season: 'season_src.s_pra'  },
  };
  const col = statCol[stat] ?? statCol.pts;

  const result = await query(
    `
    WITH player_team AS (
      SELECT DISTINCT ON (player_id) player_id, team_id
      FROM analytics.player_game_logs
      WHERE season = $1 AND game_date IS NOT NULL
      ORDER BY player_id, game_date DESC NULLS LAST
    ),

    -- L5 averages for all stats
    player_l5 AS (
      SELECT
        sub.player_id,
        AVG(sub.points)::numeric             AS l5_pts,
        AVG(sub.rebounds)::numeric            AS l5_reb,
        AVG(sub.assists)::numeric             AS l5_ast,
        AVG(sub.three_pointers_made)::numeric AS l5_3pm,
        AVG(sub.pra)::numeric                 AS l5_pra
      FROM (
        SELECT
          pgl.player_id, pgl.points, pgl.rebounds, pgl.assists,
          pgl.three_pointers_made, pgl.pra,
          ROW_NUMBER() OVER (PARTITION BY pgl.player_id ORDER BY pgl.game_date DESC NULLS LAST) AS rn
        FROM analytics.player_game_logs pgl
        JOIN analytics.games g ON pgl.game_id = g.game_id
        WHERE g.status = 'Final' AND pgl.points IS NOT NULL
      ) sub
      WHERE sub.rn <= 5
      GROUP BY sub.player_id
    ),

    -- Season averages: use player_season_averages for pts/reb/ast/pra,
    -- compute 3pm season avg from game logs (no column in season averages table)
    season_3pm AS (
      SELECT
        pgl.player_id,
        AVG(pgl.three_pointers_made)::numeric AS s_3pm
      FROM analytics.player_game_logs pgl
      JOIN analytics.games g ON pgl.game_id = g.game_id
      WHERE g.status = 'Final' AND pgl.season = $1 AND pgl.points IS NOT NULL
      GROUP BY pgl.player_id
    ),

    season_src AS (
      SELECT
        psa.player_id,
        psa.pts_avg  AS s_pts,
        psa.reb_avg  AS s_reb,
        psa.ast_avg  AS s_ast,
        psa.pra_avg  AS s_pra,
        COALESCE(s3.s_3pm, 0) AS s_3pm,
        psa.games_played
      FROM analytics.player_season_averages psa
      LEFT JOIN season_3pm s3 ON s3.player_id = psa.player_id
      WHERE psa.season = $1
    ),

    -- Next opponent from schedule (today or nearest future game)
    next_game AS (
      SELECT DISTINCT ON (pt.player_id)
        pt.player_id,
        CASE
          WHEN bs.home_team_id = pt.team_id THEN at_t.abbreviation
          ELSE ht_t.abbreviation
        END AS opp_abbr
      FROM player_team pt
      JOIN bbref_schedule bs
        ON (bs.home_team_id = pt.team_id OR bs.away_team_id = pt.team_id)
      JOIN teams ht_t ON bs.home_team_id = ht_t.team_id
      JOIN teams at_t ON bs.away_team_id = at_t.team_id
      WHERE bs.game_date >= CURRENT_DATE
      ORDER BY pt.player_id, bs.game_date ASC
    )

    SELECT
      p.player_id,
      p.full_name,
      t.abbreviation AS team_abbr,
      ng.opp_abbr    AS next_opponent_abbr,
      -- Selected stat L5 & season
      ${col.l5}      AS l5_avg,
      ${col.season}  AS season_avg,
      -- All trend scores
      (pl5.l5_pts  - season_src.s_pts)  AS trend_pts,
      (pl5.l5_reb  - season_src.s_reb)  AS trend_reb,
      (pl5.l5_ast  - season_src.s_ast)  AS trend_ast,
      (pl5.l5_3pm  - season_src.s_3pm)  AS trend_3pm,
      (pl5.l5_pra  - season_src.s_pra)  AS trend_pra
    FROM season_src
    JOIN analytics.players p  ON p.player_id  = season_src.player_id
    JOIN player_team pt        ON pt.player_id = season_src.player_id
    JOIN analytics.teams t     ON t.team_id    = pt.team_id
    JOIN player_l5 pl5         ON pl5.player_id = season_src.player_id
    LEFT JOIN next_game ng     ON ng.player_id  = season_src.player_id
    WHERE season_src.games_played >= 5
      AND season_src.s_pts >= 10
      AND (${col.l5} - ${col.season}) > 0
    ORDER BY ABS(${col.l5} - ${col.season}) DESC
    LIMIT $2
    `,
    [CURRENT_ANALYTICS_SEASON, limit],
  );

  return result.map((row: any) => ({
    player_id: row.player_id,
    full_name: row.full_name,
    team_abbr: row.team_abbr,
    next_opponent_abbr: row.next_opponent_abbr ?? null,
    l5_avg: parseFloat(row.l5_avg) || 0,
    season_avg: parseFloat(row.season_avg) || 0,
    trend_score: parseFloat(row.l5_avg) - parseFloat(row.season_avg) || 0,
    trends: {
      pts: parseFloat(row.trend_pts) || 0,
      reb: parseFloat(row.trend_reb) || 0,
      ast: parseFloat(row.trend_ast) || 0,
      threePM: parseFloat(row.trend_3pm) || 0,
      pra: parseFloat(row.trend_pra) || 0,
    },
  }));
}

// ============================================
// INSIGHTS QUERIES
// ============================================

export interface TeamPaceComparison {
  team_id: string;
  team_abbr: string;
  pace: number;
  pace_rank: number;
}

/**
 * Get pace rankings for all teams
 */
export async function getTeamPaceRankings(): Promise<TeamPaceComparison[]> {
  const result = await query(`
    WITH team_pace AS (
      SELECT 
        btgs.team_id,
        t.abbreviation as team_abbr,
        AVG(btgs.possessions) * 48.0 / NULLIF(AVG(btgs.minutes), 0) * 5 as pace
      FROM bbref_team_game_stats btgs
      JOIN teams t ON btgs.team_id = t.team_id
      JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
      WHERE bg.status = 'Final'
        AND btgs.source = 'bbref'
      GROUP BY btgs.team_id, t.abbreviation
    )
    SELECT 
      team_id,
      team_abbr,
      pace,
      RANK() OVER (ORDER BY pace DESC) as pace_rank
    FROM team_pace
    ORDER BY pace DESC
  `);

  return result.map((row: any) => ({
    team_id: row.team_id,
    team_abbr: row.team_abbr,
    pace: parseFloat(row.pace) || 0,
    pace_rank: parseInt(row.pace_rank),
  }));
}

/**
 * Get defensive rankings for all teams
 */
export async function getTeamDefensiveRankings() {
  const result = await query(`
    WITH team_defense AS (
      SELECT 
        btgs.team_id,
        t.abbreviation as team_abbr,
        AVG(
          CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END::numeric / 
          NULLIF(btgs.possessions, 0)
        ) * 100 as defensive_rating,
        AVG(CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END) as points_allowed
      FROM bbref_team_game_stats btgs
      JOIN teams t ON btgs.team_id = t.team_id
      JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
      WHERE bg.status = 'Final'
        AND btgs.source = 'bbref'
      GROUP BY btgs.team_id, t.abbreviation
    )
    SELECT 
      team_id,
      team_abbr,
      defensive_rating,
      points_allowed,
      RANK() OVER (ORDER BY defensive_rating ASC) as defensive_rank
    FROM team_defense
    ORDER BY defensive_rating ASC
  `);

  return result.map((row: any) => ({
    team_id: row.team_id,
    team_abbr: row.team_abbr,
    defensive_rating: parseFloat(row.defensive_rating) || 0,
    points_allowed: parseFloat(row.points_allowed) || 0,
    defensive_rank: parseInt(row.defensive_rank),
  }));
}

/**
 * Get summary stats for dashboard widgets
 */
export async function getDashboardSummary() {
  // Get total games, players, and data freshness
  const result = await query(`
    SELECT 
      (SELECT COUNT(DISTINCT bbref_game_id) FROM bbref_games WHERE status = 'Final') as total_games,
      (SELECT COUNT(DISTINCT player_id) FROM bbref_player_game_stats) as total_players,
      (SELECT MAX(game_date) FROM bbref_games WHERE status = 'Final') as latest_game_date,
      (SELECT COUNT(DISTINCT team_id) FROM bbref_team_game_stats) as teams_with_stats
  `);

  return result[0] || {
    total_games: 0,
    total_players: 0,
    latest_game_date: null,
    teams_with_stats: 0,
  };
}

// ============================================
// ODDS QUERIES
// ============================================

export interface GameOdds {
  home: {
    moneyline: number | null;
    spread: number | null;
    spreadOdds: number | null;
  };
  away: {
    moneyline: number | null;
    spread: number | null;
    spreadOdds: number | null;
  };
  overUnder: number | null;
  overOdds: number | null;
  underOdds: number | null;
  bookmaker: string | null; // Which bookmaker these odds are from
}

/**
 * Get latest odds for a game from analytics.game_odds_current.
 */
export async function getGameOdds(gameId: string, preferredBookmaker: string = 'draftkings'): Promise<GameOdds> {
  const analyticsResult = await query(`
    SELECT home_moneyline, away_moneyline,
           home_spread, home_spread_odds, away_spread, away_spread_odds,
           total, over_odds, under_odds, vendor
    FROM analytics.game_odds_current
    WHERE game_id = $1
  `, [gameId]);

  if (analyticsResult.length > 0) {
    const r = analyticsResult[0];
    return {
      home: { moneyline: r.home_moneyline, spread: parseFloat(r.home_spread), spreadOdds: r.home_spread_odds },
      away: { moneyline: r.away_moneyline, spread: parseFloat(r.away_spread), spreadOdds: r.away_spread_odds },
      overUnder: parseFloat(r.total),
      overOdds: r.over_odds,
      underOdds: r.under_odds,
      bookmaker: r.vendor,
    };
  }

  return {
    home: { moneyline: null, spread: null, spreadOdds: null },
    away: { moneyline: null, spread: null, spreadOdds: null },
    overUnder: null, overOdds: null, underOdds: null, bookmaker: null,
  };
}

/**
 * Get odds for multiple games at once from analytics.game_odds_current.
 * Falls back to public.markets for games not yet in analytics.
 */
export async function getGamesOdds(gameIds: string[], preferredBookmaker: string = 'draftkings'): Promise<Record<string, GameOdds>> {
  if (gameIds.length === 0) return {};

  const oddsMap: Record<string, GameOdds> = {};
  const defaultOdds = (): GameOdds => ({
    home: { moneyline: null, spread: null, spreadOdds: null },
    away: { moneyline: null, spread: null, spreadOdds: null },
    overUnder: null, overOdds: null, underOdds: null, bookmaker: null,
  });

  gameIds.forEach((id) => { oddsMap[id] = defaultOdds(); });

  // Try analytics.game_odds_current first (single row per game)
  const analyticsResult = await query(`
    SELECT game_id, home_moneyline, away_moneyline,
           home_spread, home_spread_odds, away_spread, away_spread_odds,
           total, over_odds, under_odds, vendor
    FROM analytics.game_odds_current
    WHERE game_id = ANY($1)
  `, [gameIds]);

  const foundInAnalytics = new Set<string>();
  analyticsResult.forEach((r: any) => {
    foundInAnalytics.add(r.game_id);
    oddsMap[r.game_id] = {
      home: { moneyline: r.home_moneyline, spread: parseFloat(r.home_spread), spreadOdds: r.home_spread_odds },
      away: { moneyline: r.away_moneyline, spread: parseFloat(r.away_spread), spreadOdds: r.away_spread_odds },
      overUnder: parseFloat(r.total),
      overOdds: r.over_odds,
      underOdds: r.under_odds,
      bookmaker: r.vendor,
    };
  });

  return oddsMap;
}

/**
 * Get historical matchups between two teams (last 10 games)
 */
export async function getHistoricalMatchups(homeTeamId: string, awayTeamId: string, limit: number = 10) {
  const result = await query(`
    SELECT
      g.game_id,
      g.start_time::date as game_date,
      TO_CHAR(g.start_time::date, 'MM/DD/YYYY') as date,
      g.home_team_id,
      g.away_team_id,
      ht.full_name as home_team_name,
      at.full_name as away_team_name,
      g.home_score,
      g.away_score,
      (g.home_score + g.away_score) as total_points
    FROM analytics.games g
    JOIN analytics.teams ht ON g.home_team_id = ht.team_id
    JOIN analytics.teams at ON g.away_team_id = at.team_id
    WHERE g.status = 'Final'
      AND g.home_score IS NOT NULL
      AND g.away_score IS NOT NULL
      AND (
        (g.home_team_id = $1 AND g.away_team_id = $2) OR
        (g.home_team_id = $2 AND g.away_team_id = $1)
      )
    ORDER BY g.start_time DESC
    LIMIT $3
  `, [homeTeamId, awayTeamId, limit]);

  return result.map((row: any) => ({
    date: row.date,
    homeTeam: row.home_team_name,
    awayTeam: row.away_team_name,
    homeScore: row.home_score,
    awayScore: row.away_score,
    totalPoints: row.total_points,
  }));
}

/**
 * Get line movement data for a game.
 * Reads from analytics.game_odds_history first (BDL pipeline), then falls back to public.markets.
 * Expects an analytics game_id (BDL game_id).
 */
export async function getLineMovement(gameId: string, preferredBookmaker: string = 'draftkings') {
  const vendor = preferredBookmaker.toLowerCase();

  // 1. Try analytics.game_odds_history (from BDL odds Lambda)
  const analyticsRows = await query<{ snapshot_at: string; home_spread: number | null; total: number | null }>(`
    SELECT snapshot_at, home_spread, total
    FROM analytics.game_odds_history
    WHERE game_id = $1 AND vendor = $2
    ORDER BY snapshot_at ASC
  `, [gameId, vendor]);

  if (analyticsRows.length > 0) {
    return formatLineMovementFromAnalytics(analyticsRows);
  }

  // 2. Fallback: legacy public.markets
  let result = await query(`
    SELECT 
      m.market_type,
      m.side,
      m.line,
      m.odds,
      m.snapshot_type,
      m.fetched_at,
      m.bookmaker
    FROM markets m
    WHERE m.game_id = $1
      AND m.bookmaker = $2
      AND m.market_type IN ('spread', 'total')
      AND m.snapshot_type IN ('pre_game', 'closing', 'live', 'mid_game')
    ORDER BY m.fetched_at ASC
  `, [gameId, preferredBookmaker]);

  if (result.length === 0) {
    const fallbackResult = await query(`
      SELECT 
        m.market_type,
        m.side,
        m.line,
        m.odds,
        m.snapshot_type,
        m.fetched_at,
        m.bookmaker
      FROM markets m
      WHERE m.game_id = $1
        AND m.market_type IN ('spread', 'total')
        AND m.snapshot_type IN ('pre_game', 'closing')
      ORDER BY m.fetched_at ASC
      LIMIT 20
    `, [gameId]);

    if (fallbackResult.length > 0) {
      const bookmakerCounts: Record<string, number> = {};
      fallbackResult.forEach((row: any) => {
        bookmakerCounts[row.bookmaker] = (bookmakerCounts[row.bookmaker] || 0) + 1;
      });
      const bestBookmaker = Object.entries(bookmakerCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (bestBookmaker) {
        result = fallbackResult.filter((r: any) => r.bookmaker === bestBookmaker);
      }
    }
  }

  if (result.length === 0) {
    return { spreadMovement: [], totalMovement: [] };
  }

  return formatLineMovement(result);
}

/**
 * Format analytics.game_odds_history rows into chart-ready spread/total movement.
 */
function formatLineMovementFromAnalytics(
  rows: { snapshot_at: string; home_spread: number | null; total: number | null }[]
): { spreadMovement: { time: string; value: number }[]; totalMovement: { time: string; value: number }[] } {
  const spreadMovement: { time: string; value: number }[] = [];
  const totalMovement: { time: string; value: number }[] = [];

  rows.forEach((row, index) => {
    const timeLabel =
      index === 0 ? 'Open' :
      index === rows.length - 1 ? 'Now' :
      new Date(row.snapshot_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    const spreadVal = row.home_spread != null ? parseFloat(String(row.home_spread)) : 0;
    const totalVal = row.total != null ? parseFloat(String(row.total)) : 0;

    spreadMovement.push({ time: timeLabel, value: spreadVal });
    totalMovement.push({ time: timeLabel, value: totalVal });
  });

  return { spreadMovement, totalMovement };
}

/**
 * Format line movement data for charts
 */
function formatLineMovement(data: any[]) {
  const spreadData: { time: string; value: number }[] = [];
  const totalData: { time: string; value: number }[] = [];

  // Group by market type and side
  const spreadHome: any[] = [];
  const totalOver: any[] = [];

  data.forEach((row) => {
    if (row.market_type === 'spread' && row.side === 'home') {
      spreadHome.push(row);
    } else if (row.market_type === 'total' && row.side === 'over') {
      totalOver.push(row);
    }
  });

  // Format spread movement
  if (spreadHome.length > 0) {
    spreadHome.forEach((row, index) => {
      const timeLabel = index === 0 ? 'Open' : 
                       index === spreadHome.length - 1 ? 'Now' :
                       new Date(row.fetched_at).toLocaleTimeString('en-US', { 
                         hour: 'numeric', 
                         minute: '2-digit',
                         hour12: true 
                       });
      spreadData.push({
        time: timeLabel,
        value: parseFloat(row.line) || 0,
      });
    });
  }

  // Format total movement
  if (totalOver.length > 0) {
    totalOver.forEach((row, index) => {
      const timeLabel = index === 0 ? 'Open' : 
                       index === totalOver.length - 1 ? 'Now' :
                       new Date(row.fetched_at).toLocaleTimeString('en-US', { 
                         hour: 'numeric', 
                         minute: '2-digit',
                         hour12: true 
                       });
      totalData.push({
        time: timeLabel,
        value: parseFloat(row.line) || 0,
      });
    });
  }

  return {
    spreadMovement: spreadData,
    totalMovement: totalData,
  };
}

// ============================================
// MATCHUP ANALYSIS QUERIES
// ============================================

export interface OpponentDefensiveRankings {
  team_id: string;
  points_allowed_rank: number;
  rebounds_allowed_rank: number;
  assists_allowed_rank: number;
  threes_allowed_rank: number;
  points_allowed_per_game: number;
  rebounds_allowed_per_game: number;
  assists_allowed_per_game: number;
  threes_allowed_per_game: number;
  defensive_rating: number;
}

export interface TeamOffensiveRankings {
  team_id: string;
  points_rank: number;
  rebounds_rank: number;
  assists_rank: number;
  threes_rank: number;
  points_per_game: number;
  rebounds_per_game: number;
  assists_per_game: number;
  threes_per_game: number;
  offensive_rating: number;
}

/**
 * Get opponent defensive rankings for a specific team
 * Returns where the team ranks in allowing various stats
 */
export async function getOpponentDefensiveRankings(teamId: string): Promise<OpponentDefensiveRankings | null> {
  const result = await query(`
    WITH team_defensive_stats AS (
      SELECT 
        btgs.team_id,
        AVG(CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END) as points_allowed_per_game,
        AVG(opp_tgs.rebounds) as rebounds_allowed_per_game,
        AVG(opp_tgs.assists) as assists_allowed_per_game,
        AVG(opp_tgs.three_pointers_made) as threes_allowed_per_game,
        AVG(
          CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END::numeric / 
          NULLIF(btgs.possessions, 0)
        ) * 100 as defensive_rating
      FROM bbref_team_game_stats btgs
      JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
      JOIN bbref_team_game_stats opp_tgs ON bg.bbref_game_id = opp_tgs.game_id 
        AND opp_tgs.team_id != btgs.team_id
        AND opp_tgs.source = 'bbref'
      WHERE bg.status = 'Final'
        AND btgs.source = 'bbref'
      GROUP BY btgs.team_id
    ),
    rankings AS (
      SELECT 
        team_id,
        points_allowed_per_game,
        rebounds_allowed_per_game,
        assists_allowed_per_game,
        threes_allowed_per_game,
        defensive_rating,
        RANK() OVER (ORDER BY points_allowed_per_game DESC) as points_allowed_rank,
        RANK() OVER (ORDER BY rebounds_allowed_per_game DESC) as rebounds_allowed_rank,
        RANK() OVER (ORDER BY assists_allowed_per_game DESC) as assists_allowed_rank,
        RANK() OVER (ORDER BY threes_allowed_per_game DESC) as threes_allowed_rank
      FROM team_defensive_stats
    )
    SELECT 
      team_id,
      points_allowed_rank,
      rebounds_allowed_rank,
      assists_allowed_rank,
      threes_allowed_rank,
      points_allowed_per_game,
      rebounds_allowed_per_game,
      assists_allowed_per_game,
      threes_allowed_per_game,
      defensive_rating
    FROM rankings
    WHERE team_id = $1
  `, [teamId]);

  if (result.length === 0) {
    return null;
  }

  const row = result[0];
  return {
    team_id: row.team_id,
    points_allowed_rank: parseInt(row.points_allowed_rank) || 0,
    rebounds_allowed_rank: parseInt(row.rebounds_allowed_rank) || 0,
    assists_allowed_rank: parseInt(row.assists_allowed_rank) || 0,
    threes_allowed_rank: parseInt(row.threes_allowed_rank) || 0,
    points_allowed_per_game: parseFloat(row.points_allowed_per_game) || 0,
    rebounds_allowed_per_game: parseFloat(row.rebounds_allowed_per_game) || 0,
    assists_allowed_per_game: parseFloat(row.assists_allowed_per_game) || 0,
    threes_allowed_per_game: parseFloat(row.threes_allowed_per_game) || 0,
    defensive_rating: parseFloat(row.defensive_rating) || 0,
  };
}

/**
 * Get offensive rankings for a specific team
 * Returns where the team ranks in producing various stats
 */
export async function getTeamOffensiveRankings(teamId: string): Promise<TeamOffensiveRankings | null> {
  const result = await query(`
    WITH team_offensive_stats AS (
      SELECT 
        btgs.team_id,
        AVG(btgs.points) as points_per_game,
        AVG(btgs.rebounds) as rebounds_per_game,
        AVG(btgs.assists) as assists_per_game,
        AVG(btgs.three_pointers_made) as threes_per_game,
        AVG(btgs.points::numeric / NULLIF(btgs.possessions, 0)) * 100 as offensive_rating
      FROM bbref_team_game_stats btgs
      JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
      WHERE bg.status = 'Final'
        AND btgs.source = 'bbref'
      GROUP BY btgs.team_id
    ),
    rankings AS (
      SELECT 
        team_id,
        points_per_game,
        rebounds_per_game,
        assists_per_game,
        threes_per_game,
        offensive_rating,
        RANK() OVER (ORDER BY points_per_game DESC) as points_rank,
        RANK() OVER (ORDER BY rebounds_per_game DESC) as rebounds_rank,
        RANK() OVER (ORDER BY assists_per_game DESC) as assists_rank,
        RANK() OVER (ORDER BY threes_per_game DESC) as threes_rank
      FROM team_offensive_stats
    )
    SELECT 
      team_id,
      points_rank,
      rebounds_rank,
      assists_rank,
      threes_rank,
      points_per_game,
      rebounds_per_game,
      assists_per_game,
      threes_per_game,
      offensive_rating
    FROM rankings
    WHERE team_id = $1
  `, [teamId]);

  if (result.length === 0) {
    return null;
  }

  const row = result[0];
  return {
    team_id: row.team_id,
    points_rank: parseInt(row.points_rank) || 0,
    rebounds_rank: parseInt(row.rebounds_rank) || 0,
    assists_rank: parseInt(row.assists_rank) || 0,
    threes_rank: parseInt(row.threes_rank) || 0,
    points_per_game: parseFloat(row.points_per_game) || 0,
    rebounds_per_game: parseFloat(row.rebounds_per_game) || 0,
    assists_per_game: parseFloat(row.assists_per_game) || 0,
    threes_per_game: parseFloat(row.threes_per_game) || 0,
    offensive_rating: parseFloat(row.offensive_rating) || 0,
  };
}

export interface PlayerVsOpponentStats {
  player_id: string;
  player_name: string;
  team_id: string;
  games_played: number;
  avg_points: number;
  avg_rebounds: number;
  avg_assists: number;
  avg_threes: number;
  season_avg_points: number;
  season_avg_rebounds: number;
  season_avg_assists: number;
  season_avg_threes: number;
  points_diff: number;
  rebounds_diff: number;
  assists_diff: number;
  threes_diff: number;
}

/**
 * Get a player's historical stats vs a specific opponent
 * Compares their performance vs this opponent to their season average
 */
export async function getPlayerVsOpponentStats(
  playerId: string,
  opponentTeamId: string
): Promise<PlayerVsOpponentStats | null> {
  // Get player stats vs this opponent
  const vsOpponentResult = await query(`
    SELECT 
      bpgs.player_id,
      p.full_name as player_name,
      bpgs.team_id,
      COUNT(DISTINCT bpgs.game_id) as games_played,
      AVG(bpgs.points) as avg_points,
      AVG(bpgs.rebounds) as avg_rebounds,
      AVG(bpgs.assists) as avg_assists,
      AVG(bpgs.three_pointers_made) as avg_threes
    FROM bbref_player_game_stats bpgs
    JOIN players p ON bpgs.player_id = p.player_id
    JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
    WHERE bpgs.player_id = $1
      AND bg.status = 'Final'
      AND bpgs.dnp_reason IS NULL
      AND bpgs.minutes > 10
      AND (
        (bg.home_team_id = $2 AND bpgs.team_id = bg.away_team_id) OR
        (bg.away_team_id = $2 AND bpgs.team_id = bg.home_team_id)
      )
    GROUP BY bpgs.player_id, p.full_name, bpgs.team_id
  `, [playerId, opponentTeamId]);

  if (vsOpponentResult.length === 0) {
    return null;
  }

  // Get player season averages
  const seasonResult = await query(`
    SELECT 
      AVG(bpgs.points) as season_avg_points,
      AVG(bpgs.rebounds) as season_avg_rebounds,
      AVG(bpgs.assists) as season_avg_assists,
      AVG(bpgs.three_pointers_made) as season_avg_threes
    FROM bbref_player_game_stats bpgs
    JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
    WHERE bpgs.player_id = $1
      AND bg.status = 'Final'
      AND bpgs.dnp_reason IS NULL
      AND bpgs.minutes > 10
  `, [playerId]);

  const vsOpponent = vsOpponentResult[0];
  const season = seasonResult[0] || {};

  const avgPoints = parseFloat(vsOpponent.avg_points) || 0;
  const avgRebounds = parseFloat(vsOpponent.avg_rebounds) || 0;
  const avgAssists = parseFloat(vsOpponent.avg_assists) || 0;
  const avgThrees = parseFloat(vsOpponent.avg_threes) || 0;
  const seasonAvgPoints = parseFloat(season.season_avg_points) || 0;
  const seasonAvgRebounds = parseFloat(season.season_avg_rebounds) || 0;
  const seasonAvgAssists = parseFloat(season.season_avg_assists) || 0;
  const seasonAvgThrees = parseFloat(season.season_avg_threes) || 0;

  return {
    player_id: vsOpponent.player_id,
    player_name: vsOpponent.player_name,
    team_id: vsOpponent.team_id,
    games_played: parseInt(vsOpponent.games_played) || 0,
    avg_points: avgPoints,
    avg_rebounds: avgRebounds,
    avg_assists: avgAssists,
    avg_threes: avgThrees,
    season_avg_points: seasonAvgPoints,
    season_avg_rebounds: seasonAvgRebounds,
    season_avg_assists: seasonAvgAssists,
    season_avg_threes: seasonAvgThrees,
    points_diff: avgPoints - seasonAvgPoints,
    rebounds_diff: avgRebounds - seasonAvgRebounds,
    assists_diff: avgAssists - seasonAvgAssists,
    threes_diff: avgThrees - seasonAvgThrees,
  };
}

export interface PaceAnalysis {
  home_team_pace: number;
  away_team_pace: number;
  projected_pace: number;
  pace_advantage: 'home' | 'away' | 'neutral';
  pace_impact: 'fast' | 'average' | 'slow';
}

/**
 * Analyze pace for a matchup
 * Projects the game pace based on both teams' average pace
 */
export async function getPaceAnalysis(
  homeTeamId: string,
  awayTeamId: string
): Promise<PaceAnalysis> {
  const result = await query(`
    WITH team_pace AS (
      SELECT 
        btgs.team_id,
        AVG(btgs.possessions) * 48.0 / NULLIF(AVG(btgs.minutes), 0) * 5 as pace
      FROM bbref_team_game_stats btgs
      JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
      WHERE bg.status = 'Final'
        AND btgs.source = 'bbref'
        AND btgs.team_id IN ($1, $2)
      GROUP BY btgs.team_id
    )
    SELECT 
      MAX(CASE WHEN team_id = $1 THEN pace END) as home_team_pace,
      MAX(CASE WHEN team_id = $2 THEN pace END) as away_team_pace
    FROM team_pace
  `, [homeTeamId, awayTeamId]);

  const row = result[0] || {};
  const homePace = parseFloat(row.home_team_pace) || 100;
  const awayPace = parseFloat(row.away_team_pace) || 100;
  const projectedPace = (homePace + awayPace) / 2;

  let paceAdvantage: 'home' | 'away' | 'neutral' = 'neutral';
  if (homePace > awayPace + 2) {
    paceAdvantage = 'home';
  } else if (awayPace > homePace + 2) {
    paceAdvantage = 'away';
  }

  let paceImpact: 'fast' | 'average' | 'slow' = 'average';
  if (projectedPace >= 102) {
    paceImpact = 'fast';
  } else if (projectedPace <= 98) {
    paceImpact = 'slow';
  }

  return {
    home_team_pace: homePace,
    away_team_pace: awayPace,
    projected_pace: projectedPace,
    pace_advantage: paceAdvantage,
    pace_impact: paceImpact,
  };
}

export interface StartingLineupPlayer {
  player_id: string;
  full_name: string;
  position: string;
  games_started: number;
  avg_points: number;
  avg_minutes: number;
}

export interface StartingLineup {
  team_id: string;
  players: StartingLineupPlayer[];
}

export interface MatchupAnalysis {
  game_id: string;
  home_team_id: string;
  away_team_id: string;
  home_offense: TeamOffensiveRankings | null;
  away_offense: TeamOffensiveRankings | null;
  home_defense: OpponentDefensiveRankings | null;
  away_defense: OpponentDefensiveRankings | null;
  pace_analysis: PaceAnalysis;
  key_players: PlayerVsOpponentStats[];
  starting_lineups: {
    home: StartingLineup | null;
    away: StartingLineup | null;
  };
}

/**
 * Get projected starting lineup for a team from analytics schema only (no bbref).
 * Uses recent completed games, minutes-based starter heuristic, one player per position.
 * Optionally excludes players who are on the injury report (e.g. Out, Doubtful).
 */
export async function getProjectedStartingLineupFromAnalytics(
  teamId: string,
  options?: { excludeInjuredPlayerIds?: string[] }
): Promise<StartingLineup | null> {
  const excludeIds = options?.excludeInjuredPlayerIds ?? [];
  const excludeClause = excludeIds.length > 0
    ? `AND pgl.player_id != ALL($2::text[])`
    : '';
  const params = excludeIds.length > 0 ? [teamId, excludeIds] : [teamId];

  const result = await query(`
    WITH recent_games AS (
      SELECT g.game_id, g.start_time
      FROM analytics.games g
      WHERE g.status = 'Final'
        AND (g.home_team_id = $1 OR g.away_team_id = $1)
      ORDER BY COALESCE(g.start_time, '1970-01-01'::timestamptz) DESC
      LIMIT 10
    ),
    -- Parse minutes (stored as text) to numeric; treat invalid as 0
    player_game_data AS (
      SELECT
        pgl.player_id,
        p.full_name,
        p.position,
        pgl.points,
        (NULLIF(TRIM(REGEXP_REPLACE(COALESCE(pgl.minutes, '0'), '[^0-9.]', '', 'g')), '')::numeric) AS minutes_num,
        CASE
          WHEN (NULLIF(TRIM(REGEXP_REPLACE(COALESCE(pgl.minutes, '0'), '[^0-9.]', '', 'g')), '')::numeric) >= 30 THEN 8
          WHEN (NULLIF(TRIM(REGEXP_REPLACE(COALESCE(pgl.minutes, '0'), '[^0-9.]', '', 'g')), '')::numeric) >= 25 THEN 6
          WHEN (NULLIF(TRIM(REGEXP_REPLACE(COALESCE(pgl.minutes, '0'), '[^0-9.]', '', 'g')), '')::numeric) >= 20 THEN 4
          ELSE 2
        END AS starter_score,
        ROW_NUMBER() OVER (
          PARTITION BY pgl.game_id, pgl.team_id
          ORDER BY (NULLIF(TRIM(REGEXP_REPLACE(COALESCE(pgl.minutes, '0'), '[^0-9.]', '', 'g')), '')::numeric) DESC NULLS LAST, pgl.points DESC
        ) AS player_order
      FROM analytics.player_game_logs pgl
      JOIN analytics.players p ON p.player_id = pgl.player_id
      JOIN recent_games rg ON rg.game_id = pgl.game_id
      WHERE pgl.team_id = $1
        AND (pgl.minutes IS NOT NULL AND TRIM(pgl.minutes) != '')
        ${excludeClause}
    ),
    player_aggregates AS (
      SELECT
        player_id,
        MAX(full_name) AS full_name,
        MAX(position) AS position,
        COUNT(*) AS games_played,
        SUM(CASE WHEN minutes_num >= 25 THEN 1 ELSE 0 END) AS high_minute_games,
        SUM(CASE WHEN player_order <= 5 THEN 1 ELSE 0 END) AS early_appearance_games,
        AVG(starter_score) AS avg_starter_score,
        AVG(points) AS avg_points,
        AVG(minutes_num) AS avg_minutes
      FROM player_game_data
      GROUP BY player_id
      HAVING COUNT(*) >= 3
    ),
    canonical_position AS (
      SELECT
        player_id,
        full_name,
        position,
        games_played,
        high_minute_games,
        early_appearance_games,
        avg_starter_score,
        avg_points,
        avg_minutes,
        (high_minute_games * 2 + early_appearance_games * 1.5 + COALESCE(avg_starter_score, 0)) AS starter_likelihood,
        CASE
          WHEN UPPER(TRIM(COALESCE(position, ''))) IN ('PG') THEN 'PG'
          WHEN UPPER(TRIM(COALESCE(position, ''))) IN ('SG', 'G') THEN 'SG'
          WHEN UPPER(TRIM(COALESCE(position, ''))) IN ('SF', 'F', 'G-F', 'F-G') THEN 'SF'
          WHEN UPPER(TRIM(COALESCE(position, ''))) IN ('PF') THEN 'PF'
          WHEN UPPER(TRIM(COALESCE(position, ''))) IN ('C', 'F-C', 'C-F') THEN 'C'
          ELSE 'OTHER'
        END AS canonical_pos
      FROM player_aggregates
    ),
    position_rankings AS (
      SELECT
        player_id,
        full_name,
        position,
        canonical_pos,
        games_played,
        avg_points,
        avg_minutes,
        starter_likelihood,
        ROW_NUMBER() OVER (
          PARTITION BY canonical_pos
          ORDER BY starter_likelihood DESC, avg_minutes DESC NULLS LAST, avg_points DESC NULLS LAST
        ) AS position_rank
      FROM canonical_position
    ),
    one_per_position AS (
      SELECT player_id, full_name, position, games_played, avg_points, avg_minutes, canonical_pos
      FROM position_rankings
      WHERE position_rank = 1
    ),
    filled_lineup AS (
      SELECT player_id, full_name, position, games_played, avg_points, avg_minutes, canonical_pos,
        ROW_NUMBER() OVER (
          ORDER BY CASE canonical_pos WHEN 'PG' THEN 1 WHEN 'SG' THEN 2 WHEN 'SF' THEN 3 WHEN 'PF' THEN 4 WHEN 'C' THEN 5 ELSE 6 END,
          full_name
        ) AS slot
      FROM one_per_position
    ),
    need_more AS (
      SELECT pr.player_id, pr.full_name, pr.position, pr.games_played, pr.avg_points, pr.avg_minutes, pr.canonical_pos, pr.starter_likelihood
      FROM position_rankings pr
      WHERE pr.position_rank > 1
        AND NOT EXISTS (SELECT 1 FROM one_per_position o WHERE o.player_id = pr.player_id)
    )
    SELECT player_id, full_name, position, games_played AS games_started, avg_points, avg_minutes
    FROM (
      SELECT player_id, full_name, position, games_played, avg_points, avg_minutes,
        ROW_NUMBER() OVER (ORDER BY slot) AS rn
      FROM filled_lineup
      UNION ALL
      SELECT player_id, full_name, position, games_played, avg_points, avg_minutes,
        (SELECT COALESCE(MAX(slot), 0) FROM filled_lineup) + ROW_NUMBER() OVER (ORDER BY starter_likelihood DESC, avg_minutes DESC NULLS LAST, avg_points DESC NULLS LAST) AS rn
      FROM need_more
    ) combined
    WHERE rn <= 5
    ORDER BY rn
    LIMIT 5
  `, params as string[]);

  if (result.length === 0) {
    return null;
  }

  return {
    team_id: teamId,
    players: result.map((row: any) => ({
      player_id: row.player_id,
      full_name: row.full_name,
      position: row.position || 'N/A',
      games_started: parseInt(row.games_started, 10) || 0,
      avg_points: parseFloat(row.avg_points) || 0,
      avg_minutes: parseFloat(row.avg_minutes) || 0,
    })),
  };
}

/**
 * Get projected starting lineups for both teams (analytics-only, no injury exclusion).
 * For injury-aware lineups use getMatchupAnalysis which excludes Out/Doubtful.
 */
export async function getGameStartingLineups(
  homeTeamId: string,
  awayTeamId: string
): Promise<{ home: StartingLineup | null; away: StartingLineup | null }> {
  const [homeLineup, awayLineup] = await Promise.all([
    getProjectedStartingLineupFromAnalytics(homeTeamId),
    getProjectedStartingLineupFromAnalytics(awayTeamId),
  ]);
  return { home: homeLineup, away: awayLineup };
}

/**
 * Get comprehensive matchup analysis for a game
 * Includes opponent defensive rankings, pace analysis, and key player matchups
 */
export async function getMatchupAnalysis(gameId: string): Promise<MatchupAnalysis | null> {
  const gameResult = await query(`
    SELECT g.game_id, g.home_team_id, g.away_team_id
    FROM analytics.games g
    WHERE g.game_id = $1
    LIMIT 1
  `, [gameId]);

  if (gameResult.length === 0) {
    return null;
  }

  const game = gameResult[0];
  const homeTeamId = game.home_team_id;
  const awayTeamId = game.away_team_id;

  // Get offensive and defensive rankings for both teams
  const [homeOffense, awayOffense, homeDefense, awayDefense, paceAnalysis] = await Promise.all([
    getTeamOffensiveRankings(homeTeamId),
    getTeamOffensiveRankings(awayTeamId),
    getOpponentDefensiveRankings(homeTeamId),
    getOpponentDefensiveRankings(awayTeamId),
    getPaceAnalysis(homeTeamId, awayTeamId),
  ]);

  // Get key players (top 3 scorers from each team) and their stats vs opponent
  const keyPlayersResult = await query(`
    WITH top_scorers AS (
      SELECT 
        bpgs.player_id,
        bpgs.team_id,
        AVG(bpgs.points) as avg_points,
        ROW_NUMBER() OVER (PARTITION BY bpgs.team_id ORDER BY AVG(bpgs.points) DESC) as rn
      FROM bbref_player_game_stats bpgs
      JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
      WHERE bpgs.team_id IN ($1, $2)
        AND bg.status = 'Final'
        AND bpgs.dnp_reason IS NULL
        AND bpgs.minutes > 10
      GROUP BY bpgs.player_id, bpgs.team_id
      HAVING COUNT(DISTINCT bpgs.game_id) >= 5
    )
    SELECT player_id, team_id
    FROM top_scorers
    WHERE rn <= 3
  `, [homeTeamId, awayTeamId]);

  // Get player vs opponent stats for key players
  const keyPlayers: PlayerVsOpponentStats[] = [];
  for (const player of keyPlayersResult) {
    const opponentId = player.team_id === homeTeamId ? awayTeamId : homeTeamId;
    const playerStats = await getPlayerVsOpponentStats(player.player_id, opponentId);
    if (playerStats) {
      keyPlayers.push(playerStats);
    }
  }

  // Get injured player IDs per team (Out, Doubtful) so we exclude them from projected lineup
  const injuryRows = await query<{ player_id: string; team_id: string }>(
    `SELECT player_id, team_id
     FROM analytics.player_injury_status_current
     WHERE team_id IN ($1, $2)
       AND (LOWER(COALESCE(status, '')) LIKE 'out%' OR LOWER(COALESCE(status, '')) LIKE 'doubtful%')
     ORDER BY team_id`,
    [homeTeamId, awayTeamId]
  );
  const homeInjuredIds = injuryRows.filter((r) => r.team_id === homeTeamId).map((r) => r.player_id);
  const awayInjuredIds = injuryRows.filter((r) => r.team_id === awayTeamId).map((r) => r.player_id);

  // Prefer BallDontLie lineups when available (game must have started; 2025+ season)
  let startingLineups: { home: StartingLineup | null; away: StartingLineup | null } = {
    home: null,
    away: null,
  };
  // Cache BDL lineups per game for 60s to avoid calling the API on every page load
  const bdlResponse = await unstable_cache(
    () => fetchLineupsFromBallDontLie(gameId, undefined),
    ['bdl-lineups', gameId],
    { revalidate: 60 }
  )();
  if (bdlResponse?.data?.length) {
    const starters = bdlResponse.data.filter((e) => e.starter);
    if (starters.length > 0) {
      const teamMapRows = await query<{ internal_id: string; provider_id: string }>(
        `SELECT internal_id, provider_id
         FROM provider_id_map
         WHERE entity_type = 'team' AND provider = 'balldontlie' AND internal_id IN ($1, $2)`,
        [homeTeamId, awayTeamId]
      );
      const bdlTeamIdToInternal: Record<string, string> = {};
      for (const row of teamMapRows) {
        bdlTeamIdToInternal[row.provider_id] = row.internal_id;
      }
      const homePlayers: StartingLineupPlayer[] = [];
      const awayPlayers: StartingLineupPlayer[] = [];
      for (const e of starters) {
        const bdlTeamId = String(e.player?.team_id ?? '');
        const internalTeamId = bdlTeamIdToInternal[bdlTeamId];
        if (!internalTeamId) continue;
        const fullName = [e.player?.first_name, e.player?.last_name].filter(Boolean).join(' ').trim() || 'Unknown';
        const player: StartingLineupPlayer = {
          player_id: String(e.player?.id ?? ''),
          full_name: fullName,
          position: e.player?.position ?? e.position ?? 'N/A',
          games_started: 0,
          avg_points: 0,
          avg_minutes: 0,
        };
        if (internalTeamId === homeTeamId) homePlayers.push(player);
        else if (internalTeamId === awayTeamId) awayPlayers.push(player);
      }
      if (homePlayers.length > 0) startingLineups.home = { team_id: homeTeamId, players: homePlayers };
      if (awayPlayers.length > 0) startingLineups.away = { team_id: awayTeamId, players: awayPlayers };
    }
  }

  // Fall back to analytics-projected lineups when BDL lineups missing or incomplete
  if (!startingLineups.home || !startingLineups.away) {
    const [homeLineup, awayLineup] = await Promise.all([
      getProjectedStartingLineupFromAnalytics(homeTeamId, { excludeInjuredPlayerIds: homeInjuredIds }),
      getProjectedStartingLineupFromAnalytics(awayTeamId, { excludeInjuredPlayerIds: awayInjuredIds }),
    ]);
    if (!startingLineups.home) startingLineups.home = homeLineup;
    if (!startingLineups.away) startingLineups.away = awayLineup;
  }

  return {
    game_id: game.game_id,
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
    home_offense: homeOffense,
    away_offense: awayOffense,
    home_defense: homeDefense,
    away_defense: awayDefense,
    pace_analysis: paceAnalysis,
    key_players: keyPlayers,
    starting_lineups: startingLineups,
  };
}

// ============================================
// PLAYER PROP LINE SHOPPING
// ============================================

/**
 * Get all sportsbook lines for a player prop (game, player, market_type).
 * Optionally at a specific snapshot_at; otherwise uses latest snapshot.
 */
export async function getPlayerPropLines(
  gameId: string,
  playerId: string,
  marketType: string,
  snapshotAt?: string | null
): Promise<PlayerPropLineComparisonRow[]> {
  if (snapshotAt) {
    const rows = await query<PlayerPropLineComparisonRow>(
      `SELECT sportsbook, side, line_value, odds_american, odds_decimal, implied_probability, snapshot_at, player_name
       FROM analytics.player_prop_lines
       WHERE game_id = $1 AND player_id = $2 AND market_type = $3 AND snapshot_at = $4
       ORDER BY side, line_value, sportsbook`,
      [gameId, playerId, marketType, snapshotAt]
    );
    return rows;
  }
  const rows = await query<PlayerPropLineComparisonRow>(
    `SELECT sportsbook, side, line_value, odds_american, odds_decimal, implied_probability, snapshot_at, player_name
     FROM analytics.player_prop_lines l
     WHERE l.game_id = $1 AND l.player_id = $2 AND l.market_type = $3
       AND l.snapshot_at = (
         SELECT max(snapshot_at) FROM analytics.player_prop_lines
         WHERE game_id = $1 AND player_id = $2 AND market_type = $3
       )
     ORDER BY side, line_value, sportsbook`,
    [gameId, playerId, marketType]
  );
  return rows;
}

/**
 * Line shopping response: all books for the prop plus best over/under line and best price on same (consensus) line.
 */
export async function getPlayerPropLineShopping(
  gameId: string,
  playerId: string,
  marketType: string
): Promise<PlayerPropLineShoppingResponse> {
  const rows = await getPlayerPropLines(gameId, playerId, marketType, null);
  const playerName =
    rows.length > 0 && rows[0].player_name != null ? rows[0].player_name : '';

  const books: PlayerPropLineBookEntry[] = rows.map((r) => ({
    book: r.sportsbook,
    line: Number(r.line_value),
    side: r.side,
    odds: r.odds_american,
  }));

  const overRows = rows.filter((r) => r.side === 'over');
  const underRows = rows.filter((r) => r.side === 'under');

  // Best over line: minimum line_value (easiest over)
  let best_over_line: PlayerPropLineBestEntry | null = null;
  if (overRows.length > 0) {
    const minOver = overRows.reduce((acc, r) =>
      Number(r.line_value) < Number(acc.line_value) ? r : acc
    );
    best_over_line = { book: minOver.sportsbook, line: Number(minOver.line_value) };
  }

  // Best under line: maximum line_value (easiest under)
  let best_under_line: PlayerPropLineBestEntry | null = null;
  if (underRows.length > 0) {
    const maxUnder = underRows.reduce((acc, r) =>
      Number(r.line_value) > Number(acc.line_value) ? r : acc
    );
    best_under_line = { book: maxUnder.sportsbook, line: Number(maxUnder.line_value) };
  }

  // Consensus line: modal line_value (most frequent) across all rows
  const lineCounts = new Map<string, number>();
  for (const r of rows) {
    const key = String(r.line_value);
    lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1);
  }
  let consensusLine: number | null = null;
  let maxCount = 0;
  for (const [key, count] of lineCounts) {
    if (count > maxCount) {
      maxCount = count;
      consensusLine = parseFloat(key);
    }
  }

  // Best over price on same line: max(odds_american) for over at consensus line
  let best_over_price_same_line: PlayerPropLineBestEntry | null = null;
  if (consensusLine != null && overRows.length > 0) {
    const atLine = overRows.filter((r) => Number(r.line_value) === consensusLine);
    if (atLine.length > 0) {
      const best = atLine.reduce((acc, r) =>
        r.odds_american > acc.odds_american ? r : acc
      );
      best_over_price_same_line = { book: best.sportsbook, odds: best.odds_american };
    }
  }

  // Best under price on same line: max(odds_american) for under at consensus line
  let best_under_price_same_line: PlayerPropLineBestEntry | null = null;
  if (consensusLine != null && underRows.length > 0) {
    const atLine = underRows.filter((r) => Number(r.line_value) === consensusLine);
    if (atLine.length > 0) {
      const best = atLine.reduce((acc, r) =>
        r.odds_american > acc.odds_american ? r : acc
      );
      best_under_price_same_line = { book: best.sportsbook, odds: best.odds_american };
    }
  }

  return {
    player: playerName,
    market: marketType,
    books,
    best_over_line,
    best_under_line,
    best_over_price_same_line,
    best_under_price_same_line,
  };
}

export interface InjuryOpportunityGuardrailFlags {
  capped_by_absolute_minutes: boolean;
  capped_by_plus8_rule: boolean;
  usage_multiplier_clamped: boolean;
  starter_absorption_applied: boolean;
  weak_role_match_penalty: boolean;
  /** True when game is within 45m of tip and consensus snapshots are older than 30m. */
  near_tip_stale_line_penalty: boolean;
}

/** Layer B: how consensus line was built (fresh, latest-per-book, paired O/U). */
export interface InjuryOpportunityConsensusDiagnostics {
  books_count: number;
  oldest_snapshot_at: string;
  newest_snapshot_at: string;
  /** Minutes since newest contributing book snapshot (freshness of market). */
  staleness_minutes: number;
  /** Spread of lines across books at snapshot time; null if single book or undefined. */
  line_dispersion_stddev: number | null;
}

export interface InjuryOpportunityContext {
  injured_players: Array<{ player_id: string; full_name: string; position: string | null; status: string | null; baseline_minutes: number }>;
  lost_minutes_total: number;
  redistributable_minutes_total: number;
}

export interface InjuryOpportunityCandidate {
  game_id: string;
  team_id: string;
  player_id: string;
  full_name: string;
  position: string | null;
  baseline_minutes: number;
  projected_minutes: number;
  baseline_ppm: number;
  opportunity_multiplier: number;
  projected_points: number;
  consensus_line_points: number;
  edge_vs_line: number;
  confidence: number;
  adjusted_edge: number;
  injury_context: InjuryOpportunityContext;
  guardrail_flags: InjuryOpportunityGuardrailFlags;
  consensus_diagnostics: InjuryOpportunityConsensusDiagnostics;
}

type TeamOpportunityInputs = {
  gameId: string;
  teamId: string;
  gameStartTime: string;
  injuredRows: Array<{ player_id: string; full_name: string; position: string | null; status: string | null; baseline_minutes: number; usage_proxy: number }>;
  candidateRows: Array<{ player_id: string; full_name: string; position: string | null; baseline_minutes: number; baseline_ppm: number; appearance_count: number; minute_stddev: number; consistency_ratio: number }>;
  lineRows: Array<{
    player_id: string;
    line_value: number;
    books: number;
    oldest_snapshot_at: string;
    newest_snapshot_at: string;
    staleness_minutes: number;
    line_dispersion_stddev: number | null;
  }>;
};

function toRoleBucket(position: string | null): 'G' | 'F' | 'C' | 'OTHER' {
  const p = (position ?? '').toUpperCase();
  if (p.includes('C')) return 'C';
  if (p.includes('F')) return 'F';
  if (p.includes('G') || p.includes('PG') || p.includes('SG')) return 'G';
  return 'OTHER';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildTeamCandidates(input: TeamOpportunityInputs): InjuryOpportunityCandidate[] {
  const MIN_PARTICIPATION = 3;
  const ALPHA = 0.35;
  const ABS_MIN_CAP = 34;
  const RELATIVE_GAIN_CAP = 8;
  const OPPORTUNITY_MULTIPLIER_MIN = 0.9;
  const OPPORTUNITY_MULTIPLIER_MAX = 1.15;

  const linesByPlayer = new Map<string, TeamOpportunityInputs['lineRows'][number]>();
  for (const row of input.lineRows) linesByPlayer.set(row.player_id, row);

  const eligibleCandidates = input.candidateRows.filter((r) => r.appearance_count >= MIN_PARTICIPATION && linesByPlayer.has(r.player_id));
  if (eligibleCandidates.length === 0) return [];

  let lostMinutesTotal = 0;
  let redistributableLostMinutes = 0;
  let lostUsageTotal = 0;
  let starterAbsorptionApplied = false;
  const injuredBuckets = new Map<'G' | 'F' | 'C' | 'OTHER', number>();
  injuredBuckets.set('G', 0);
  injuredBuckets.set('F', 0);
  injuredBuckets.set('C', 0);
  injuredBuckets.set('OTHER', 0);

  for (const inj of input.injuredRows) {
    const bucket = toRoleBucket(inj.position);
    const baseline = Number.isFinite(inj.baseline_minutes) ? inj.baseline_minutes : 0;
    const cappedPortion = baseline > 30 ? baseline * 0.6 : baseline;
    if (baseline > 30) starterAbsorptionApplied = true;
    lostMinutesTotal += baseline;
    redistributableLostMinutes += cappedPortion;
    lostUsageTotal += Math.max(0, inj.usage_proxy * cappedPortion);
    injuredBuckets.set(bucket, (injuredBuckets.get(bucket) ?? 0) + cappedPortion);
  }

  if (redistributableLostMinutes <= 0) return [];

  const rawWeights = new Map<string, number>();
  const usageWeights = new Map<string, number>();
  for (const c of eligibleCandidates) {
    const bucket = toRoleBucket(c.position);
    const bucketLost = injuredBuckets.get(bucket) ?? 0;
    const nonMatchingLost = redistributableLostMinutes - bucketLost;
    const roleWeight = bucketLost > 0 ? 1 : (nonMatchingLost > 0 ? 0.3 : 0.1);
    const minuteWeight = clamp(c.baseline_minutes / 22, 0.1, 1.0);
    const consistencyWeight = clamp(c.consistency_ratio, 0.1, 1.0);
    const weight = roleWeight * (0.5 + 0.3 * minuteWeight + 0.2 * consistencyWeight);
    rawWeights.set(c.player_id, Math.max(0, weight));
    usageWeights.set(c.player_id, Math.max(0, roleWeight * consistencyWeight));
  }

  const totalWeight = Array.from(rawWeights.values()).reduce((a, b) => a + b, 0);
  const totalUsageWeight = Array.from(usageWeights.values()).reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return [];

  const injuryContext: InjuryOpportunityContext = {
    injured_players: input.injuredRows.map((r) => ({
      player_id: r.player_id,
      full_name: r.full_name,
      position: r.position,
      status: r.status,
      baseline_minutes: r.baseline_minutes,
    })),
    lost_minutes_total: Number(lostMinutesTotal.toFixed(2)),
    redistributable_minutes_total: Number(redistributableLostMinutes.toFixed(2)),
  };

  const mostlyDoubtful = input.injuredRows.length > 0 &&
    input.injuredRows.filter((r) => (r.status ?? '').toLowerCase().startsWith('out')).length <
    input.injuredRows.length / 2;

  return eligibleCandidates.map((c) => {
    const baseMinutes = c.baseline_minutes;
    const normalizedShare = (rawWeights.get(c.player_id) ?? 0) / totalWeight;
    const allocatedMinutes = redistributableLostMinutes * normalizedShare;
    const rawProjectedMinutes = baseMinutes + allocatedMinutes;
    const maxFromRelative = baseMinutes + RELATIVE_GAIN_CAP;
    const projectedMinutes = Math.min(rawProjectedMinutes, ABS_MIN_CAP, maxFromRelative);

    const usageShare = totalUsageWeight > 0 ? (usageWeights.get(c.player_id) ?? 0) / totalUsageWeight : 0;
    const redistributedUsageShare = lostUsageTotal > 0 ? usageShare : 0;
    let usageDelta = ALPHA * redistributedUsageShare;
    const minuteGain = projectedMinutes - baseMinutes;
    if (minuteGain > 6) usageDelta *= 0.5;
    const rawMultiplier = 1 + usageDelta;
    const clampedMultiplier = clamp(rawMultiplier, OPPORTUNITY_MULTIPLIER_MIN, OPPORTUNITY_MULTIPLIER_MAX);
    const projectedPoints = projectedMinutes * c.baseline_ppm * clampedMultiplier;

    let confidence = 1;
    if (c.appearance_count < 5) confidence -= 0.2;
    if (c.minute_stddev > 7) confidence -= 0.15;
    const bucket = toRoleBucket(c.position);
    const weakRoleMatch = (injuredBuckets.get(bucket) ?? 0) === 0;
    if (weakRoleMatch) confidence -= 0.2;
    if (c.appearance_count <= 4) confidence -= 0.15;
    if (mostlyDoubtful) confidence -= 0.1;
    if (!weakRoleMatch && c.minute_stddev <= 4 && c.appearance_count >= 7 && !mostlyDoubtful) {
      confidence += 0.1;
    }

    const line = linesByPlayer.get(c.player_id)!;
    const tipMs = new Date(input.gameStartTime).getTime();
    const nowMs = Date.now();
    const minutesUntilTip = (tipMs - nowMs) / 60000;
    const nearTipStale =
      Number.isFinite(minutesUntilTip) &&
      minutesUntilTip > 0 &&
      minutesUntilTip < 45 &&
      line.staleness_minutes > 30;
    if (nearTipStale) {
      confidence -= 0.1;
    }

    confidence = clamp(confidence, 0.15, 1.0);

    const edge = projectedPoints - line.line_value;
    const adjustedEdge = edge * confidence;

    const consensus_diagnostics: InjuryOpportunityConsensusDiagnostics = {
      books_count: line.books,
      oldest_snapshot_at: line.oldest_snapshot_at,
      newest_snapshot_at: line.newest_snapshot_at,
      staleness_minutes: Number(line.staleness_minutes.toFixed(1)),
      line_dispersion_stddev:
        line.line_dispersion_stddev != null && Number.isFinite(line.line_dispersion_stddev)
          ? Number(line.line_dispersion_stddev.toFixed(3))
          : null,
    };

    return {
      game_id: input.gameId,
      team_id: input.teamId,
      player_id: c.player_id,
      full_name: c.full_name,
      position: c.position,
      baseline_minutes: Number(baseMinutes.toFixed(2)),
      projected_minutes: Number(projectedMinutes.toFixed(2)),
      baseline_ppm: Number(c.baseline_ppm.toFixed(4)),
      opportunity_multiplier: Number(clampedMultiplier.toFixed(4)),
      projected_points: Number(projectedPoints.toFixed(2)),
      consensus_line_points: Number(line.line_value.toFixed(2)),
      edge_vs_line: Number(edge.toFixed(2)),
      confidence: Number(confidence.toFixed(3)),
      adjusted_edge: Number(adjustedEdge.toFixed(2)),
      injury_context: injuryContext,
      consensus_diagnostics,
      guardrail_flags: {
        capped_by_absolute_minutes: rawProjectedMinutes > ABS_MIN_CAP,
        capped_by_plus8_rule: rawProjectedMinutes > maxFromRelative,
        usage_multiplier_clamped: rawMultiplier !== clampedMultiplier,
        starter_absorption_applied: starterAbsorptionApplied,
        weak_role_match_penalty: weakRoleMatch,
        near_tip_stale_line_penalty: nearTipStale,
      },
    };
  });
}

/** Only props snapshots at least this recent count toward consensus (historical rows unchanged). */
const INJURY_OPPORTUNITY_LINE_FRESHNESS_MINUTES = 120;

export async function getInjuryOpportunityCandidates(limit: number = 25): Promise<InjuryOpportunityCandidate[]> {
  const upcomingGames = await query<{ game_id: string; home_team_id: string; away_team_id: string; start_time: string | Date }>(
    `SELECT g.game_id, g.home_team_id, g.away_team_id, g.start_time
     FROM analytics.games g
     WHERE g.start_time >= now() - interval '6 hour'
       AND g.start_time < now() + interval '7 day'
     ORDER BY g.start_time ASC
     LIMIT 30`
  );
  if (upcomingGames.length === 0) return [];

  const gameIds = upcomingGames.map((g) => g.game_id);
  const teamIds = Array.from(new Set(upcomingGames.flatMap((g) => [g.home_team_id, g.away_team_id])));

  const injuredRows = await query<{
    team_id: string;
    player_id: string;
    full_name: string;
    position: string | null;
    status: string | null;
    baseline_minutes: number;
    usage_proxy: number;
  }>(
    `WITH l10 AS (
       SELECT pgl.player_id, pgl.team_id,
              AVG(CASE WHEN NULLIF(TRIM(COALESCE(pgl.minutes, '')), '') IS NOT NULL
                THEN NULLIF(TRIM(REGEXP_REPLACE(COALESCE(pgl.minutes, '0'), '[^0-9.]', '', 'g')), '')::numeric
                ELSE NULL END) AS avg_minutes,
              AVG(CASE
                WHEN NULLIF(TRIM(REGEXP_REPLACE(COALESCE(pgl.minutes, '0'), '[^0-9.]', '', 'g')), '')::numeric > 0
                THEN ((COALESCE(pgl.field_goals_attempted,0) + 0.44 * COALESCE(pgl.free_throws_attempted,0) + COALESCE(pgl.turnovers,0))::numeric
                  / NULLIF(NULLIF(TRIM(REGEXP_REPLACE(COALESCE(pgl.minutes, '0'), '[^0-9.]', '', 'g')), '')::numeric,0))
                ELSE NULL END) AS usage_proxy
       FROM analytics.player_game_logs pgl
       JOIN analytics.games g ON g.game_id = pgl.game_id
       WHERE g.status = 'Final'
         AND pgl.team_id = ANY($1::text[])
       GROUP BY pgl.player_id, pgl.team_id
     )
     SELECT i.team_id, i.player_id, p.full_name, p.position, i.status,
            COALESCE(l10.avg_minutes, 0)::float AS baseline_minutes,
            COALESCE(l10.usage_proxy, 0)::float AS usage_proxy
     FROM analytics.player_injury_status_current i
     JOIN analytics.players p ON p.player_id = i.player_id
     LEFT JOIN l10 ON l10.player_id = i.player_id AND l10.team_id = i.team_id
     WHERE i.team_id = ANY($1::text[])
       AND (LOWER(COALESCE(i.status, '')) LIKE 'out%' OR LOWER(COALESCE(i.status, '')) LIKE 'doubtful%')`,
    [teamIds]
  );

  const injuredByTeam = new Map<string, typeof injuredRows>();
  for (const row of injuredRows) {
    if (!injuredByTeam.has(row.team_id)) injuredByTeam.set(row.team_id, []);
    injuredByTeam.get(row.team_id)!.push(row);
  }

  const injuredPlayerIds = new Set(injuredRows.map((r) => r.player_id));
  const candidates = await query<{
    team_id: string;
    player_id: string;
    full_name: string;
    position: string | null;
    baseline_minutes: number;
    baseline_ppm: number;
    appearance_count: number;
    minute_stddev: number;
    consistency_ratio: number;
  }>(
    `WITH recent AS (
       SELECT pgl.player_id, pgl.team_id,
              NULLIF(TRIM(REGEXP_REPLACE(COALESCE(pgl.minutes, '0'), '[^0-9.]', '', 'g')), '')::numeric AS minutes_num,
              COALESCE(pgl.points, 0)::numeric AS points_num,
              ROW_NUMBER() OVER (PARTITION BY pgl.player_id ORDER BY pgl.game_date DESC NULLS LAST) AS rn
       FROM analytics.player_game_logs pgl
       JOIN analytics.games g ON g.game_id = pgl.game_id
       WHERE g.status = 'Final'
         AND pgl.team_id = ANY($1::text[])
     ),
     l10 AS (
       SELECT r.player_id, r.team_id,
              AVG(r.minutes_num) FILTER (WHERE r.minutes_num IS NOT NULL) AS avg_minutes,
              SUM(r.points_num) FILTER (WHERE r.minutes_num IS NOT NULL) / NULLIF(SUM(r.minutes_num) FILTER (WHERE r.minutes_num IS NOT NULL), 0) AS ppm,
              SUM(CASE WHEN r.minutes_num > 0 THEN 1 ELSE 0 END)::int AS appearances,
              COALESCE(stddev_samp(r.minutes_num) FILTER (WHERE r.minutes_num IS NOT NULL), 0) AS minute_stddev
       FROM recent r
       WHERE r.rn <= 10
       GROUP BY r.player_id, r.team_id
     )
     SELECT l10.team_id, l10.player_id, p.full_name, p.position,
            COALESCE(l10.avg_minutes, 0)::float AS baseline_minutes,
            COALESCE(l10.ppm, 0)::float AS baseline_ppm,
            COALESCE(l10.appearances, 0)::int AS appearance_count,
            COALESCE(l10.minute_stddev, 0)::float AS minute_stddev,
            CASE
              WHEN COALESCE(l10.avg_minutes, 0) <= 0 THEN 0
              ELSE GREATEST(0, LEAST(1, 1 - (COALESCE(l10.minute_stddev, 0) / NULLIF(l10.avg_minutes, 0))))
            END::float AS consistency_ratio
     FROM l10
     JOIN analytics.players p ON p.player_id = l10.player_id
     WHERE COALESCE(l10.avg_minutes, 0) BETWEEN 8 AND 22`,
    [teamIds]
  );

  const lines = await query<{
    game_id: string;
    player_id: string;
    line_value: number;
    books: number;
    oldest_snapshot_at: string | Date;
    newest_snapshot_at: string | Date;
    staleness_minutes: number;
    line_dispersion_stddev: number | null;
  }>(
    `WITH fresh AS (
       SELECT ppc.game_id, ppc.player_id, ppc.sportsbook, ppc.side, ppc.line_value, ppc.snapshot_at
       FROM analytics.player_props_current ppc
       WHERE ppc.game_id::text = ANY($1::text[])
         AND LOWER(COALESCE(ppc.prop_type, '')) = 'points'
         AND LOWER(COALESCE(ppc.market_type, '')) = 'over_under'
         AND LOWER(COALESCE(ppc.side, '')) IN ('over', 'under')
         AND ppc.line_value IS NOT NULL
         AND ppc.sportsbook IS NOT NULL
         AND ppc.snapshot_at >= now() - ($2::int * interval '1 minute')
     ),
     latest_over AS (
       SELECT DISTINCT ON (game_id, player_id, sportsbook)
         game_id, player_id, sportsbook, line_value, snapshot_at AS over_snapshot_at
       FROM fresh
       WHERE LOWER(side) = 'over'
       ORDER BY game_id, player_id, sportsbook, snapshot_at DESC
     ),
     paired AS (
       SELECT lo.game_id, lo.player_id, lo.sportsbook, lo.line_value, lo.over_snapshot_at
       FROM latest_over lo
       WHERE EXISTS (
         SELECT 1 FROM fresh f
         WHERE f.game_id = lo.game_id
           AND f.player_id = lo.player_id
           AND f.sportsbook = lo.sportsbook
           AND f.line_value = lo.line_value
           AND LOWER(f.side) = 'under'
       )
     ),
     agg AS (
       SELECT
         game_id,
         player_id,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY line_value)::float AS line_value,
         COUNT(*)::int AS books,
         MIN(over_snapshot_at) AS oldest_snapshot_at,
         MAX(over_snapshot_at) AS newest_snapshot_at,
         stddev_samp(line_value) AS line_dispersion_stddev
       FROM paired
       GROUP BY game_id, player_id
       HAVING COUNT(*) >= 3
     )
     SELECT
       game_id::text AS game_id,
       player_id::text AS player_id,
       line_value,
       books,
       oldest_snapshot_at,
       newest_snapshot_at,
       (EXTRACT(EPOCH FROM (now() - newest_snapshot_at)) / 60.0)::float AS staleness_minutes,
       line_dispersion_stddev::float AS line_dispersion_stddev
     FROM agg`,
    [gameIds, INJURY_OPPORTUNITY_LINE_FRESHNESS_MINUTES]
  );

  const linesNormalized: TeamOpportunityInputs['lineRows'] = lines.map((l) => ({
    player_id: String(l.player_id),
    line_value: Number(l.line_value),
    books: Number(l.books),
    oldest_snapshot_at:
      l.oldest_snapshot_at instanceof Date
        ? l.oldest_snapshot_at.toISOString()
        : String(l.oldest_snapshot_at),
    newest_snapshot_at:
      l.newest_snapshot_at instanceof Date
        ? l.newest_snapshot_at.toISOString()
        : String(l.newest_snapshot_at),
    staleness_minutes: Number(l.staleness_minutes),
    line_dispersion_stddev:
      l.line_dispersion_stddev != null && Number.isFinite(Number(l.line_dispersion_stddev))
        ? Number(l.line_dispersion_stddev)
        : null,
  }));

  const candidateByTeam = new Map<string, typeof candidates>();
  for (const c of candidates) {
    if (injuredPlayerIds.has(c.player_id)) continue;
    if (!candidateByTeam.has(c.team_id)) candidateByTeam.set(c.team_id, []);
    candidateByTeam.get(c.team_id)!.push(c);
  }
  const linesByGame = new Map<string, TeamOpportunityInputs['lineRows']>();
  for (let i = 0; i < lines.length; i++) {
    const gid = String(lines[i].game_id);
    const row = linesNormalized[i];
    if (!linesByGame.has(gid)) linesByGame.set(gid, []);
    linesByGame.get(gid)!.push(row);
  }

  const all: InjuryOpportunityCandidate[] = [];
  for (const g of upcomingGames) {
    const gameLines = linesByGame.get(String(g.game_id)) ?? [];
    const gameStartIso =
      g.start_time instanceof Date ? g.start_time.toISOString() : String(g.start_time);
    for (const teamId of [g.home_team_id, g.away_team_id]) {
      const teamInjuries = injuredByTeam.get(teamId) ?? [];
      if (teamInjuries.length === 0) continue;
      const teamCandidates = candidateByTeam.get(teamId) ?? [];
      if (teamCandidates.length === 0) continue;
      all.push(...buildTeamCandidates({
        gameId: g.game_id,
        teamId,
        gameStartTime: gameStartIso,
        injuredRows: teamInjuries,
        candidateRows: teamCandidates,
        lineRows: gameLines,
      }));
    }
  }

  return all
    .sort((a, b) => b.adjusted_edge - a.adjusted_edge)
    .slice(0, Math.max(1, limit));
}