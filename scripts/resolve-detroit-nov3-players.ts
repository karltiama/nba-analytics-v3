import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function resolveDetroitNov3Players() {
  console.log('\n🔧 Resolving Detroit Nov 3 Missing Players\n');
  
  const gameId = 'bbref_202511030000_DET_MEM';
  
  // Manual mappings based on known issues
  const manualMappings = [
    { 
      scrapedName: 'Ron Holland', 
      teamCode: 'DET', 
      playerId: '1641842', 
      dbName: 'Ronald Holland II' 
    },
    { 
      scrapedName: 'Charles Bassey', 
      teamCode: 'MEM', 
      playerId: '1629646',  // Verified: Charles Bassey
      dbName: 'Charles Bassey' 
    }
  ];
  
  // First, verify these player IDs exist
  console.log('📋 Verifying player IDs...\n');
  for (const mapping of manualMappings) {
    const playerCheck = await pool.query(`
      SELECT player_id, full_name, first_name, last_name
      FROM players
      WHERE player_id = $1
    `, [mapping.playerId]);
    
    if (playerCheck.rows.length > 0) {
      const player = playerCheck.rows[0];
      console.log(`✅ ${mapping.scrapedName} -> ${player.full_name} (${mapping.playerId})`);
    } else {
      console.log(`❌ Player ID ${mapping.playerId} not found for ${mapping.scrapedName}`);
    }
  }
  
  // Now update scraped_boxscores
  console.log('\n📝 Updating scraped_boxscores...\n');
  
  for (const mapping of manualMappings) {
    const result = await pool.query(`
      UPDATE scraped_boxscores
      SET player_id = $1,
          updated_at = now()
      WHERE game_id = $2
        AND team_code = $3
        AND player_name = $4
        AND source = 'bbref_csv'
        AND (player_id IS NULL OR player_id != $1)
    `, [mapping.playerId, gameId, mapping.teamCode, mapping.scrapedName]);
    
    if (result.rowCount && result.rowCount > 0) {
      console.log(`✅ Updated ${mapping.scrapedName} (${mapping.teamCode}): ${result.rowCount} row(s)`);
    } else {
      // Check if it already exists
      const existing = await pool.query(`
        SELECT player_id FROM scraped_boxscores
        WHERE game_id = $1 AND team_code = $2 AND player_name = $3 AND source = 'bbref_csv'
      `, [gameId, mapping.teamCode, mapping.scrapedName]);
      
      if (existing.rows.length > 0) {
        console.log(`ℹ️  ${mapping.scrapedName} (${mapping.teamCode}): Already has player_id ${existing.rows[0].player_id}`);
      } else {
        console.log(`⚠️  ${mapping.scrapedName} (${mapping.teamCode}): Not found in scraped_boxscores`);
      }
    }
  }
  
  // Verify the updates
  console.log('\n📊 Verifying updates...\n');
  const unresolved = await pool.query(`
    SELECT player_name, team_code, player_id, points
    FROM scraped_boxscores
    WHERE game_id = $1
      AND source = 'bbref_csv'
      AND player_id IS NULL
      AND dnp_reason IS NULL
    ORDER BY team_code, player_name
  `, [gameId]);
  
  if (unresolved.rows.length > 0) {
    console.log(`⚠️  Still ${unresolved.rows.length} unresolved players:`);
    unresolved.rows.forEach((row: any) => {
      console.log(`   ${row.player_name} (${row.team_code}): ${row.points || 0} PTS`);
    });
  } else {
    console.log('✅ All players resolved!');
  }
  
  // Calculate totals
  const totals = await pool.query(`
    SELECT 
      team_code,
      SUM(points) as total_points,
      COUNT(*) as player_count
    FROM scraped_boxscores
    WHERE game_id = $1
      AND source = 'bbref_csv'
      AND player_id IS NOT NULL
      AND dnp_reason IS NULL
    GROUP BY team_code
  `, [gameId]);
  
  console.log('\n📊 Team Totals (from resolved players):');
  totals.rows.forEach((row: any) => {
    console.log(`   ${row.team_code}: ${row.total_points} points (${row.player_count} players)`);
  });
  
  console.log('\n💡 Next step: Run populate-bbref-stats.ts to update player and team stats');
  
  await pool.end();
}

resolveDetroitNov3Players();

