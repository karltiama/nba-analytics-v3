import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  try {
    console.log('\n🔍 Investigating BBRef Team Game Stats Population Issues\n');
    console.log('='.repeat(100));
    
    // 1. Check how many games are in bbref_schedule
    const scheduleCount = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(canonical_game_id) as with_canonical_id,
        COUNT(*) - COUNT(canonical_game_id) as without_canonical_id
      FROM bbref_schedule
      WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL
    `);
    
    console.log('\n📅 BBREF_SCHEDULE STATUS:');
    console.log('-'.repeat(100));
    console.log(`Total games: ${scheduleCount.rows[0].total}`);
    console.log(`With canonical_game_id: ${scheduleCount.rows[0].with_canonical_id}`);
    console.log(`Without canonical_game_id: ${scheduleCount.rows[0].without_canonical_id}`);
    
    // 2. Check how many games are in bbref_team_game_stats
    const teamStatsCount = await pool.query(`
      SELECT COUNT(DISTINCT game_id) as unique_games
      FROM bbref_team_game_stats
    `);
    
    console.log('\n📊 BBREF_TEAM_GAME_STATS STATUS:');
    console.log('-'.repeat(100));
    console.log(`Unique games: ${teamStatsCount.rows[0].unique_games}`);
    
    // 3. Check how many games in bbref_team_game_stats have matching canonical_game_id in bbref_schedule
    const matchedStats = await pool.query(`
      SELECT COUNT(DISTINCT btgs.game_id) as matched_games
      FROM bbref_team_game_stats btgs
      WHERE EXISTS (
        SELECT 1 FROM bbref_schedule bs 
        WHERE bs.canonical_game_id = btgs.game_id
      )
    `);
    
    console.log(`Games with matching canonical_game_id in schedule: ${matchedStats.rows[0].matched_games}`);
    
    // 4. Find games in bbref_team_game_stats that DON'T have matching canonical_game_id
    const unmatchedStats = await pool.query(`
      SELECT DISTINCT
        btgs.game_id,
        g.start_time::date as game_date,
        ht.abbreviation as home_team,
        at.abbreviation as away_team,
        g.status,
        g.start_time
      FROM bbref_team_game_stats btgs
      JOIN games g ON btgs.game_id = g.game_id
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      WHERE NOT EXISTS (
        SELECT 1 FROM bbref_schedule bs 
        WHERE bs.canonical_game_id = btgs.game_id
      )
      ORDER BY g.start_time DESC
      LIMIT 20
    `);
    
    console.log(`\n❌ Games in bbref_team_game_stats WITHOUT matching canonical_game_id (showing first 20):`);
    console.log('-'.repeat(100));
    if (unmatchedStats.rows.length === 0) {
      console.log('  ✅ All games have matching canonical_game_id');
    } else {
      unmatchedStats.rows.forEach((row: any, idx: number) => {
        console.log(`  ${idx + 1}. ${row.game_date.toISOString().split('T')[0]} - ${row.away_team} @ ${row.home_team}`);
        console.log(`     Game ID: ${row.game_id}`);
        console.log(`     Status: ${row.status}`);
      });
    }
    
    // 5. Find games in bbref_schedule that have canonical_game_id but no stats
    const scheduleWithoutStats = await pool.query(`
      SELECT 
        bs.bbref_game_id,
        bs.game_date,
        bs.home_team_abbr,
        bs.away_team_abbr,
        bs.canonical_game_id,
        CASE WHEN btgs.game_id IS NULL THEN 'NO STATS' ELSE 'HAS STATS' END as stats_status
      FROM bbref_schedule bs
      LEFT JOIN bbref_team_game_stats btgs ON bs.canonical_game_id = btgs.game_id
      WHERE bs.canonical_game_id IS NOT NULL
        AND btgs.game_id IS NULL
      ORDER BY bs.game_date DESC
      LIMIT 20
    `);
    
    console.log(`\n❌ Games in bbref_schedule WITH canonical_game_id but NO team stats (showing first 20):`);
    console.log('-'.repeat(100));
    if (scheduleWithoutStats.rows.length === 0) {
      console.log('  ✅ All games with canonical_game_id have stats');
    } else {
      scheduleWithoutStats.rows.forEach((row: any, idx: number) => {
        console.log(`  ${idx + 1}. ${row.game_date.toISOString().split('T')[0]} - ${row.away_team_abbr} @ ${row.home_team_abbr}`);
        console.log(`     BBRef ID: ${row.bbref_game_id}`);
        console.log(`     Canonical ID: ${row.canonical_game_id}`);
        console.log(`     Status: ${row.stats_status}`);
      });
    }
    
    // 6. Check if games exist in games table for schedule entries
    const scheduleGamesCheck = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(g.game_id) as games_exist,
        COUNT(*) - COUNT(g.game_id) as games_missing
      FROM bbref_schedule bs
      LEFT JOIN games g ON bs.canonical_game_id = g.game_id
      WHERE bs.canonical_game_id IS NOT NULL
    `);
    
    console.log(`\n🎮 GAMES TABLE CHECK:`);
    console.log('-'.repeat(100));
    console.log(`Schedule entries with canonical_game_id: ${scheduleGamesCheck.rows[0].total}`);
    console.log(`Games that exist in games table: ${scheduleGamesCheck.rows[0].games_exist}`);
    console.log(`Games missing from games table: ${scheduleGamesCheck.rows[0].games_missing}`);
    
    // 7. Check player stats to see if they exist for games without team stats
    const playerStatsCheck = await pool.query(`
      SELECT 
        COUNT(DISTINCT game_id) as games_with_player_stats
      FROM bbref_player_game_stats
    `);
    
    console.log(`\n👤 PLAYER STATS CHECK:`);
    console.log('-'.repeat(100));
    console.log(`Games with player stats: ${playerStatsCheck.rows[0].games_with_player_stats}`);
    
    // 8. Find games with player stats but no team stats
    const playerButNoTeam = await pool.query(`
      SELECT DISTINCT
        bpgs.game_id,
        g.start_time::date as game_date,
        ht.abbreviation as home_team,
        at.abbreviation as away_team,
        g.start_time
      FROM bbref_player_game_stats bpgs
      JOIN games g ON bpgs.game_id = g.game_id
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      WHERE NOT EXISTS (
        SELECT 1 FROM bbref_team_game_stats btgs 
        WHERE btgs.game_id = bpgs.game_id
      )
      ORDER BY g.start_time DESC
      LIMIT 20
    `);
    
    console.log(`\n⚠️  Games with PLAYER stats but NO TEAM stats (showing first 20):`);
    console.log('-'.repeat(100));
    if (playerButNoTeam.rows.length === 0) {
      console.log('  ✅ All games with player stats have team stats');
    } else {
      playerButNoTeam.rows.forEach((row: any, idx: number) => {
        console.log(`  ${idx + 1}. ${row.game_date.toISOString().split('T')[0]} - ${row.away_team} @ ${row.home_team}`);
        console.log(`     Game ID: ${row.game_id}`);
      });
    }
    
    // 9. Sample query to see what the UI query would return
    console.log(`\n🎯 UI QUERY TEST (for a sample team):`);
    console.log('-'.repeat(100));
    
    const sampleTeam = await pool.query(`
      SELECT team_id, abbreviation 
      FROM teams 
      WHERE abbreviation IN ('LAL', 'GSW', 'BOS', 'MIA')
      LIMIT 1
    `);
    
    if (sampleTeam.rows.length > 0) {
      const teamId = sampleTeam.rows[0].team_id;
      const teamAbbr = sampleTeam.rows[0].abbreviation;
      
      const uiQueryResult = await pool.query(`
        SELECT 
          btgs.game_id,
          (g.start_time AT TIME ZONE 'America/New_York')::date as game_date,
          TO_CHAR((g.start_time AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') as game_date_str,
          g.start_time,
          ht.abbreviation as home_team,
          at.abbreviation as away_team,
          btgs.is_home,
          btgs.points
        FROM bbref_team_game_stats btgs
        JOIN games g ON btgs.game_id = g.game_id
        JOIN teams ht ON g.home_team_id = ht.team_id
        JOIN teams at ON g.away_team_id = at.team_id
        WHERE btgs.team_id = $1
          AND btgs.source = 'bbref'
          AND EXISTS (
            SELECT 1 FROM bbref_schedule bs 
            WHERE bs.canonical_game_id = btgs.game_id
          )
        ORDER BY g.start_time DESC
        LIMIT 5
      `, [teamId]);
      
      console.log(`\nTeam: ${teamAbbr} (${teamId})`);
      console.log(`Games returned by UI query: ${uiQueryResult.rows.length}`);
      if (uiQueryResult.rows.length > 0) {
        console.log(`Sample games:`);
        uiQueryResult.rows.forEach((row: any, idx: number) => {
          console.log(`  ${idx + 1}. ${row.game_date_str} - ${row.away_team} @ ${row.home_team} (${row.points} pts)`);
        });
      } else {
        console.log(`  ❌ No games returned - this is why the UI shows empty!`);
      }
    }
    
    // Summary and recommendations
    console.log('\n' + '='.repeat(100));
    console.log('📋 SUMMARY & RECOMMENDATIONS');
    console.log('='.repeat(100));
    
    const totalScheduleGames = scheduleCount.rows[0].total;
    const scheduleWithCanonical = scheduleCount.rows[0].with_canonical_id;
    const teamStatsGames = teamStatsCount.rows[0].unique_games;
    const matchedGames = matchedStats.rows[0].matched_games;
    
    console.log(`\n1. Schedule Status:`);
    console.log(`   - Total games in schedule: ${totalScheduleGames}`);
    console.log(`   - Games with canonical_game_id: ${scheduleWithCanonical}`);
    console.log(`   - Games without canonical_game_id: ${totalScheduleGames - scheduleWithCanonical}`);
    
    console.log(`\n2. Team Stats Status:`);
    console.log(`   - Games with team stats: ${teamStatsGames}`);
    console.log(`   - Games that match schedule (will show in UI): ${matchedGames}`);
    console.log(`   - Games that won't show in UI: ${teamStatsGames - matchedGames}`);
    
    console.log(`\n3. Root Cause Analysis:`);
    if (scheduleWithCanonical < totalScheduleGames) {
      console.log(`   ⚠️  ISSUE: ${totalScheduleGames - scheduleWithCanonical} games in schedule don't have canonical_game_id`);
      console.log(`      → These games need to be matched to games in the games table`);
      console.log(`      → Run sync-games-from-bbref-schedule.ts to match them`);
    }
    
    if (matchedGames < teamStatsGames) {
      console.log(`   ⚠️  ISSUE: ${teamStatsGames - matchedGames} games have team stats but no matching canonical_game_id in schedule`);
      console.log(`      → These games won't show in the UI query`);
      console.log(`      → Need to ensure bbref_schedule entries have canonical_game_id set`);
    }
    
    if (scheduleWithoutStats.rows.length > 0) {
      console.log(`   ⚠️  ISSUE: ${scheduleWithoutStats.rows.length} games in schedule have canonical_game_id but no team stats`);
      console.log(`      → These games need team stats populated`);
      console.log(`      → Run populate-bbref-stats.ts --teams-only to populate team stats`);
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

