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
  most_recent_game_date: string | null;
  most_recent_game_has_stats: boolean;
  most_recent_game_id: string | null;
  coverage_pct: number;
  wins: number;
  losses: number;
  roster_issues: number;         // Players in box scores not on active roster
  active_roster_count: number;   // Number of active players on roster
}

export async function GET(request: Request) {
  try {
    // Parse query parameters
    const url = new URL(request.url);
    const endDateParam = url.searchParams.get('end-date'); // Optional: filter games up to this date
    const showAllGames = url.searchParams.get('show-all') === 'true'; // Option to show all games (including today)
    
    // Always calculate yesterday for "most recent game" check (only flag games up to yesterday)
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    
    // Default to yesterday (only show completed games)
    // Use local date, not UTC, to match user's timezone
    let endDate: string | null = null;
    if (!showAllGames) {
      // Default: filter to yesterday
      endDate = yesterdayStr;
    } else if (endDateParam) {
      // If show-all is true but end-date is provided, use the provided date
      endDate = endDateParam;
    }
    // If showAllGames is true and no endDateParam, endDate stays null (show all games)
    
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
          ${endDate ? `AND bg.game_date <= $1::date` : ''}
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
          ${endDate ? `AND bg.game_date <= $1::date` : ''}
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
          ${endDate ? `AND bg.game_date <= $1::date` : ''}
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
            ${endDate ? `AND game_date <= $1::date` : ''}
          UNION ALL
          SELECT 
            away_team_id as team_id,
            away_score > home_score as won
          FROM bbref_games
          WHERE status = 'Final'
            AND home_score IS NOT NULL 
            AND away_score IS NOT NULL
            ${endDate ? `AND game_date <= $1::date` : ''}
        ) game_results
        GROUP BY team_id
      ),
      most_recent_games AS (
        -- Get the most recent game for each team (up to yesterday only) and check if it has stats
        -- Always check only up to yesterday - don't flag today's games as outdated
        SELECT 
          t.team_id,
          latest_game.bbref_game_id as most_recent_game_id,
          latest_game.game_date as most_recent_game_date,
          CASE WHEN EXISTS (
            SELECT 1 FROM bbref_team_game_stats btgs 
            WHERE btgs.game_id = latest_game.bbref_game_id 
              AND btgs.team_id = t.team_id
              AND btgs.source = 'bbref'
          ) THEN true ELSE false END as most_recent_game_has_stats
        FROM teams t
        LEFT JOIN LATERAL (
          SELECT bg.bbref_game_id, bg.game_date
          FROM bbref_games bg
          WHERE (bg.home_team_id = t.team_id OR bg.away_team_id = t.team_id)
            AND bg.status = 'Final'
            AND bg.game_date <= $2::date
          ORDER BY bg.game_date DESC
          LIMIT 1
        ) latest_game ON true
      ),
      roster_check AS (
        -- Check for players in box scores who aren't on the team's active roster
        -- Check against the most common season for each team (default to '2025')
        SELECT 
          bpgs.team_id,
          COUNT(DISTINCT bpgs.player_id) FILTER (
            WHERE NOT EXISTS (
              SELECT 1 
              FROM player_team_rosters ptr
              WHERE ptr.player_id = bpgs.player_id
                AND ptr.team_id = bpgs.team_id
                AND ptr.active = true
                AND ptr.season = COALESCE(
                  (SELECT season 
                   FROM bbref_games bg2 
                   JOIN bbref_player_game_stats bpgs2 ON bg2.bbref_game_id = bpgs2.game_id
                   WHERE bpgs2.team_id = bpgs.team_id 
                     AND bg2.status = 'Final'
                   GROUP BY season 
                   ORDER BY COUNT(*) DESC 
                   LIMIT 1),
                  '2025'
                )
            )
          ) as roster_issues,
          (SELECT COUNT(DISTINCT ptr.player_id)
           FROM player_team_rosters ptr
           WHERE ptr.team_id = bpgs.team_id
             AND ptr.active = true
             AND ptr.season = COALESCE(
               (SELECT season 
                FROM bbref_games bg2 
                JOIN bbref_player_game_stats bpgs2 ON bg2.bbref_game_id = bpgs2.game_id
                WHERE bpgs2.team_id = bpgs.team_id 
                  AND bg2.status = 'Final'
                GROUP BY season 
                ORDER BY COUNT(*) DESC 
                LIMIT 1),
               '2025'
             )
          ) as active_roster_count
        FROM bbref_player_game_stats bpgs
        JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
        WHERE bg.status = 'Final'
          ${endDate ? `AND bg.game_date <= $1::date` : ''}
        GROUP BY bpgs.team_id
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
        mrg.most_recent_game_date,
        COALESCE(mrg.most_recent_game_has_stats, false) as most_recent_game_has_stats,
        mrg.most_recent_game_id,
        CASE 
          WHEN COALESCE(tfg.final_games, 0) > 0 
          THEN ROUND((COALESCE(tgs.games_with_team_stats, 0)::numeric / tfg.final_games) * 100)
          ELSE 0 
        END as coverage_pct,
        COALESCE(tr.wins, 0) as wins,
        COALESCE(tr.losses, 0) as losses,
        COALESCE(rc.roster_issues, 0) as roster_issues,
        COALESCE(rc.active_roster_count, 0) as active_roster_count
      FROM team_final_games tfg
      LEFT JOIN team_player_stats tps ON tfg.team_id = tps.team_id
      LEFT JOIN team_game_stats tgs ON tfg.team_id = tgs.team_id
      LEFT JOIN team_records tr ON tfg.team_id = tr.team_id
      LEFT JOIN most_recent_games mrg ON tfg.team_id = mrg.team_id
      LEFT JOIN roster_check rc ON tfg.team_id = rc.team_id
      ORDER BY tfg.abbreviation
    `, endDate ? [endDate, yesterdayStr] : [yesterdayStr, yesterdayStr]);

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
      most_recent_game_date: row.most_recent_game_date
        ? new Date(row.most_recent_game_date).toISOString().split('T')[0]
        : null,
      most_recent_game_has_stats: row.most_recent_game_has_stats || false,
      most_recent_game_id: row.most_recent_game_id || null,
      coverage_pct: parseInt(row.coverage_pct) || 0,
      wins: parseInt(row.wins) || 0,
      losses: parseInt(row.losses) || 0,
      roster_issues: parseInt(row.roster_issues) || 0,
      active_roster_count: parseInt(row.active_roster_count) || 0,
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
    const teamsWithOutdatedRecentGame = teamData.filter(t => 
      t.most_recent_game_date && !t.most_recent_game_has_stats
    );
    const teamsWithRosterIssues = teamData.filter(t => t.roster_issues > 0);

    // Calculate overall date range from the data
    const allDates = teamData
      .filter(t => t.earliest_game_date || t.latest_game_date)
      .flatMap(t => [t.earliest_game_date, t.latest_game_date].filter(Boolean) as string[]);
    
    const overallEarliest = allDates.length > 0 
      ? allDates.reduce((earliest, date) => date < earliest ? date : earliest, allDates[0])
      : null;
    const overallLatest = allDates.length > 0 
      ? allDates.reduce((latest, date) => date > latest ? date : latest, allDates[0])
      : null;
    
    return NextResponse.json({
      teams: teamData,
      summary: {
        total_teams: teamData.length,
        total_final_games: Math.round(totalFinalGames),
        games_with_scores: Math.round(totalWithScores),
        games_with_team_stats: Math.round(totalWithTeamStats),
        missing_boxscores: Math.round(totalMissingBoxscores),
        average_coverage: avgCoverage,
        data_source: 'bbref_only',
        date_range: {
          earliest: overallEarliest,
          latest: overallLatest,
          filtered_to: endDate || null,
          note: endDate ? `Showing Final games up to ${endDate} (yesterday)` : 'Showing all Final games (including today)'
        }
      },
      issues: {
        teams_with_no_games: teamsWithNoGames.length,
        teams_with_low_coverage: teamsWithLowCoverage.length,
        teams_with_missing_boxscores: teamsWithMissingBoxscores.length,
        teams_with_outdated_recent_game: teamsWithOutdatedRecentGame.length,
        teams_with_roster_issues: teamsWithRosterIssues.length
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

