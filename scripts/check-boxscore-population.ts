import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function checkBoxscorePopulation() {
  try {
    console.log('🔍 Checking Box Score Population...\n');

    // Check what game_ids are in scraped_boxscores
    const scrapedGames = await pool.query(`
      SELECT DISTINCT 
        sb.game_id,
        COUNT(*) as player_count
      FROM scraped_boxscores sb
      WHERE sb.source = 'bbref_csv'
      GROUP BY sb.game_id
      ORDER BY sb.game_id
      LIMIT 20
    `);

    console.log('📊 Sample games in scraped_boxscores:');
    console.log('game_id | player_count');
    console.log('─'.repeat(50));
    for (const row of scrapedGames.rows) {
      console.log(`${row.game_id?.padEnd(40)} | ${row.player_count}`);
    }

    // Check if these games exist in bbref_games
    console.log('\n\n🔍 Checking if scraped games exist in bbref_games:\n');
    
    const gameIds = scrapedGames.rows.map(r => r.game_id).filter(Boolean);
    if (gameIds.length > 0) {
      const existingGames = await pool.query(`
        SELECT bbref_game_id, game_date, home_team_id, away_team_id
        FROM bbref_games
        WHERE bbref_game_id = ANY($1)
      `, [gameIds]);

      console.log(`Found ${existingGames.rows.length} of ${gameIds.length} games in bbref_games`);
      
      const missing = gameIds.filter(id => !existingGames.rows.find(g => g.bbref_game_id === id));
      if (missing.length > 0) {
        console.log(`\n⚠️  Missing games (in scraped_boxscores but not in bbref_games):`);
        missing.forEach(id => console.log(`  - ${id}`));
      }
    }

    // Check what's in bbref_player_game_stats
    const playerStatsGames = await pool.query(`
      SELECT DISTINCT game_id, COUNT(*) as player_count
      FROM bbref_player_game_stats
      GROUP BY game_id
      ORDER BY game_id
      LIMIT 20
    `);

    console.log('\n\n📊 Sample games in bbref_player_game_stats:');
    console.log('game_id | player_count');
    console.log('─'.repeat(40));
    for (const row of playerStatsGames.rows) {
      console.log(`${row.game_id?.padEnd(30)} | ${row.player_count}`);
    }

    // Check for games in scraped_boxscores that aren't in bbref_player_game_stats
    const notPopulated = await pool.query(`
      SELECT DISTINCT sb.game_id, COUNT(*) as player_count
      FROM scraped_boxscores sb
      WHERE sb.source = 'bbref_csv'
        AND sb.player_id IS NOT NULL
        AND sb.dnp_reason IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM bbref_player_game_stats bpgs
          WHERE bpgs.game_id = sb.game_id
            AND bpgs.player_id = sb.player_id
        )
      GROUP BY sb.game_id
      ORDER BY sb.game_id
      LIMIT 10
    `);

    if (notPopulated.rows.length > 0) {
      console.log('\n\n⚠️  Games in scraped_boxscores but NOT populated to bbref_player_game_stats:');
      console.log('game_id | player_count');
      console.log('─'.repeat(40));
      for (const row of notPopulated.rows) {
        // Check if game exists in bbref_games
        const gameCheck = await pool.query(`
          SELECT bbref_game_id FROM bbref_games WHERE bbref_game_id = $1
        `, [row.game_id]);
        
        const exists = gameCheck.rows.length > 0 ? '✅' : '❌';
        console.log(`${row.game_id?.padEnd(30)} | ${row.player_count} ${exists}`);
      }
    } else {
      console.log('\n✅ All scraped games appear to be populated!');
    }

    // Summary
    const summary = await pool.query(`
      SELECT 
        (SELECT COUNT(DISTINCT game_id) FROM scraped_boxscores WHERE source = 'bbref_csv') as scraped_games,
        (SELECT COUNT(DISTINCT game_id) FROM bbref_player_game_stats) as populated_games,
        (SELECT COUNT(DISTINCT bbref_game_id) FROM bbref_games WHERE status = 'Final') as final_games
    `);

    console.log('\n\n📈 SUMMARY:');
    console.log(`Scraped games: ${summary.rows[0].scraped_games}`);
    console.log(`Populated games: ${summary.rows[0].populated_games}`);
    console.log(`Final games in bbref_games: ${summary.rows[0].final_games}`);

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

checkBoxscorePopulation();

