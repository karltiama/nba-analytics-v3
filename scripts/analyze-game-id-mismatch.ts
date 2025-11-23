import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  try {
    console.log('\n🔍 Analyzing Game ID Mismatches\n');
    console.log('='.repeat(100));
    
    // Check how game_ids are structured in both tables
    console.log('\n1️⃣ GAME ID FORMATS');
    console.log('-'.repeat(100));
    
    const scheduleIds = await pool.query(`
      SELECT DISTINCT 
        SUBSTRING(bbref_game_id FROM 1 FOR 20) as id_prefix,
        COUNT(*) as count
      FROM bbref_schedule
      GROUP BY id_prefix
      ORDER BY count DESC
      LIMIT 10
    `);
    
    console.log('\nBBRef Schedule ID formats:');
    scheduleIds.rows.forEach((r: any) => {
      console.log(`  ${r.id_prefix}... : ${r.count} games`);
    });
    
    const statsIds = await pool.query(`
      SELECT DISTINCT 
        CASE 
          WHEN game_id LIKE 'bbref_%' THEN 'bbref_*'
          WHEN game_id LIKE '002%' THEN '002*'
          WHEN game_id LIKE '184%' THEN '184*'
          ELSE 'other'
        END as id_format,
        COUNT(*) as count
      FROM bbref_team_game_stats
      GROUP BY id_format
      ORDER BY count DESC
    `);
    
    console.log('\nBBRef Team Stats ID formats:');
    statsIds.rows.forEach((r: any) => {
      console.log(`  ${r.id_format} : ${r.count} games`);
    });
    
    // Check canonical_game_id linking
    console.log('\n2️⃣ CANONICAL GAME ID LINKING');
    console.log('-'.repeat(100));
    
    const linked = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(canonical_game_id) as linked,
        COUNT(*) - COUNT(canonical_game_id) as unlinked
      FROM bbref_schedule
    `);
    
    console.log(`Total schedule entries: ${linked.rows[0].total}`);
    console.log(`Linked to games table: ${linked.rows[0].linked}`);
    console.log(`Not linked: ${linked.rows[0].unlinked}`);
    
    // Sample of unlinked games
    const unlinkedSample = await pool.query(`
      SELECT 
        bbref_game_id,
        game_date,
        away_team_abbr,
        home_team_abbr,
        canonical_game_id
      FROM bbref_schedule
      WHERE canonical_game_id IS NULL
      ORDER BY game_date DESC
      LIMIT 10
    `);
    
    if (unlinkedSample.rows.length > 0) {
      console.log('\nSample unlinked games:');
      unlinkedSample.rows.forEach((g: any, i: number) => {
        console.log(`  ${i + 1}. ${g.game_date} - ${g.away_team_abbr} @ ${g.home_team_abbr} (${g.bbref_game_id})`);
      });
    }
    
    // Check date mismatches for specific teams
    console.log('\n3️⃣ DATE MISMATCHES - Sample Analysis');
    console.log('-'.repeat(100));
    
    // Pick a specific team matchup that has mismatches
    const mismatchSample = await pool.query(`
      SELECT 
        bs.bbref_game_id,
        bs.game_date as schedule_date,
        bs.away_team_abbr,
        bs.home_team_abbr,
        bs.canonical_game_id,
        g.start_time::date as game_date,
        g.game_id
      FROM bbref_schedule bs
      LEFT JOIN games g ON bs.canonical_game_id = g.game_id
      WHERE bs.canonical_game_id IS NOT NULL
        AND g.start_time::date != bs.game_date
      ORDER BY bs.game_date DESC
      LIMIT 10
    `);
    
    if (mismatchSample.rows.length > 0) {
      console.log('\nGames with date mismatches:');
      mismatchSample.rows.forEach((g: any, i: number) => {
        console.log(`  ${i + 1}. ${g.away_team_abbr} @ ${g.home_team_abbr}`);
        console.log(`     Schedule Date: ${g.schedule_date}`);
        console.log(`     Game Date: ${g.game_date}`);
        console.log(`     BBRef ID: ${g.bbref_game_id}`);
        console.log(`     Game ID: ${g.game_id}`);
        console.log('');
      });
    }
    
    // Check if games exist in bbref_player_game_stats but not in bbref_team_game_stats
    console.log('\n4️⃣ MISSING TEAM STATS');
    console.log('-'.repeat(100));
    
    const missingTeamStats = await pool.query(`
      SELECT 
        COUNT(DISTINCT bpgs.game_id) as games_with_player_stats,
        COUNT(DISTINCT btgs.game_id) as games_with_team_stats
      FROM bbref_player_game_stats bpgs
      LEFT JOIN bbref_team_game_stats btgs ON bpgs.game_id = btgs.game_id
    `);
    
    console.log(`Games with player stats: ${missingTeamStats.rows[0].games_with_player_stats}`);
    console.log(`Games with team stats: ${missingTeamStats.rows[0].games_with_team_stats}`);
    console.log(`Missing team stats: ${missingTeamStats.rows[0].games_with_player_stats - missingTeamStats.rows[0].games_with_team_stats}`);
    
    const sampleMissing = await pool.query(`
      SELECT DISTINCT bpgs.game_id, g.start_time::date as game_date
      FROM bbref_player_game_stats bpgs
      JOIN games g ON bpgs.game_id = g.game_id
      WHERE NOT EXISTS (
        SELECT 1 FROM bbref_team_game_stats btgs 
        WHERE btgs.game_id = bpgs.game_id
      )
      ORDER BY g.start_time::date DESC
      LIMIT 10
    `);
    
    if (sampleMissing.rows.length > 0) {
      console.log('\nSample games with player stats but no team stats:');
      sampleMissing.rows.forEach((g: any, i: number) => {
        console.log(`  ${i + 1}. ${g.game_date} - Game ID: ${g.game_id}`);
      });
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

