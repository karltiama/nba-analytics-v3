import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

/**
 * Show sample rows from bbref_player_game_stats
 */
async function showBBRefPlayerStats(limit: number = 5) {
  const result = await pool.query(`
    SELECT 
      bpgs.game_id,
      bpgs.player_id,
      p.full_name as player_name,
      t.abbreviation as team,
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
    JOIN teams t ON bpgs.team_id = t.team_id
    JOIN games g ON bpgs.game_id = g.game_id
    ORDER BY g.start_time DESC, p.full_name
    LIMIT $1
  `, [limit]);
  
  if (result.rows.length === 0) {
    console.log('No BBRef player stats found.');
    return;
  }
  
  console.log('\n' + '='.repeat(140));
  console.log('BBREF PLAYER GAME STATS (Sample)');
  console.log('='.repeat(140));
  
  for (const row of result.rows) {
    console.log(`\n📊 ${row.player_name} (${row.team}) | Game: ${row.game_id}`);
    console.log(`   Date: ${row.game_date}`);
    console.log(`   MIN: ${row.minutes || 'N/A'} | PTS: ${row.points || 'N/A'} | REB: ${row.rebounds || 'N/A'} | AST: ${row.assists || 'N/A'} | STL: ${row.steals || 'N/A'} | BLK: ${row.blocks || 'N/A'} | TOV: ${row.turnovers || 'N/A'}`);
    console.log(`   FGM/FGA: ${row.fgm || 'N/A'}/${row.fga || 'N/A'} | 3PM/3PA: ${row['3pm'] || 'N/A'}/${row['3pa'] || 'N/A'} | FTM/FTA: ${row.ftm || 'N/A'}/${row.fta || 'N/A'}`);
    console.log(`   ORB: ${row.orb || 'N/A'} | DRB: ${row.drb || 'N/A'} | PF: ${row.pf || 'N/A'} | +/-: ${row.pm || 'N/A'}`);
  }
  
  console.log('\n' + '='.repeat(140));
}

/**
 * Show sample rows from player_game_stats
 */
async function showRegularPlayerStats(limit: number = 5) {
  const result = await pool.query(`
    SELECT 
      pgs.game_id,
      pgs.player_id,
      p.full_name as player_name,
      t.abbreviation as team,
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
    JOIN teams t ON pgs.team_id = t.team_id
    JOIN games g ON pgs.game_id = g.game_id
    ORDER BY g.start_time DESC, p.full_name
    LIMIT $1
  `, [limit]);
  
  if (result.rows.length === 0) {
    console.log('No regular player stats found.');
    return;
  }
  
  console.log('\n' + '='.repeat(140));
  console.log('REGULAR PLAYER GAME STATS (Sample)');
  console.log('='.repeat(140));
  
  for (const row of result.rows) {
    console.log(`\n📊 ${row.player_name} (${row.team}) | Game: ${row.game_id}`);
    console.log(`   Date: ${row.game_date}`);
    console.log(`   MIN: ${row.minutes || 'N/A'} | PTS: ${row.points || 'N/A'} | REB: ${row.rebounds || 'N/A'} | AST: ${row.assists || 'N/A'} | STL: ${row.steals || 'N/A'} | BLK: ${row.blocks || 'N/A'} | TOV: ${row.turnovers || 'N/A'}`);
    console.log(`   FGM/FGA: ${row.fgm || 'N/A'}/${row.fga || 'N/A'} | 3PM/3PA: ${row['3pm'] || 'N/A'}/${row['3pa'] || 'N/A'} | FTM/FTA: ${row.ftm || 'N/A'}/${row.fta || 'N/A'}`);
    console.log(`   +/-: ${row.pm || 'N/A'} | Note: ORB, DRB, PF not available in regular stats`);
  }
  
  console.log('\n' + '='.repeat(140));
}

/**
 * Show sample rows from bbref_team_game_stats
 */
