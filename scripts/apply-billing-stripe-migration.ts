/**
 * Applies WP6.3 billing schema (unique provider ids + webhook idempotency).
 * Env: SUPABASE_DB_URL
 *
 * Usage: npx tsx scripts/apply-billing-stripe-migration.ts
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

const sql = fs.readFileSync(path.join('db', 'schemas', 'MIGRATION_billing_stripe.sql'), 'utf8');
const useSsl = dbUrl.includes('supabase.co') || dbUrl.includes('pooler.supabase.com');

async function main() {
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });
  try {
    await pool.query(sql);
    const indexes = await pool.query(
      `select indexname
       from pg_indexes
       where schemaname = 'public'
         and tablename in ('user_entitlements', 'billing_webhook_events')
       order by indexname`
    );
    const column = await pool.query(
      `select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'user_entitlements'
         and column_name = 'last_provider_event_at'`
    );
    const table = await pool.query(
      `select to_regclass('public.billing_webhook_events') as rel`
    );
    console.log('MIGRATION_OK');
    console.log(`last_provider_event_at=${column.rowCount === 1}`);
    console.log(`billing_webhook_events=${Boolean(table.rows[0]?.rel)}`);
    console.log(`indexes=${indexes.rows.map((r: { indexname: string }) => r.indexname).join(',')}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'migration failed');
  process.exit(1);
});
