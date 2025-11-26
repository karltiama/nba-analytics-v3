import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function checkRawData() {
  console.log('\n🔍 Checking Raw Data for Detroit Nov 3 Game\n');
  
  const gameId = 'bbref_202511030000_DET_MEM';
  
  // Check raw_data from scraped_boxscores
  const scraped = await pool.query(`
    SELECT 
      sb.player_name,
      sb.team_code,
      sb.raw_data
    FROM scraped_boxscores sb
    WHERE sb.game_id = $1
      AND sb.source = 'bbref_csv'
      AND sb.team_code = 'DET'
    ORDER BY sb.player_name
    LIMIT 5
  `, [gameId]);
  
  console.log(`📥 Sample Raw Data (Detroit, first 5 players):\n`);
  scraped.rows.forEach((row: any, i: number) => {
    console.log(`\n${i + 1}. ${row.player_name}:`);
    if (row.raw_data) {
      try {
        const parsed = typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : row.raw_data;
        console.log(`   Raw data keys: ${Object.keys(parsed).join(', ')}`);
        console.log(`   PTS: ${parsed.PTS || parsed.points || 'NULL'}`);
        console.log(`   FG: ${parsed.FG || parsed.field_goals_made || 'NULL'}/${parsed.FGA || parsed.field_goals_attempted || 'NULL'}`);
        console.log(`   MP: ${parsed.MP || parsed.minutes || 'NULL'}`);
        if (parsed.Starters) {
          console.log(`   Starters field: ${parsed.Starters}`);
        }
      } catch (e) {
        console.log(`   Raw data (string): ${String(row.raw_data).substring(0, 200)}...`);
      }
    } else {
      console.log(`   No raw_data`);
    }
  });
  
  // Check if there are multiple scraped entries for this game
  const allScraped = await pool.query(`
    SELECT 
      COUNT(*) as count,
      COUNT(DISTINCT scraped_at) as unique_scrapes,
      MIN(scraped_at) as first_scrape,
      MAX(scraped_at) as last_scrape
    FROM scraped_boxscores
    WHERE game_id = $1
      AND source = 'bbref_csv'
  `, [gameId]);
  
  console.log(`\n\n📊 Scraping History:`);
  console.log(`   Total rows: ${allScraped.rows[0].count}`);
  console.log(`   Unique scrape times: ${allScraped.rows[0].unique_scrapes}`);
  console.log(`   First scrape: ${allScraped.rows[0].first_scrape}`);
  console.log(`   Last scrape: ${allScraped.rows[0].last_scrape}`);
  
  // Check what Basketball Reference actually shows
  console.log(`\n\n🌐 Basketball Reference URL:`);
  console.log(`   https://www.basketball-reference.com/boxscores/202511030MEM.html`);
  console.log(`   Expected score: DET 124, MEM 130`);
  
  // Check if we need to re-scrape
  console.log(`\n\n💡 Recommendation:`);
  console.log(`   The scraped data appears to be NULL, but player stats show 100-103 points.`);
  console.log(`   This suggests either:`);
  console.log(`   1. Wrong game's stats were populated into this game_id`);
  console.log(`   2. The CSV parsing failed and stats came from elsewhere`);
  console.log(`   3. Need to re-scrape and re-populate this game`);
  
  await pool.end();
}

checkRawData();