async function showBBRefTeamStats(limit: number = 5) {
  const result = await pool.query(`
    SELECT 
      btgs.game_id,
      btgs.team_id,
      t.abbreviation as team,
      g.start_time::date as game_date,
      ht.abbreviation as home_team,
      at.abbreviation as away_team,
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
      btgs.possessions,
      btgs.is_home
    FROM bbref_team_game_stats btgs
    JOIN teams t ON btgs.team_id = t.team_id
    JOIN games g ON btgs.game_id = g.game_id
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    ORDER BY g.start_time DESC, t.abbreviation
    LIMIT $1
  `, [limit]);
  
  if (result.rows.length === 0) {
    console.log('No BBRef team stats found.');
    return;
  }
  
  console.log('\n' + '='.repeat(140));
  console.log('BBREF TEAM GAME STATS (Sample)');
  console.log('='.repeat(140));
  
  for (const row of result.rows) {
    const location = row.is_home ? 'HOME' : 'AWAY';
    console.log(`\n🏀 ${row.team} (${location}) | Game: ${row.game_id}`);
    console.log(`   Date: ${row.game_date} | ${row.away_team} @ ${row.home_team}`);
    console.log(`   PTS: ${row.points || 'N/A'} | FGM/FGA: ${row.fgm || 'N/A'}/${row.fga || 'N/A'} | 3PM/3PA: ${row['3pm'] || 'N/A'}/${row['3pa'] || 'N/A'} | FTM/FTA: ${row.ftm || 'N/A'}/${row.fta || 'N/A'}`);
    console.log(`   REB: ${row.rebounds || 'N/A'} (ORB: ${row.orb || 'N/A'}, DRB: ${row.drb || 'N/A'}) | AST: ${row.assists || 'N/A'} | STL: ${row.steals || 'N/A'} | BLK: ${row.blocks || 'N/A'} | TOV: ${row.turnovers || 'N/A'}`);
    console.log(`   PF: ${row.pf || 'N/A'} | Possessions: ${row.possessions || 'N/A'}`);
  }
  
  console.log('\n' + '='.repeat(140));
}

/**
 * Show sample rows from team_game_stats
 */
async function showRegularTeamStats(limit: number = 5) {
  const result = await pool.query(`
    SELECT 
      tgs.game_id,
      tgs.team_id,
      t.abbreviation as team,
      g.start_time::date as game_date,
      ht.abbreviation as home_team,
      at.abbreviation as away_team,
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
      tgs.possessions,
      tgs.is_home
    FROM team_game_stats tgs
    JOIN teams t ON tgs.team_id = t.team_id
    JOIN games g ON tgs.game_id = g.game_id
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    ORDER BY g.start_time DESC, t.abbreviation
    LIMIT $1
  `, [limit]);
  
  if (result.rows.length === 0) {
    console.log('No regular team stats found.');
    return;
  }
  
  console.log('\n' + '='.repeat(140));
  console.log('REGULAR TEAM GAME STATS (Sample)');
  console.log('='.repeat(140));
  
  for (const row of result.rows) {
    const location = row.is_home ? 'HOME' : 'AWAY';
    console.log(`\n🏀 ${row.team} (${location}) | Game: ${row.game_id}`);
    console.log(`   Date: ${row.game_date} | ${row.away_team} @ ${row.home_team}`);
    console.log(`   PTS: ${row.points || 'N/A'} | FGM/FGA: ${row.fgm || 'N/A'}/${row.fga || 'N/A'} | 3PM/3PA: ${row['3pm'] || 'N/A'}/${row['3pa'] || 'N/A'} | FTM/FTA: ${row.ftm || 'N/A'}/${row.fta || 'N/A'}`);
    console.log(`   REB: ${row.rebounds || 'N/A'} (ORB: ${row.orb || 'N/A'}, DRB: ${row.drb || 'N/A'}) | AST: ${row.assists || 'N/A'} | STL: ${row.steals || 'N/A'} | BLK: ${row.blocks || 'N/A'} | TOV: ${row.turnovers || 'N/A'}`);
    console.log(`   Possessions: ${row.possessions || 'N/A'} | Note: PF not available in regular stats`);
  }
  
  console.log('\n' + '='.repeat(140));
}

async function main() {
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf('--limit');
  const playersOnly = args.includes('--players-only');
  const teamsOnly = args.includes('--teams-only');
  
  const limit = limitIndex !== -1 && args[limitIndex + 1] ? parseInt(args[limitIndex + 1]) : 5;
  
  try {
    if (!teamsOnly) {
      await showBBRefPlayerStats(limit);
      await showRegularPlayerStats(limit);
    }
    
    if (!playersOnly) {
      await showBBRefTeamStats(limit);
      await showRegularTeamStats(limit);
    }
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();


