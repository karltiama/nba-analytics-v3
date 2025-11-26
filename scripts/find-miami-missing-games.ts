import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function findMissingGames() {
  console.log('\n🔍 Finding Miami Missing Games\n');
  
  const miami = await pool.query(`SELECT team_id FROM teams WHERE abbreviation = 'MIA'`);
  const teamId = miami.rows[0].team_id;
  
  // Get all completed games
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
      ) as has_team_stats,
      EXISTS (
        SELECT 1 FROM bbref_player_game_stats bpgs
        WHERE bpgs.game_id = bg.bbref_game_id
          AND bpgs.team_id = $1
      ) as has_player_stats
    FROM bbref_games bg
    WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
      AND bg.game_date <= CURRENT_DATE
      AND bg.status = 'Final'
    ORDER BY bg.game_date ASC
  `, [teamId]);
  
  console.log(`Total completed games: ${completedGames.rows.length}\n`);
  
  const missingStats = completedGames.rows.filter((g: any) => !g.has_team_stats);
  
  console.log(`Games WITH stats: ${completedGames.rows.length - missingStats.length}`);
  console.log(`Games MISSING stats: ${missingStats.length}\n`);
  
  if (missingStats.length > 0) {
    console.log('❌ Games missing team stats:');
    missingStats.forEach((game: any) => {
      const vs = game.home_team_abbr === 'MIA' ? 'vs' : '@';
      const opponent = game.home_team_abbr === 'MIA' ? game.away_team_abbr : game.home_team_abbr;
      const score = game.home_score && game.away_score 
        ? ` (${game.home_score}-${game.away_score})`
        : '';
      console.log(`   ${game.game_date} ${vs} ${opponent}${score} (${game.bbref_game_id})`);
    });
  }
  
  // Show all completed games for reference
  console.log(`\n📋 All ${completedGames.rows.length} completed games:`);
  completedGames.rows.forEach((game: any) => {
    const vs = game.home_team_abbr === 'MIA' ? 'vs' : '@';
    const opponent = game.home_team_abbr === 'MIA' ? game.away_team_abbr : game.home_team_abbr;
    const teamMarker = game.has_team_stats ? '✅' : '❌';
    const playerMarker = game.has_player_stats ? '✅' : '❌';
    console.log(`   ${teamMarker}${playerMarker} ${game.game_date} ${vs} ${opponent}`);
  });
  
  await pool.end();
}

findMissingGames();


