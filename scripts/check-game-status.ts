import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

const games = [
  'bbref_202511200000_PHI_MIL',
  'bbref_202511120000_ATL_SAC',
  'bbref_202511110000_GSW_OKC',
  'bbref_202511070000_OKC_SAC'
];

async function checkGames() {
  // Check if games exist in bbref_games
  const exists = await pool.query(
    'SELECT bbref_game_id, game_date, status FROM bbref_games WHERE bbref_game_id = ANY($1::text[])',
    [games]
  );
  console.log(`Games found in bbref_games: ${exists.rows.length}\n`);
  
  for (const gameId of games) {
    const game = exists.rows.find((r: any) => r.bbref_game_id === gameId);
    const scraped = await pool.query(
      'SELECT COUNT(*) as count FROM scraped_boxscores WHERE game_id = $1 AND source = $2',
      [gameId, 'bbref_csv']
    );
    const stats = await pool.query(
      'SELECT COUNT(*) as count FROM bbref_player_game_stats WHERE game_id = $1',
      [gameId]
    );
    console.log(`${gameId}:`);
    if (game) {
      console.log(`  In bbref_games: ✅ (${game.game_date}, ${game.status})`);
    } else {
      console.log(`  In bbref_games: ❌`);
    }
    console.log(`  Scraped: ${scraped.rows[0].count}`);
    console.log(`  Stats: ${stats.rows[0].count}\n`);
  }
  await pool.end();
}

checkGames();

