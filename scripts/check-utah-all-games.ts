import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function checkAllGames() {
  console.log('\n🔍 Checking ALL Utah Games (including non-Final)\n');
  
  const utah = await pool.query(`SELECT team_id FROM teams WHERE abbreviation = 'UTA'`);
  const teamId = utah.rows[0].team_id;
  
  // Get ALL games (not just Final)
  const allGames = await pool.query(`
    SELECT 
      bg.bbref_game_id,
      bg.game_date,
      bg.status,
      bg.home_team_abbr,
      bg.away_team_abbr,
      bg.home_score,
      bg.away_score,
      CASE 
        WHEN bg.game_date <= CURRENT_DATE THEN 'Past'
        ELSE 'Future'
      END as time_period,
      EXISTS (
        SELECT 1 FROM bbref_team_game_stats btgs
        WHERE btgs.game_id = bg.bbref_game_id
          AND btgs.team_id = $1
      ) as has_team_stats
    FROM bbref_games bg
    WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
    ORDER BY bg.game_date ASC
  `, [teamId]);
  
  console.log(`Total games in database: ${allGames.rows.length}\n`);
  
  // Group by status
  const byStatus = new Map<string, any[]>();
  allGames.rows.forEach((game: any) => {
    const status = game.status || 'Unknown';
    if (!byStatus.has(status)) {
      byStatus.set(status, []);
    }
    byStatus.get(status)!.push(game);
  });
  
  console.log('Games by status:');
  Array.from(byStatus.entries()).forEach(([status, games]) => {
    console.log(`  ${status}: ${games.length} games`);
  });
  
  // Check past games that aren't Final
  const pastNonFinal = allGames.rows.filter((g: any) => 
    new Date(g.game_date) <= new Date() && g.status !== 'Final'
  );
  
  if (pastNonFinal.length > 0) {
    console.log(`\n⚠️  Past games that aren't marked as Final (${pastNonFinal.length}):`);
    pastNonFinal.forEach((game: any) => {
      const vs = game.home_team_abbr === 'UTA' ? 'vs' : '@';
      const opponent = game.home_team_abbr === 'UTA' ? game.away_team_abbr : game.home_team_abbr;
      const score = game.home_score && game.away_score 
        ? ` (${game.home_score}-${game.away_score})`
        : '';
      const statsMarker = game.has_team_stats ? '✅' : '❌';
      console.log(`   ${statsMarker} ${game.game_date} ${vs} ${opponent}${score} - Status: ${game.status}`);
    });
  }
  
  // Check games that should be completed (past date) but missing stats
  const pastMissingStats = allGames.rows.filter((g: any) => 
    new Date(g.game_date) <= new Date() && 
    g.status === 'Final' && 
    !g.has_team_stats
  );
  
  if (pastMissingStats.length > 0) {
    console.log(`\n❌ Final games missing stats (${pastMissingStats.length}):`);
    pastMissingStats.forEach((game: any) => {
      const vs = game.home_team_abbr === 'UTA' ? 'vs' : '@';
      const opponent = game.home_team_abbr === 'UTA' ? game.away_team_abbr : game.home_team_abbr;
      console.log(`   ${game.game_date} ${vs} ${opponent} (${game.bbref_game_id})`);
    });
  }
  
  // Show all games in date order
  console.log(`\n📋 All games (first 20):`);
  allGames.rows.slice(0, 20).forEach((game: any) => {
    const vs = game.home_team_abbr === 'UTA' ? 'vs' : '@';
    const opponent = game.home_team_abbr === 'UTA' ? game.away_team_abbr : game.home_team_abbr;
    const statsMarker = game.has_team_stats ? '✅' : '❌';
    const timeMarker = game.time_period === 'Past' ? '📅' : '🔮';
    console.log(`   ${timeMarker} ${statsMarker} ${game.game_date} ${vs} ${opponent} - ${game.status}`);
  });
  
  if (allGames.rows.length > 20) {
    console.log(`   ... and ${allGames.rows.length - 20} more games`);
  }
  
  await pool.end();
}

checkAllGames();

