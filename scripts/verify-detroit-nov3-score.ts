import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function verifyScore() {
  console.log('\n🔍 Verifying Detroit Nov 3 Game Score\n');
  
  const gameId = 'bbref_202511030000_DET_MEM';
  
  // Get all scraped players with their points
  const scraped = await pool.query(`
    SELECT 
      sb.player_name,
      sb.team_code,
      sb.points,
      sb.raw_data,
      sb.dnp_reason,
      sb.player_id
    FROM scraped_boxscores sb
    WHERE sb.game_id = $1
      AND sb.source = 'bbref_csv'
    ORDER BY sb.team_code, sb.player_name
  `, [gameId]);
  
  console.log(`📥 All Scraped Players (${scraped.rows.length} total):\n`);
  
  let detTotal = 0;
  let memTotal = 0;
  const detPlayers: any[] = [];
  const memPlayers: any[] = [];
  
  for (const row of scraped.rows) {
    const pts = row.points || 0;
    const hasPlayerId = row.player_id !== null;
    const dnp = row.dnp_reason !== null;
    
    if (row.team_code === 'DET') {
      detTotal += pts;
      detPlayers.push({
        name: row.player_name,
        pts,
        hasPlayerId,
        dnp,
        inStats: hasPlayerId && !dnp
      });
    } else if (row.team_code === 'MEM') {
      memTotal += pts;
      memPlayers.push({
        name: row.player_name,
        pts,
        hasPlayerId,
        dnp,
        inStats: hasPlayerId && !dnp
      });
    }
  }
  
  console.log(`Detroit Players (${detPlayers.length}):`);
  detPlayers.forEach((p: any) => {
    const markers = [];
    if (!p.hasPlayerId) markers.push('❌ No ID');
    if (p.dnp) markers.push('DNP');
    if (p.inStats) markers.push('✅ In Stats');
    console.log(`   ${p.name}: ${p.pts} PTS ${markers.join(' ')}`);
  });
  
  console.log(`\nMemphis Players (${memPlayers.length}):`);
  memPlayers.forEach((p: any) => {
    const markers = [];
    if (!p.hasPlayerId) markers.push('❌ No ID');
    if (p.dnp) markers.push('DNP');
    if (p.inStats) markers.push('✅ In Stats');
    console.log(`   ${p.name}: ${p.pts} PTS ${markers.join(' ')}`);
  });
  
  console.log(`\n📊 Totals from Scraped Data:`);
  console.log(`   Detroit: ${detTotal} points`);
  console.log(`   Memphis: ${memTotal} points`);
  
  // Check game record
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
    
    const detMissing = expectedDetScore - detTotal;
    const memMissing = expectedMemScore - memTotal;
    
    console.log(`\n⚠️  Missing Points:`);
    console.log(`   Detroit: ${detMissing} points`);
    console.log(`   Memphis: ${memMissing} points`);
    
    if (detMissing > 0 || memMissing > 0) {
      console.log(`\n💡 Possible reasons:`);
      console.log(`   1. Some players weren't included in the CSV export`);
      console.log(`   2. The game record score might be incorrect`);
      console.log(`   3. Some players might be in team totals but not individual stats`);
      console.log(`\n🌐 Check Basketball Reference directly:`);
      console.log(`   https://www.basketball-reference.com/boxscores/202511030MEM.html`);
    }
  }
  
  await pool.end();
}

verifyScore();

