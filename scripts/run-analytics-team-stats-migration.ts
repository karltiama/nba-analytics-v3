/**
 * Run analytics_team_stats_advanced.sql migration using pg.
 * Usage: npx tsx scripts/run-analytics-team-stats-migration.ts
 * Env: SUPABASE_DB_URL
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
if (!SUPABASE_DB_URL) {
  console.error('Set SUPABASE_DB_URL in .env');
  process.exit(1);
}

const sqlPath = join(__dirname, '../db/schemas/analytics_team_stats_advanced.sql');
const sql = readFileSync(sqlPath, 'utf-8');

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

async function main() {
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('Migration analytics_team_stats_advanced.sql applied successfully.');
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
