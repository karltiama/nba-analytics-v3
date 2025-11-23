import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

/**
 * Add constraints to ensure BBRef tables only contain BBRef data
 */
async function main() {
  try {
    console.log('\n🔒 Adding BBRef-Only Constraints\n');
    console.log('='.repeat(100));
    
    // Add check constraint to team stats (if not exists)
    try {
      await pool.query(`
        ALTER TABLE bbref_team_game_stats
        ADD CONSTRAINT bbref_team_game_stats_source_check 
        CHECK (source = 'bbref')
      `);
      console.log('✅ Added source check constraint to bbref_team_game_stats');
    } catch (error: any) {
      if (error.message.includes('already exists')) {
        console.log('ℹ️  Constraint already exists on bbref_team_game_stats');
      } else {
        throw error;
      }
    }
    
    // Add check constraint to player stats (if not exists)
    try {
      await pool.query(`
        ALTER TABLE bbref_player_game_stats
        ADD CONSTRAINT bbref_player_game_stats_source_check 
        CHECK (source = 'bbref')
      `);
      console.log('✅ Added source check constraint to bbref_player_game_stats');
    } catch (error: any) {
      if (error.message.includes('already exists')) {
        console.log('ℹ️  Constraint already exists on bbref_player_game_stats');
      } else {
        throw error;
      }
    }
    
    // Verify constraints
    const teamConstraints = await pool.query(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_name = 'bbref_team_game_stats'
        AND constraint_type = 'CHECK'
    `);
    
    const playerConstraints = await pool.query(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_name = 'bbref_player_game_stats'
        AND constraint_type = 'CHECK'
    `);
    
    console.log('\n📋 VERIFICATION:');
    console.log('-'.repeat(100));
    console.log(`Team stats constraints: ${teamConstraints.rows.length}`);
    console.log(`Player stats constraints: ${playerConstraints.rows.length}`);
    
    if (teamConstraints.rows.length > 0) {
      console.log('\nTeam stats constraints:');
      teamConstraints.rows.forEach((c: any) => {
        console.log(`  - ${c.constraint_name}`);
      });
    }
    
    if (playerConstraints.rows.length > 0) {
      console.log('\nPlayer stats constraints:');
      playerConstraints.rows.forEach((c: any) => {
        console.log(`  - ${c.constraint_name}`);
      });
    }
    
    console.log('\n' + '='.repeat(100));
    console.log('✅ Constraints added successfully!');
    console.log('='.repeat(100));
    console.log('\n💡 These constraints ensure:');
    console.log('   - Only BBRef data can be inserted into BBRef tables');
    console.log('   - Source field must always be "bbref"');
    console.log('   - Prevents accidental data mixing');
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();

