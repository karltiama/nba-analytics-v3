import { query } from '@/lib/db';

/**
 * Betting Dashboard Query Functions
 * 
 * Fetches data for the betting dashboard using BBRef tables
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
 * Get games for a specific date from bbref_schedule
 * Joins with bbref_games to get status/scores if available
 */
export async function getGamesForDate(date: string) {
  // Get games scheduled for this date from bbref_schedule
  // Left join with bbref_games to get status/scores if the game has been played
  // Use start_time from bbref_schedule first, then bbref_games, then default to 7 PM ET
  const gamesResult = await query(`
    SELECT 
      bs.bbref_game_id as game_id,
      bs.game_date,
      COALESCE(bs.start_time, bg.start_time, bs.game_date::timestamptz + interval '19 hours') as start_time,
      bs.home_team_id,
      bs.away_team_id,
      ht.full_name as home_team_name,
      at.full_name as away_team_name,
      bs.home_team_abbr,
      bs.away_team_abbr,
      bg.home_score,
      bg.away_score,
      COALESCE(bg.status, 'Scheduled') as status
    FROM bbref_schedule bs
    JOIN teams ht ON bs.home_team_id = ht.team_id
    JOIN teams at ON bs.away_team_id = at.team_id
    LEFT JOIN bbref_games bg ON bs.bbref_game_id = bg.bbref_game_id
    WHERE bs.game_date = $1::date
    ORDER BY COALESCE(bs.start_time, bg.start_time, bs.game_date::timestamptz) ASC
  `, [date]);

  return gamesResult;
}

/**
 * Get today's games from bbref_schedule
 */
export async function getTodaysGames() {
  // Get today's date in ET timezone (NBA uses ET)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return getGamesForDate(today);
}

/**
 * Get recent games (last N games) for the dashboard
 */
export async function getRecentGames(limit: number = 10) {
  const result = await query(`
    SELECT 
      bg.bbref_game_id as game_id,
      bg.game_date,
      COALESCE(bg.start_time, bg.game_date::timestamptz) as start_time,
      bg.home_team_id,
      bg.away_team_id,
      ht.full_name as home_team_name,
      at.full_name as away_team_name,
      ht.abbreviation as home_team_abbr,
      at.abbreviation as away_team_abbr,
      bg.home_score,
      bg.away_score,
      bg.status
    FROM bbref_games bg
    JOIN teams ht ON bg.home_team_id = ht.team_id
    JOIN teams at ON bg.away_team_id = at.team_id
    WHERE bg.status = 'Final'
    ORDER BY bg.game_date DESC, bg.start_time DESC
    LIMIT $1
  `, [limit]);

  return result;
}

/**
 * Get team ratings (offensive/defensive) for all teams
 */
export async function getAllTeamRatings(): Promise<Record<string, TeamRatings>> {
  const result = await query(`
    WITH team_stats AS (
      SELECT 
        btgs.team_id,
        COUNT(DISTINCT btgs.game_id) as games_played,
        AVG(btgs.points) as avg_points,
        AVG(CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END) as avg_points_against,
        AVG(btgs.possessions) as avg_possessions,
        -- Offensive Rating: Points per 100 possessions
        AVG(btgs.points::numeric / NULLIF(btgs.possessions, 0)) * 100 as offensive_rating,
        -- Defensive Rating: Points allowed per 100 possessions
        AVG(
          CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END::numeric / 
          NULLIF(btgs.possessions, 0)
        ) * 100 as defensive_rating,
        -- Pace: Possessions per 48 minutes (approximated)
        AVG(btgs.possessions) * 48.0 / NULLIF(AVG(btgs.minutes), 0) * 5 as pace
      FROM bbref_team_game_stats btgs
      JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
      WHERE bg.status = 'Final'
        AND btgs.source = 'bbref'
      GROUP BY btgs.team_id
    ),
    -- Calculate records directly from bbref_games (not from team_game_stats)
    -- This ensures we only count Final games with actual scores
    team_records AS (
      SELECT 
        team_id,
        SUM(CASE WHEN won THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN NOT won THEN 1 ELSE 0 END) as losses
      FROM (
        -- Home team results
        SELECT 
          home_team_id as team_id,
          home_score > away_score as won
        FROM bbref_games
        WHERE status = 'Final'
          AND home_score IS NOT NULL 
          AND away_score IS NOT NULL
        UNION ALL
        -- Away team results
        SELECT 
          away_team_id as team_id,
          away_score > home_score as won
        FROM bbref_games
        WHERE status = 'Final'
          AND home_score IS NOT NULL 
          AND away_score IS NOT NULL
      ) game_results
      GROUP BY team_id
    )
    SELECT 
      ts.team_id,
      ts.offensive_rating,
      ts.defensive_rating,
      ts.pace,
      ts.avg_points,
      ts.avg_points_against,
      COALESCE(tr.wins, 0) as wins,
      COALESCE(tr.losses, 0) as losses
    FROM team_stats ts
    LEFT JOIN team_records tr ON ts.team_id = tr.team_id
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
      bg.bbref_game_id as game_id,
      bg.game_date,
      btgs.is_home,
      btgs.points as team_score,
      CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END as opponent_score,
      CASE 
        WHEN btgs.is_home AND bg.home_score > bg.away_score THEN 'W'
        WHEN NOT btgs.is_home AND bg.away_score > bg.home_score THEN 'W'
        ELSE 'L'
      END as result,
      CASE WHEN btgs.is_home THEN at.abbreviation ELSE ht.abbreviation END as opponent_abbr
    FROM bbref_team_game_stats btgs
    JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
    JOIN teams ht ON bg.home_team_id = ht.team_id
    JOIN teams at ON bg.away_team_id = at.team_id
    WHERE btgs.team_id = $1
      AND bg.status = 'Final'
      AND btgs.source = 'bbref'
    ORDER BY bg.game_date DESC
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

/**
 * Get player's upcoming opponent info
 */
export async function getPlayerNextOpponent(playerId: string) {
  // For now, return null since we don't have scheduled games yet
  // This will be populated when we add odds API
  return null;
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

