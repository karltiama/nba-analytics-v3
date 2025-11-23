import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  try {
    console.log('\n🔍 Diagnosing Missing Pistons Game: Nov 1 vs DAL\n');
    console.log('='.repeat(100));
    
    const pistonsTeamId = '1610612765';
    const mavsTeamId = '1610612742'; // Dallas Mavericks
    
    // 1. Check bbref_schedule for this game
    console.log('\n1️⃣ CHECKING BBREF_SCHEDULE');
    console.log('-'.repeat(100));
    
    const scheduleCheck = await pool.query(`
      SELECT 
        bs.bbref_game_id,
        bs.game_date,
        bs.home_team_abbr,
        bs.away_team_abbr,
        bs.home_team_id,
        bs.away_team_id,
        bs.canonical_game_id,
        bs.season
      FROM bbref_schedule bs
      WHERE bs.game_date = '2025-11-01'
        AND (
          (bs.home_team_abbr = 'DET' AND bs.away_team_abbr = 'DAL') OR
          (bs.home_team_abbr = 'DAL' AND bs.away_team_abbr = 'DET')
        )
    `);
    
    console.log(`Found ${scheduleCheck.rows.length} game(s) in bbref_schedule:`);
    scheduleCheck.rows.forEach((row: any, i: number) => {
      console.log(`  ${i + 1}. ${row.away_team_abbr} @ ${row.home_team_abbr}`);
      console.log(`     Date: ${row.game_date}`);
      console.log(`     BBRef ID: ${row.bbref_game_id}`);
      console.log(`     Canonical ID: ${row.canonical_game_id || 'NOT SET'}`);
      console.log(`     Home Team ID: ${row.home_team_id}`);
      console.log(`     Away Team ID: ${row.away_team_id}`);
    });
    
    // 2. Check games table
    console.log('\n2️⃣ CHECKING GAMES TABLE');
    console.log('-'.repeat(100));
    
    const gamesCheck = await pool.query(`
      SELECT 
        g.game_id,
        g.start_time,
        (g.start_time AT TIME ZONE 'America/New_York')::date as et_date,
        ht.abbreviation as home_team,
        at.abbreviation as away_team,
        g.home_team_id,
        g.away_team_id,
        g.status,
        g.home_score,
        g.away_score
      FROM games g
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      WHERE (g.start_time AT TIME ZONE 'America/New_York')::date = '2025-11-01'
        AND (
          (g.home_team_id = $1 AND g.away_team_id = $2) OR
          (g.home_team_id = $2 AND g.away_team_id = $1)
        )
    `, [pistonsTeamId, mavsTeamId]);
    
    console.log(`Found ${gamesCheck.rows.length} game(s) in games table:`);
    gamesCheck.rows.forEach((row: any, i: number) => {
      console.log(`  ${i + 1}. ${row.away_team} @ ${row.home_team}`);
      console.log(`     Game ID: ${row.game_id}`);
      console.log(`     Date: ${row.et_date}`);
      console.log(`     Start Time: ${row.start_time}`);
      console.log(`     Status: ${row.status}`);
      console.log(`     Score: ${row.home_score} - ${row.away_score}`);
    });
    
    // 3. Check bbref_player_game_stats
    if (gamesCheck.rows.length > 0) {
      const gameId = gamesCheck.rows[0].game_id;
      
      console.log('\n3️⃣ CHECKING BBREF_PLAYER_GAME_STATS');
      console.log('-'.repeat(100));
      
      const playerStatsCheck = await pool.query(`
        SELECT 
          COUNT(*) as total_rows,
          COUNT(DISTINCT player_id) as unique_players,
          COUNT(DISTINCT team_id) as unique_teams,
          COUNT(CASE WHEN team_id = $1 THEN 1 END) as pistons_rows,
          COUNT(CASE WHEN team_id = $2 THEN 1 END) as mavs_rows
        FROM bbref_player_game_stats
        WHERE game_id = $3
      `, [pistonsTeamId, mavsTeamId, gameId]);
      
      console.log(`Game ID: ${gameId}`);
      console.log(`  Total rows: ${playerStatsCheck.rows[0].total_rows}`);
      console.log(`  Unique players: ${playerStatsCheck.rows[0].unique_players}`);
      console.log(`  Unique teams: ${playerStatsCheck.rows[0].unique_teams}`);
      console.log(`  Pistons rows: ${playerStatsCheck.rows[0].pistons_rows}`);
      console.log(`  Mavs rows: ${playerStatsCheck.rows[0].mavs_rows}`);
      
      // 4. Check bbref_team_game_stats
      console.log('\n4️⃣ CHECKING BBREF_TEAM_GAME_STATS');
      console.log('-'.repeat(100));
      
      const teamStatsCheck = await pool.query(`
        SELECT 
          btgs.*,
          ht.abbreviation as home_team,
          at.abbreviation as away_team
        FROM bbref_team_game_stats btgs
        JOIN games g ON btgs.game_id = g.game_id
        JOIN teams ht ON g.home_team_id = ht.team_id
        JOIN teams at ON g.away_team_id = at.team_id
        WHERE btgs.game_id = $1
      `, [gameId]);
      
      console.log(`Found ${teamStatsCheck.rows.length} team stat row(s):`);
      teamStatsCheck.rows.forEach((row: any, i: number) => {
        console.log(`  ${i + 1}. Team: ${row.team_id === pistonsTeamId ? 'Pistons' : 'Mavs'}`);
        console.log(`     Points: ${row.points}`);
        console.log(`     Source: ${row.source}`);
        console.log(`     Is Home: ${row.is_home}`);
      });
      
      // 5. Check if it would show up in the query
      console.log('\n5️⃣ CHECKING QUERY FILTERS');
      console.log('-'.repeat(100));
      
      const queryCheck = await pool.query(`
        SELECT 
          btgs.game_id,
          (g.start_time AT TIME ZONE 'America/New_York')::date as game_date,
          TO_CHAR((g.start_time AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') as game_date_str,
          ht.abbreviation as home_team,
          at.abbreviation as away_team,
          btgs.team_id,
          btgs.source,
          CASE 
            WHEN EXISTS (
              SELECT 1 FROM bbref_schedule bs 
              WHERE bs.canonical_game_id = btgs.game_id
            ) THEN 'YES' ELSE 'NO' END as in_schedule
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
      
      console.log(`Would show in query: ${queryCheck.rows.length > 0 ? 'YES ✅' : 'NO ❌'}`);
      if (queryCheck.rows.length > 0) {
        queryCheck.rows.forEach((row: any) => {
          console.log(`  Game Date: ${row.game_date_str}`);
          console.log(`  Matchup: ${row.away_team} @ ${row.home_team}`);
        });
      } else {
        console.log('\n  Checking why it failed:');
        
        // Check source
        const sourceCheck = await pool.query(`
          SELECT source FROM bbref_team_game_stats WHERE game_id = $1 AND team_id = $2
        `, [gameId, pistonsTeamId]);
        console.log(`  Source check: ${sourceCheck.rows.length > 0 ? sourceCheck.rows[0].source : 'NO ROW'}`);
        
        // Check schedule link
        const scheduleLinkCheck = await pool.query(`
          SELECT canonical_game_id FROM bbref_schedule WHERE canonical_game_id = $1
        `, [gameId]);
        console.log(`  Schedule link: ${scheduleLinkCheck.rows.length > 0 ? 'EXISTS' : 'MISSING'}`);
      }
    }
    
    // 6. Check all Pistons games around Nov 1
    console.log('\n6️⃣ ALL PISTONS GAMES AROUND NOV 1');
    console.log('-'.repeat(100));
    
    const allPistonsGames = await pool.query(`
      SELECT 
        btgs.game_id,
        (g.start_time AT TIME ZONE 'America/New_York')::date as game_date,
        TO_CHAR((g.start_time AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') as game_date_str,
        ht.abbreviation as home_team,
        at.abbreviation as away_team,
        btgs.source,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM bbref_schedule bs 
            WHERE bs.canonical_game_id = btgs.game_id
          ) THEN 'YES' ELSE 'NO' END as in_schedule
      FROM bbref_team_game_stats btgs
      JOIN games g ON btgs.game_id = g.game_id
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      WHERE btgs.team_id = $1
        AND (g.start_time AT TIME ZONE 'America/New_York')::date BETWEEN '2025-10-30' AND '2025-11-05'
      ORDER BY g.start_time
    `, [pistonsTeamId]);
    
    console.log(`Found ${allPistonsGames.rows.length} Pistons games Oct 30 - Nov 5:`);
    allPistonsGames.rows.forEach((row: any, i: number) => {
      const highlight = row.game_date_str === '2025-11-01' ? ' ⭐' : '';
      console.log(`  ${i + 1}. ${row.game_date_str} - ${row.away_team} @ ${row.home_team}${highlight}`);
      console.log(`     Game ID: ${row.game_id}`);
      console.log(`     Source: ${row.source}`);
      console.log(`     In Schedule: ${row.in_schedule}`);
    });
    
    console.log('\n' + '='.repeat(100));
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();




