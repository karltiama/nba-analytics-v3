import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

/**
 * Compare player stats from bbref_player_game_stats vs player_game_stats
 * Shows side-by-side comparison for a specific game or player
 */
async function comparePlayerStats(gameId?: string, playerId?: string, limit: number = 20) {
  // First, find games that exist in both tables by matching on player_id and game date
  let sql = `
    WITH matched_games AS (
      SELECT DISTINCT
        bpgs.player_id,
        bpgs.game_id as bbref_game_id,
        pgs.game_id as regular_game_id,
        g.start_time::date as game_date,
        ht.abbreviation as home_team,
        at.abbreviation as away_team
      FROM bbref_player_game_stats bpgs
      JOIN games g_bbref ON bpgs.game_id = g_bbref.game_id
      JOIN player_game_stats pgs ON bpgs.player_id = pgs.player_id
      JOIN games g ON pgs.game_id = g.game_id
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      WHERE g_bbref.start_time::date = g.start_time::date
        AND (
          (g_bbref.home_team_id = g.home_team_id AND g_bbref.away_team_id = g.away_team_id)
          OR (g_bbref.home_team_id = g.away_team_id AND g_bbref.away_team_id = g.home_team_id)
        )
    )
    SELECT 
      mg.bbref_game_id,
      mg.regular_game_id,
      mg.player_id,
      p.full_name as player_name,
      mg.game_date,
      mg.home_team,
      mg.away_team,
      -- BBRef stats
      bpgs.minutes as bbref_minutes,
      bpgs.points as bbref_points,
      bpgs.rebounds as bbref_rebounds,
      bpgs.assists as bbref_assists,
      bpgs.steals as bbref_steals,
      bpgs.blocks as bbref_blocks,
      bpgs.turnovers as bbref_turnovers,
      bpgs.field_goals_made as bbref_fgm,
      bpgs.field_goals_attempted as bbref_fga,
      bpgs.three_pointers_made as bbref_3pm,
      bpgs.three_pointers_attempted as bbref_3pa,
      bpgs.free_throws_made as bbref_ftm,
      bpgs.free_throws_attempted as bbref_fta,
      bpgs.offensive_rebounds as bbref_orb,
      bpgs.defensive_rebounds as bbref_drb,
      bpgs.personal_fouls as bbref_pf,
      bpgs.plus_minus as bbref_pm,
      -- Regular stats
      pgs.minutes as regular_minutes,
      pgs.points as regular_points,
      pgs.rebounds as regular_rebounds,
      pgs.assists as regular_assists,
      pgs.steals as regular_steals,
      pgs.blocks as regular_blocks,
      pgs.turnovers as regular_turnovers,
      pgs.field_goals_made as regular_fgm,
      pgs.field_goals_attempted as regular_fga,
      pgs.three_pointers_made as regular_3pm,
      pgs.three_pointers_attempted as regular_3pa,
      pgs.free_throws_made as regular_ftm,
      pgs.free_throws_attempted as regular_fta,
      pgs.plus_minus as regular_pm,
      -- Flags
      '✅' as has_bbref,
      '✅' as has_regular
    FROM matched_games mg
    JOIN bbref_player_game_stats bpgs ON bpgs.game_id = mg.bbref_game_id AND bpgs.player_id = mg.player_id
    JOIN player_game_stats pgs ON pgs.game_id = mg.regular_game_id AND pgs.player_id = mg.player_id
    JOIN players p ON mg.player_id = p.player_id
    WHERE 1=1
  `;
  
  const params: any[] = [];
  let paramCount = 1;
  
  if (gameId) {
    sql += ` AND (mg.bbref_game_id = $${paramCount} OR mg.regular_game_id = $${paramCount})`;
    params.push(gameId);
    paramCount++;
  }
  
  if (playerId) {
    sql += ` AND mg.player_id = $${paramCount}`;
    params.push(playerId);
    paramCount++;
  }
  
  sql += `
    ORDER BY mg.game_date DESC, p.full_name
    LIMIT $${paramCount}
  `;
  params.push(limit);
  
  const result = await pool.query(sql, params);
  
  if (result.rows.length === 0) {
    console.log('No matching records found.');
    return;
  }
  
  console.log('\n' + '='.repeat(120));
  console.log('PLAYER STATS COMPARISON: BBRef vs Regular');
  console.log('='.repeat(120));
  
  for (const row of result.rows) {
    console.log(`\n📊 ${row.player_name}`);
    console.log(`   BBRef Game ID: ${row.bbref_game_id}`);
    console.log(`   Regular Game ID: ${row.regular_game_id}`);
    console.log(`   Date: ${row.game_date} | ${row.away_team} @ ${row.home_team}`);
    console.log(`   Sources: BBRef ${row.has_bbref} | Regular ${row.has_regular}`);
    console.log('\n   ┌─────────────────────────────────────────────────────────────────────────────┐');
    console.log('   │ Stat              │ BBRef          │ Regular        │ Match │');
    console.log('   ├───────────────────┼────────────────┼────────────────┼───────┤');
    
    const stats = [
      { name: 'Minutes', bbref: row.bbref_minutes, regular: row.regular_minutes },
      { name: 'Points', bbref: row.bbref_points, regular: row.regular_points },
      { name: 'Rebounds', bbref: row.bbref_rebounds, regular: row.regular_rebounds },
      { name: 'Assists', bbref: row.bbref_assists, regular: row.regular_assists },
      { name: 'Steals', bbref: row.bbref_steals, regular: row.regular_steals },
      { name: 'Blocks', bbref: row.bbref_blocks, regular: row.regular_blocks },
      { name: 'Turnovers', bbref: row.bbref_turnovers, regular: row.regular_turnovers },
      { name: 'FGM', bbref: row.bbref_fgm, regular: row.regular_fgm },
      { name: 'FGA', bbref: row.bbref_fga, regular: row.regular_fga },
      { name: '3PM', bbref: row.bbref_3pm, regular: row.regular_3pm },
      { name: '3PA', bbref: row.bbref_3pa, regular: row.regular_3pa },
      { name: 'FTM', bbref: row.bbref_ftm, regular: row.regular_ftm },
      { name: 'FTA', bbref: row.bbref_fta, regular: row.regular_fta },
      { name: 'Plus/Minus', bbref: row.bbref_pm, regular: row.regular_pm },
    ];
    
    for (const stat of stats) {
      const bbrefVal = stat.bbref !== null ? String(stat.bbref) : 'N/A';
      const regularVal = stat.regular !== null ? String(stat.regular) : 'N/A';
      const match = stat.bbref === stat.regular ? '✅' : (stat.bbref === null || stat.regular === null ? '⚠️' : '❌');
      
      console.log(`   │ ${stat.name.padEnd(17)} │ ${bbrefVal.padEnd(14)} │ ${regularVal.padEnd(14)} │ ${match}   │`);
    }
    
    // BBRef-only fields
    if (row.bbref_orb !== null || row.bbref_drb !== null || row.bbref_pf !== null) {
      console.log('   ├───────────────────┼────────────────┼────────────────┼───────┤');
      console.log('   │ BBRef Only Fields │                │                │       │');
      console.log(`   │ Off Rebounds      │ ${String(row.bbref_orb || 'N/A').padEnd(14)} │ ${'N/A'.padEnd(14)} │ ⚠️   │`);
      console.log(`   │ Def Rebounds      │ ${String(row.bbref_drb || 'N/A').padEnd(14)} │ ${'N/A'.padEnd(14)} │ ⚠️   │`);
      console.log(`   │ Personal Fouls    │ ${String(row.bbref_pf || 'N/A').padEnd(14)} │ ${'N/A'.padEnd(14)} │ ⚠️   │`);
    }
    
    console.log('   └─────────────────────────────────────────────────────────────────────────────┘');
  }
  
  console.log('\n' + '='.repeat(120));
}

