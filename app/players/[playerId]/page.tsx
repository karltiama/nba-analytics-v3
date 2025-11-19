import { PlayerHeader } from './components/PlayerHeader';
import { PlayerSeasonStats } from './components/PlayerSeasonStats';
import { PlayerRecentForm } from './components/PlayerRecentForm';
import { PlayerGameLogs } from './components/PlayerGameLogs';
import { PlayerAdvancedStats } from './components/PlayerAdvancedStats';
import {
  getPlayerInfo,
  getPlayerSeasonStats,
  getPlayerPaceAdjustedStats,
  getPlayerUsageRate,
  getPlayerRecentForm,
  getPlayerSplits,
  getMultipleOpponentDefensiveRankings,
} from '@/lib/players/queries';
import { query } from '@/lib/db';
import Link from 'next/link';

async function getPlayerStats(playerId: string, season: string | null = null) {
  const [seasonStats, paceAdjusted, usageRate, recentForm, splits] = await Promise.all([
    getPlayerSeasonStats(playerId, season),
    getPlayerPaceAdjustedStats(playerId, season),
    getPlayerUsageRate(playerId, season),
    getPlayerRecentForm(playerId, season),
    getPlayerSplits(playerId, season),
  ]);

  return {
    season_stats: seasonStats,
    pace_adjusted: paceAdjusted,
    usage_rate: usageRate,
    recent_form: recentForm,
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
  
  // Get opponent defensive rankings for all unique opponents in a single query
  const uniqueOpponentIds = [...new Set(games.map((g: any) => g.opponent_id))];
  const opponentRankings = await getMultipleOpponentDefensiveRankings(uniqueOpponentIds, season);
  
  // Add rankings to each game
  const gamesWithRankings = games.map((game: any) => ({
    ...game,
    opponent_defensive_rankings: opponentRankings[game.opponent_id] || {},
  }));
  
  return { games: gamesWithRankings };
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

  const { season_stats, pace_adjusted, usage_rate, recent_form, splits } = statsData;
  const { games } = gamesData;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PlayerHeader player={player} />
        <PlayerSeasonStats seasonStats={season_stats} />
        <PlayerAdvancedStats 
          seasonStats={season_stats}
          paceAdjusted={pace_adjusted}
          usageRate={usage_rate}
        />
        <PlayerRecentForm recentForm={recent_form} />
        <PlayerGameLogs games={games} />
      </div>
    </div>
  );
}

