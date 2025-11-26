import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function checkUtah() {
  const utah = await pool.query(`SELECT team_id FROM teams WHERE abbreviation = 'UTA'`);
  const teamId = utah.rows[0].team_id;
  
  console.log('\n🔍 Utah Completed Games Analysis\n');
  
  // Check completed games
  const completed = await pool.query(`
    SELECT COUNT(*) as count
    FROM bbref_games bg
    WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
      AND bg.game_date <= CURRENT_DATE
      AND bg.status = 'Final'
  `, [teamId]);
  
  console.log(`Completed games (Final, up to today): ${completed.rows[0].count}`);
  
  // Check completed games with stats
  const completedWithStats = await pool.query(`
    SELECT COUNT(DISTINCT btgs.game_id) as count
    FROM bbref_team_game_stats btgs
    JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
    WHERE btgs.team_id = $1
      AND btgs.source = 'bbref'
      AND bg.game_date <= CURRENT_DATE
      AND bg.status = 'Final'
  `, [teamId]);
  
  console.log(`Completed games with team stats: ${completedWithStats.rows[0].count}`);
  
  // List all completed games
  const allCompleted = await pool.query(`
    SELECT 
      bg.bbref_game_id,
      bg.game_date,
      bg.status,
      bg.home_team_abbr,
      bg.away_team_abbr,
      EXISTS (
        SELECT 1 FROM bbref_team_game_stats btgs
        WHERE btgs.game_id = bg.bbref_game_id
          AND btgs.team_id = $1
      ) as has_stats
    FROM bbref_games bg
    WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
      AND bg.game_date <= CURRENT_DATE
      AND bg.status = 'Final'
    ORDER BY bg.game_date ASC
  `, [teamId]);
  
  console.log(`\n📋 All ${allCompleted.rows.length} completed games:`);
  allCompleted.rows.forEach((game: any) => {
    const vs = game.home_team_abbr === 'UTA' ? 'vs' : '@';
    const opponent = game.home_team_abbr === 'UTA' ? game.away_team_abbr : game.home_team_abbr;
    const marker = game.has_stats ? '✅' : '❌';
    console.log(`  ${marker} ${game.game_date} ${vs} ${opponent} (${game.bbref_game_id})`);
  });
  
  // Check scheduled games
  const scheduled = await pool.query(`
    SELECT COUNT(*) as count
    FROM bbref_games bg
    WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
      AND (bg.game_date > CURRENT_DATE OR bg.status != 'Final')
  `, [teamId]);
  
  console.log(`\n📅 Scheduled/future games: ${scheduled.rows[0].count}`);
  
  // Check ALL games with stats (no date/status filter)
  console.log(`\n📊 All games with team stats (no filters):`);
  const allWithStats = await pool.query(`
    SELECT 
      bg.bbref_game_id,
      bg.game_date,
      bg.status,
      bg.home_team_abbr,
      bg.away_team_abbr
    FROM bbref_team_game_stats btgs
    JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
    WHERE btgs.team_id = $1
      AND btgs.source = 'bbref'
    ORDER BY bg.game_date DESC
  `, [teamId]);
  
  console.log(`Total: ${allWithStats.rows.length} games`);
  allWithStats.rows.forEach((game: any) => {
    const vs = game.home_team_abbr === 'UTA' ? 'vs' : '@';
    const opponent = game.home_team_abbr === 'UTA' ? game.away_team_abbr : game.home_team_abbr;
    const isFuture = new Date(game.game_date) > new Date();
    const marker = isFuture ? '🔮' : game.status === 'Final' ? '✅' : '⚠️';
    console.log(`  ${marker} ${game.game_date} ${vs} ${opponent} - Status: ${game.status} (${game.bbref_game_id})`);
  });
  
  await pool.end();
}

checkUtah();