/**
 * Compare team stats from bbref_team_game_stats vs team_game_stats
 */
async function compareTeamStats(gameId?: string, teamId?: string, limit: number = 10) {
  let sql = `
    SELECT 
      COALESCE(btgs.game_id, tgs.game_id) as game_id,
      COALESCE(btgs.team_id, tgs.team_id) as team_id,
      t.abbreviation as team_abbr,
      g.start_time::date as game_date,
      ht.abbreviation as home_team,
      at.abbreviation as away_team,
      -- BBRef stats
      btgs.points as bbref_points,
      btgs.field_goals_made as bbref_fgm,
      btgs.field_goals_attempted as bbref_fga,
      btgs.three_pointers_made as bbref_3pm,
      btgs.three_pointers_attempted as bbref_3pa,
      btgs.free_throws_made as bbref_ftm,
      btgs.free_throws_attempted as bbref_fta,
      btgs.rebounds as bbref_rebounds,
      btgs.offensive_rebounds as bbref_orb,
      btgs.defensive_rebounds as bbref_drb,
      btgs.assists as bbref_assists,
      btgs.steals as bbref_steals,
      btgs.blocks as bbref_blocks,
      btgs.turnovers as bbref_turnovers,
      btgs.personal_fouls as bbref_pf,
      btgs.possessions as bbref_possessions,
      -- Regular stats
      tgs.points as regular_points,
      tgs.field_goals_made as regular_fgm,
      tgs.field_goals_attempted as regular_fga,
      tgs.three_pointers_made as regular_3pm,
      tgs.three_pointers_attempted as regular_3pa,
      tgs.free_throws_made as regular_ftm,
      tgs.free_throws_attempted as regular_fta,
      tgs.rebounds as regular_rebounds,
      tgs.offensive_rebounds as regular_orb,
      tgs.defensive_rebounds as regular_drb,
      tgs.assists as regular_assists,
      tgs.steals as regular_steals,
      tgs.blocks as regular_blocks,
      tgs.turnovers as regular_turnovers,
      tgs.possessions as regular_possessions,
      -- Flags
      CASE WHEN btgs.game_id IS NULL THEN '❌' ELSE '✅' END as has_bbref,
      CASE WHEN tgs.game_id IS NULL THEN '❌' ELSE '✅' END as has_regular
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    FULL OUTER JOIN bbref_team_game_stats btgs ON btgs.game_id = g.game_id
    FULL OUTER JOIN team_game_stats tgs ON tgs.game_id = g.game_id AND tgs.team_id = btgs.team_id
    LEFT JOIN teams t ON COALESCE(btgs.team_id, tgs.team_id) = t.team_id
    WHERE 1=1
  `;
  
  const params: any[] = [];
  let paramCount = 1;
  
  if (gameId) {
    sql += ` AND g.game_id = $${paramCount}`;
    params.push(gameId);
    paramCount++;
  }
  
  if (teamId) {
    sql += ` AND COALESCE(btgs.team_id, tgs.team_id) = $${paramCount}`;
    params.push(teamId);
    paramCount++;
  }
  
  sql += `
    AND (btgs.game_id IS NOT NULL OR tgs.game_id IS NOT NULL)
    ORDER BY g.start_time DESC, t.abbreviation
    LIMIT $${paramCount}
  `;
  params.push(limit);
  
  const result = await pool.query(sql, params);
  
  if (result.rows.length === 0) {
    console.log('No matching team records found.');
    return;
  }
  
  console.log('\n' + '='.repeat(120));
  console.log('TEAM STATS COMPARISON: BBRef vs Regular');
  console.log('='.repeat(120));
  
  for (const row of result.rows) {
    console.log(`\n🏀 ${row.team_abbr} | Game: ${row.game_id}`);
    console.log(`   Date: ${row.game_date} | ${row.away_team} @ ${row.home_team}`);
    console.log(`   Sources: BBRef ${row.has_bbref} | Regular ${row.has_regular}`);
    console.log('\n   ┌─────────────────────────────────────────────────────────────────────────────┐');
    console.log('   │ Stat              │ BBRef          │ Regular        │ Match │');
    console.log('   ├───────────────────┼────────────────┼────────────────┼───────┤');
    
    const stats = [
      { name: 'Points', bbref: row.bbref_points, regular: row.regular_points },
      { name: 'FGM', bbref: row.bbref_fgm, regular: row.regular_fgm },
      { name: 'FGA', bbref: row.bbref_fga, regular: row.regular_fga },
      { name: '3PM', bbref: row.bbref_3pm, regular: row.regular_3pm },
      { name: '3PA', bbref: row.bbref_3pa, regular: row.regular_3pa },
      { name: 'FTM', bbref: row.bbref_ftm, regular: row.regular_ftm },
      { name: 'FTA', bbref: row.bbref_fta, regular: row.regular_fta },
      { name: 'Rebounds', bbref: row.bbref_rebounds, regular: row.regular_rebounds },
      { name: 'Off Rebounds', bbref: row.bbref_orb, regular: row.regular_orb },
      { name: 'Def Rebounds', bbref: row.bbref_drb, regular: row.regular_drb },
      { name: 'Assists', bbref: row.bbref_assists, regular: row.regular_assists },
      { name: 'Steals', bbref: row.bbref_steals, regular: row.regular_steals },
      { name: 'Blocks', bbref: row.bbref_blocks, regular: row.regular_blocks },
      { name: 'Turnovers', bbref: row.bbref_turnovers, regular: row.regular_turnovers },
      { name: 'Possessions', bbref: row.bbref_possessions, regular: row.regular_possessions },
    ];
    
    for (const stat of stats) {
      const bbrefVal = stat.bbref !== null ? String(stat.bbref) : 'N/A';
      const regularVal = stat.regular !== null ? String(stat.regular) : 'N/A';
      const match = stat.bbref === stat.regular ? '✅' : (stat.bbref === null || stat.regular === null ? '⚠️' : '❌');
      
      console.log(`   │ ${stat.name.padEnd(17)} │ ${bbrefVal.padEnd(14)} │ ${regularVal.padEnd(14)} │ ${match}   │`);
    }
    
    // BBRef-only fields
    if (row.bbref_pf !== null) {
      console.log('   ├───────────────────┼────────────────┼────────────────┼───────┤');
      console.log(`   │ Personal Fouls    │ ${String(row.bbref_pf || 'N/A').padEnd(14)} │ ${'N/A'.padEnd(14)} │ ⚠️   │`);
    }
    
    console.log('   └─────────────────────────────────────────────────────────────────────────────┘');
  }
  
  console.log('\n' + '='.repeat(120));
}

async function main() {
  const args = process.argv.slice(2);
  const gameIdIndex = args.indexOf('--game-id');
  const playerIdIndex = args.indexOf('--player-id');
  const teamIdIndex = args.indexOf('--team-id');
  const limitIndex = args.indexOf('--limit');
  const playersOnly = args.includes('--players-only');
  const teamsOnly = args.includes('--teams-only');
  
  const gameId = gameIdIndex !== -1 && args[gameIdIndex + 1] ? args[gameIdIndex + 1] : undefined;
  const playerId = playerIdIndex !== -1 && args[playerIdIndex + 1] ? args[playerIdIndex + 1] : undefined;
  const teamId = teamIdIndex !== -1 && args[teamIdIndex + 1] ? args[teamIdIndex + 1] : undefined;
  const limit = limitIndex !== -1 && args[limitIndex + 1] ? parseInt(args[limitIndex + 1]) : 20;
  
  try {
    if (!teamsOnly) {
      await comparePlayerStats(gameId, playerId, limit);
    }
    
    if (!playersOnly) {
      await compareTeamStats(gameId, teamId, limit);
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

