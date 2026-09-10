/**
 * Apply Market Movement v1 empty serving schema (Step 11B).
 * Does not backfill. Env: SUPABASE_DB_URL
 *
 *   npx tsx scripts/apply-market-movement-v1-schema.ts
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

const sql = fs.readFileSync(path.join('db', 'schemas', 'MIGRATION_market_movement_v1.sql'), 'utf8');
const useSsl = dbUrl.includes('supabase.co') || dbUrl.includes('pooler.supabase.com');

async function main() {
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });
  try {
    await pool.query(sql);
    const tables = await pool.query<{ rel: string | null }>(
      `select to_regclass('analytics.player_prop_market_movement')::text as rel
       union all
       select to_regclass('analytics.game_odds_market_movement')::text
       union all
       select to_regclass('analytics.market_movement_consensus')::text`
    );
    const counts = await pool.query<{ player_n: string; game_n: string }>(
      `select
         (select count(*)::text from analytics.player_prop_market_movement) as player_n,
         (select count(*)::text from analytics.game_odds_market_movement) as game_n`
    );
    const indexes = await pool.query<{ indexname: string }>(
      `select indexname
       from pg_indexes
       where schemaname = 'analytics'
         and tablename in ('player_prop_market_movement', 'game_odds_market_movement')
       order by indexname`
    );
    const rls = await pool.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'analytics'
         and c.relname in ('player_prop_market_movement', 'game_odds_market_movement')
       order by c.relname`
    );
    const summaryUnchanged = await pool.query<{ n: string }>(
      `select count(*)::text as n from analytics.player_prop_movement_summary`
    );

    console.log('MIGRATION_OK');
    console.log(`player_prop_market_movement=${tables.rows[0]?.rel}`);
    console.log(`game_odds_market_movement=${tables.rows[1]?.rel}`);
    console.log(`consensus_table=${tables.rows[2]?.rel ?? 'null'}`);
    console.log(`player_rows=${counts.rows[0]?.player_n}`);
    console.log(`game_rows=${counts.rows[0]?.game_n}`);
    console.log(`indexes=${indexes.rows.map((r) => r.indexname).join(',')}`);
    console.log(
      `rls=${rls.rows.map((r) => `${r.relname}:${r.relrowsecurity}`).join(',')}`
    );
    console.log(`player_prop_movement_summary_rows=${summaryUnchanged.rows[0]?.n}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'migration failed');
  process.exit(1);
});
