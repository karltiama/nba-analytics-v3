import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  try {
    console.log('\n🔍 Checking BBRef Team ID Format\n');
    console.log('='.repeat(100));
    
    // Check bbref_schedule team IDs
    const scheduleCheck = await pool.query(`
      SELECT DISTINCT
        bs.home_team_abbr,
        bs.home_team_id,
        bs.away_team_abbr,
        bs.away_team_id
      FROM bbref_schedule bs
      WHERE bs.home_team_id IS NOT NULL
      ORDER BY bs.home_team_abbr
      LIMIT 10
    `);
    
    console.log('\n📋 BBRef Schedule Team IDs:');
    scheduleCheck.rows.forEach((row: any) => {
      console.log(`  ${row.home_team_abbr}: ${row.home_team_id}`);
      console.log(`  ${row.away_team_abbr}: ${row.away_team_id}`);
    });
    
    // Check what team IDs are in bbref_team_game_stats
    const statsCheck = await pool.query(`
      SELECT DISTINCT
        btgs.team_id,
        t.abbreviation,
        COUNT(*) as game_count
      FROM bbref_team_game_stats btgs
      JOIN teams t ON btgs.team_id = t.team_id
      GROUP BY btgs.team_id, t.abbreviation
      ORDER BY t.abbreviation
      LIMIT 10
    `);
    
    console.log('\n📊 BBRef Team Game Stats Team IDs:');
    statsCheck.rows.forEach((row: any) => {
      console.log(`  ${row.abbreviation}: ${row.team_id} (${row.game_count} games)`);
    });
    
    // Check if bbref_schedule team IDs match bbref_team_game_stats team IDs
    console.log('\n🔗 Checking ID Consistency:');
    console.log('-'.repeat(100));
    
    const mismatchCheck = await pool.query(`
      SELECT DISTINCT
        bs.home_team_id as schedule_team_id,
        btgs.team_id as stats_team_id,
        COUNT(*) as count
      FROM bbref_schedule bs
      JOIN games g ON bs.canonical_game_id = g.game_id
      JOIN bbref_team_game_stats btgs ON g.game_id = btgs.game_id
      WHERE bs.home_team_id IS NOT NULL
        AND bs.home_team_id != btgs.team_id
      GROUP BY bs.home_team_id, btgs.team_id
      LIMIT 10
    `);
    
    if (mismatchCheck.rows.length > 0) {
      console.log('❌ Found mismatches:');
      mismatchCheck.rows.forEach((row: any) => {
        console.log(`  Schedule: ${row.schedule_team_id} vs Stats: ${row.stats_team_id} (${row.count} games)`);
      });
    } else {
      console.log('✅ Team IDs match between schedule and stats');
    }
    
    // Check Nov 1 DAL @ DET specifically
    console.log('\n🎯 Nov 1 DAL @ DET:');
    console.log('-'.repeat(100));
    const nov1Check = await pool.query(`
      SELECT 
        bs.home_team_id,
        bs.away_team_id,
        bs.home_team_abbr,
        bs.away_team_abbr,
        btgs.team_id as stats_team_id
      FROM bbref_schedule bs
      JOIN games g ON bs.canonical_game_id = g.game_id
      LEFT JOIN bbref_team_game_stats btgs ON g.game_id = btgs.game_id
      WHERE bs.game_date = '2025-11-01'
        AND bs.home_team_abbr = 'DET'
        AND bs.away_team_abbr = 'DAL'
      LIMIT 1
    `);
    
    if (nov1Check.rows.length > 0) {
      const row = nov1Check.rows[0];
      console.log(`Schedule Home Team ID: ${row.home_team_id}`);
      console.log(`Schedule Away Team ID: ${row.away_team_id}`);
      console.log(`Stats Team ID: ${row.stats_team_id || 'N/A'}`);
    }
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();






