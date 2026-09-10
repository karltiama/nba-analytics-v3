/**
 * Apply 13R.2 identity DDL only. No product FK changes. No BDL HTTP.
 *   npx tsx scripts/ops/apply-player-identity-canonical-migration.ts
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL?.trim();
if (!connectionString) {
  throw new Error('Missing SUPABASE_DB_URL');
}

async function main() {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'db/schemas/MIGRATION_player_identity_canonical.sql'),
    'utf8'
  );
  const pool = new Pool({
    connectionString,
    ssl:
      connectionString.includes('supabase.co') ||
      connectionString.includes('pooler.supabase.com')
        ? { rejectUnauthorized: false }
        : undefined,
    max: 1,
  });
  try {
    await pool.query(sql);
    const constraints = await pool.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid IN (
         'analytics.player_provider_ids'::regclass,
         'analytics.player_identity_unresolved'::regclass
       )
       ORDER BY conrelid::regclass::text, conname`
    );
    const grants = await pool.query<{ grantee: string; privilege: string }>(
      `SELECT grantee, privilege_type AS privilege
       FROM information_schema.role_table_grants
       WHERE table_schema = 'analytics'
         AND table_name = 'player_identity_unresolved'`
    );
    console.log(JSON.stringify({
      applied: true,
      constraints: constraints.rows,
      grants: grants.rows,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

void main();
