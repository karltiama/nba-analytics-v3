import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function verifyTeamStats() {
  console.log('🔍 Verifying team stats are correctly aggregated from Basketball Reference...\n');
  
  // Get a sample of recent games
  const sampleGames = await pool.query(`
    SELECT bg.bbref_game_id, bg.game_date, bg.home_team_abbr, bg.away_team_abbr, bg.home_score, bg.away_score
    FROM bbref_games bg
    WHERE bg.status = 'Final'
      AND EXISTS (SELECT 1 FROM bbref_player_game_stats bpgs WHERE bpgs.game_id = bg.bbref_game_id)
    ORDER BY bg.game_date DESC
    LIMIT 5
  `);
  
  console.log(`Checking ${sampleGames.rows.length} sample games:\n`);
  
  for (const game of sampleGames.rows) {
    console.log(`\n📊 Game: ${game.game_date.toISOString().split('T')[0]} - ${game.away_team_abbr} @ ${game.home_team_abbr}`);
    console.log(`   Score: ${game.away_score} - ${game.home_score}`);
    
    // Get team IDs
    const homeTeam = await pool.query('SELECT team_id FROM teams WHERE abbreviation = $1', [game.home_team_abbr]);
    const awayTeam = await pool.query('SELECT team_id FROM teams WHERE abbreviation = $1', [game.away_team_abbr]);
    
    if (homeTeam.rows.length === 0 || awayTeam.rows.length === 0) continue;
    
    const homeTeamId = homeTeam.rows[0].team_id;
    const awayTeamId = awayTeam.rows[0].team_id;
    
    // Calculate from player stats
    const homePlayerStats = await pool.query(`
      SELECT 
        COUNT(*) as player_count,
        SUM(points) as total_points,
        SUM(field_goals_made) as fgm,
        SUM(field_goals_attempted) as fga,
        SUM(rebounds) as rebounds,
        SUM(assists) as assists
      FROM bbref_player_game_stats
      WHERE game_id = $1 AND team_id = $2 AND dnp_reason IS NULL
    `, [game.bbref_game_id, homeTeamId]);
    
    const awayPlayerStats = await pool.query(`
      SELECT 
        COUNT(*) as player_count,
        SUM(points) as total_points,
        SUM(field_goals_made) as fgm,
        SUM(field_goals_attempted) as fga,
        SUM(rebounds) as rebounds,
        SUM(assists) as assists
      FROM bbref_player_game_stats
      WHERE game_id = $1 AND team_id = $2 AND dnp_reason IS NULL
    `, [game.bbref_game_id, awayTeamId]);
    
    // Get team stats from bbref_team_game_stats
    const homeTeamStats = await pool.query(`
      SELECT points, field_goals_made, field_goals_attempted, rebounds, assists
      FROM bbref_team_game_stats
      WHERE game_id = $1 AND team_id = $2 AND source = 'bbref'
    `, [game.bbref_game_id, homeTeamId]);
    
    const awayTeamStats = await pool.query(`
      SELECT points, field_goals_made, field_goals_attempted, rebounds, assists
      FROM bbref_team_game_stats
      WHERE game_id = $1 AND team_id = $2 AND source = 'bbref'
    `, [game.bbref_game_id, awayTeamId]);
    
    const homeFromPlayers = homePlayerStats.rows[0];
    const awayFromPlayers = awayPlayerStats.rows[0];
    const homeFromTeam = homeTeamStats.rows[0];
    const awayFromTeam = awayTeamStats.rows[0];
    
    console.log(`\n   ${game.home_team_abbr} (Home):`);
    if (homeFromTeam) {
      const pointsMatch = Number(homeFromPlayers.total_points) === Number(homeFromTeam.points);
      const fgmMatch = Number(homeFromPlayers.fgm) === Number(homeFromTeam.field_goals_made);
      const fgaMatch = Number(homeFromPlayers.fga) === Number(homeFromTeam.field_goals_attempted);
      
      console.log(`     From Players: ${homeFromPlayers.player_count} players, ${homeFromPlayers.total_points} pts, ${homeFromPlayers.fgm}/${homeFromPlayers.fga} FG`);
      console.log(`     From Team Stats: ${homeFromTeam.points} pts, ${homeFromTeam.field_goals_made}/${homeFromTeam.field_goals_attempted} FG`);
      console.log(`     Match: ${pointsMatch && fgmMatch && fgaMatch ? '✅' : '❌'}`);
      if (!pointsMatch) console.log(`       ⚠️  Points mismatch: ${homeFromPlayers.total_points} vs ${homeFromTeam.points}`);
      if (!fgmMatch) console.log(`       ⚠️  FGM mismatch: ${homeFromPlayers.fgm} vs ${homeFromTeam.field_goals_made}`);
      if (!fgaMatch) console.log(`       ⚠️  FGA mismatch: ${homeFromPlayers.fga} vs ${homeFromTeam.field_goals_attempted}`);
    } else {
      console.log(`     ⚠️  No team stats found in bbref_team_game_stats`);
    }
    
    console.log(`\n   ${game.away_team_abbr} (Away):`);
    if (awayFromTeam) {
      const pointsMatch = Number(awayFromPlayers.total_points) === Number(awayFromTeam.points);
      const fgmMatch = Number(awayFromPlayers.fgm) === Number(awayFromTeam.field_goals_made);
      const fgaMatch = Number(awayFromPlayers.fga) === Number(awayFromTeam.field_goals_attempted);
      
      console.log(`     From Players: ${awayFromPlayers.player_count} players, ${awayFromPlayers.total_points} pts, ${awayFromPlayers.fgm}/${awayFromPlayers.fga} FG`);
      console.log(`     From Team Stats: ${awayFromTeam.points} pts, ${awayFromTeam.field_goals_made}/${awayFromTeam.field_goals_attempted} FG`);
      console.log(`     Match: ${pointsMatch && fgmMatch && fgaMatch ? '✅' : '❌'}`);
      if (!pointsMatch) console.log(`       ⚠️  Points mismatch: ${awayFromPlayers.total_points} vs ${awayFromTeam.points}`);
      if (!fgmMatch) console.log(`       ⚠️  FGM mismatch: ${awayFromPlayers.fgm} vs ${awayFromTeam.field_goals_made}`);
      if (!fgaMatch) console.log(`       ⚠️  FGA mismatch: ${awayFromPlayers.fga} vs ${awayFromTeam.field_goals_attempted}`);
    } else {
      console.log(`     ⚠️  No team stats found in bbref_team_game_stats`);
    }
  }
  
  await pool.end();
}

verifyTeamStats().catch(console.error);

