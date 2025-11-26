import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function checkGames() {
  const gameIds = ['bbref_202511110000_GSW_OKC', 'bbref_202511120000_ATL_SAC'];
  
  for (const gameId of gameIds) {
    const result = await pool.query(`
      SELECT 
        bg.bbref_game_id,
        bg.game_date,
        bg.status,
        bg.home_team_abbr,
        bg.away_team_abbr,
        (SELECT COUNT(*) FROM bbref_player_game_stats bpgs WHERE bpgs.game_id = bg.bbref_game_id) as player_stats,
        (SELECT COUNT(*) FROM bbref_team_game_stats btgs WHERE btgs.game_id = bg.bbref_game_id) as team_stats,
        EXISTS (
          SELECT 1 FROM bbref_player_game_stats bpgs 
          WHERE bpgs.game_id = bg.bbref_game_id
        ) as has_player_stats
      FROM bbref_games bg
      WHERE bg.bbref_game_id = $1
    `, [gameId]);
    
    if (result.rows.length > 0) {
      const game = result.rows[0];
      console.log(`${gameId}:`);
      console.log(`  Home: ${game.home_team_abbr}, Away: ${game.away_team_abbr}`);
      console.log(`  Player stats: ${game.player_stats}`);
      console.log(`  Team stats: ${game.team_stats}`);
      console.log(`  Has player stats (EXISTS): ${game.has_player_stats}`);
      console.log(`  Status: ${game.status}`);
      console.log('');
    } else {
      console.log(`${gameId}: Game not found in bbref_games`);
    }
  }
  
  await pool.end();
}

checkGames();

