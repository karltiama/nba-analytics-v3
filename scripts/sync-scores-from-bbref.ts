import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

/**
 * Sync scores from bbref_team_game_stats to games table
 * Updates games that have BBRef stats but missing scores
 */
async function main() {
  try {
    console.log('\n🔄 Syncing Scores from BBRef Stats to Games Table\n');
    console.log('='.repeat(100));
    
    // Find games with BBRef stats but missing scores
    const gamesToUpdate = await pool.query(`
      SELECT DISTINCT
        g.game_id,
        g.status,
        g.home_score,
        g.away_score,
        g.start_time,
        ht.team_id as home_team_id,
        at.team_id as away_team_id,
        ht.abbreviation as home_team,
        at.abbreviation as away_team,
        home_stats.points as home_points,
        away_stats.points as away_points
      FROM games g
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      JOIN bbref_team_game_stats home_stats ON g.game_id = home_stats.game_id 
        AND g.home_team_id = home_stats.team_id
        AND home_stats.source = 'bbref'
      JOIN bbref_team_game_stats away_stats ON g.game_id = away_stats.game_id 
        AND g.away_team_id = away_stats.team_id
        AND away_stats.source = 'bbref'
      WHERE (g.home_score IS NULL OR g.away_score IS NULL)
        AND home_stats.points IS NOT NULL
        AND away_stats.points IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM bbref_schedule bs 
          WHERE bs.canonical_game_id = g.game_id
        )
      ORDER BY g.start_time DESC
    `);
    
    console.log(`Found ${gamesToUpdate.rows.length} games to update\n`);
    
    if (gamesToUpdate.rows.length === 0) {
      console.log('✅ No games need updating');
      return;
    }
    
    // Show sample
    console.log('Sample games to update:');
    gamesToUpdate.rows.slice(0, 10).forEach((game: any, i: number) => {
      console.log(`\n${i + 1}. ${game.away_team} @ ${game.home_team}`);
      console.log(`   Game ID: ${game.game_id}`);
      console.log(`   Current Status: ${game.status}`);
      console.log(`   Current Scores: ${game.home_score || 'NULL'} - ${game.away_score || 'NULL'}`);
      console.log(`   BBRef Scores: ${game.home_points} - ${game.away_points}`);
    });
    
    // Update games
    console.log('\n\n🔄 Updating games...');
    console.log('-'.repeat(100));
    
    let updated = 0;
    let statusUpdated = 0;
    
    for (const game of gamesToUpdate.rows) {
      const needsStatusUpdate = game.status !== 'Final';
      
      await pool.query(`
        UPDATE games
        SET 
          home_score = $1,
          away_score = $2,
          status = CASE WHEN $3 THEN 'Final' ELSE status END,
          updated_at = now()
        WHERE game_id = $4
      `, [game.home_points, game.away_points, needsStatusUpdate, game.game_id]);
      
      updated++;
      if (needsStatusUpdate) statusUpdated++;
    }
    
    console.log(`✅ Updated ${updated} games`);
    console.log(`✅ Updated status to 'Final' for ${statusUpdated} games`);
    
    // Verify Nov 1 game
    console.log('\n\n🎯 Verifying Nov 1 DAL @ DET:');
    console.log('-'.repeat(100));
    const nov1Check = await pool.query(`
      SELECT 
        g.game_id,
        g.status,
        g.home_score,
        g.away_score,
        ht.abbreviation as home_team,
        at.abbreviation as away_team
      FROM games g
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      WHERE g.game_id = '1842025110112'
    `);
    
    if (nov1Check.rows.length > 0) {
      const game = nov1Check.rows[0];
      console.log(`Status: ${game.status}`);
      console.log(`Scores: ${game.home_score} - ${game.away_score}`);
      console.log(`Matchup: ${game.away_team} @ ${game.home_team}`);
      
      if (game.home_score !== null && game.away_score !== null) {
        console.log('\n✅ Scores are now set! Result should display correctly.');
      }
    }
    
    console.log('\n' + '='.repeat(100));
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();

