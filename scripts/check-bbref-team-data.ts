import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Check BBRef data accuracy for all teams
 * Shows summary statistics and identifies data issues
 */

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
}

async function checkAllTeams() {
  console.log('\n🔍 Checking BBRef Data for All Teams\n');
  console.log('='.repeat(100));
  
  try {
    // Get all teams
    const teams = await pool.query(`
      SELECT team_id, abbreviation, full_name
      FROM teams
      ORDER BY abbreviation
    `);
    
    console.log(`\nFound ${teams.rows.length} teams to check\n`);
    
    const teamData: TeamData[] = [];
    
    // Check data for each team
    for (const team of teams.rows) {
      const stats = await pool.query(`
        SELECT 
          -- Total games in bbref_games (only up to today's date)
          (SELECT COUNT(*) 
           FROM bbref_games bg
           WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
             AND bg.game_date <= CURRENT_DATE) as total_games,
          
          -- Games with player stats
          (SELECT COUNT(DISTINCT bpgs.game_id)
           FROM bbref_player_game_stats bpgs
           JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
           WHERE bpgs.team_id = $1
             AND bg.game_date <= CURRENT_DATE) as games_with_player_stats,
          
          -- Games with team stats
          (SELECT COUNT(DISTINCT btgs.game_id)
           FROM bbref_team_game_stats btgs
           JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
           WHERE btgs.team_id = $1
             AND bg.game_date <= CURRENT_DATE) as games_with_team_stats,
          
          -- Games with scores
          (SELECT COUNT(*)
           FROM bbref_games bg
           WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
             AND bg.home_score IS NOT NULL
             AND bg.away_score IS NOT NULL
             AND bg.game_date <= CURRENT_DATE) as games_with_scores,
          
          -- Earliest game date
          (SELECT MIN(bg.game_date)
           FROM bbref_games bg
           WHERE bg.home_team_id = $1 OR bg.away_team_id = $1) as earliest_game_date,
          
          -- Latest game date
          (SELECT MAX(bg.game_date)
           FROM bbref_games bg
           WHERE bg.home_team_id = $1 OR bg.away_team_id = $1) as latest_game_date,
          
          -- Total player stats rows (only up to today's date)
          (SELECT COUNT(*)
           FROM bbref_player_game_stats bpgs
           JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
           WHERE bpgs.team_id = $1
             AND bg.game_date <= CURRENT_DATE) as player_stats_count,
          
          -- Total team stats rows (only up to today's date)
          (SELECT COUNT(*)
           FROM bbref_team_game_stats btgs
           JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
           WHERE btgs.team_id = $1
             AND bg.game_date <= CURRENT_DATE) as team_stats_count
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
        coverage_pct: coveragePct
      });
    }
    
    // Display summary table
    console.log('\n📊 BBRef Data Summary by Team\n');
    console.log('-'.repeat(100));
    console.log(
      'Team'.padEnd(6) +
      'Games'.padStart(8) +
      'Player Stats'.padStart(14) +
      'Team Stats'.padStart(12) +
      'Coverage'.padStart(10) +
      'Scores'.padStart(8) +
      'Date Range'.padStart(20)
    );
    console.log('-'.repeat(100));
    
    teamData.forEach(team => {
      const dateRange = team.earliest_game_date && team.latest_game_date
        ? `${team.earliest_game_date} to ${team.latest_game_date}`
        : 'No games';
      
      console.log(
        team.abbreviation.padEnd(6) +
        team.total_games.toString().padStart(8) +
        team.games_with_player_stats.toString().padStart(14) +
        team.games_with_team_stats.toString().padStart(12) +
        `${team.coverage_pct}%`.padStart(10) +
        team.games_with_scores.toString().padStart(8) +
        dateRange.padStart(20)
      );
    });
    
    // Summary statistics
    console.log('\n' + '='.repeat(100));
    console.log('\n📈 Overall Statistics\n');
    console.log('-'.repeat(100));
    
    const totalGames = teamData.reduce((sum, t) => sum + t.total_games, 0);
    const totalPlayerStats = teamData.reduce((sum, t) => sum + t.games_with_player_stats, 0);
    const totalTeamStats = teamData.reduce((sum, t) => sum + t.games_with_team_stats, 0);
    const totalScores = teamData.reduce((sum, t) => sum + t.games_with_scores, 0);
    const avgCoverage = teamData.length > 0
      ? Math.round(teamData.reduce((sum, t) => sum + t.coverage_pct, 0) / teamData.length)
      : 0;
    
    console.log(`Total Teams: ${teamData.length}`);
    console.log(`Total Games: ${totalGames}`);
    console.log(`Games with Player Stats: ${totalPlayerStats}`);
    console.log(`Games with Team Stats: ${totalTeamStats}`);
    console.log(`Games with Scores: ${totalScores}`);
    console.log(`Average Coverage: ${avgCoverage}%`);
    
    // Identify issues
    console.log('\n' + '='.repeat(100));
    console.log('\n⚠️  Data Issues\n');
    console.log('-'.repeat(100));
    
    const teamsWithNoGames = teamData.filter(t => t.total_games === 0);
    const teamsWithLowCoverage = teamData.filter(t => t.total_games > 0 && t.coverage_pct < 50);
    const teamsWithMissingStats = teamData.filter(t => 
      t.total_games > 0 && t.games_with_team_stats < t.total_games
    );
    const teamsWithNoScores = teamData.filter(t => 
      t.total_games > 0 && t.games_with_scores === 0
    );
    
    if (teamsWithNoGames.length > 0) {
      console.log(`\n❌ Teams with NO games (${teamsWithNoGames.length}):`);
      teamsWithNoGames.forEach(t => {
        console.log(`   - ${t.abbreviation} (${t.full_name})`);
      });
    }
    
    if (teamsWithLowCoverage.length > 0) {
      console.log(`\n⚠️  Teams with LOW coverage < 50% (${teamsWithLowCoverage.length}):`);
      teamsWithLowCoverage.forEach(t => {
        console.log(`   - ${t.abbreviation}: ${t.games_with_team_stats}/${t.total_games} games (${t.coverage_pct}%)`);
      });
    }
    
    if (teamsWithMissingStats.length > 0) {
      console.log(`\n⚠️  Teams with MISSING team stats (${teamsWithMissingStats.length}):`);
      teamsWithMissingStats.slice(0, 10).forEach(t => {
        const missing = t.total_games - t.games_with_team_stats;
        console.log(`   - ${t.abbreviation}: ${missing} games missing stats`);
      });
      if (teamsWithMissingStats.length > 10) {
        console.log(`   ... and ${teamsWithMissingStats.length - 10} more`);
      }
    }
    
    if (teamsWithNoScores.length > 0) {
      console.log(`\n⚠️  Teams with NO scores (${teamsWithNoScores.length}):`);
      teamsWithNoScores.forEach(t => {
        console.log(`   - ${t.abbreviation}: ${t.total_games} games, 0 with scores`);
      });
    }
    
    if (
      teamsWithNoGames.length === 0 &&
      teamsWithLowCoverage.length === 0 &&
      teamsWithMissingStats.length === 0 &&
      teamsWithNoScores.length === 0
    ) {
      console.log('✅ No issues found! All teams have good data coverage.');
    }
    
    // Detailed view option
    console.log('\n' + '='.repeat(100));
    console.log('\n💡 Detailed Team Breakdown\n');
    console.log('-'.repeat(100));
    
    // Show teams with best and worst coverage
    const sortedByCoverage = [...teamData].sort((a, b) => b.coverage_pct - a.coverage_pct);
    
    console.log('\n🏆 Top 5 Teams by Coverage:');
    sortedByCoverage.slice(0, 5).forEach((t, idx) => {
      console.log(`   ${idx + 1}. ${t.abbreviation}: ${t.coverage_pct}% (${t.games_with_team_stats}/${t.total_games} games)`);
    });
    
    console.log('\n📉 Bottom 5 Teams by Coverage:');
    sortedByCoverage.slice(-5).reverse().forEach((t, idx) => {
      console.log(`   ${idx + 1}. ${t.abbreviation}: ${t.coverage_pct}% (${t.games_with_team_stats}/${t.total_games} games)`);
    });
    
    // Games without stats
    console.log('\n' + '='.repeat(100));
    console.log('\n🔍 Games Missing Team Stats (Sample)\n');
    console.log('-'.repeat(100));
    
    const missingStatsSample = await pool.query(`
      SELECT 
        bg.bbref_game_id,
        bg.game_date,
        bg.home_team_abbr,
        bg.away_team_abbr,
        bg.status,
        bg.home_score,
        bg.away_score,
        CASE 
          WHEN bg.home_team_id = $1 THEN bg.home_team_abbr
          ELSE bg.away_team_abbr
        END as team_abbr
      FROM bbref_games bg
      WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
        AND NOT EXISTS (
          SELECT 1 FROM bbref_team_game_stats btgs
          WHERE btgs.game_id = bg.bbref_game_id
            AND btgs.team_id = $1
        )
      ORDER BY bg.game_date DESC
      LIMIT 5
    `, [teamData.find(t => t.total_games > 0 && t.games_with_team_stats < t.total_games)?.team_id || teamData[0]?.team_id]);
    
    if (missingStatsSample.rows.length > 0) {
      console.log(`\nSample games missing team stats for ${missingStatsSample.rows[0].team_abbr}:`);
      missingStatsSample.rows.forEach((game: any) => {
        console.log(`   - ${game.game_date.toISOString().split('T')[0]}: ${game.away_team_abbr} @ ${game.home_team_abbr} (${game.status})`);
      });
    }
    
    console.log('\n' + '='.repeat(100));
    console.log('\n✅ Check complete!\n');
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

async function main() {
  try {
    await checkAllTeams();
  } catch (error: any) {
    console.error('\nFatal error:', error.message);
    process.exit(1);
  }
}

main();

