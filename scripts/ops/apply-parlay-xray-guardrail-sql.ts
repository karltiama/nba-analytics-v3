/**
 * One-shot apply of sql/proposed/parlay-xray-extraction-guardrails.sql
 * to the Court Context product database.
 *
 * Never prints connection strings or secrets.
 * Requires: --apply
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { createPostgresXrayStore } from '@/lib/parlay-xray/extraction/postgres-store';

const EXPECTED_PROJECT_REF = 'mbubzxjglvhaxikdghqb';
const SQL_PATH = join(process.cwd(), 'sql/proposed/parlay-xray-extraction-guardrails.sql');
const SYNTHETIC_USER = 'xray-cert-x2a1-operator';

function loadLocalEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of ['.env.local', '.env']) {
    let text = '';
    try {
      text = readFileSync(join(process.cwd(), file), 'utf8');
    } catch {
      continue;
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const eq = line.indexOf('=');
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (out[key] == null) out[key] = value;
    }
  }
  return out;
}

function redactHost(connectionString: string): string {
  try {
    const normalized = connectionString.replace(/^postgres(ql)?:/i, 'https:');
    const u = new URL(normalized);
    const host = u.hostname;
    if (host.length <= 12) return `${host.slice(0, 2)}…`;
    return `${host.slice(0, 4)}…${host.slice(-10)}:${u.port || '5432'}`;
  } catch {
    return '(unparseable-host)';
  }
}

function assertProductTarget(connectionString: string): void {
  const lower = connectionString.toLowerCase();
  if (!lower.includes(EXPECTED_PROJECT_REF)) {
    throw new Error('TARGET_AMBIGUOUS: connection host/user does not match the known Court Context Supabase project ref.');
  }
  if (!lower.includes('supabase.co') && !lower.includes('pooler.supabase.com')) {
    throw new Error('TARGET_AMBIGUOUS: connection is not a Supabase product host.');
  }
}

function assertAdditiveSql(sql: string): void {
  if (/^\s*DROP\s+/im.test(sql) || /^\s*TRUNCATE\s+/im.test(sql) || /^\s*DELETE\s+/im.test(sql)) {
    throw new Error('SQL_UNSAFE: destructive statement found');
  }
  if (!/CREATE TABLE IF NOT EXISTS parlay_xray_/i.test(sql)) {
    throw new Error('SQL_CHANGED_SINCE_CERTIFICATION');
  }
}

async function main(): Promise<void> {
  if (!process.argv.includes('--apply')) {
    console.error('Refusing to run without --apply');
    process.exit(2);
  }

  const env = loadLocalEnv();
  const connectionString = (process.env.SUPABASE_DB_URL || env.SUPABASE_DB_URL || '').trim();
  if (!connectionString) {
    throw new Error('Missing SUPABASE_DB_URL');
  }
  assertProductTarget(connectionString);

  const extractionFlag = (process.env.PARLAY_XRAY_EXTRACTION_ENABLED || env.PARLAY_XRAY_EXTRACTION_ENABLED || '').trim();
  const xrayKeySet = Boolean((process.env.PARLAY_XRAY_OPENAI_API_KEY || env.PARLAY_XRAY_OPENAI_API_KEY || '').trim());
  console.log(
    JSON.stringify({
      phase: 'target',
      host: redactHost(connectionString),
      projectRef: `${EXPECTED_PROJECT_REF.slice(0, 4)}…${EXPECTED_PROJECT_REF.slice(-4)}`,
      schema: 'public',
      extractionFlag: extractionFlag === '' ? '(unset → false)' : extractionFlag,
      xrayKeyConfigured: xrayKeySet,
    })
  );
  if (extractionFlag === 'true' || extractionFlag === '1' || extractionFlag === 'yes') {
    throw new Error('HARD_SAFETY: PARLAY_XRAY_EXTRACTION_ENABLED is true; refusing to continue');
  }

  const sql = readFileSync(SQL_PATH, 'utf8');
  assertAdditiveSql(sql);

  const ssl = connectionString.includes('supabase.co') || connectionString.includes('pooler.supabase.com');
  const pool = new Pool({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max: 1,
    connectionTimeoutMillis: 15000,
  });

  const started = new Date().toISOString();
  try {
    const ident = await pool.query<{ usr: string; db: string; can_create: boolean }>(
      `SELECT current_user AS usr, current_database() AS db,
              has_schema_privilege(current_user, 'public', 'CREATE') AS can_create`
    );
    const role = ident.rows[0];
    console.log(
      JSON.stringify({
        phase: 'privilege',
        db: role?.db,
        user: role?.usr,
        canCreatePublic: role?.can_create === true,
        ssl,
      })
    );
    if (!role?.can_create) {
      throw new Error('DDL permission missing on public schema');
    }

    const existing = await pool.query<{ name: string }>(
      `SELECT relname AS name FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND relname LIKE 'parlay_xray%'`
    );
    console.log(JSON.stringify({ phase: 'pre_inventory', objects: existing.rows.map((r) => r.name) }));
    if (existing.rows.length > 0) {
      const unexpected = existing.rows.filter((r) => !r.name.startsWith('parlay_xray_'));
      if (unexpected.length) {
        throw new Error('Incompatible existing objects');
      }
    }

    await pool.query(sql);
    const ended = new Date().toISOString();
    console.log(JSON.stringify({ phase: 'apply', started, ended, file: 'sql/proposed/parlay-xray-extraction-guardrails.sql' }));

    const cols = await pool.query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name LIKE 'parlay_xray_%'
       ORDER BY table_name, ordinal_position`
    );
    console.log(JSON.stringify({ phase: 'schema', columns: cols.rows }));

    const checks = await pool.query(
      `SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid::regclass::text LIKE 'parlay_xray%'`
    );
    console.log(JSON.stringify({ phase: 'constraints', rows: checks.rows }));

    const store = createPostgresXrayStore(pool);
    const now = Date.now();
    const reserved = await store.reserve({
      userId: SYNTHETIC_USER,
      dayKey: '2099-01-01',
      userLimit: 3,
      globalLimit: 100,
      cooldownMs: 0,
      inflightTtlMs: 120000,
      now,
    });
    if (!reserved.ok) {
      throw new Error(`synthetic reserve failed: ${reserved.reason}`);
    }
    await store.releaseBeforeProvider(reserved.reservation);

    const advisory = await pool.query<{ locked: boolean }>(`SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked`, [
      `xray-inflight:${SYNTHETIC_USER}`,
    ]);

    await pool.query(`DELETE FROM parlay_xray_inflight WHERE user_id = $1`, [SYNTHETIC_USER]);
    await pool.query(`DELETE FROM parlay_xray_cooldowns WHERE user_id = $1`, [SYNTHETIC_USER]);
    await pool.query(`DELETE FROM parlay_xray_daily_counters WHERE scope IN ($1, 'global') AND bucket_date = '2099-01-01'`, [
      `user:${SYNTHETIC_USER}`,
    ]);
    await pool.query(`DELETE FROM parlay_xray_dedupe WHERE identity LIKE $1`, [`${SYNTHETIC_USER}:%`]);
    await pool.query(`DELETE FROM parlay_xray_extraction_usage WHERE user_id = $1`, [SYNTHETIC_USER]);

    const leftover = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM parlay_xray_daily_counters) AS counters,
         (SELECT count(*)::int FROM parlay_xray_inflight) AS inflight,
         (SELECT count(*)::int FROM parlay_xray_cooldowns) AS cooldowns,
         (SELECT count(*)::int FROM parlay_xray_dedupe) AS dedupe,
         (SELECT count(*)::int FROM parlay_xray_extraction_usage) AS usage`
    );

    console.log(
      JSON.stringify({
        phase: 'smoke',
        syntheticUser: SYNTHETIC_USER,
        reserveOk: true,
        released: true,
        advisoryLockAvailable: advisory.rows[0]?.locked === true,
        leftoverCounts: leftover.rows[0],
      })
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'apply_failed');
  process.exit(1);
});
