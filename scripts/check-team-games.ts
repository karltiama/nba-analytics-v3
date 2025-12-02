import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function checkTeamGames(teamAbbr: string) {
  const result = await pool.query(`
    SELECT 
      t.team_id,
      t.abbreviation,
      COUNT(DISTINCT bg.bbref_game_id) as total_games,
      COUNT(DISTINCT CASE WHEN bg.status = 'Final' THEN bg.bbref_game_id END) as final_games,
      COUNT(DISTINCT CASE WHEN bpgs.game_id IS NOT NULL THEN bg.bbref_game_id END) as games_with_player_stats,
      COUNT(DISTINCT CASE WHEN btgs.game_id IS NOT NULL THEN bg.bbref_game_id END) as games_with_team_stats,
      MIN(bg.game_date) as earliest_game,
      MAX(bg.game_date) as latest_game,
      COUNT(DISTINCT CASE WHEN bg.game_date <= CURRENT_DATE - INTERVAL '1 day' THEN bg.bbref_game_id END) as games_up_to_yesterday
    FROM teams t
    LEFT JOIN bbref_games bg ON (bg.home_team_id = t.team_id OR bg.away_team_id = t.team_id)
    LEFT JOIN bbref_player_game_stats bpgs ON bpgs.game_id = bg.bbref_game_id AND bpgs.team_id = t.team_id
    LEFT JOIN bbref_team_game_stats btgs ON btgs.game_id = bg.bbref_game_id AND btgs.team_id = t.team_id
    WHERE t.abbreviation = $1
    GROUP BY t.team_id, t.abbreviation
  `, [teamAbbr]);

  if (result.rows.length === 0) {
    console.log(`No team found with abbreviation: ${teamAbbr}`);
    return;
  }

  const team = result.rows[0];
  console.log(`\n📊 ${teamAbbr} Game Statistics\n`);
  console.log(`Total games in bbref_games: ${team.total_games || 0}`);
  console.log(`Final games: ${team.final_games || 0}`);
  console.log(`Games up to yesterday: ${team.games_up_to_yesterday || 0}`);
  console.log(`Games with player stats: ${team.games_with_player_stats || 0}`);
  console.log(`Games with team stats: ${team.games_with_team_stats || 0}`);
  console.log(`Missing box scores: ${(team.games_up_to_yesterday || 0) - (team.games_with_team_stats || 0)}`);
  console.log(`Date range: ${team.earliest_game || 'N/A'} to ${team.latest_game || 'N/A'}`);

  // Get breakdown by status
  const statusBreakdown = await pool.query(`
    SELECT 
      bg.status,
      COUNT(*) as count,
      COUNT(CASE WHEN bpgs.game_id IS NOT NULL THEN 1 END) as with_player_stats,
      COUNT(CASE WHEN btgs.game_id IS NOT NULL THEN 1 END) as with_team_stats
    FROM bbref_games bg
    LEFT JOIN bbref_player_game_stats bpgs ON bpgs.game_id = bg.bbref_game_id
    LEFT JOIN bbref_team_game_stats btgs ON btgs.game_id = bg.bbref_game_id
    WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
      AND bg.game_date <= CURRENT_DATE - INTERVAL '1 day'
    GROUP BY bg.status
    ORDER BY bg.status
  `, [team.team_id]);

  console.log(`\n📋 Breakdown by Status (up to yesterday):`);
  statusBreakdown.rows.forEach(row => {
    console.log(`  ${row.status || 'NULL'}: ${row.count} games (${row.with_player_stats} with player stats, ${row.with_team_stats} with team stats)`);
  });

  // Get all games up to yesterday with their stats status
  const allGames = await pool.query(`
    SELECT DISTINCT
      bg.bbref_game_id,
      bg.game_date,
      bg.status,
      bg.home_team_abbr,
      bg.away_team_abbr,
      bg.home_score,
      bg.away_score,
      CASE WHEN EXISTS (SELECT 1 FROM bbref_player_game_stats bpgs WHERE bpgs.game_id = bg.bbref_game_id) THEN 'Yes' ELSE 'No' END as has_player_stats,
      CASE WHEN EXISTS (SELECT 1 FROM bbref_team_game_stats btgs WHERE btgs.game_id = bg.bbref_game_id AND btgs.team_id = $1) THEN 'Yes' ELSE 'No' END as has_team_stats
    FROM bbref_games bg
    WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
      AND bg.game_date <= CURRENT_DATE - INTERVAL '1 day'
    ORDER BY bg.game_date DESC
  `, [team.team_id]);

  console.log(`\n📋 All Games Up to Yesterday (${allGames.rows.length} total):`);
  allGames.rows.forEach((game, idx) => {
    const statsStatus = game.has_player_stats === 'Yes' && game.has_team_stats === 'Yes' ? '✅' : '❌';
    console.log(`  ${statsStatus} ${game.game_date} - ${game.away_team_abbr} @ ${game.home_team_abbr} [${game.status || 'NULL'}] - Player: ${game.has_player_stats}, Team: ${game.has_team_stats}`);
  });

  // Get sample missing games
  const missingGames = allGames.rows.filter(g => g.has_player_stats === 'No');
  
  if (missingGames.length > 0) {
    console.log(`\n📋 Missing Games (${missingGames.length} total):`);
    missingGames.forEach((game, idx) => {
      console.log(`  ${idx + 1}. ${game.game_date} - ${game.away_team_abbr} @ ${game.home_team_abbr} (${game.status || 'NULL'}) - ${game.bbref_game_id}`);
    });
  }

  await pool.end();
}

const teamAbbr = process.argv[2] || 'CLE';
checkTeamGames(teamAbbr).catch(console.error);

