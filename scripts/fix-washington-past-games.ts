import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function fixWashingtonGames() {
  console.log('\n🔧 Fixing Washington Past Games Status\n');
  
  const washington = await pool.query(`SELECT team_id FROM teams WHERE abbreviation = 'WAS'`);
  const teamId = washington.rows[0].team_id;
  
  // Find past games that are Scheduled
  const pastScheduled = await pool.query(`
    SELECT 
      bg.bbref_game_id,
      bg.game_date,
      bg.status,
      bg.home_team_abbr,
      bg.away_team_abbr,
      bg.home_score,
      bg.away_score,
      EXISTS (
        SELECT 1 FROM bbref_team_game_stats btgs
        WHERE btgs.game_id = bg.bbref_game_id
          AND btgs.team_id = $1
      ) as has_stats
    FROM bbref_games bg
    WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
      AND bg.game_date <= CURRENT_DATE
      AND bg.status = 'Scheduled'
    ORDER BY bg.game_date ASC
  `, [teamId]);
  
  console.log(`Found ${pastScheduled.rows.length} past games marked as Scheduled:\n`);
  
  if (pastScheduled.rows.length === 0) {
    console.log('✅ No past games with incorrect status found!');
  } else {
    for (const game of pastScheduled.rows) {
      const vs = game.home_team_abbr === 'WAS' ? 'vs' : '@';
      const opponent = game.home_team_abbr === 'WAS' ? game.away_team_abbr : game.home_team_abbr;
      const score = game.home_score && game.away_score 
        ? ` (${game.home_score}-${game.away_score})`
        : '';
      const statsMarker = game.has_stats ? '✅' : '❌';
      
      console.log(`${statsMarker} ${game.game_date} ${vs} ${opponent}${score} - ${game.bbref_game_id}`);
    }
    
    // Update status to Final
    console.log(`\n📝 Updating ${pastScheduled.rows.length} games to Final status...`);
    
    const gameIds = pastScheduled.rows.map((g: any) => g.bbref_game_id);
    
    await pool.query(`
      UPDATE bbref_games
      SET status = 'Final'
      WHERE bbref_game_id = ANY($1::text[])
        AND status = 'Scheduled'
    `, [gameIds]);
    
    console.log('✅ Updated status to Final');
  }
  
  // Check all completed games and find missing stats
  const completedGames = await pool.query(`
    SELECT 
      bg.bbref_game_id,
      bg.game_date,
      bg.status,
      bg.home_team_abbr,
      bg.away_team_abbr,
      bg.home_score,
      bg.away_score,
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
  
  const needStats = completedGames.rows.filter((g: any) => !g.has_stats);
  
  if (needStats.length > 0) {
    console.log(`\n⚠️  ${needStats.length} games need stats:`);
    needStats.forEach((game: any) => {
      const vs = game.home_team_abbr === 'WAS' ? 'vs' : '@';
      const opponent = game.home_team_abbr === 'WAS' ? game.away_team_abbr : game.home_team_abbr;
      console.log(`   ${game.game_date} ${vs} ${opponent} (${game.bbref_game_id})`);
    });
    
    console.log(`\n💡 To scrape these games, run:`);
    console.log(`   npx tsx scripts/batch-scrape-missing-bbref-games.ts --game-ids ${needStats.map((g: any) => g.bbref_game_id).join(',')}`);
  } else {
    console.log('\n✅ All games already have stats!');
  }
  
  // Show summary
  console.log(`\n📊 Washington Summary:`);
  console.log(`   Completed games: ${completedGames.rows.length}`);
  console.log(`   Games with stats: ${completedGames.rows.length - needStats.length}`);
  console.log(`   Coverage: ${completedGames.rows.length > 0 ? Math.round(((completedGames.rows.length - needStats.length) / completedGames.rows.length) * 100) : 0}%`);
  
  await pool.end();
}

fixWashingtonGames();

