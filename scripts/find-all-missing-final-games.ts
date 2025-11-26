import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function findAllMissingFinalGames() {
  const result = await pool.query(`
    SELECT 
      bg.bbref_game_id, 
      bg.game_date, 
      bg.status, 
      ht.abbreviation as home, 
      at.abbreviation as away
    FROM bbref_games bg
    JOIN teams ht ON bg.home_team_id = ht.team_id
    JOIN teams at ON bg.away_team_id = at.team_id
    WHERE bg.game_date <= CURRENT_DATE
      AND bg.status = 'Final'
      AND NOT EXISTS (
        SELECT 1 FROM bbref_team_game_stats 
        WHERE game_id = bg.bbref_game_id
      )
    ORDER BY bg.game_date DESC
  `);
  
  console.log(`\n📊 Final games missing team stats: ${result.rows.length}\n`);
  
  if (result.rows.length > 0) {
    result.rows.forEach((r: any) => {
      const date = r.game_date.toISOString().split('T')[0];
      console.log(`  ${date}: ${r.away} @ ${r.home} (${r.bbref_game_id})`);
    });
    
    const gameIds = result.rows.map((r: any) => r.bbref_game_id);
    console.log(`\n💡 To scrape these games, run:`);
    console.log(`   npx tsx scripts/batch-scrape-missing-bbref-games.ts --game-ids ${gameIds.join(',')}\n`);
  }
  
  await pool.end();
}

findAllMissingFinalGames();

