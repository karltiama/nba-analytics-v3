import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Add Vit Krejci to the database
 * 
 * Vit Krejci is a Czech player who appears in our scraped box scores
 * but doesn't exist in the players table yet.
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

async function main() {
  console.log('🔍 Checking Vit Krejci data...\n');
  
  // Check what data we have
  const scrapedData = await pool.query(`
    SELECT 
      player_name,
      team_code,
      game_date,
      points,
      rebounds,
      assists,
      minutes,
      COUNT(*) as game_count
    FROM scraped_boxscores
    WHERE player_name = 'Vit Krejci'
    GROUP BY player_name, team_code, game_date, points, rebounds, assists, minutes
    ORDER BY game_date
  `);
  
  console.log(`Found ${scrapedData.rows.length} game records for Vit Krejci:\n`);
  scrapedData.rows.forEach((row, idx) => {
    console.log(`${idx + 1}. ${row.game_date} (${row.team_code}): ${row.points}PTS, ${row.rebounds}REB, ${row.assists}AST, ${row.minutes}MIN`);
  });
  
  // Get team ID for ATL
  const teamResult = await pool.query(`
    SELECT team_id, abbreviation FROM teams WHERE abbreviation = 'ATL'
  `);
  
  if (teamResult.rows.length === 0) {
    console.error('\n❌ Could not find ATL team in database');
    await pool.end();
    return;
  }
  
  const atlTeamId = teamResult.rows[0].team_id;
  console.log(`\n✅ Found ATL team: ${atlTeamId}`);
  
  // Generate a player ID (using a simple format: vit_krejci_2025)
  // In production, you'd want to use a proper ID from an API
  const playerId = `vit_krejci_2025`;
  
  console.log(`\n📝 Adding Vit Krejci to database...`);
  console.log(`   Player ID: ${playerId}`);
  console.log(`   Full Name: Vit Krejci`);
  console.log(`   First Name: Vit`);
  console.log(`   Last Name: Krejci`);
  console.log(`   Team: ATL (${atlTeamId})`);
  
  try {
    await pool.query('BEGIN');
    
    // Insert player
    await pool.query(`
      INSERT INTO players (
        player_id, full_name, first_name, last_name, 
        position, height, weight, dob, active,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      ON CONFLICT (player_id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        updated_at = NOW()
    `, [
      playerId,
      'Vit Krejci',
      'Vit',
      'Krejci',
      null, // position - unknown
      null, // height - unknown
      null, // weight - unknown
      null, // dob - unknown
      true, // active - assume active since playing
    ]);
    
    console.log('   ✅ Player added to players table');
    
    // Add to player_team_rosters for 2025-26 season
    await pool.query(`
      INSERT INTO player_team_rosters (
        player_id, team_id, season, active, jersey,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (player_id, season) DO UPDATE SET
        team_id = EXCLUDED.team_id,
        active = EXCLUDED.active,
        updated_at = NOW()
    `, [
      playerId,
      atlTeamId,
      '2025-26',
      true,
      null, // jersey number - unknown
    ]);
    
    console.log('   ✅ Player added to player_team_rosters');
    
    // Update scraped_boxscores with player_id
    const updateResult = await pool.query(`
      UPDATE scraped_boxscores
      SET player_id = $1, updated_at = NOW()
      WHERE player_name = 'Vit Krejci'
        AND player_id IS NULL
      RETURNING id
    `, [playerId]);
    
    console.log(`   ✅ Updated ${updateResult.rowCount} records in scraped_boxscores`);
    
    await pool.query('COMMIT');
    
    console.log('\n✅ Successfully added Vit Krejci to database!');
    console.log(`\n📊 Summary:`);
    console.log(`   Player ID: ${playerId}`);
    console.log(`   Records updated: ${updateResult.rowCount}`);
    
  } catch (error: any) {
    await pool.query('ROLLBACK');
    console.error('\n❌ Error adding player:', error.message);
    throw error;
  }
  
  await pool.end();
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});


