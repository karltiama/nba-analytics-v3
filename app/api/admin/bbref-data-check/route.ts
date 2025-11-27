import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

interface TeamData {
  team_id: string;
  abbreviation: string;
  full_name: string;
  final_games: number;           // Games with status='Final' (completed)
  games_with_scores: number;     // Final games with scores
  games_with_player_stats: number;
  games_with_team_stats: number;
  missing_boxscores: number;     // Final games without boxscores
  earliest_game_date: string | null;
  latest_game_date: string | null;
  coverage_pct: number;
  wins: number;
  losses: number;
}

export async function GET() {
  try {
    // Get all teams with their BBRef data stats in a single efficient query
    const result = await pool.query(`
      WITH team_final_games AS (
        -- Count Final games per team from bbref_games only
        SELECT 
          t.team_id,
          t.abbreviation,
          t.full_name,
          COUNT(DISTINCT bg.bbref_game_id) as final_games,
          COUNT(DISTINCT CASE WHEN bg.home_score IS NOT NULL AND bg.away_score IS NOT NULL 
                              THEN bg.bbref_game_id END) as games_with_scores,
          MIN(bg.game_date) as earliest_game_date,
          MAX(bg.game_date) as latest_game_date
        FROM teams t
        LEFT JOIN bbref_games bg ON (bg.home_team_id = t.team_id OR bg.away_team_id = t.team_id)
          AND bg.status = 'Final'
        GROUP BY t.team_id, t.abbreviation, t.full_name
      ),
      team_player_stats AS (
        -- Count games with player stats from bbref_player_game_stats only
        SELECT 
          bpgs.team_id,
          COUNT(DISTINCT bpgs.game_id) as games_with_player_stats
        FROM bbref_player_game_stats bpgs
        JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
        WHERE bg.status = 'Final'
        GROUP BY bpgs.team_id
      ),
      team_game_stats AS (
        -- Count games with team stats from bbref_team_game_stats only (source='bbref')
        SELECT 
          btgs.team_id,
          COUNT(DISTINCT btgs.game_id) as games_with_team_stats
        FROM bbref_team_game_stats btgs
        JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
        WHERE bg.status = 'Final'
          AND btgs.source = 'bbref'
        GROUP BY btgs.team_id
      ),
      team_records AS (
        -- Calculate wins/losses directly from bbref_games
        SELECT 
          team_id,
          SUM(CASE WHEN won THEN 1 ELSE 0 END) as wins,
          SUM(CASE WHEN NOT won THEN 1 ELSE 0 END) as losses
        FROM (
          SELECT 
            home_team_id as team_id,
            home_score > away_score as won
          FROM bbref_games
          WHERE status = 'Final'
            AND home_score IS NOT NULL 
            AND away_score IS NOT NULL
          UNION ALL
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
        tfg.team_id,
        tfg.abbreviation,
        tfg.full_name,
        COALESCE(tfg.final_games, 0) as final_games,
        COALESCE(tfg.games_with_scores, 0) as games_with_scores,
        COALESCE(tps.games_with_player_stats, 0) as games_with_player_stats,
        COALESCE(tgs.games_with_team_stats, 0) as games_with_team_stats,
        COALESCE(tfg.final_games, 0) - COALESCE(tgs.games_with_team_stats, 0) as missing_boxscores,
        tfg.earliest_game_date,
        tfg.latest_game_date,
        CASE 
          WHEN COALESCE(tfg.final_games, 0) > 0 
          THEN ROUND((COALESCE(tgs.games_with_team_stats, 0)::numeric / tfg.final_games) * 100)
          ELSE 0 
        END as coverage_pct,
        COALESCE(tr.wins, 0) as wins,
        COALESCE(tr.losses, 0) as losses
      FROM team_final_games tfg
      LEFT JOIN team_player_stats tps ON tfg.team_id = tps.team_id
      LEFT JOIN team_game_stats tgs ON tfg.team_id = tgs.team_id
      LEFT JOIN team_records tr ON tfg.team_id = tr.team_id
      ORDER BY tfg.abbreviation
    `);

    const teamData: TeamData[] = result.rows.map(row => ({
      team_id: row.team_id,
      abbreviation: row.abbreviation,
      full_name: row.full_name,
      final_games: parseInt(row.final_games) || 0,
      games_with_scores: parseInt(row.games_with_scores) || 0,
      games_with_player_stats: parseInt(row.games_with_player_stats) || 0,
      games_with_team_stats: parseInt(row.games_with_team_stats) || 0,
      missing_boxscores: parseInt(row.missing_boxscores) || 0,
      earliest_game_date: row.earliest_game_date 
        ? new Date(row.earliest_game_date).toISOString().split('T')[0]
        : null,
      latest_game_date: row.latest_game_date
        ? new Date(row.latest_game_date).toISOString().split('T')[0]
        : null,
      coverage_pct: parseInt(row.coverage_pct) || 0,
      wins: parseInt(row.wins) || 0,
      losses: parseInt(row.losses) || 0,
    }));

    // Calculate summary statistics
    const totalFinalGames = teamData.reduce((sum, t) => sum + t.final_games, 0) / 2; // Each game counts twice
    const totalWithScores = teamData.reduce((sum, t) => sum + t.games_with_scores, 0) / 2;
    const totalWithTeamStats = teamData.reduce((sum, t) => sum + t.games_with_team_stats, 0) / 2;
    const totalMissingBoxscores = teamData.reduce((sum, t) => sum + t.missing_boxscores, 0) / 2;
    const avgCoverage = teamData.length > 0
      ? Math.round(teamData.reduce((sum, t) => sum + t.coverage_pct, 0) / teamData.length)
      : 0;

    // Identify issues
    const teamsWithNoGames = teamData.filter(t => t.final_games === 0);
    const teamsWithLowCoverage = teamData.filter(t => t.final_games > 0 && t.coverage_pct < 50);
    const teamsWithMissingBoxscores = teamData.filter(t => t.missing_boxscores > 0);

    return NextResponse.json({
      teams: teamData,
      summary: {
        total_teams: teamData.length,
        total_final_games: Math.round(totalFinalGames),
        games_with_scores: Math.round(totalWithScores),
        games_with_team_stats: Math.round(totalWithTeamStats),
        missing_boxscores: Math.round(totalMissingBoxscores),
        average_coverage: avgCoverage,
        data_source: 'bbref_only'
      },
      issues: {
        teams_with_no_games: teamsWithNoGames.length,
        teams_with_low_coverage: teamsWithLowCoverage.length,
        teams_with_missing_boxscores: teamsWithMissingBoxscores.length
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

