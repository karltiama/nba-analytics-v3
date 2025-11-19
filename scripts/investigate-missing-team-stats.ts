import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Investigate why Final games are missing team_game_stats
 * 
 * Checks:
 * 1. Do these games have player_game_stats?
 * 2. Do these games have valid team_ids?
 * 3. Are there any errors in the team mapping?
 * 4. When were these games processed?
 */

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function investigateMissingTeamStats() {
  console.log('\nInvestigating games missing team_game_stats...\n');
  
  // Get the games missing team_game_stats
  const missingStatsQuery = `
    SELECT 
      g.game_id,
      g.start_time,
      g.status,
      g.home_team_id,
      g.away_team_id,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr,
      EXISTS(SELECT 1 FROM player_game_stats pgs WHERE pgs.game_id = g.game_id) as has_player_stats,
      (SELECT COUNT(*) FROM player_game_stats pgs WHERE pgs.game_id = g.game_id) as player_stats_count,
      (SELECT COUNT(DISTINCT pgs.team_id) FROM player_game_stats pgs WHERE pgs.game_id = g.game_id) as unique_teams_in_stats
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE g.status = 'Final'
      AND NOT EXISTS (
        SELECT 1 FROM team_game_stats tgs 
        WHERE tgs.game_id = g.game_id 
        AND (tgs.team_id = g.home_team_id OR tgs.team_id = g.away_team_id)
      )
    ORDER BY g.start_time DESC
    LIMIT 20
  `;
  
  const result = await pool.query(missingStatsQuery);
  
  if (result.rows.length === 0) {
    console.log('No games missing team_game_stats found.');
    return;
  }
  
  console.log(`Found ${result.rows.length} games missing team_game_stats:\n`);
  
  for (const game of result.rows) {
    console.log(`Game ID: ${game.game_id}`);
    console.log(`  Date: ${new Date(game.start_time).toISOString().split('T')[0]}`);
    console.log(`  Matchup: ${game.away_abbr} @ ${game.home_abbr}`);
    console.log(`  Status: ${game.status}`);
    console.log(`  Has player_game_stats: ${game.has_player_stats}`);
    console.log(`  Player stats count: ${game.player_stats_count}`);
    console.log(`  Unique teams in player stats: ${game.unique_teams_in_stats}`);
    console.log(`  Home team ID: ${game.home_team_id}`);
    console.log(`  Away team ID: ${game.away_team_id}`);
    
    // Check if team_ids in player_game_stats match game team_ids
    if (game.has_player_stats) {
      const teamCheckQuery = `
        SELECT DISTINCT pgs.team_id, t.abbreviation
        FROM player_game_stats pgs
        LEFT JOIN teams t ON pgs.team_id = t.team_id
        WHERE pgs.game_id = $1
        ORDER BY pgs.team_id
      `;
      
      const teamResult = await pool.query(teamCheckQuery, [game.game_id]);
      console.log(`  Teams found in player_game_stats:`);
      teamResult.rows.forEach(row => {
        const isHome = row.team_id === game.home_team_id;
        const isAway = row.team_id === game.away_team_id;
        const match = isHome ? 'HOME' : isAway ? 'AWAY' : 'MISMATCH';
        console.log(`    - ${row.team_id} (${row.abbreviation || 'NOT FOUND'}) [${match}]`);
      });
      
      // Check for any NULL team_ids
      const nullTeamQuery = `
        SELECT COUNT(*) as null_count
        FROM player_game_stats pgs
        WHERE pgs.game_id = $1 AND pgs.team_id IS NULL
      `;
      const nullResult = await pool.query(nullTeamQuery, [game.game_id]);
      if (nullResult.rows[0].null_count > 0) {
        console.log(`  ⚠️  WARNING: ${nullResult.rows[0].null_count} player_game_stats records have NULL team_id`);
      }
    }
    
    console.log('');
  }
  
  // Summary analysis
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY ANALYSIS');
  console.log('='.repeat(60));
  
  const hasPlayerStats = result.rows.filter(r => r.has_player_stats).length;
  const missingPlayerStats = result.rows.length - hasPlayerStats;
  
  console.log(`\nGames with player_game_stats: ${hasPlayerStats}`);
  console.log(`Games without player_game_stats: ${missingPlayerStats}`);
  
  if (hasPlayerStats > 0) {
    console.log('\n⚠️  These games have player_game_stats but no team_game_stats.');
    console.log('   This suggests the team_game_stats creation failed or was skipped.');
    console.log('   Possible causes:');
    console.log('   1. Team ID mismatch between player_game_stats and games table');
    console.log('   2. Error during team_game_stats upsert that was silently caught');
    console.log('   3. Script that processes these games doesn\'t call upsert_team_game_stats');
  }
  
  if (missingPlayerStats > 0) {
    console.log('\n⚠️  These games are missing player_game_stats entirely.');
    console.log('   team_game_stats cannot be created without player_game_stats.');
    console.log('   These games need box scores to be fetched first.');
  }
}

async function main() {
  try {
    await investigateMissingTeamStats();
  } catch (error: any) {
    console.error('\n[ERROR]', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

