import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function checkDetroitNov3() {
  console.log('\n🔍 Investigating Detroit Nov 3 Game\n');
  
  const det = await pool.query(`SELECT team_id FROM teams WHERE abbreviation = 'DET'`);
  const teamId = det.rows[0].team_id;
  
  // Find Nov 3 game
  const game = await pool.query(`
    SELECT 
      bg.bbref_game_id,
      bg.game_date,
      bg.status,
      bg.home_team_abbr,
      bg.away_team_abbr,
      bg.home_score,
      bg.away_score,
      bg.home_team_id,
      bg.away_team_id
    FROM bbref_games bg
    WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
      AND bg.game_date = '2025-11-03'
    ORDER BY bg.game_date ASC
  `, [teamId]);
  
  if (game.rows.length === 0) {
    console.log('❌ No game found for Detroit on Nov 3, 2025');
    await pool.end();
    return;
  }
  
  const gameInfo = game.rows[0];
  console.log(`📅 Game: ${gameInfo.game_date}`);
  console.log(`   ${gameInfo.away_team_abbr} @ ${gameInfo.home_team_abbr}`);
  console.log(`   Score: ${gameInfo.away_score} - ${gameInfo.home_score}`);
  console.log(`   Status: ${gameInfo.status}`);
  console.log(`   Game ID: ${gameInfo.bbref_game_id}\n`);
  
  // Check team game stats
  const teamStats = await pool.query(`
    SELECT 
      btgs.*,
      t.abbreviation as team_abbr
    FROM bbref_team_game_stats btgs
    JOIN teams t ON btgs.team_id = t.team_id
    WHERE btgs.game_id = $1
    ORDER BY t.abbreviation
  `, [gameInfo.bbref_game_id]);
  
  console.log(`📊 Team Game Stats (${teamStats.rows.length} teams):`);
  teamStats.rows.forEach((stat: any) => {
    console.log(`\n   ${stat.team_abbr}:`);
    console.log(`      Points: ${stat.points}`);
    console.log(`      FG: ${stat.field_goals_made}/${stat.field_goals_attempted} (${stat.field_goals_percentage})`);
    console.log(`      3P: ${stat.three_pointers_made}/${stat.three_pointers_attempted} (${stat.three_pointers_percentage})`);
    console.log(`      FT: ${stat.free_throws_made}/${stat.free_throws_attempted} (${stat.free_throws_percentage})`);
    console.log(`      Rebounds: ${stat.total_rebounds} (${stat.offensive_rebounds} ORB, ${stat.defensive_rebounds} DRB)`);
    console.log(`      Assists: ${stat.assists}`);
    console.log(`      Steals: ${stat.steals}`);
    console.log(`      Blocks: ${stat.blocks}`);
    console.log(`      Turnovers: ${stat.turnovers}`);
    console.log(`      Personal Fouls: ${stat.personal_fouls}`);
    console.log(`      Is Home: ${stat.is_home}`);
    console.log(`      Source: ${stat.source}`);
  });
  
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
  `, [gameInfo.bbref_game_id]);
  
  console.log(`\n👥 Player Game Stats (${playerStats.rows.length} players):`);
  
  const detroitPlayers = playerStats.rows.filter((p: any) => p.team_abbr === 'DET');
  const opponentAbbr = gameInfo.home_team_abbr === 'DET' ? gameInfo.away_team_abbr : gameInfo.home_team_abbr;
  const opponentPlayers = playerStats.rows.filter((p: any) => p.team_abbr === opponentAbbr);
  
  console.log(`\n   Detroit (${detroitPlayers.length} players):`);
  detroitPlayers.forEach((p: any) => {
    console.log(`      ${p.player_name}: ${p.points} PTS, ${p.total_rebounds} REB, ${p.assists} AST`);
  });
  
  console.log(`\n   ${opponentAbbr} (${opponentPlayers.length} players):`);
  opponentPlayers.forEach((p: any) => {
    console.log(`      ${p.player_name}: ${p.points} PTS, ${p.total_rebounds} REB, ${p.assists} AST`);
  });
  
  // Check scraped boxscores
  const scraped = await pool.query(`
    SELECT 
      sb.*
    FROM scraped_boxscores sb
    WHERE sb.game_id = $1
      AND sb.source = 'bbref_csv'
    ORDER BY sb.team_code, sb.player_name
  `, [gameInfo.bbref_game_id]);
  
  console.log(`\n📥 Scraped Boxscores (${scraped.rows.length} rows):`);
  if (scraped.rows.length > 0) {
    const detScraped = scraped.rows.filter((s: any) => s.team_code === 'DET');
    const oppScraped = scraped.rows.filter((s: any) => s.team_code !== 'DET');
    
    console.log(`\n   Detroit scraped: ${detScraped.length} players`);
    console.log(`   ${opponentAbbr} scraped: ${oppScraped.length} players`);
    
    // Check if team totals match
    const detTeamTotal = detScraped.reduce((sum: number, p: any) => sum + (parseInt(p.PTS) || 0), 0);
    const detTeamStats = teamStats.rows.find((t: any) => t.team_abbr === 'DET');
    
    if (detTeamStats) {
      console.log(`\n   ⚠️  Detroit Points Comparison:`);
      console.log(`      Scraped total (sum of players): ${detTeamTotal}`);
      console.log(`      Team game stats: ${detTeamStats.points}`);
      if (detTeamTotal !== detTeamStats.points) {
        console.log(`      ❌ MISMATCH DETECTED!`);
      } else {
        console.log(`      ✅ Match`);
      }
    }
  } else {
    console.log(`   ⚠️  No scraped boxscore data found!`);
  }
  
  // Check if scores match
  const detTeamStats = teamStats.rows.find((t: any) => t.team_abbr === 'DET');
  const oppTeamStats = teamStats.rows.find((t: any) => t.team_abbr !== 'DET');
  
  if (detTeamStats && oppTeamStats) {
    console.log(`\n📊 Score Verification:`);
    const detIsHome = detTeamStats.is_home;
    const detScore = detTeamStats.points;
    const oppScore = oppTeamStats.points;
    
    console.log(`   Detroit score (from team_stats): ${detScore}`);
    console.log(`   ${opponentAbbr} score (from team_stats): ${oppScore}`);
    console.log(`   Game record: ${gameInfo.away_score} - ${gameInfo.home_score}`);
    
    const expectedDetScore = detIsHome ? gameInfo.home_score : gameInfo.away_score;
    const expectedOppScore = detIsHome ? gameInfo.away_score : gameInfo.home_score;
    
    if (detScore !== expectedDetScore || oppScore !== expectedOppScore) {
      console.log(`\n   ❌ SCORE MISMATCH:`);
      console.log(`      Expected Detroit: ${expectedDetScore}, Got: ${detScore}`);
      console.log(`      Expected ${opponentAbbr}: ${expectedOppScore}, Got: ${oppScore}`);
    } else {
      console.log(`   ✅ Scores match`);
    }
  }
  
  await pool.end();
}

checkDetroitNov3();

