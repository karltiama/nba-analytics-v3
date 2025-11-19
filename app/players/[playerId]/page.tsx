import { PlayerHeader } from './components/PlayerHeader';
import { PlayerSeasonStats } from './components/PlayerSeasonStats';
import { PlayerRecentForm } from './components/PlayerRecentForm';
import { PlayerGameLogs } from './components/PlayerGameLogs';
import { query } from '@/lib/db';
import Link from 'next/link';

async function getPlayerInfo(playerId: string) {
  const result = await query(
    `SELECT player_id, full_name, first_name, last_name, position, height, weight, dob, active
     FROM players WHERE player_id = $1`,
    [playerId]
  );
  return result[0] || null;
}

async function getPlayerStats(playerId: string, season: string | null = null) {
  // Get season stats
  let sql = `
    SELECT 
      COUNT(DISTINCT pgs.game_id) as games_played,
      COUNT(DISTINCT CASE WHEN pgs.dnp_reason IS NULL THEN pgs.game_id END) as games_active,
      SUM(pgs.points) as total_points,
      AVG(pgs.points) as avg_points,
      SUM(pgs.rebounds) as total_rebounds,
      AVG(pgs.rebounds) as avg_rebounds,
      SUM(pgs.assists) as total_assists,
      AVG(pgs.assists) as avg_assists,
      SUM(pgs.steals) as total_steals,
      AVG(pgs.steals) as avg_steals,
      SUM(pgs.blocks) as total_blocks,
      AVG(pgs.blocks) as avg_blocks,
      SUM(pgs.turnovers) as total_turnovers,
      AVG(pgs.turnovers) as avg_turnovers,
      SUM(pgs.field_goals_made) as total_fgm,
      SUM(pgs.field_goals_attempted) as total_fga,
      AVG(pgs.field_goals_made::numeric / NULLIF(pgs.field_goals_attempted, 0)) * 100 as fg_pct,
      SUM(pgs.three_pointers_made) as total_3pm,
      SUM(pgs.three_pointers_attempted) as total_3pa,
      AVG(pgs.three_pointers_made::numeric / NULLIF(pgs.three_pointers_attempted, 0)) * 100 as three_pct,
      SUM(pgs.free_throws_made) as total_ftm,
      SUM(pgs.free_throws_attempted) as total_fta,
      AVG(pgs.free_throws_made::numeric / NULLIF(pgs.free_throws_attempted, 0)) * 100 as ft_pct,
      AVG(pgs.minutes) as avg_minutes,
      SUM(pgs.minutes) as total_minutes,
      AVG(pgs.plus_minus) as avg_plus_minus,
      SUM(CASE WHEN pgs.started THEN 1 ELSE 0 END) as games_started
    FROM player_game_stats pgs
    JOIN games g ON pgs.game_id = g.game_id
    WHERE pgs.player_id = $1
      AND g.status = 'Final'
      AND pgs.dnp_reason IS NULL
  `;
  const params: any[] = [playerId];
  if (season) {
    sql += ` AND g.season = $2`;
    params.push(season);
  }
  const seasonStats = await query(sql, params);

  // Get recent form (L5)
  let sqlL5 = `
    WITH recent_games AS (
      SELECT pgs.points, pgs.rebounds, pgs.assists, pgs.field_goals_made, 
             pgs.field_goals_attempted, pgs.minutes
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.game_id
      WHERE pgs.player_id = $1
        AND g.status = 'Final'
        AND pgs.dnp_reason IS NULL
  `;
  const l5Params: any[] = [playerId];
  let l5ParamCount = 2;
  if (season) {
    sqlL5 += ` AND g.season = $${l5ParamCount}`;
    l5Params.push(season);
    l5ParamCount++;
  }
  sqlL5 += `
      ORDER BY g.start_time DESC
      LIMIT 5
    )
    SELECT 
      AVG(points) as avg_points,
      AVG(rebounds) as avg_rebounds,
      AVG(assists) as avg_assists,
      AVG(field_goals_made::numeric / NULLIF(field_goals_attempted, 0)) * 100 as fg_pct,
      AVG(minutes) as avg_minutes
    FROM recent_games
  `;
  const l5 = await query(sqlL5, l5Params);

  // Get recent form (L10)
  let sqlL10 = `
    WITH recent_games AS (
      SELECT pgs.points, pgs.rebounds, pgs.assists, pgs.field_goals_made, 
             pgs.field_goals_attempted, pgs.minutes
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.game_id
      WHERE pgs.player_id = $1
        AND g.status = 'Final'
        AND pgs.dnp_reason IS NULL
  `;
  const l10Params: any[] = [playerId];
  let l10ParamCount = 2;
  if (season) {
    sqlL10 += ` AND g.season = $${l10ParamCount}`;
    l10Params.push(season);
    l10ParamCount++;
  }
  sqlL10 += `
      ORDER BY g.start_time DESC
      LIMIT 10
    )
    SELECT 
      AVG(points) as avg_points,
      AVG(rebounds) as avg_rebounds,
      AVG(assists) as avg_assists,
      AVG(field_goals_made::numeric / NULLIF(field_goals_attempted, 0)) * 100 as fg_pct,
      AVG(minutes) as avg_minutes
    FROM recent_games
  `;
  const l10 = await query(sqlL10, l10Params);

  // Get splits
  let sqlSplits = `
    SELECT 
      CASE WHEN tgs.is_home THEN 'home' ELSE 'away' END as location,
      COUNT(DISTINCT pgs.game_id) as games_played,
      AVG(pgs.points) as avg_points,
      AVG(pgs.rebounds) as avg_rebounds,
      AVG(pgs.assists) as avg_assists,
      AVG(pgs.field_goals_made::numeric / NULLIF(pgs.field_goals_attempted, 0)) * 100 as fg_pct,
      AVG(pgs.minutes) as avg_minutes
    FROM player_game_stats pgs
    JOIN games g ON pgs.game_id = g.game_id
    JOIN team_game_stats tgs ON g.game_id = tgs.game_id AND pgs.team_id = tgs.team_id
    WHERE pgs.player_id = $1
      AND g.status = 'Final'
      AND pgs.dnp_reason IS NULL
  `;
  const splitsParams: any[] = [playerId];
  if (season) {
    sqlSplits += ` AND g.season = $2`;
    splitsParams.push(season);
  }
  sqlSplits += ` GROUP BY location`;
  const splitsResult = await query(sqlSplits, splitsParams);
  const splits: { home: any; away: any } = { home: {}, away: {} };
  splitsResult.forEach((row: any) => {
    if (row.location === 'home') {
      splits.home = row;
    } else {
      splits.away = row;
    }
  });

  return {
    season_stats: seasonStats[0] || {},
    recent_form: {
      last_5: l5[0] || {},
      last_10: l10[0] || {},
    },
    splits,
  };
}

