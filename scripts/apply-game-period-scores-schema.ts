/**
 * Apply raw.game_period_scores (empty). Does not backfill. Env: SUPABASE_DB_URL
 * Run before deploying the nightly-bdl-updater build that writes it.
 *
 *   npx tsx scripts/apply-game-period-scores-schema.ts
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const dbUrl = process.env.SUPABASE_DB_URL?.trim();
if (!dbUrl) {
  console.error('Set SUPABASE_DB_URL');
  process.exit(1);
}

const sql = fs.readFileSync(path.join('db', 'schemas', 'MIGRATION_raw_game_period_scores.sql'), 'utf8');
const useSsl = dbUrl.includes('supabase.co') || dbUrl.includes('pooler.supabase.com');

async function main() {
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });
  try {
    await pool.query(sql);
    const table = await pool.query<{ rel: string | null }>(
      `select to_regclass('raw.game_period_scores')::text as rel`
    );
    const rows = await pool.query<{ n: string }>(`select count(*) n from raw.game_period_scores`);
    console.log('MIGRATION_OK');
    console.log(`game_period_scores=${table.rows[0]?.rel} rows=${rows.rows[0]?.n}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
