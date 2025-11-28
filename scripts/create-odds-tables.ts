import 'dotenv/config';
import { Pool } from 'pg';
import { readFileSync } from 'fs';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

async function main() {
  try {
    console.log('🔄 Creating odds-related tables...\n');

    // Create staging_events table
    console.log('1. Creating staging_events table...');
    const stagingSql = readFileSync('db/schemas/staging_events.sql', 'utf8');
    await pool.query(stagingSql);
    console.log('   ✅ Created staging_events');

    // Create markets table
    console.log('\n2. Creating markets table...');
    const marketsSql = readFileSync('db/schemas/markets.sql', 'utf8');
    await pool.query(marketsSql);
    console.log('   ✅ Created markets');

    // Verify tables exist
    console.log('\n3. Verifying tables...');
    const stagingCheck = await pool.query(
      "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = 'staging_events'"
    );
    const marketsCheck = await pool.query(
      "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = 'markets'"
    );

    if (stagingCheck.rows[0].count > 0 && marketsCheck.rows[0].count > 0) {
      console.log('   ✅ Both tables exist');
    } else {
      console.log('   ⚠️  Some tables may not exist');
    }

    console.log('\n✅ Tables created successfully!');
  } catch (error: any) {
    console.error('Error creating tables:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});

