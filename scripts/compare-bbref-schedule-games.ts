import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  try {
    console.log('\n🔍 Cross-Referencing BBRef Schedule vs BBRef Team Game Stats\n');
    console.log('='.repeat(100));
    
    // Get all games from bbref_schedule
    const scheduleGames = await pool.query(`
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
      WHERE bs.home_team_id IS NOT NULL AND bs.away_team_id IS NOT NULL
      ORDER BY bs.game_date DESC, bs.home_team_abbr, bs.away_team_abbr
    `);
    
    console.log(`\n📅 BBREF_SCHEDULE: ${scheduleGames.rows.length} games total\n`);
    
    // Get all games from bbref_team_game_stats
    const bbrefTeamStats = await pool.query(`
      SELECT DISTINCT
        btgs.game_id,
        g.start_time::date as game_date,
        ht.abbreviation as home_team_abbr,
        at.abbreviation as away_team_abbr,
        btgs.team_id,
        g.status
      FROM bbref_team_game_stats btgs
      JOIN games g ON btgs.game_id = g.game_id
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      ORDER BY g.start_time::date DESC, ht.abbreviation, at.abbreviation
    `);
    
    console.log(`📊 BBREF_TEAM_GAME_STATS: ${bbrefTeamStats.rows.length} team-game rows (${new Set(bbrefTeamStats.rows.map((r: any) => r.game_id)).size} unique games)\n`);
    
    // Create a map of unique games from bbref_team_game_stats
    const bbrefGamesMap = new Map<string, any>();
    for (const stat of bbrefTeamStats.rows) {
      const key = `${stat.game_date.toISOString().split('T')[0]}_${stat.home_team_abbr}_${stat.away_team_abbr}`;
      if (!bbrefGamesMap.has(key)) {
        bbrefGamesMap.set(key, stat);
      }
    }
    
    // Find games in schedule but not in bbref_team_game_stats
    console.log('🔍 MISSING GAMES (in bbref_schedule but NOT in bbref_team_game_stats):');
    console.log('-'.repeat(100));
    
    let missingCount = 0;
    const missingGames: any[] = [];
    
    for (const scheduleGame of scheduleGames.rows) {
      const scheduleDate = scheduleGame.game_date.toISOString().split('T')[0];
      const key1 = `${scheduleDate}_${scheduleGame.home_team_abbr}_${scheduleGame.away_team_abbr}`;
      const key2 = `${scheduleDate}_${scheduleGame.away_team_abbr}_${scheduleGame.home_team_abbr}`;
      
      const found = bbrefGamesMap.has(key1) || bbrefGamesMap.has(key2);
      
      if (!found) {
        missingCount++;
        missingGames.push(scheduleGame);
        console.log(`  ${missingCount}. ${scheduleDate} - ${scheduleGame.away_team_abbr} @ ${scheduleGame.home_team_abbr}`);
        console.log(`     BBRef ID: ${scheduleGame.bbref_game_id}`);
        console.log(`     Canonical Game ID: ${scheduleGame.canonical_game_id || 'NOT SET'}`);
        console.log(`     Season: ${scheduleGame.season || 'N/A'}`);
      }
    }
    
    if (missingCount === 0) {
      console.log('  ✅ No missing games found');
    }
    
    // Find games in bbref_team_game_stats but not in schedule
    console.log('\n🔍 EXTRA GAMES (in bbref_team_game_stats but NOT in bbref_schedule):');
    console.log('-'.repeat(100));
    
    let extraCount = 0;
    for (const [key, stat] of bbrefGamesMap.entries()) {
      const [date, home, away] = key.split('_');
      const found = scheduleGames.rows.find((s: any) => {
        const sDate = s.game_date.toISOString().split('T')[0];
        return sDate === date && (
          (s.home_team_abbr === home && s.away_team_abbr === away) ||
          (s.home_team_abbr === away && s.away_team_abbr === home)
        );
      });
      
      if (!found) {
        extraCount++;
        console.log(`  ${extraCount}. ${date} - ${stat.away_team_abbr} @ ${stat.home_team_abbr}`);
        console.log(`     Game ID: ${stat.game_id}`);
        console.log(`     Status: ${stat.status}`);
      }
    }
    
    if (extraCount === 0) {
      console.log('  ✅ No extra games found');
    }
    
    // Check for date mismatches (same teams, different dates)
    console.log('\n🔍 DATE MISMATCHES (same teams, different dates):');
    console.log('-'.repeat(100));
    
    let mismatchCount = 0;
    for (const scheduleGame of scheduleGames.rows) {
      const scheduleDate = scheduleGame.game_date.toISOString().split('T')[0];
      const key1 = `${scheduleDate}_${scheduleGame.home_team_abbr}_${scheduleGame.away_team_abbr}`;
      const key2 = `${scheduleDate}_${scheduleGame.away_team_abbr}_${scheduleGame.home_team_abbr}`;
      
      // Check if teams match but date doesn't
      for (const [key, stat] of bbrefGamesMap.entries()) {
        const [statDate, statHome, statAway] = key.split('_');
        const teamsMatch = 
          (statHome === scheduleGame.home_team_abbr && statAway === scheduleGame.away_team_abbr) ||
          (statHome === scheduleGame.away_team_abbr && statAway === scheduleGame.home_team_abbr);
        
        if (teamsMatch && statDate !== scheduleDate) {
          mismatchCount++;
          console.log(`  ${mismatchCount}. Teams: ${scheduleGame.away_team_abbr} @ ${scheduleGame.home_team_abbr}`);
          console.log(`     Schedule Date: ${scheduleDate}`);
          console.log(`     BBRef Stats Date: ${statDate}`);
          console.log(`     Game ID: ${stat.game_id}`);
          break;
        }
      }
    }
    
    if (mismatchCount === 0) {
      console.log('  ✅ No date mismatches found');
    }
    
    // Check for team count mismatches per date
    console.log('\n🔍 GAME COUNT PER DATE:');
    console.log('-'.repeat(100));
    
    const scheduleDateGroups = new Map<string, any[]>();
    for (const scheduleGame of scheduleGames.rows) {
      const dateKey = scheduleGame.game_date.toISOString().split('T')[0];
      if (!scheduleDateGroups.has(dateKey)) {
        scheduleDateGroups.set(dateKey, []);
      }
      scheduleDateGroups.get(dateKey)!.push(scheduleGame);
    }
    
    const bbrefDateGroups = new Map<string, Set<string>>();
    for (const stat of bbrefTeamStats.rows) {
      const dateKey = stat.game_date.toISOString().split('T')[0];
      if (!bbrefDateGroups.has(dateKey)) {
        bbrefDateGroups.set(dateKey, new Set());
      }
      bbrefDateGroups.get(dateKey)!.add(stat.game_id);
    }
    
    let dateMismatchCount = 0;
    const allDates = new Set([...scheduleDateGroups.keys(), ...bbrefDateGroups.keys()]);
    
    for (const date of Array.from(allDates).sort().reverse().slice(0, 10)) {
      const scheduleCount = scheduleDateGroups.get(date)?.length || 0;
      const bbrefCount = bbrefDateGroups.get(date)?.size || 0;
      
      if (scheduleCount !== bbrefCount) {
        dateMismatchCount++;
        console.log(`  Date: ${date}`);
        console.log(`    Schedule: ${scheduleCount} games`);
        console.log(`    BBRef Stats: ${bbrefCount} games`);
        console.log(`    Difference: ${scheduleCount - bbrefCount}`);
        
        if (scheduleCount > bbrefCount) {
          const scheduleGamesForDate = scheduleDateGroups.get(date) || [];
          const bbrefGamesForDate = Array.from(bbrefDateGroups.get(date) || []);
          
          for (const sGame of scheduleGamesForDate) {
            const found = bbrefTeamStats.rows.find((b: any) => {
              const bDate = b.game_date.toISOString().split('T')[0];
              return bDate === date && (
                (b.home_team_abbr === sGame.home_team_abbr && b.away_team_abbr === sGame.away_team_abbr) ||
                (b.home_team_abbr === sGame.away_team_abbr && b.away_team_abbr === sGame.home_team_abbr)
              );
            });
            
            if (!found) {
              console.log(`      Missing: ${sGame.away_team_abbr} @ ${sGame.home_team_abbr} (${sGame.bbref_game_id})`);
            }
          }
        }
        console.log('');
      }
    }
    
    if (dateMismatchCount === 0) {
      console.log('  ✅ All dates match');
    }
    
    // Summary
    console.log('\n' + '='.repeat(100));
    console.log('📊 SUMMARY');
    console.log('='.repeat(100));
    console.log(`BBRef Schedule Games: ${scheduleGames.rows.length}`);
    console.log(`BBRef Team Game Stats Games: ${new Set(bbrefTeamStats.rows.map((r: any) => r.game_id)).size}`);
    console.log(`Missing Games (in schedule, not in stats): ${missingCount}`);
    console.log(`Extra Games (in stats, not in schedule): ${extraCount}`);
    console.log(`Date Mismatches: ${mismatchCount}`);
    console.log(`Date Count Mismatches: ${dateMismatchCount}`);
    console.log('='.repeat(100));
    
    if (missingCount > 0) {
      console.log('\n💡 To fix missing games, you may need to:');
      console.log('   1. Run populate-bbref-stats.ts to populate team stats from player stats');
      console.log('   2. Check if games exist in bbref_player_game_stats');
      console.log('   3. Verify game_ids match between schedule and stats tables');
    }
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();

