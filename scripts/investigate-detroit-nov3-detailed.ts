import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function investigateDetailed() {
  console.log('\n🔍 Detailed Investigation: Detroit Nov 3 Game\n');
  
  const gameId = 'bbref_202511030000_DET_MEM';
  
  // Check scraped boxscores in detail
  const scraped = await pool.query(`
    SELECT 
      sb.*
    FROM scraped_boxscores sb
    WHERE sb.game_id = $1
      AND sb.source = 'bbref_csv'
    ORDER BY sb.team_code, sb.player_name
  `, [gameId]);
  
  console.log(`📥 Scraped Boxscores (${scraped.rows.length} rows):\n`);
  
  const detScraped = scraped.rows.filter((s: any) => s.team_code === 'DET');
  const memScraped = scraped.rows.filter((s: any) => s.team_code === 'MEM');
  
  console.log(`Detroit Players (${detScraped.length}):`);
  detScraped.forEach((p: any, i: number) => {
    console.log(`\n   ${i + 1}. ${p.player_name || 'Unknown'}:`);
    console.log(`      PTS: ${p.PTS || 'NULL'}`);
    console.log(`      FG: ${p.FG || 'NULL'}/${p.FGA || 'NULL'}`);
    console.log(`      MP: ${p.MP || 'NULL'}`);
    console.log(`      Raw data keys: ${Object.keys(p).join(', ')}`);
    if (p.payload) {
      console.log(`      Payload sample: ${JSON.stringify(p.payload).substring(0, 200)}...`);
    }
  });
  
  console.log(`\n\nMemphis Players (${memScraped.length}):`);
  memScraped.forEach((p: any, i: number) => {
    console.log(`\n   ${i + 1}. ${p.player_name || 'Unknown'}:`);
    console.log(`      PTS: ${p.PTS || 'NULL'}`);
    console.log(`      FG: ${p.FG || 'NULL'}/${p.FGA || 'NULL'}`);
    console.log(`      MP: ${p.MP || 'NULL'}`);
  });
  
  // Calculate totals from scraped data
  const detTotalPts = detScraped.reduce((sum: number, p: any) => {
    const pts = parseInt(p.PTS) || 0;
    return sum + pts;
  }, 0);
  
  const memTotalPts = memScraped.reduce((sum: number, p: any) => {
    const pts = parseInt(p.PTS) || 0;
    return sum + pts;
  }, 0);
  
  console.log(`\n\n📊 Calculated Totals from Scraped Data:`);
  console.log(`   Detroit: ${detTotalPts} points`);
  console.log(`   Memphis: ${memTotalPts} points`);
  
  // Check player game stats
  const playerStats = await pool.query(`
    SELECT 
      bpgs.*,
      p.full_name as player_name,
      t.abbreviation as team_abbr
    FROM bbref_player_game_stats bpgs
    JOIN players p ON bpgs.player_id = p.player_id
    JOIN teams t ON bpgs.team_id = t.team_id
    WHERE bpgs.game_id = $1
    ORDER BY t.abbreviation, bpgs.points DESC NULLS LAST
  `, [gameId]);
  
  const detPlayerStats = playerStats.rows.filter((p: any) => p.team_abbr === 'DET');
  const memPlayerStats = playerStats.rows.filter((p: any) => p.team_abbr === 'MEM');
  
  const detPlayerTotalPts = detPlayerStats.reduce((sum: number, p: any) => sum + (p.points || 0), 0);
  const memPlayerTotalPts = memPlayerStats.reduce((sum: number, p: any) => sum + (p.points || 0), 0);
  
  console.log(`\n\n📊 Calculated Totals from Player Game Stats:`);
  console.log(`   Detroit: ${detPlayerTotalPts} points (${detPlayerStats.length} players)`);
  console.log(`   Memphis: ${memPlayerTotalPts} points (${memPlayerStats.length} players)`);
  
  // Check if there are other games with similar scores
  console.log(`\n\n🔍 Checking for other games with score 100-103:`);
  const similarGames = await pool.query(`
    SELECT 
      bg.bbref_game_id,
      bg.game_date,
      bg.home_team_abbr,
      bg.away_team_abbr,
      bg.home_score,
      bg.away_score
    FROM bbref_games bg
    WHERE (bg.home_score = 103 AND bg.away_score = 100)
       OR (bg.home_score = 100 AND bg.away_score = 103)
    ORDER BY bg.game_date DESC
    LIMIT 10
  `);
  
  console.log(`   Found ${similarGames.rows.length} games with 100-103 score:`);
  similarGames.rows.forEach((g: any) => {
    console.log(`      ${g.game_date}: ${g.away_team_abbr} @ ${g.home_team_abbr} (${g.away_score}-${g.home_score}) - ${g.bbref_game_id}`);
  });
  
  // Check team game stats for those similar games
  if (similarGames.rows.length > 0) {
    console.log(`\n\n🔍 Checking team stats for similar games:`);
    for (const similarGame of similarGames.rows) {
      const similarTeamStats = await pool.query(`
        SELECT 
          btgs.*,
          t.abbreviation as team_abbr
        FROM bbref_team_game_stats btgs
        JOIN teams t ON btgs.team_id = t.team_id
        WHERE btgs.game_id = $1
      `, [similarGame.bbref_game_id]);
      
      if (similarTeamStats.rows.length > 0) {
        console.log(`\n   ${similarGame.bbref_game_id}:`);
        similarTeamStats.rows.forEach((ts: any) => {
          console.log(`      ${ts.team_abbr}: ${ts.points} points`);
        });
      }
    }
  }
  
  await pool.end();
}

investigateDetailed();

