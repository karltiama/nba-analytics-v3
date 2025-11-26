import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function verifyResults() {
  console.log('\n🔍 Verifying Populate Results\n');
  
  // Check recent inserts/updates
  const recentStats = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END) as recent_created,
      COUNT(CASE WHEN updated_at > NOW() - INTERVAL '1 hour' THEN 1 END) as recent_updated
    FROM bbref_player_game_stats
  `);
  
  console.log('Player Stats:');
  console.log(`   Total rows: ${recentStats.rows[0].total}`);
  console.log(`   Created in last hour: ${recentStats.rows[0].recent_created}`);
  console.log(`   Updated in last hour: ${recentStats.rows[0].recent_updated}`);
  
  // Check scraped_boxscores vs populated stats
  const comparison = await pool.query(`
    SELECT 
      (SELECT COUNT(DISTINCT game_id) FROM scraped_boxscores WHERE source = 'bbref_csv' AND player_id IS NOT NULL) as scraped_games,
      (SELECT COUNT(DISTINCT game_id) FROM bbref_player_game_stats) as populated_games,
      (SELECT COUNT(*) FROM scraped_boxscores WHERE source = 'bbref_csv' AND player_id IS NOT NULL AND dnp_reason IS NULL) as scraped_rows,
      (SELECT COUNT(*) FROM bbref_player_game_stats) as populated_rows
  `);
  
  console.log('\nComparison:');
  console.log(`   Scraped games: ${comparison.rows[0].scraped_games}`);
  console.log(`   Populated games: ${comparison.rows[0].populated_games}`);
  console.log(`   Scraped rows: ${comparison.rows[0].scraped_rows}`);
  console.log(`   Populated rows: ${comparison.rows[0].populated_rows}`);
  
  // Check for games with scraped data but no stats
  const missing = await pool.query(`
    SELECT COUNT(DISTINCT sb.game_id) as count
    FROM scraped_boxscores sb
    WHERE sb.source = 'bbref_csv'
      AND sb.player_id IS NOT NULL
      AND sb.dnp_reason IS NULL
      AND EXISTS (SELECT 1 FROM bbref_games bg WHERE bg.bbref_game_id = sb.game_id)
      AND NOT EXISTS (
        SELECT 1 FROM bbref_player_game_stats bpgs
        WHERE bpgs.game_id = sb.game_id
          AND bpgs.player_id = sb.player_id
      )
  `);
  
  console.log(`\n⚠️  Games with scraped data but missing stats: ${missing.rows[0].count}`);
  
  if (parseInt(missing.rows[0].count) > 0) {
    const sample = await pool.query(`
      SELECT DISTINCT sb.game_id, COUNT(*) as player_count
      FROM scraped_boxscores sb
      WHERE sb.source = 'bbref_csv'
        AND sb.player_id IS NOT NULL
        AND sb.dnp_reason IS NULL
        AND EXISTS (SELECT 1 FROM bbref_games bg WHERE bg.bbref_game_id = sb.game_id)
        AND NOT EXISTS (
          SELECT 1 FROM bbref_player_game_stats bpgs
          WHERE bpgs.game_id = sb.game_id
            AND bpgs.player_id = sb.player_id
        )
      GROUP BY sb.game_id
      LIMIT 5
    `);
    
    console.log('\n   Sample missing games:');
    sample.rows.forEach((r: any) => {
      console.log(`     - ${r.game_id}: ${r.player_count} players`);
    });
  }
  
  await pool.end();
}

verifyResults();


