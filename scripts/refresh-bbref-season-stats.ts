import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

/**
 * Refresh the bbref_team_season_stats materialized view
 * Run this after ETL populates new games into bbref_team_game_stats
 */
async function refreshBBRefSeasonStats() {
  try {
    console.log('Refreshing bbref_team_season_stats materialized view...');
    
    await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY bbref_team_season_stats');
    
    // Get count to verify
    const result = await pool.query('SELECT COUNT(*) as count FROM bbref_team_season_stats');
    console.log(`✅ Materialized view refreshed. Teams with stats: ${result.rows[0].count}`);
    
  } catch (error: any) {
    if (error.message.includes('does not exist')) {
      console.log('⚠️  Materialized view does not exist. Create it first using db/schemas/bbref_team_season_stats.sql');
    } else {
      console.error('❌ Error refreshing materialized view:', error.message);
      throw error;
    }
  } finally {
    await pool.end();
  }
}

refreshBBRefSeasonStats();


