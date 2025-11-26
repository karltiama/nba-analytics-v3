import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function deleteDetroitNov3Data() {
  console.log('\n🗑️  Deleting Detroit Nov 3 Game Data\n');
  
  const gameId = 'bbref_202511030000_DET_MEM';
  
  // Delete in order: team stats, player stats, scraped boxscores
  console.log('1. Deleting bbref_team_game_stats...');
  const teamStatsResult = await pool.query(`
    DELETE FROM bbref_team_game_stats
    WHERE game_id = $1
  `, [gameId]);
  console.log(`   ✅ Deleted ${teamStatsResult.rowCount} team stat rows`);
  
  console.log('2. Deleting bbref_player_game_stats...');
  const playerStatsResult = await pool.query(`
    DELETE FROM bbref_player_game_stats
    WHERE game_id = $1
  `, [gameId]);
  console.log(`   ✅ Deleted ${playerStatsResult.rowCount} player stat rows`);
  
  console.log('3. Deleting scraped_boxscores...');
  const scrapedResult = await pool.query(`
    DELETE FROM scraped_boxscores
    WHERE game_id = $1 AND source = 'bbref_csv'
  `, [gameId]);
  console.log(`   ✅ Deleted ${scrapedResult.rowCount} scraped boxscore rows`);
  
  console.log('\n✅ All data deleted for game:', gameId);
  console.log('\n💡 Next step: Re-scrape the game');
  console.log(`   Run: npx tsx scripts/batch-scrape-missing-bbref-games.ts --game-ids ${gameId}`);
  
  await pool.end();
}

deleteDetroitNov3Data();

