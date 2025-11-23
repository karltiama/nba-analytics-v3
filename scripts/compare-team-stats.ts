import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

/**
 * Compare team stats for a specific team from both sources
 */
async function compareTeamStats(teamAbbr: string, limit: number = 10) {
  // Get team_id from abbreviation
  const teamResult = await pool.query(
    `SELECT team_id, abbreviation, full_name FROM teams WHERE abbreviation = $1`,
    [teamAbbr.toUpperCase()]
  );
  
  if (teamResult.rows.length === 0) {
    console.log(`❌ Team ${teamAbbr} not found.`);
    return;
  }
  
  const team = teamResult.rows[0];
  const teamId = team.team_id;
  
  console.log(`\n🏀 ${team.full_name} (${team.abbreviation}) - Stats Comparison`);
  console.log('='.repeat(140));
  
  // Get BBRef team stats
  const bbrefStats = await pool.query(`
    SELECT 
      btgs.game_id,
      g.start_time::date as game_date,
      ht.abbreviation as home_team,
      at.abbreviation as away_team,
      btgs.is_home,
      btgs.points,
      btgs.field_goals_made as fgm,
      btgs.field_goals_attempted as fga,
      btgs.three_pointers_made as "3pm",
      btgs.three_pointers_attempted as "3pa",
      btgs.free_throws_made as ftm,
      btgs.free_throws_attempted as fta,
      btgs.rebounds,
      btgs.offensive_rebounds as orb,
      btgs.defensive_rebounds as drb,
      btgs.assists,
      btgs.steals,
      btgs.blocks,
      btgs.turnovers,
      btgs.personal_fouls as pf,
      btgs.possessions
    FROM bbref_team_game_stats btgs
    JOIN games g ON btgs.game_id = g.game_id
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE btgs.team_id = $1
    ORDER BY g.start_time DESC
    LIMIT $2
  `, [teamId, limit]);
  
  // Get regular team stats
  const regularStats = await pool.query(`
    SELECT 
      tgs.game_id,
      g.start_time::date as game_date,
      ht.abbreviation as home_team,
      at.abbreviation as away_team,
      tgs.is_home,
      tgs.points,
      tgs.field_goals_made as fgm,
      tgs.field_goals_attempted as fga,
      tgs.three_pointers_made as "3pm",
      tgs.three_pointers_attempted as "3pa",
      tgs.free_throws_made as ftm,
      tgs.free_throws_attempted as fta,
      tgs.rebounds,
      tgs.offensive_rebounds as orb,
      tgs.defensive_rebounds as drb,
      tgs.assists,
      tgs.steals,
      tgs.blocks,
      tgs.turnovers,
      tgs.possessions
    FROM team_game_stats tgs
    JOIN games g ON tgs.game_id = g.game_id
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE tgs.team_id = $1
    ORDER BY g.start_time DESC
    LIMIT $2
  `, [teamId, limit]);
  
  console.log(`\n📊 BBREF TEAM STATS (${bbrefStats.rows.length} games)`);
  console.log('-'.repeat(140));
  
  if (bbrefStats.rows.length === 0) {
    console.log('   No BBRef stats found for this team.');
  } else {
    for (const row of bbrefStats.rows) {
      const location = row.is_home ? 'HOME' : 'AWAY';
      const matchup = row.is_home 
        ? `${row.away_team} @ ${row.home_team}` 
        : `${row.home_team} @ ${row.away_team}`;
      
      console.log(`\n   Game: ${row.game_id} | ${row.game_date} | ${matchup} (${location})`);
      console.log(`   PTS: ${row.points || 'N/A'} | FGM/FGA: ${row.fgm || 'N/A'}/${row.fga || 'N/A'} | 3PM/3PA: ${row['3pm'] || 'N/A'}/${row['3pa'] || 'N/A'} | FTM/FTA: ${row.ftm || 'N/A'}/${row.fta || 'N/A'}`);
      console.log(`   REB: ${row.rebounds || 'N/A'} (ORB: ${row.orb || 'N/A'}, DRB: ${row.drb || 'N/A'}) | AST: ${row.assists || 'N/A'} | STL: ${row.steals || 'N/A'} | BLK: ${row.blocks || 'N/A'} | TOV: ${row.turnovers || 'N/A'}`);
      console.log(`   PF: ${row.pf || 'N/A'} | Possessions: ${row.possessions || 'N/A'}`);
    }
  }
  
  console.log(`\n📊 REGULAR TEAM STATS (${regularStats.rows.length} games)`);
  console.log('-'.repeat(140));
  
  if (regularStats.rows.length === 0) {
    console.log('   No regular stats found for this team.');
  } else {
    for (const row of regularStats.rows) {
      const location = row.is_home ? 'HOME' : 'AWAY';
      const matchup = row.is_home 
        ? `${row.away_team} @ ${row.home_team}` 
        : `${row.home_team} @ ${row.away_team}`;
      
      console.log(`\n   Game: ${row.game_id} | ${row.game_date} | ${matchup} (${location})`);
      console.log(`   PTS: ${row.points || 'N/A'} | FGM/FGA: ${row.fgm || 'N/A'}/${row.fga || 'N/A'} | 3PM/3PA: ${row['3pm'] || 'N/A'}/${row['3pa'] || 'N/A'} | FTM/FTA: ${row.ftm || 'N/A'}/${row.fta || 'N/A'}`);
      console.log(`   REB: ${row.rebounds || 'N/A'} (ORB: ${row.orb || 'N/A'}, DRB: ${row.drb || 'N/A'}) | AST: ${row.assists || 'N/A'} | STL: ${row.steals || 'N/A'} | BLK: ${row.blocks || 'N/A'} | TOV: ${row.turnovers || 'N/A'}`);
      console.log(`   Possessions: ${row.possessions || 'N/A'} | Note: PF not available`);
    }
  }
  
  // Now compare player stats
  console.log(`\n\n👥 PLAYER STATS COMPARISON`);
  console.log('='.repeat(140));
  
  // Get BBRef player stats
  const bbrefPlayers = await pool.query(`
    SELECT 
      bpgs.game_id,
      bpgs.player_id,
      p.full_name as player_name,
      g.start_time::date as game_date,
      bpgs.minutes,
      bpgs.points,
      bpgs.rebounds,
      bpgs.assists,
      bpgs.steals,
      bpgs.blocks,
      bpgs.turnovers,
      bpgs.field_goals_made as fgm,
      bpgs.field_goals_attempted as fga,
      bpgs.three_pointers_made as "3pm",
      bpgs.three_pointers_attempted as "3pa",
      bpgs.free_throws_made as ftm,
      bpgs.free_throws_attempted as fta,
      bpgs.offensive_rebounds as orb,
      bpgs.defensive_rebounds as drb,
      bpgs.personal_fouls as pf,
      bpgs.plus_minus as pm
    FROM bbref_player_game_stats bpgs
    JOIN players p ON bpgs.player_id = p.player_id
    JOIN games g ON bpgs.game_id = g.game_id
    WHERE bpgs.team_id = $1
    ORDER BY g.start_time DESC, p.full_name
    LIMIT $2
  `, [teamId, limit * 2]); // More players since multiple per game
  
  // Get regular player stats
  const regularPlayers = await pool.query(`
    SELECT 
      pgs.game_id,
      pgs.player_id,
      p.full_name as player_name,
      g.start_time::date as game_date,
      pgs.minutes,
      pgs.points,
      pgs.rebounds,
      pgs.assists,
      pgs.steals,
      pgs.blocks,
      pgs.turnovers,
      pgs.field_goals_made as fgm,
      pgs.field_goals_attempted as fga,
      pgs.three_pointers_made as "3pm",
      pgs.three_pointers_attempted as "3pa",
      pgs.free_throws_made as ftm,
      pgs.free_throws_attempted as fta,
      pgs.plus_minus as pm
    FROM player_game_stats pgs
    JOIN players p ON pgs.player_id = p.player_id
    JOIN games g ON pgs.game_id = g.game_id
    WHERE pgs.team_id = $1
    ORDER BY g.start_time DESC, p.full_name
    LIMIT $2
  `, [teamId, limit * 2]);
  
  console.log(`\n📊 BBREF PLAYER STATS (${bbrefPlayers.rows.length} player-game records)`);
  console.log('-'.repeat(140));
  
  if (bbrefPlayers.rows.length === 0) {
    console.log('   No BBRef player stats found for this team.');
  } else {
    for (const row of bbrefPlayers.rows) {
      console.log(`\n   ${row.player_name} | Game: ${row.game_id} | ${row.game_date}`);
      console.log(`   MIN: ${row.minutes || 'N/A'} | PTS: ${row.points || 'N/A'} | REB: ${row.rebounds || 'N/A'} | AST: ${row.assists || 'N/A'} | STL: ${row.steals || 'N/A'} | BLK: ${row.blocks || 'N/A'} | TOV: ${row.turnovers || 'N/A'}`);
      console.log(`   FGM/FGA: ${row.fgm || 'N/A'}/${row.fga || 'N/A'} | 3PM/3PA: ${row['3pm'] || 'N/A'}/${row['3pa'] || 'N/A'} | FTM/FTA: ${row.ftm || 'N/A'}/${row.fta || 'N/A'}`);
      console.log(`   ORB: ${row.orb || 'N/A'} | DRB: ${row.drb || 'N/A'} | PF: ${row.pf || 'N/A'} | +/-: ${row.pm || 'N/A'}`);
    }
  }
  
  console.log(`\n📊 REGULAR PLAYER STATS (${regularPlayers.rows.length} player-game records)`);
  console.log('-'.repeat(140));
  
  if (regularPlayers.rows.length === 0) {
    console.log('   No regular player stats found for this team.');
  } else {
    for (const row of regularPlayers.rows) {
      console.log(`\n   ${row.player_name} | Game: ${row.game_id} | ${row.game_date}`);
      console.log(`   MIN: ${row.minutes || 'N/A'} | PTS: ${row.points || 'N/A'} | REB: ${row.rebounds || 'N/A'} | AST: ${row.assists || 'N/A'} | STL: ${row.steals || 'N/A'} | BLK: ${row.blocks || 'N/A'} | TOV: ${row.turnovers || 'N/A'}`);
      console.log(`   FGM/FGA: ${row.fgm || 'N/A'}/${row.fga || 'N/A'} | 3PM/3PA: ${row['3pm'] || 'N/A'}/${row['3pa'] || 'N/A'} | FTM/FTA: ${row.ftm || 'N/A'}/${row.fta || 'N/A'}`);
      console.log(`   +/-: ${row.pm || 'N/A'} | Note: ORB, DRB, PF not available`);
    }
  }
  
  console.log('\n' + '='.repeat(140));
}

async function main() {
  const args = process.argv.slice(2);
  const teamIndex = args.indexOf('--team');
  const limitIndex = args.indexOf('--limit');
  
  const teamAbbr = teamIndex !== -1 && args[teamIndex + 1] 
    ? args[teamIndex + 1] 
    : 'DET'; // Default to Detroit
  
  const limit = limitIndex !== -1 && args[limitIndex + 1] 
    ? parseInt(args[limitIndex + 1]) 
    : 5;
  
  try {
    await compareTeamStats(teamAbbr, limit);
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();


