/**
 * Run db/schemas/*.sql files against SUPABASE_DB_URL (no psql required).
 *
 * Usage:
 *   npx tsx scripts/run-schemas.ts                    # raw_schema.sql + analytics_schema.sql
 *   npx tsx scripts/run-schemas.ts raw_schema          # only raw
 *   npx tsx scripts/run-schemas.ts analytics_schema    # only analytics
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

const SCHEMAS_DIR = join(process.cwd(), 'db', 'schemas');

const defaultFiles = ['raw_schema.sql', 'analytics_schema.sql', 'analytics_schema_migration.sql'];

async function main() {
  const args = process.argv.slice(2);
  const files = args.length > 0 ? args.map((f) => (f.endsWith('.sql') ? f : `${f}.sql`)) : defaultFiles;

  const pool = new Pool({ connectionString: SUPABASE_DB_URL });
  const client = await pool.connect();

  try {
    for (const file of files) {
      const path = join(SCHEMAS_DIR, file);
      console.log(`Running ${file}...`);
      const sql = readFileSync(path, 'utf8');
      await client.query(sql);
      console.log(`  Done.`);
    }
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
