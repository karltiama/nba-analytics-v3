import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Manual Player Resolution
 * 
 * Manually resolves specific players that we know exist but can't be auto-matched
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

// Manual mappings: scraped_name -> player_id
const manualMappings: Array<{ scrapedName: string; teamCode: string; playerId: string; dbName: string }> = [
  { scrapedName: 'Ron Holland', teamCode: 'DET', playerId: '1641842', dbName: 'Ronald Holland II' },
  { scrapedName: 'Egor Demin', teamCode: 'BRK', playerId: '1642856', dbName: 'Egor Dëmin' },
  { scrapedName: 'Pacome Dadiet', teamCode: 'NYK', playerId: '1642359', dbName: 'Pacôme Dadiet' },
  { scrapedName: 'Yanic Konan Niederhauser', teamCode: 'LAC', playerId: '1642949', dbName: 'Yanic Konan Niederhäuser' },
];

async function main() {
  console.log('🔧 Manually resolving players...\n');
  
  let totalUpdated = 0;
  
  for (const { scrapedName, teamCode, playerId, dbName } of manualMappings) {
    // Verify player exists
    const playerCheck = await pool.query(`
      SELECT player_id, full_name FROM players WHERE player_id = $1
    `, [playerId]);
    
    if (playerCheck.rows.length === 0) {
      console.log(`⚠️  Player ${playerId} (${dbName}) not found in database`);
      continue;
    }
    
    console.log(`Resolving: "${scrapedName}" (${teamCode}) → ${dbName} (${playerId})`);
    
    // Update all records
    const result = await pool.query(`
      UPDATE scraped_boxscores
      SET player_id = $1, updated_at = NOW()
      WHERE player_name = $2
        AND team_code = $3
        AND player_id IS NULL
      RETURNING id
    `, [playerId, scrapedName, teamCode]);
    
    const updated = result.rowCount || 0;
    totalUpdated += updated;
    console.log(`  ✅ Updated ${updated} records\n`);
  }
  
  console.log(`\n📊 Total records updated: ${totalUpdated}`);
  await pool.end();
}

main().catch(console.error);

