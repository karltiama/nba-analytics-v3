import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  try {
    console.log('\n🔍 Investigating Nov 1 DAL @ DET Result\n');
    console.log('='.repeat(100));
    
    const gameId = '1842025110112';
    
    // Check games table
    console.log('\n1️⃣ GAMES TABLE');
    console.log('-'.repeat(100));
    const gameCheck = await pool.query(`
      SELECT 
        g.game_id,
        g.start_time,
        (g.start_time AT TIME ZONE 'America/New_York')::date as et_date,
        g.status,
        g.home_score,
        g.away_score,
        ht.abbreviation as home_team,
        at.abbreviation as away_team,
        g.home_team_id,
        g.away_team_id
      FROM games g
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      WHERE g.game_id = $1
    `, [gameId]);
    
    if (gameCheck.rows.length > 0) {
      const game = gameCheck.rows[0];
      console.log(`Game ID: ${game.game_id}`);
      console.log(`Date: ${game.et_date}`);
      console.log(`Status: ${game.status}`);
      console.log(`Home Team: ${game.home_team} (${game.home_team_id})`);
      console.log(`Away Team: ${game.away_team} (${game.away_team_id})`);
      console.log(`Home Score: ${game.home_score}`);
      console.log(`Away Score: ${game.away_score}`);
      
      // Calculate expected result
      if (game.home_score !== null && game.away_score !== null) {
        const pistonsTeamId = '9';
        const isPistonsHome = game.home_team_id === pistonsTeamId;
        const pistonsScore = isPistonsHome ? game.home_score : game.away_score;
        const opponentScore = isPistonsHome ? game.away_score : game.home_score;
        const result = pistonsScore > opponentScore ? 'W' : pistonsScore < opponentScore ? 'L' : null;
        
        console.log(`\nExpected Result Calculation:`);
        console.log(`  Pistons is home: ${isPistonsHome}`);
        console.log(`  Pistons score: ${pistonsScore}`);
        console.log(`  Opponent score: ${opponentScore}`);
        console.log(`  Result: ${result}`);
      } else {
        console.log(`\n❌ Scores are NULL - cannot calculate result`);
      }
    } else {
      console.log('❌ Game not found in games table');
    }
    
    // Check bbref_team_game_stats
    console.log('\n2️⃣ BBREF_TEAM_GAME_STATS');
    console.log('-'.repeat(100));
    const teamStatsCheck = await pool.query(`
      SELECT 
        btgs.team_id,
        t.abbreviation,
        btgs.is_home,
        btgs.points,
        btgs.source
      FROM bbref_team_game_stats btgs
      JOIN teams t ON btgs.team_id = t.team_id
      WHERE btgs.game_id = $1
      ORDER BY btgs.is_home DESC
    `, [gameId]);
    
    console.log(`Found ${teamStatsCheck.rows.length} team stat rows:`);
    teamStatsCheck.rows.forEach((row: any) => {
      console.log(`  ${row.abbreviation} (${row.team_id}): ${row.points} pts, Home: ${row.is_home}, Source: ${row.source}`);
    });
    
    // Test the actual query
    console.log('\n3️⃣ TESTING ACTUAL QUERY');
    console.log('-'.repeat(100));
    const queryTest = await pool.query(`
      SELECT 
        btgs.game_id,
        (g.start_time AT TIME ZONE 'America/New_York')::date as game_date,
        TO_CHAR((g.start_time AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') as game_date_str,
        ht.abbreviation as home_team,
        at.abbreviation as away_team,
        btgs.is_home,
        btgs.points,
        g.status,
        g.home_score,
        g.away_score,
        CASE 
          WHEN btgs.is_home AND g.home_score > g.away_score THEN 'W'
          WHEN btgs.is_home AND g.home_score < g.away_score THEN 'L'
          WHEN NOT btgs.is_home AND g.away_score > g.home_score THEN 'W'
          WHEN NOT btgs.is_home AND g.away_score < g.home_score THEN 'L'
          ELSE NULL
        END as result,
        CASE 
          WHEN btgs.is_home THEN g.home_score
          ELSE g.away_score
        END as team_score,
        CASE 
          WHEN btgs.is_home THEN g.away_score
          ELSE g.home_score
        END as opponent_score
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
    `, ['9', gameId]);
    
    console.log(`Query returned ${queryTest.rows.length} row(s):`);
    queryTest.rows.forEach((row: any, i: number) => {
      console.log(`\n  Row ${i + 1}:`);
      console.log(`    Date: ${row.game_date_str}`);
      console.log(`    Matchup: ${row.away_team} @ ${row.home_team}`);
      console.log(`    Is Home: ${row.is_home}`);
      console.log(`    Status: ${row.status}`);
      console.log(`    Home Score: ${row.home_score}`);
      console.log(`    Away Score: ${row.away_score}`);
      console.log(`    Team Score: ${row.team_score}`);
      console.log(`    Opponent Score: ${row.opponent_score}`);
      console.log(`    Result: ${row.result || 'NULL'}`);
      console.log(`    Points: ${row.points}`);
    });
    
    // Check if scores are NULL
    if (queryTest.rows.length > 0 && queryTest.rows[0].home_score === null) {
      console.log('\n❌ ISSUE FOUND: Scores are NULL in games table');
      console.log('   This prevents the result from being calculated.');
      console.log('   Need to update scores from bbref data.');
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




