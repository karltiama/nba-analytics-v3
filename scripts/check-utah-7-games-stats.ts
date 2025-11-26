import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function checkGames() {
  const gameIds = [
    'bbref_202510220000_LAC_UTA',
    'bbref_202510240000_UTA_SAC',
    'bbref_202510270000_PHO_UTA',
    'bbref_202510310000_UTA_PHO',
    'bbref_202511210000_OKC_UTA',
    'bbref_202511230000_LAL_UTA',
    'bbref_202511240000_UTA_GSW'
  ];
  
  console.log('\n🔍 Checking Stats for 7 Utah Games\n');
  
  for (const gameId of gameIds) {
    const result = await pool.query(`
      SELECT 
        bg.bbref_game_id,
        bg.game_date,
        bg.status,
        (SELECT COUNT(*) FROM bbref_player_game_stats WHERE game_id = bg.bbref_game_id) as player_stats,
        (SELECT COUNT(*) FROM bbref_team_game_stats WHERE game_id = bg.bbref_game_id) as team_stats
      FROM bbref_games bg
      WHERE bg.bbref_game_id = $1
    `, [gameId]);
    
    if (result.rows.length > 0) {
      const game = result.rows[0];
      console.log(`${game.bbref_game_id}:`);
      console.log(`  Player stats: ${game.player_stats}`);
      console.log(`  Team stats: ${game.team_stats}`);
      console.log(`  Status: ${game.status}`);
      console.log('');
    } else {
      console.log(`${gameId}: Game not found\n`);
    }
  }
  
  await pool.end();
}

checkGames();


