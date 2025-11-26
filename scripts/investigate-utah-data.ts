import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function investigateUtah() {
  console.log('\n🔍 Investigating Utah Team Data\n');
  
  // Get Utah's team_id
  const utah = await pool.query(`
    SELECT team_id, abbreviation, full_name
    FROM teams
    WHERE abbreviation = 'UTA'
  `);
  
  if (utah.rows.length === 0) {
    console.log('❌ Utah team not found!');
    await pool.end();
    return;
  }
  
  const teamId = utah.rows[0].team_id;
  console.log(`Team: ${utah.rows[0].full_name} (${utah.rows[0].abbreviation})`);
  console.log(`Team ID: ${teamId}\n`);
  
  // Check games in bbref_games
  const gamesInTable = await pool.query(`
    SELECT COUNT(*) as count
    FROM bbref_games bg
    WHERE bg.home_team_id = $1 OR bg.away_team_id = $1
  `, [teamId]);
  
  console.log(`Games in bbref_games: ${gamesInTable.rows[0].count}`);
  
  // Check games with team stats
  const gamesWithStats = await pool.query(`
    SELECT COUNT(DISTINCT btgs.game_id) as count
    FROM bbref_team_game_stats btgs
    JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
    WHERE btgs.team_id = $1
      AND btgs.source = 'bbref'
  `, [teamId]);
  
  console.log(`Games with team stats: ${gamesWithStats.rows[0].count}`);
  
  // Check games with player stats
  const gamesWithPlayerStats = await pool.query(`
    SELECT COUNT(DISTINCT bpgs.game_id) as count
    FROM bbref_player_game_stats bpgs
    JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
    WHERE bpgs.team_id = $1
      AND bpgs.source = 'bbref'
  `, [teamId]);
  
  console.log(`Games with player stats: ${gamesWithPlayerStats.rows[0].count}`);
  
  // Get sample of games
  console.log('\n📋 Sample games in bbref_games:');
  const sampleGames = await pool.query(`
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
      ) as has_team_stats,
      EXISTS (
        SELECT 1 FROM bbref_player_game_stats bpgs
        WHERE bpgs.game_id = bg.bbref_game_id
          AND bpgs.team_id = $1
      ) as has_player_stats
    FROM bbref_games bg
    WHERE bg.home_team_id = $1 OR bg.away_team_id = $1
    ORDER BY bg.game_date DESC
    LIMIT 10
  `, [teamId]);
  
  sampleGames.rows.forEach((game: any) => {
    const vs = game.home_team_abbr === 'UTA' ? 'vs' : '@';
    const opponent = game.home_team_abbr === 'UTA' ? game.away_team_abbr : game.home_team_abbr;
    console.log(`  ${game.game_date} ${vs} ${opponent} - Team Stats: ${game.has_team_stats ? '✅' : '❌'}, Player Stats: ${game.has_player_stats ? '✅' : '❌'}`);
  });
  
  // Check what getBBRefTeamGameStats would return
  console.log('\n📊 Testing getBBRefTeamGameStats query:');
  const gameStats = await pool.query(`
    SELECT 
      btgs.game_id,
      bg.game_date,
      bg.home_team_abbr as home_team,
      bg.away_team_abbr as away_team,
      btgs.is_home,
      btgs.points,
      btgs.field_goals_made as fgm,
      btgs.field_goals_attempted as fga
    FROM bbref_team_game_stats btgs
    JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
    WHERE btgs.team_id = $1
      AND btgs.source = 'bbref'
    ORDER BY COALESCE(bg.start_time, bg.game_date) DESC
    LIMIT 5
  `, [teamId]);
  
  console.log(`Found ${gameStats.rows.length} game stats`);
  gameStats.rows.forEach((stat: any) => {
    console.log(`  ${stat.game_date} - ${stat.is_home ? 'vs' : '@'} ${stat.is_home ? stat.away_team : stat.home_team}: ${stat.points} pts (${stat.fgm}/${stat.fga})`);
  });
  
  // Check season stats
  console.log('\n📊 Testing getBBRefTeamSeasonStats query:');
  const seasonStats = await pool.query(`
    SELECT 
      COUNT(DISTINCT btgs.game_id) as games_played,
      AVG(btgs.points) as avg_points,
      SUM(btgs.points) as total_points
    FROM bbref_team_game_stats btgs
    JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
    WHERE btgs.team_id = $1
      AND btgs.source = 'bbref'
  `, [teamId]);
  
  const stats = seasonStats.rows[0];
  console.log(`Games played: ${stats.games_played}`);
  console.log(`Avg points: ${stats.avg_points ? Number(stats.avg_points).toFixed(1) : 'N/A'}`);
  console.log(`Total points: ${stats.total_points || 'N/A'}`);
  
  // Check materialized view
  console.log('\n📊 Checking materialized view:');
  const materializedView = await pool.query(`
    SELECT * FROM bbref_team_season_stats WHERE team_id = $1
  `, [teamId]);
  
  if (materializedView.rows.length > 0) {
    const mv = materializedView.rows[0];
    console.log(`Games played (MV): ${mv.games_played}`);
    console.log(`Avg points (MV): ${mv.avg_points ? Number(mv.avg_points).toFixed(1) : 'N/A'}`);
  } else {
    console.log('❌ No data in materialized view');
  }
  
  await pool.end();
}

investigateUtah();


