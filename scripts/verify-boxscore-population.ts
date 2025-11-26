import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function verify() {
  // Check games that have scraped data but no player stats
  const missing = await pool.query(`
    SELECT DISTINCT 
      sb.game_id,
      COUNT(DISTINCT sb.player_id) as scraped_players,
      COUNT(DISTINCT bpgs.player_id) as populated_players
    FROM scraped_boxscores sb
    LEFT JOIN bbref_player_game_stats bpgs 
      ON sb.game_id = bpgs.game_id 
      AND sb.player_id = bpgs.player_id
      AND bpgs.source = 'bbref'
    WHERE sb.source = 'bbref_csv'
      AND sb.player_id IS NOT NULL
      AND sb.dnp_reason IS NULL
      AND EXISTS (
        SELECT 1 FROM bbref_games bg WHERE bg.bbref_game_id = sb.game_id
      )
    GROUP BY sb.game_id
    HAVING COUNT(DISTINCT bpgs.player_id) < COUNT(DISTINCT sb.player_id)
    ORDER BY sb.game_id
    LIMIT 10
  `);
  
  console.log(`\n🔍 Games with scraped data but missing player stats:`);
  console.log('game_id | scraped_players | populated_players | missing');
  console.log('─'.repeat(70));
  
  for (const row of missing.rows) {
    const missingCount = parseInt(row.scraped_players) - parseInt(row.populated_players);
    console.log(`${row.game_id.padEnd(35)} | ${String(row.scraped_players).padStart(15)} | ${String(row.populated_players).padStart(17)} | ${missingCount}`);
  }
  
  if (missing.rows.length === 0) {
    console.log('✅ All games with scraped data appear to be populated!');
  }
  
  // Check a specific game to see what's happening
  const sampleGame = await pool.query(`
    SELECT 
      bg.bbref_game_id,
      bg.game_date,
      ht.abbreviation as home_team,
      at.abbreviation as away_team,
      (SELECT COUNT(*) FROM scraped_boxscores WHERE game_id = bg.bbref_game_id AND source = 'bbref_csv' AND player_id IS NOT NULL AND dnp_reason IS NULL) as scraped_count,
      (SELECT COUNT(*) FROM bbref_player_game_stats WHERE game_id = bg.bbref_game_id AND source = 'bbref' AND dnp_reason IS NULL) as populated_count
    FROM bbref_games bg
    JOIN teams ht ON bg.home_team_id = ht.team_id
    JOIN teams at ON bg.away_team_id = at.team_id
    WHERE bg.status = 'Final'
    ORDER BY bg.game_date DESC
    LIMIT 5
  `);
  
  console.log(`\n📊 Sample games (most recent):`);
  console.log('game_id | date | matchup | scraped | populated');
  console.log('─'.repeat(80));
  for (const game of sampleGame.rows) {
    console.log(`${game.bbref_game_id.padEnd(35)} | ${game.game_date} | ${game.away_team} @ ${game.home_team.padEnd(3)} | ${String(game.scraped_count).padStart(7)} | ${String(game.populated_count).padStart(10)}`);
  }
  
  await pool.end();
}

verify();


