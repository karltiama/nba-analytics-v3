import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

interface TeamData {
  team_id: string;
  abbreviation: string;
  full_name: string;
  total_games: number;
  games_with_player_stats: number;
  games_with_team_stats: number;
  games_with_scores: number;
  earliest_game_date: string | null;
  latest_game_date: string | null;
  player_stats_count: number;
  team_stats_count: number;
  coverage_pct: number;
  missing_stats_count: number;
}

export async function GET() {
  try {
    // Get all teams
    const teams = await pool.query(`
      SELECT team_id, abbreviation, full_name
      FROM teams
      ORDER BY abbreviation
    `);

    const teamData: TeamData[] = [];

    // Check data for each team
    for (const team of teams.rows) {
      const stats = await pool.query(`
        SELECT 
          -- Total games in bbref_games
          (SELECT COUNT(*) 
           FROM bbref_games bg
           WHERE bg.home_team_id = $1 OR bg.away_team_id = $1) as total_games,
          
          -- Games with player stats
          (SELECT COUNT(DISTINCT bpgs.game_id)
           FROM bbref_player_game_stats bpgs
           JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
           WHERE bpgs.team_id = $1) as games_with_player_stats,
          
          -- Games with team stats
          (SELECT COUNT(DISTINCT btgs.game_id)
           FROM bbref_team_game_stats btgs
           JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
           WHERE btgs.team_id = $1) as games_with_team_stats,
          
          -- Games with scores
          (SELECT COUNT(*)
           FROM bbref_games bg
           WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
             AND bg.home_score IS NOT NULL
             AND bg.away_score IS NOT NULL) as games_with_scores,
          
          -- Earliest game date
          (SELECT MIN(bg.game_date)
           FROM bbref_games bg
           WHERE bg.home_team_id = $1 OR bg.away_team_id = $1) as earliest_game_date,
          
          -- Latest game date
          (SELECT MAX(bg.game_date)
           FROM bbref_games bg
           WHERE bg.home_team_id = $1 OR bg.away_team_id = $1) as latest_game_date,
          
          -- Total player stats rows
          (SELECT COUNT(*)
           FROM bbref_player_game_stats bpgs
           JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
           WHERE bpgs.team_id = $1) as player_stats_count,
          
          -- Total team stats rows
          (SELECT COUNT(*)
           FROM bbref_team_game_stats btgs
           JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
           WHERE btgs.team_id = $1) as team_stats_count
      `, [team.team_id]);

      const data = stats.rows[0];
      const totalGames = parseInt(data.total_games) || 0;
      const gamesWithTeamStats = parseInt(data.games_with_team_stats) || 0;
      const coveragePct = totalGames > 0 
        ? Math.round((gamesWithTeamStats / totalGames) * 100) 
        : 0;

      teamData.push({
        team_id: team.team_id,
        abbreviation: team.abbreviation,
        full_name: team.full_name,
        total_games: totalGames,
        games_with_player_stats: parseInt(data.games_with_player_stats) || 0,
        games_with_team_stats: gamesWithTeamStats,
        games_with_scores: parseInt(data.games_with_scores) || 0,
        earliest_game_date: data.earliest_game_date 
          ? new Date(data.earliest_game_date).toISOString().split('T')[0]
          : null,
        latest_game_date: data.latest_game_date
          ? new Date(data.latest_game_date).toISOString().split('T')[0]
          : null,
        player_stats_count: parseInt(data.player_stats_count) || 0,
        team_stats_count: parseInt(data.team_stats_count) || 0,
        coverage_pct: coveragePct,
        missing_stats_count: totalGames - gamesWithTeamStats
      });
    }

    // Calculate summary statistics
    const totalGames = teamData.reduce((sum, t) => sum + t.total_games, 0);
    const totalPlayerStats = teamData.reduce((sum, t) => sum + t.games_with_player_stats, 0);
    const totalTeamStats = teamData.reduce((sum, t) => sum + t.games_with_team_stats, 0);
    const totalScores = teamData.reduce((sum, t) => sum + t.games_with_scores, 0);
    const avgCoverage = teamData.length > 0
      ? Math.round(teamData.reduce((sum, t) => sum + t.coverage_pct, 0) / teamData.length)
      : 0;

    // Identify issues
    const teamsWithNoGames = teamData.filter(t => t.total_games === 0);
    const teamsWithLowCoverage = teamData.filter(t => t.total_games > 0 && t.coverage_pct < 50);
    const teamsWithMissingStats = teamData.filter(t => 
      t.total_games > 0 && t.games_with_team_stats < t.total_games
    );

    return NextResponse.json({
      teams: teamData,
      summary: {
        total_teams: teamData.length,
        total_games: totalGames,
        games_with_player_stats: totalPlayerStats,
        games_with_team_stats: totalTeamStats,
        games_with_scores: totalScores,
        average_coverage: avgCoverage,
        total_missing_stats: totalGames - totalTeamStats
      },
      issues: {
        teams_with_no_games: teamsWithNoGames.length,
        teams_with_low_coverage: teamsWithLowCoverage.length,
        teams_with_missing_stats: teamsWithMissingStats.length
      }
    });
  } catch (error: any) {
    console.error('Error checking BBRef data:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

