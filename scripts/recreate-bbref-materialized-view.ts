import 'dotenv/config';
import { Pool } from 'pg';
import { readFileSync } from 'fs';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  try {
    console.log('🔄 Recreating bbref_team_season_stats materialized view...\n');
    
    // Drop old view
    console.log('1. Dropping old materialized view...');
    await pool.query('DROP MATERIALIZED VIEW IF EXISTS bbref_team_season_stats');
    console.log('   ✅ Dropped');
    
    // Read and execute schema
    console.log('\n2. Creating new materialized view (without status filter)...');
    const sql = readFileSync('db/schemas/bbref_team_season_stats.sql', 'utf8');
    await pool.query(sql);
    console.log('   ✅ Created');
    
    // Refresh
    console.log('\n3. Refreshing materialized view...');
    await pool.query('REFRESH MATERIALIZED VIEW bbref_team_season_stats');
    console.log('   ✅ Refreshed');
    
    // Verify Detroit stats
    console.log('\n4. Verifying Detroit stats...');
    const det = await pool.query(
      `SELECT team_id FROM teams WHERE abbreviation = 'DET' LIMIT 1`
    );
    
    if (det.rows.length > 0) {
      const stats = await pool.query(
        `SELECT games_played, avg_points, total_points, wins, losses
         FROM bbref_team_season_stats 
         WHERE team_id = $1`,
        [det.rows[0].team_id]
      );
      
      if (stats.rows.length > 0) {
        const s = stats.rows[0];
        console.log(`   ✅ Detroit Pistons:`);
        console.log(`      Games: ${s.games_played}`);
        console.log(`      Avg Points: ${Number(s.avg_points).toFixed(1)}`);
        console.log(`      Total Points: ${s.total_points}`);
        console.log(`      Record: ${s.wins}-${s.losses}`);
      } else {
        console.log('   ⚠️  No stats found for Detroit');
      }
    }
    
    // Count total teams
    const total = await pool.query('SELECT COUNT(*) as count FROM bbref_team_season_stats');
    console.log(`\n✅ Materialized view ready! Total teams: ${total.rows[0].count}`);
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

