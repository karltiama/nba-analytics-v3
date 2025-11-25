import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  try {
    console.log('\n🔍 Checking Team ID Mismatch for Nov 1 DAL @ DET\n');
    console.log('='.repeat(100));
    
    const gameId = '1842025110112';
    
    // Check what team IDs are in the schedule
    console.log('\n1️⃣ BBREF_SCHEDULE TEAM IDs');
    console.log('-'.repeat(100));
    const scheduleCheck = await pool.query(`
      SELECT 
        bs.home_team_id,
        bs.away_team_id,
        bs.home_team_abbr,
        bs.away_team_abbr,
        ht.team_id as home_team_id_from_teams,
        at.team_id as away_team_id_from_teams
      FROM bbref_schedule bs
      LEFT JOIN teams ht ON ht.abbreviation = bs.home_team_abbr
      LEFT JOIN teams at ON at.abbreviation = bs.away_team_abbr
      WHERE bs.canonical_game_id = $1
    `, [gameId]);
    
    if (scheduleCheck.rows.length > 0) {
      const row = scheduleCheck.rows[0];
      console.log(`Home Team (${row.home_team_abbr}):`);
      console.log(`  Schedule ID: ${row.home_team_id}`);
      console.log(`  Teams table ID: ${row.home_team_id_from_teams}`);
      console.log(`Away Team (${row.away_team_abbr}):`);
      console.log(`  Schedule ID: ${row.away_team_id}`);
      console.log(`  Teams table ID: ${row.away_team_id_from_teams}`);
    }
    
    // Check what team IDs are in the games table
    console.log('\n2️⃣ GAMES TABLE TEAM IDs');
    console.log('-'.repeat(100));
    const gamesCheck = await pool.query(`
      SELECT 
        g.home_team_id,
        g.away_team_id,
        ht.abbreviation as home_team,
        ht.team_id as home_team_id_value,
        at.abbreviation as away_team,
        at.team_id as away_team_id_value
      FROM games g
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      WHERE g.game_id = $1
    `, [gameId]);
    
    if (gamesCheck.rows.length > 0) {
      const row = gamesCheck.rows[0];
      console.log(`Home Team: ${row.home_team} (ID: ${row.home_team_id_value})`);
      console.log(`Away Team: ${row.away_team} (ID: ${row.away_team_id_value})`);
    } else {
      console.log('❌ Game not found in games table');
    }
    
    // Check bbref_team_game_stats
    console.log('\n3️⃣ BBREF_TEAM_GAME_STATS');
    console.log('-'.repeat(100));
    const teamStatsCheck = await pool.query(`
      SELECT 
        btgs.team_id,
        t.abbreviation,
        btgs.source,
        btgs.points
      FROM bbref_team_game_stats btgs
      JOIN teams t ON btgs.team_id = t.team_id
      WHERE btgs.game_id = $1
      ORDER BY btgs.team_id
    `, [gameId]);
    
    console.log(`Found ${teamStatsCheck.rows.length} team stat rows:`);
    teamStatsCheck.rows.forEach((row: any) => {
      console.log(`  ${row.abbreviation} (${row.team_id}): ${row.points} pts, source: ${row.source}`);
    });
    
    // Check what Pistons team ID should be
    console.log('\n4️⃣ PISTONS TEAM ID LOOKUP');
    console.log('-'.repeat(100));
    const pistonsCheck = await pool.query(`
      SELECT team_id, abbreviation, full_name
      FROM teams
      WHERE abbreviation = 'DET'
    `);
    
    console.log('Pistons team IDs:');
    pistonsCheck.rows.forEach((row: any) => {
      console.log(`  ${row.abbreviation}: ${row.team_id} (${row.full_name})`);
    });
    
    // Now check if the query would find it
    console.log('\n5️⃣ QUERY TEST');
    console.log('-'.repeat(100));
    
    if (pistonsCheck.rows.length > 0) {
      const pistonsTeamId = pistonsCheck.rows[0].team_id;
      console.log(`Using Pistons team ID: ${pistonsTeamId}`);
      
      const queryTest = await pool.query(`
        SELECT 
          btgs.game_id,
          (g.start_time AT TIME ZONE 'America/New_York')::date as game_date,
          TO_CHAR((g.start_time AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') as game_date_str,
          ht.abbreviation as home_team,
          at.abbreviation as away_team,
          btgs.is_home,
          btgs.points
        FROM bbref_team_game_stats btgs
        JOIN games g ON btgs.game_id = g.game_id
        JOIN teams ht ON g.home_team_id = ht.team_id
        JOIN teams at ON g.away_team_id = at.team_id
        WHERE btgs.team_id = $1
          AND btgs.game_id = $2
          AND btgs.source = 'bbref'
          AND EXISTS (
            SELECT 1 FROM bbref_schedule bs 
            WHERE bs.canonical_game_id = btgs.game_id
          )
      `, [pistonsTeamId, gameId]);
      
      console.log(`\nQuery result: ${queryTest.rows.length > 0 ? 'FOUND ✅' : 'NOT FOUND ❌'}`);
      if (queryTest.rows.length > 0) {
        queryTest.rows.forEach((row: any) => {
          console.log(`  Date: ${row.game_date_str}`);
          console.log(`  Matchup: ${row.away_team} @ ${row.home_team}`);
          console.log(`  Is Home: ${row.is_home}`);
          console.log(`  Points: ${row.points}`);
        });
      }
    }
    
    console.log('\n' + '='.repeat(100));
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();






