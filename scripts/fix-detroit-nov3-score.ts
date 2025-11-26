import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function fixDetroitNov3Score() {
  console.log('\n🔧 Fixing Detroit Nov 3 Game Score\n');
  
  const gameId = 'bbref_202511030000_DET_MEM';
  
  // Get current game record
  const game = await pool.query(`
    SELECT 
      bg.bbref_game_id,
      bg.game_date,
      bg.home_team_abbr,
      bg.away_team_abbr,
      bg.home_score,
      bg.away_score
    FROM bbref_games bg
    WHERE bg.bbref_game_id = $1
  `, [gameId]);
  
  if (game.rows.length === 0) {
    console.log('❌ Game not found');
    await pool.end();
    return;
  }
  
  const gameInfo = game.rows[0];
  console.log(`📅 Game: ${gameInfo.game_date}`);
  console.log(`   ${gameInfo.away_team_abbr} @ ${gameInfo.home_team_abbr}`);
  console.log(`   Current score: ${gameInfo.away_score} - ${gameInfo.home_score}`);
  
  // Correct score: DET 114, MEM 106
  // DET is away team, MEM is home team
  const correctAwayScore = 114; // DET
  const correctHomeScore = 106; // MEM
  
  console.log(`   Correct score: ${correctAwayScore} - ${correctHomeScore}`);
  
  // Update the game record
  await pool.query(`
    UPDATE bbref_games
    SET 
      away_score = $1,
      home_score = $2,
      updated_at = now()
    WHERE bbref_game_id = $3
  `, [correctAwayScore, correctHomeScore, gameId]);
  
  console.log('\n✅ Updated game record score');
  
  // Verify team stats match
  const teamStats = await pool.query(`
    SELECT 
      btgs.*,
      t.abbreviation as team_abbr
    FROM bbref_team_game_stats btgs
    JOIN teams t ON btgs.team_id = t.team_id
    WHERE btgs.game_id = $1
    ORDER BY t.abbreviation
  `, [gameId]);
  
  console.log('\n📊 Team Stats Verification:');
  teamStats.rows.forEach((stat: any) => {
    const expectedScore = stat.is_home 
      ? correctHomeScore 
      : correctAwayScore;
    const match = stat.points === expectedScore ? '✅' : '❌';
    console.log(`   ${match} ${stat.team_abbr}: ${stat.points} points (expected: ${expectedScore})`);
  });
  
  await pool.end();
}

fixDetroitNov3Score();

