import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

/**
 * Remove any entries from bbref tables that are not from BBRef sources
 * This ensures data integrity and removes confusion
 */
async function main() {
  try {
    console.log('\n🧹 Cleaning Up Non-BBRef Entries\n');
    console.log('='.repeat(100));
    
    // Check for entries with wrong source
    const wrongSourceTeam = await pool.query(`
      SELECT COUNT(*) as count
      FROM bbref_team_game_stats
      WHERE source != 'bbref' OR source IS NULL
    `);
    
    const wrongSourcePlayer = await pool.query(`
      SELECT COUNT(*) as count
      FROM bbref_player_game_stats
      WHERE source != 'bbref' OR source IS NULL
    `);
    
    console.log('\n1️⃣ CHECKING SOURCE FIELD');
    console.log('-'.repeat(100));
    console.log(`Team stats with wrong source: ${wrongSourceTeam.rows[0].count}`);
    console.log(`Player stats with wrong source: ${wrongSourcePlayer.rows[0].count}`);
    
    // Check for games not in bbref_schedule
    const notInScheduleTeam = await pool.query(`
      SELECT COUNT(DISTINCT btgs.game_id) as count
      FROM bbref_team_game_stats btgs
      LEFT JOIN bbref_schedule bs ON btgs.game_id = bs.canonical_game_id
      WHERE bs.canonical_game_id IS NULL
    `);
    
    const notInSchedulePlayer = await pool.query(`
      SELECT COUNT(DISTINCT bpgs.game_id) as count
      FROM bbref_player_game_stats bpgs
      LEFT JOIN bbref_schedule bs ON bpgs.game_id = bs.canonical_game_id
      WHERE bs.canonical_game_id IS NULL
    `);
    
    console.log('\n2️⃣ CHECKING BBREF_SCHEDULE MATCHING');
    console.log('-'.repeat(100));
    console.log(`Team stats games NOT in schedule: ${notInScheduleTeam.rows[0].count}`);
    console.log(`Player stats games NOT in schedule: ${notInSchedulePlayer.rows[0].count}`);
    
    // Show sample of games not in schedule
    if (parseInt(notInScheduleTeam.rows[0].count) > 0) {
      const sampleNotInSchedule = await pool.query(`
        SELECT DISTINCT
          btgs.game_id,
          g.start_time::date as game_date,
          ht.abbreviation as home_team,
          at.abbreviation as away_team,
          btgs.source
        FROM bbref_team_game_stats btgs
        JOIN games g ON btgs.game_id = g.game_id
        JOIN teams ht ON g.home_team_id = ht.team_id
        JOIN teams at ON g.away_team_id = at.team_id
        LEFT JOIN bbref_schedule bs ON btgs.game_id = bs.canonical_game_id
        WHERE bs.canonical_game_id IS NULL
        ORDER BY g.start_time DESC
        LIMIT 10
      `);
      
      console.log('\n📋 Sample games NOT in bbref_schedule:');
      sampleNotInSchedule.rows.forEach((g: any, i: number) => {
        console.log(`  ${i + 1}. ${g.game_date.toISOString().split('T')[0]} - ${g.away_team} @ ${g.home_team}`);
        console.log(`     Game ID: ${g.game_id}`);
        console.log(`     Source: ${g.source}`);
      });
    }
    
    // Check for games not in scraped_boxscores (the source of BBRef data)
    const notInScrapedTeam = await pool.query(`
      SELECT COUNT(DISTINCT btgs.game_id) as count
      FROM bbref_team_game_stats btgs
      LEFT JOIN scraped_boxscores sb ON btgs.game_id = sb.game_id
      WHERE sb.game_id IS NULL
    `);
    
    const notInScrapedPlayer = await pool.query(`
      SELECT COUNT(DISTINCT bpgs.game_id) as count
      FROM bbref_player_game_stats bpgs
      LEFT JOIN scraped_boxscores sb ON bpgs.game_id = sb.game_id
      WHERE sb.game_id IS NULL
    `);
    
    console.log('\n3️⃣ CHECKING SCRAPED_BOXSCORES MATCHING');
    console.log('-'.repeat(100));
    console.log(`Team stats games NOT in scraped_boxscores: ${notInScrapedTeam.rows[0].count}`);
    console.log(`Player stats games NOT in scraped_boxscores: ${notInScrapedPlayer.rows[0].count}`);
    
    // Summary
    console.log('\n' + '='.repeat(100));
    console.log('📊 CLEANUP SUMMARY');
    console.log('='.repeat(100));
    
    const totalToRemoveTeam = parseInt(wrongSourceTeam.rows[0].count) + parseInt(notInScheduleTeam.rows[0].count);
    const totalToRemovePlayer = parseInt(wrongSourcePlayer.rows[0].count) + parseInt(notInSchedulePlayer.rows[0].count);
    
    console.log(`\nTeam stats to remove: ${totalToRemoveTeam}`);
    console.log(`Player stats to remove: ${totalToRemovePlayer}`);
    
    if (totalToRemoveTeam === 0 && totalToRemovePlayer === 0) {
      console.log('\n✅ No cleanup needed! All entries are BBRef-affiliated.');
      return;
    }
    
    // Ask for confirmation before deleting
    console.log('\n⚠️  READY TO CLEAN UP');
    console.log('-'.repeat(100));
    console.log('This will DELETE:');
    if (wrongSourceTeam.rows[0].count > 0) {
      console.log(`  - ${wrongSourceTeam.rows[0].count} team stats entries with wrong source`);
    }
    if (notInScheduleTeam.rows[0].count > 0) {
      console.log(`  - ${notInScheduleTeam.rows[0].count} team stats games not in bbref_schedule`);
    }
    if (wrongSourcePlayer.rows[0].count > 0) {
      console.log(`  - ${wrongSourcePlayer.rows[0].count} player stats entries with wrong source`);
    }
    if (notInSchedulePlayer.rows[0].count > 0) {
      console.log(`  - ${notInSchedulePlayer.rows[0].count} player stats games not in bbref_schedule`);
    }
    
    // Perform cleanup
    console.log('\n🗑️  PERFORMING CLEANUP...');
    
    // Delete team stats with wrong source
    if (parseInt(wrongSourceTeam.rows[0].count) > 0) {
      const deletedTeamSource = await pool.query(`
        DELETE FROM bbref_team_game_stats
        WHERE source != 'bbref' OR source IS NULL
      `);
      console.log(`✅ Deleted ${deletedTeamSource.rowCount} team stats with wrong source`);
    }
    
    // Delete team stats not in schedule
    if (parseInt(notInScheduleTeam.rows[0].count) > 0) {
      const deletedTeamSchedule = await pool.query(`
        DELETE FROM bbref_team_game_stats
        WHERE game_id NOT IN (
          SELECT canonical_game_id FROM bbref_schedule WHERE canonical_game_id IS NOT NULL
        )
      `);
      console.log(`✅ Deleted ${deletedTeamSchedule.rowCount} team stats not in bbref_schedule`);
    }
    
    // Delete player stats with wrong source
    if (parseInt(wrongSourcePlayer.rows[0].count) > 0) {
      const deletedPlayerSource = await pool.query(`
        DELETE FROM bbref_player_game_stats
        WHERE source != 'bbref' OR source IS NULL
      `);
      console.log(`✅ Deleted ${deletedPlayerSource.rowCount} player stats with wrong source`);
    }
    
    // Delete player stats not in schedule
    if (parseInt(notInSchedulePlayer.rows[0].count) > 0) {
      const deletedPlayerSchedule = await pool.query(`
        DELETE FROM bbref_player_game_stats
        WHERE game_id NOT IN (
          SELECT canonical_game_id FROM bbref_schedule WHERE canonical_game_id IS NOT NULL
        )
      `);
      console.log(`✅ Deleted ${deletedPlayerSchedule.rowCount} player stats not in bbref_schedule`);
    }
    
    // Final verification
    const finalTeamCount = await pool.query(`
      SELECT COUNT(*) as count
      FROM bbref_team_game_stats
    `);
    
    const finalPlayerCount = await pool.query(`
      SELECT COUNT(*) as count
      FROM bbref_player_game_stats
    `);
    
    console.log('\n' + '='.repeat(100));
    console.log('✅ CLEANUP COMPLETE');
    console.log('='.repeat(100));
    console.log(`Final team stats count: ${finalTeamCount.rows[0].count}`);
    console.log(`Final player stats count: ${finalPlayerCount.rows[0].count}`);
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();

