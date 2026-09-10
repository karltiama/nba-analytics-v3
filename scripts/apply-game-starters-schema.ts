/**
 * Apply analytics.game_starters empty serving schema (Step 12C).
 * Does not backfill. Env: SUPABASE_DB_URL
 *
 *   npx tsx scripts/apply-game-starters-schema.ts
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

const sql = fs.readFileSync(path.join('db', 'schemas', 'MIGRATION_game_starters.sql'), 'utf8');
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
      `select to_regclass('analytics.game_starters')::text as rel`
    );
    const indexes = await pool.query<{ indexname: string }>(
      `select indexname from pg_indexes
       where schemaname = 'analytics' and tablename = 'game_starters'
       order by indexname`
    );
    const rls = await pool.query<{ relrowsecurity: boolean }>(
      `select c.relrowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'analytics' and c.relname = 'game_starters'`
    );
    const grants = await pool.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type
       from information_schema.role_table_grants
       where table_schema = 'analytics' and table_name = 'game_starters'
       order by grantee, privilege_type`
    );
    console.log('MIGRATION_OK');
    console.log(`game_starters=${table.rows[0]?.rel}`);
    console.log(`indexes=${indexes.rows.map((r) => r.indexname).join(',')}`);
    console.log(`rls=${rls.rows[0]?.relrowsecurity ?? 'unknown'}`);
    console.log(
      `grants=${grants.rows.map((r) => `${r.grantee}:${r.privilege_type}`).join(',') || '(owner default)'}`
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'migration failed');
  process.exit(1);
});
