import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

/**
 * Cross-reference bbref_schedule with bbref_team_game_stats
 * Match by date + teams (not game_id since formats differ)
 */
async function analyzeAlignment() {
  console.log('\n🔍 Cross-Referencing BBRef Schedule vs BBRef Team Game Stats\n');
  console.log('='.repeat(100));
  
  // Get all games from bbref_schedule with team IDs
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
    WHERE bs.home_team_id IS NOT NULL 
      AND bs.away_team_id IS NOT NULL
    ORDER BY bs.game_date DESC
  `);
  
  console.log(`\n📅 BBREF_SCHEDULE: ${scheduleGames.rows.length} games\n`);
  
  // Get all unique games from bbref_team_game_stats
  const bbrefGames = await pool.query(`
    SELECT DISTINCT
      btgs.game_id,
      g.start_time::date as game_date,
      ht.abbreviation as home_team_abbr,
      at.abbreviation as away_team_abbr,
      g.home_team_id,
      g.away_team_id,
      g.status
    FROM bbref_team_game_stats btgs
    JOIN games g ON btgs.game_id = g.game_id
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    ORDER BY g.start_time::date DESC
  `);
  
  console.log(`📊 BBREF_TEAM_GAME_STATS: ${bbrefGames.rows.length} unique games\n`);
  
  // Match games by date + teams
  console.log('🔍 MATCHING ANALYSIS');
  console.log('-'.repeat(100));
  
  let matched = 0;
  let unmatched = 0;
  const unmatchedGames: any[] = [];
  
  for (const scheduleGame of scheduleGames.rows) {
    const scheduleDate = scheduleGame.game_date.toISOString().split('T')[0];
    
    const found = bbrefGames.rows.find((bg: any) => {
      const bgDate = bg.game_date.toISOString().split('T')[0];
      const dateMatch = bgDate === scheduleDate;
      
      const teamsMatch = 
        (bg.home_team_id === scheduleGame.home_team_id && bg.away_team_id === scheduleGame.away_team_id) ||
        (bg.home_team_id === scheduleGame.away_team_id && bg.away_team_id === scheduleGame.home_team_id);
      
      return dateMatch && teamsMatch;
    });
    
    if (found) {
      matched++;
    } else {
      unmatched++;
      if (unmatchedGames.length < 20) {
        unmatchedGames.push(scheduleGame);
      }
    }
  }
  
  console.log(`✅ Matched: ${matched} games`);
  console.log(`❌ Unmatched: ${unmatched} games`);
  
  if (unmatchedGames.length > 0) {
    console.log('\n📋 Sample Unmatched Games (first 20):');
    unmatchedGames.forEach((g: any, i: number) => {
      console.log(`  ${i + 1}. ${g.game_date.toISOString().split('T')[0]} - ${g.away_team_abbr} @ ${g.home_team_abbr}`);
      console.log(`     BBRef ID: ${g.bbref_game_id}`);
      console.log(`     Canonical ID: ${g.canonical_game_id || 'NOT SET'}`);
    });
  }
  
  // Check for games in stats but not in schedule (by date + teams)
  console.log('\n🔍 GAMES IN STATS BUT NOT IN SCHEDULE');
  console.log('-'.repeat(100));
  
  let extraInStats = 0;
  const extraGames: any[] = [];
  
  for (const bbrefGame of bbrefGames.rows) {
    const bgDate = bbrefGame.game_date.toISOString().split('T')[0];
    
    const found = scheduleGames.rows.find((sg: any) => {
      const sgDate = sg.game_date.toISOString().split('T')[0];
      const dateMatch = sgDate === bgDate;
      
      const teamsMatch = 
        (sg.home_team_id === bbrefGame.home_team_id && sg.away_team_id === bbrefGame.away_team_id) ||
        (sg.home_team_id === bbrefGame.away_team_id && sg.away_team_id === bbrefGame.home_team_id);
      
      return dateMatch && teamsMatch;
    });
    
    if (!found) {
      extraInStats++;
      if (extraGames.length < 20) {
        extraGames.push(bbrefGame);
      }
    }
  }
  
  console.log(`Extra games in stats: ${extraInStats}`);
  
  if (extraGames.length > 0) {
    console.log('\n📋 Sample Extra Games (first 20):');
    extraGames.forEach((g: any, i: number) => {
      console.log(`  ${i + 1}. ${g.game_date.toISOString().split('T')[0]} - ${g.away_team_abbr} @ ${g.home_team_abbr}`);
      console.log(`     Game ID: ${g.game_id}`);
      console.log(`     Status: ${g.status}`);
    });
  }
  
  // Summary
  console.log('\n' + '='.repeat(100));
  console.log('📊 SUMMARY');
  console.log('='.repeat(100));
  console.log(`Schedule Games: ${scheduleGames.rows.length}`);
  console.log(`Stats Games: ${bbrefGames.rows.length}`);
  console.log(`Matched: ${matched}`);
  console.log(`Unmatched in Schedule: ${unmatched}`);
  console.log(`Extra in Stats: ${extraInStats}`);
  console.log('='.repeat(100));
  
  return { matched, unmatched, extraInStats };
}

async function main() {
  try {
    await analyzeAlignment();
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();

