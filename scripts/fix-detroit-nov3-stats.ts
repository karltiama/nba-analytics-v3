import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function fixDetroitNov3() {
  console.log('\n🔧 Fixing Detroit Nov 3 Game Stats\n');
  
  const gameId = 'bbref_202511030000_DET_MEM';
  
  // Get all scraped data with raw_data
  const scraped = await pool.query(`
    SELECT 
      sb.*,
      sb.raw_data
    FROM scraped_boxscores sb
    WHERE sb.game_id = $1
      AND sb.source = 'bbref_csv'
    ORDER BY sb.team_code, sb.player_name
  `, [gameId]);
  
  console.log(`📥 Found ${scraped.rows.length} scraped rows\n`);
  
  // Calculate totals from raw_data
  let detTotalPts = 0;
  let memTotalPts = 0;
  const detPlayers: any[] = [];
  const memPlayers: any[] = [];
  
  for (const row of scraped.rows) {
    if (!row.raw_data) continue;
    
    try {
      const parsed = typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : row.raw_data;
      const pts = parsed.PTS;
      
      // Skip "Did Not Play" entries
      if (pts === 'Did Not Play' || pts === 'DNP' || pts === null || pts === undefined) {
        continue;
      }
      
      const ptsNum = parseInt(String(pts)) || 0;
      
      if (row.team_code === 'DET') {
        detTotalPts += ptsNum;
        detPlayers.push({ name: row.player_name, pts: ptsNum, raw: parsed });
      } else if (row.team_code === 'MEM') {
        memTotalPts += ptsNum;
        memPlayers.push({ name: row.player_name, pts: ptsNum, raw: parsed });
      }
    } catch (e) {
      console.log(`   ⚠️  Error parsing raw_data for ${row.player_name}: ${e}`);
    }
  }
  
  console.log(`📊 Calculated Totals from Raw Data:`);
  console.log(`   Detroit: ${detTotalPts} points (${detPlayers.length} players)`);
  console.log(`   Memphis: ${memTotalPts} points (${memPlayers.length} players)`);
  
  // Check what the game record says
  const game = await pool.query(`
    SELECT 
      bg.home_score,
      bg.away_score,
      bg.home_team_abbr,
      bg.away_team_abbr
    FROM bbref_games bg
    WHERE bg.bbref_game_id = $1
  `, [gameId]);
  
  if (game.rows.length > 0) {
    const gameInfo = game.rows[0];
    const expectedDetScore = gameInfo.away_team_abbr === 'DET' ? gameInfo.away_score : gameInfo.home_score;
    const expectedMemScore = gameInfo.home_team_abbr === 'MEM' ? gameInfo.home_score : gameInfo.away_score;
    
    console.log(`\n📊 Game Record:`);
    console.log(`   Expected Detroit: ${expectedDetScore}`);
    console.log(`   Expected Memphis: ${expectedMemScore}`);
    
    if (detTotalPts === expectedDetScore && memTotalPts === expectedMemScore) {
      console.log(`\n✅ Totals match game record!`);
      console.log(`\n💡 The issue is that the parsed columns are NULL but raw_data is correct.`);
      console.log(`   We need to re-populate player stats from raw_data.`);
      console.log(`   Running populate-bbref-stats.ts should fix this.`);
    } else {
      console.log(`\n❌ Totals don't match game record!`);
      console.log(`   Detroit: Expected ${expectedDetScore}, Got ${detTotalPts}`);
      console.log(`   Memphis: Expected ${expectedMemScore}, Got ${memTotalPts}`);
    }
  }
  
  // Show top scorers
  console.log(`\n\n🏀 Top Scorers (from raw_data):`);
  console.log(`\n   Detroit:`);
  detPlayers.sort((a, b) => b.pts - a.pts).slice(0, 5).forEach((p: any) => {
    console.log(`      ${p.name}: ${p.pts} PTS`);
  });
  console.log(`\n   Memphis:`);
  memPlayers.sort((a, b) => b.pts - a.pts).slice(0, 5).forEach((p: any) => {
    console.log(`      ${p.name}: ${p.pts} PTS`);
  });
  
  await pool.end();
}

fixDetroitNov3();

