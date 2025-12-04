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
  // Use canonical_game_id if available (for odds matching), otherwise bbref_game_id
  const gamesResult = await query(`
    SELECT 
      COALESCE(bs.canonical_game_id, bs.bbref_game_id) as game_id,
      bs.bbref_game_id,
      bs.canonical_game_id,
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
 * Get latest pre-game odds for a game
 * Returns odds from a single bookmaker (DraftKings by default) for consistency
 */
export async function getGameOdds(gameId: string, preferredBookmaker: string = 'draftkings'): Promise<GameOdds> {
  // First try to get all odds from preferred bookmaker
  let result = await query(`
    SELECT 
      m.market_type,
      m.side,
      m.line,
      m.odds,
      m.bookmaker
    FROM markets m
    WHERE m.game_id = $1
      AND m.snapshot_type = 'pre_game'
      AND m.market_type IN ('moneyline', 'spread', 'total')
      AND m.bookmaker = $2
  `, [gameId, preferredBookmaker]);

  // If preferred bookmaker doesn't have all markets, fall back to any bookmaker
  if (result.length < 6) { // Need at least 6 markets (2 moneyline + 2 spread + 2 total)
    const fallbackResult = await query(`
      WITH bookmaker_counts AS (
        SELECT 
          m.bookmaker,
          COUNT(DISTINCT m.market_type || '_' || m.side) as market_count
        FROM markets m
        WHERE m.game_id = $1
          AND m.snapshot_type = 'pre_game'
          AND m.market_type IN ('moneyline', 'spread', 'total')
        GROUP BY m.bookmaker
      ),
      best_bookmaker AS (
        SELECT bookmaker
        FROM bookmaker_counts
        ORDER BY market_count DESC, bookmaker
        LIMIT 1
      )
      SELECT 
        m.market_type,
        m.side,
        m.line,
        m.odds,
        m.bookmaker
      FROM markets m
      CROSS JOIN best_bookmaker bb
      WHERE m.game_id = $1
        AND m.snapshot_type = 'pre_game'
        AND m.market_type IN ('moneyline', 'spread', 'total')
        AND m.bookmaker = bb.bookmaker
      ORDER BY m.fetched_at DESC
    `, [gameId]);
    
    if (fallbackResult.length > 0) {
      result = fallbackResult;
    }
  }

  // Initialize default structure
  const odds: GameOdds = {
    home: {
      moneyline: null,
      spread: null,
      spreadOdds: null,
    },
    away: {
      moneyline: null,
      spread: null,
      spreadOdds: null,
    },
    overUnder: null,
    overOdds: null,
    underOdds: null,
    bookmaker: null,
  };

  // Process results
  result.forEach((row: any) => {
    const bookmaker = row.bookmaker;
    if (!odds.bookmaker) {
      odds.bookmaker = bookmaker;
    }

    if (row.market_type === 'moneyline') {
      if (row.side === 'home') {
        odds.home.moneyline = row.odds;
      } else if (row.side === 'away') {
        odds.away.moneyline = row.odds;
      }
    } else if (row.market_type === 'spread') {
      if (row.side === 'home') {
        odds.home.spread = row.line;
        odds.home.spreadOdds = row.odds;
      } else if (row.side === 'away') {
        odds.away.spread = row.line;
        odds.away.spreadOdds = row.odds;
      }
    } else if (row.market_type === 'total') {
      if (row.side === 'over') {
        odds.overUnder = row.line;
        odds.overOdds = row.odds;
      } else if (row.side === 'under') {
        odds.overUnder = row.line; // Same line for both
        odds.underOdds = row.odds;
      }
    }
  });

  return odds;
}

/**
 * Get odds for multiple games at once
 * Uses a single default bookmaker (DraftKings) for consistency
 * Falls back to any available bookmaker if DraftKings doesn't have the game
 */
export async function getGamesOdds(gameIds: string[], preferredBookmaker: string = 'draftkings'): Promise<Record<string, GameOdds>> {
  if (gameIds.length === 0) {
    return {};
  }

  // Get odds from preferred bookmaker (DraftKings) first
  let result = await query(`
    SELECT 
      m.game_id,
      m.market_type,
      m.side,
      m.line,
      m.odds,
      m.bookmaker
    FROM markets m
    WHERE m.game_id = ANY($1)
      AND m.snapshot_type = 'pre_game'
      AND m.market_type IN ('moneyline', 'spread', 'total')
      AND m.bookmaker = $2
    ORDER BY m.game_id, m.market_type, m.side
  `, [gameIds, preferredBookmaker]);

  // Find games that don't have DraftKings odds
  const gamesWithOdds = new Set(result.map((r: any) => r.game_id));
  const gamesWithoutOdds = gameIds.filter(id => !gamesWithOdds.has(id));

  // For games without DraftKings, get any available bookmaker
  if (gamesWithoutOdds.length > 0) {
    const fallbackResult = await query(`
      WITH game_bookmakers AS (
        SELECT DISTINCT
          m.game_id,
          m.bookmaker,
          COUNT(DISTINCT m.market_type || '_' || m.side) as market_count
        FROM markets m
        WHERE m.game_id = ANY($1)
          AND m.snapshot_type = 'pre_game'
          AND m.market_type IN ('moneyline', 'spread', 'total')
        GROUP BY m.game_id, m.bookmaker
      ),
      best_bookmaker_per_game AS (
        SELECT 
          game_id,
          bookmaker,
          ROW_NUMBER() OVER (
            PARTITION BY game_id 
            ORDER BY market_count DESC, bookmaker
          ) as rn
        FROM game_bookmakers
      )
      SELECT 
        m.game_id,
        m.market_type,
        m.side,
        m.line,
        m.odds,
        m.bookmaker
      FROM markets m
      INNER JOIN best_bookmaker_per_game bb ON m.game_id = bb.game_id AND m.bookmaker = bb.bookmaker
      WHERE m.game_id = ANY($1)
        AND m.snapshot_type = 'pre_game'
        AND m.market_type IN ('moneyline', 'spread', 'total')
        AND bb.rn = 1
      ORDER BY m.game_id, m.market_type, m.side
    `, [gamesWithoutOdds]);

    // Combine results
    result = [...result, ...fallbackResult];
  }

  // Group by game_id
  const oddsMap: Record<string, GameOdds> = {};

  // Initialize all games with default structure
  gameIds.forEach((gameId) => {
    oddsMap[gameId] = {
      home: { moneyline: null, spread: null, spreadOdds: null },
      away: { moneyline: null, spread: null, spreadOdds: null },
      overUnder: null,
      overOdds: null,
      underOdds: null,
      bookmaker: null,
    };
  });

  // Process results
  result.forEach((row: any) => {
    const gameId = row.game_id;
    if (!oddsMap[gameId]) {
      oddsMap[gameId] = {
        home: { moneyline: null, spread: null, spreadOdds: null },
        away: { moneyline: null, spread: null, spreadOdds: null },
        overUnder: null,
        overOdds: null,
        underOdds: null,
        bookmaker: null,
      };
    }

    const odds = oddsMap[gameId];
    if (!odds.bookmaker) {
      odds.bookmaker = row.bookmaker;
    }

    if (row.market_type === 'moneyline') {
      if (row.side === 'home') {
        odds.home.moneyline = row.odds;
      } else if (row.side === 'away') {
        odds.away.moneyline = row.odds;
      }
    } else if (row.market_type === 'spread') {
      if (row.side === 'home') {
        odds.home.spread = row.line;
        odds.home.spreadOdds = row.odds;
      } else if (row.side === 'away') {
        odds.away.spread = row.line;
        odds.away.spreadOdds = row.odds;
      }
    } else if (row.market_type === 'total') {
      if (row.side === 'over') {
        odds.overUnder = row.line;
        odds.overOdds = row.odds;
      } else if (row.side === 'under') {
        odds.overUnder = row.line;
        odds.underOdds = row.odds;
      }
    }
  });

  return oddsMap;
}

/**
 * Get historical matchups between two teams (last 10 games)
 */
export async function getHistoricalMatchups(homeTeamId: string, awayTeamId: string, limit: number = 10) {
  const result = await query(`
    SELECT 
      bg.bbref_game_id as game_id,
      bg.game_date,
      TO_CHAR(bg.game_date, 'MM/DD/YYYY') as date,
      bg.home_team_id,
      bg.away_team_id,
      ht.abbreviation as home_team_abbr,
      ht.full_name as home_team_name,
      at.abbreviation as away_team_abbr,
      at.full_name as away_team_name,
      bg.home_score,
      bg.away_score,
      (bg.home_score + bg.away_score) as total_points
    FROM bbref_games bg
    JOIN teams ht ON bg.home_team_id = ht.team_id
    JOIN teams at ON bg.away_team_id = at.team_id
    WHERE bg.status = 'Final'
      AND (
        (bg.home_team_id = $1 AND bg.away_team_id = $2) OR
        (bg.home_team_id = $2 AND bg.away_team_id = $1)
      )
    ORDER BY bg.game_date DESC
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
 * Get line movement data for a game
 * Returns spread and total movement over time from markets table
 * Note: gameId can be either canonical_game_id or bbref_game_id
 */
export async function getLineMovement(gameId: string, preferredBookmaker: string = 'draftkings') {
  // First, try to get all snapshots for this game from the preferred bookmaker
  // Check both the game_id directly and any related IDs
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

  // If no results, check if gameId is a bbref_game_id and look for canonical_game_id
  if (result.length === 0) {
    const canonicalLookup = await query(`
      SELECT canonical_game_id 
      FROM bbref_schedule 
      WHERE bbref_game_id = $1 
      LIMIT 1
    `, [gameId]);
    
    if (canonicalLookup.length > 0 && canonicalLookup[0].canonical_game_id) {
      result = await query(`
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
      `, [canonicalLookup[0].canonical_game_id, preferredBookmaker]);
    }
  }

  // If still no results from preferred bookmaker, try any bookmaker
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
      // Group by bookmaker and use the one with most data
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
    return {
      spreadMovement: [],
      totalMovement: [],
    };
  }

  return formatLineMovement(result);
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
 * Get projected starting lineup for a team based on recent games
 * Uses multiple heuristics to determine starters:
 * 1. Players marked as started (if available)
 * 2. Players with high minutes (25+ min typically indicates starter)
 * 3. Players who appear early in box score order (starters listed first)
 * 4. Most common player at each position in recent games
 */
export async function getProjectedStartingLineup(teamId: string): Promise<StartingLineup | null> {
  const result = await query(`
    WITH recent_games AS (
      SELECT DISTINCT bg.bbref_game_id, bg.game_date
      FROM bbref_games bg
      WHERE bg.status = 'Final'
        AND (bg.home_team_id = $1 OR bg.away_team_id = $1)
      ORDER BY bg.game_date DESC
      LIMIT 10
    ),
    player_game_data AS (
      SELECT 
        bpgs.player_id,
        p.full_name,
        p.position,
        bpgs.game_id,
        bpgs.minutes,
        bpgs.points,
        bpgs.started,
        bpgs.dnp_reason,
        -- Calculate starter score: higher = more likely to be starter
        CASE 
          WHEN bpgs.started = true THEN 10  -- Explicit starter flag
          WHEN bpgs.minutes >= 30 THEN 8     -- High minutes = likely starter
          WHEN bpgs.minutes >= 25 THEN 6     -- Good minutes = probably starter
          WHEN bpgs.minutes >= 20 THEN 4     -- Decent minutes = maybe starter
          ELSE 2                              -- Low minutes = unlikely starter
        END as starter_score,
        -- Get player order in game (starters usually appear first)
        ROW_NUMBER() OVER (
          PARTITION BY bpgs.game_id, bpgs.team_id 
          ORDER BY 
            CASE WHEN bpgs.started = true THEN 0 ELSE 1 END,
            bpgs.minutes DESC NULLS LAST,
            bpgs.points DESC
        ) as player_order
      FROM bbref_player_game_stats bpgs
      JOIN players p ON bpgs.player_id = p.player_id
      JOIN recent_games rg ON bpgs.game_id = rg.bbref_game_id
      WHERE bpgs.team_id = $1
        AND bpgs.dnp_reason IS NULL
        AND bpgs.minutes > 0
    ),
    player_aggregates AS (
      SELECT 
        player_id,
        MAX(full_name) as full_name,
        MAX(position) as position,
        COUNT(*) as games_played,
        SUM(CASE WHEN started = true THEN 1 ELSE 0 END) as explicit_starts,
        SUM(CASE WHEN minutes >= 25 THEN 1 ELSE 0 END) as high_minute_games,
        SUM(CASE WHEN player_order <= 5 THEN 1 ELSE 0 END) as early_appearance_games,
        AVG(starter_score) as avg_starter_score,
        AVG(points) as avg_points,
        AVG(minutes) as avg_minutes
      FROM player_game_data
      GROUP BY player_id
      HAVING COUNT(*) >= 3  -- Must have played in at least 3 recent games
    ),
    position_candidates AS (
      SELECT 
        player_id,
        full_name,
        position,
        games_played,
        explicit_starts,
        high_minute_games,
        early_appearance_games,
        avg_starter_score,
        avg_points,
        avg_minutes,
        -- Combined starter likelihood score
        (explicit_starts * 3 + high_minute_games * 2 + early_appearance_games * 1.5 + avg_starter_score) as starter_likelihood
      FROM player_aggregates
    ),
    position_rankings AS (
      SELECT 
        player_id,
        full_name,
        position,
        games_played,
        explicit_starts,
        avg_points,
        avg_minutes,
        ROW_NUMBER() OVER (
          PARTITION BY position 
          ORDER BY starter_likelihood DESC, avg_minutes DESC, avg_points DESC
        ) as position_rank
      FROM position_candidates
    )
    SELECT 
      player_id,
      full_name,
      position,
      games_played as games_started,
      avg_points,
      avg_minutes
    FROM position_rankings
    WHERE position_rank = 1
      AND position IS NOT NULL
    ORDER BY 
      CASE position
        WHEN 'PG' THEN 1
        WHEN 'SG' THEN 2
        WHEN 'SF' THEN 3
        WHEN 'PF' THEN 4
        WHEN 'C' THEN 5
        ELSE 6
      END,
      position,
      full_name
    LIMIT 5
  `, [teamId]);

  if (result.length === 0) {
    return null;
  }

  return {
    team_id: teamId,
    players: result.map((row: any) => ({
      player_id: row.player_id,
      full_name: row.full_name,
      position: row.position || 'N/A',
      games_started: parseInt(row.games_started) || 0,
      avg_points: parseFloat(row.avg_points) || 0,
      avg_minutes: parseFloat(row.avg_minutes) || 0,
    })),
  };
}

/**
 * Get projected starting lineups for both teams in a game
 */
export async function getGameStartingLineups(
  homeTeamId: string,
  awayTeamId: string
): Promise<{ home: StartingLineup | null; away: StartingLineup | null }> {
  const [homeLineup, awayLineup] = await Promise.all([
    getProjectedStartingLineup(homeTeamId),
    getProjectedStartingLineup(awayTeamId),
  ]);

  return {
    home: homeLineup,
    away: awayLineup,
  };
}

/**
 * Get comprehensive matchup analysis for a game
 * Includes opponent defensive rankings, pace analysis, and key player matchups
 */
export async function getMatchupAnalysis(gameId: string): Promise<MatchupAnalysis | null> {
  // Get game info
  const gameResult = await query(`
    SELECT 
      COALESCE(bs.canonical_game_id, bs.bbref_game_id) as game_id,
      bs.home_team_id,
      bs.away_team_id
    FROM bbref_schedule bs
    WHERE bs.bbref_game_id = $1 
       OR bs.canonical_game_id = $1
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

  // Get projected starting lineups
  const startingLineups = await getGameStartingLineups(homeTeamId, awayTeamId);

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