async function getPlayerGames(playerId: string, season: string | null = null, limit: number = 20) {
  let sql = `
    SELECT 
      g.game_id,
      g.start_time,
      g.status,
      g.season,
      pgs.team_id as team_id,
      t_team.abbreviation as team_abbr,
      t_team.full_name as team_name,
      CASE 
        WHEN g.home_team_id = pgs.team_id THEN g.away_team_id
        ELSE g.home_team_id
      END as opponent_id,
      CASE 
        WHEN g.home_team_id = pgs.team_id THEN t_away.abbreviation
        ELSE t_home.abbreviation
      END as opponent_abbr,
      CASE 
        WHEN g.home_team_id = pgs.team_id THEN t_away.full_name
        ELSE t_home.full_name
      END as opponent_name,
      CASE 
        WHEN g.home_team_id = pgs.team_id THEN 'home'
        ELSE 'away'
      END as location,
      CASE 
        WHEN g.home_team_id = pgs.team_id THEN g.home_score
        ELSE g.away_score
      END as team_score,
      CASE 
        WHEN g.home_team_id = pgs.team_id THEN g.away_score
        ELSE g.home_score
      END as opponent_score,
      CASE 
        WHEN g.status != 'Final' THEN NULL
        WHEN g.home_team_id = pgs.team_id AND g.home_score > g.away_score THEN 'W'
        WHEN g.home_team_id = pgs.team_id AND g.home_score < g.away_score THEN 'L'
        WHEN g.away_team_id = pgs.team_id AND g.away_score > g.home_score THEN 'W'
        WHEN g.away_team_id = pgs.team_id AND g.away_score < g.home_score THEN 'L'
        ELSE NULL
      END as result,
      pgs.minutes,
      pgs.points,
      pgs.rebounds,
      pgs.assists,
      pgs.steals,
      pgs.blocks,
      pgs.turnovers,
      pgs.field_goals_made,
      pgs.field_goals_attempted,
      pgs.three_pointers_made,
      pgs.three_pointers_attempted,
      pgs.free_throws_made,
      pgs.free_throws_attempted,
      pgs.plus_minus,
      pgs.started,
      pgs.dnp_reason
    FROM player_game_stats pgs
    JOIN games g ON pgs.game_id = g.game_id
    JOIN teams t_team ON pgs.team_id = t_team.team_id
    JOIN teams t_home ON g.home_team_id = t_home.team_id
    JOIN teams t_away ON g.away_team_id = t_away.team_id
    WHERE pgs.player_id = $1
  `;
  const params: any[] = [playerId];
  let paramCount = 2;
  if (season) {
    sql += ` AND g.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  }
  sql += ` ORDER BY g.start_time DESC LIMIT $${paramCount}`;
  params.push(limit);
  const games = await query(sql, params);
  return { games };
}

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { playerId } = await params;
  const { season } = await searchParams;
  const seasonParam = season || null;

  const [player, statsData, gamesData] = await Promise.all([
    getPlayerInfo(playerId),
    getPlayerStats(playerId, seasonParam),
    getPlayerGames(playerId, seasonParam, 20),
  ]);

  if (!player) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">Player not found</h1>
          <Link href="/dashboard" className="text-blue-600 dark:text-blue-400 hover:underline">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const { season_stats, recent_form, splits } = statsData;
  const { games } = gamesData;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PlayerHeader player={player} />
        <PlayerSeasonStats seasonStats={season_stats} />
        <PlayerRecentForm recentForm={recent_form} />
        <PlayerGameLogs games={games} />
      </div>
    </div>
  );
}

