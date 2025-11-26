import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function fixGame() {
  console.log('\n🔧 Fixing Utah Nov 5 game status...\n');
  
  // Check current status
  const before = await pool.query(`
    SELECT bbref_game_id, game_date, status, home_team_abbr, away_team_abbr
    FROM bbref_games
    WHERE bbref_game_id = 'bbref_202511050000_UTA_DET'
  `);
  
  if (before.rows.length === 0) {
    console.log('❌ Game not found');
    await pool.end();
    return;
  }
  
  console.log('Before:', before.rows[0]);
  
  // Fix status if it's SScheduled
  await pool.query(`
    UPDATE bbref_games
    SET status = 'Final'
    WHERE bbref_game_id = 'bbref_202511050000_UTA_DET'
      AND status = 'SScheduled'
  `);
  
  // Check after
  const after = await pool.query(`
    SELECT bbref_game_id, game_date, status, home_team_abbr, away_team_abbr
    FROM bbref_games
    WHERE bbref_game_id = 'bbref_202511050000_UTA_DET'
  `);
  
  console.log('After:', after.rows[0]);
  
  // Check game details
  const details = await pool.query(`
    SELECT 
      bg.bbref_game_id,
      bg.game_date,
      bg.status,
      bg.home_score,
      bg.away_score,
      (SELECT COUNT(*) FROM bbref_team_game_stats WHERE game_id = bg.bbref_game_id) as stats_count
    FROM bbref_games bg
    WHERE bg.bbref_game_id = 'bbref_202511050000_UTA_DET'
  `);
  
  const game = details.rows[0];
  console.log('\nGame details:');
  console.log(`  Date: ${game.game_date}`);
  console.log(`  Status: ${game.status}`);
  console.log(`  Score: ${game.home_score || 'N/A'} - ${game.away_score || 'N/A'}`);
  console.log(`  Team stats entries: ${game.stats_count}`);
  
  // If game has stats and is in the past, it should be Final
  const gameDate = new Date(game.game_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (gameDate < today && parseInt(game.stats_count) > 0 && game.status !== 'Final') {
    console.log('\n⚠️  Game is in the past and has stats but status is not Final');
    console.log('   Updating status to Final...');
    
    await pool.query(`
      UPDATE bbref_games
      SET status = 'Final'
      WHERE bbref_game_id = 'bbref_202511050000_UTA_DET'
    `);
    
    console.log('✅ Updated status to Final');
  }
  
  await pool.end();
}

fixGame();

