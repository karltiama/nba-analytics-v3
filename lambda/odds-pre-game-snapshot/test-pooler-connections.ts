/**
 * Test Supabase Pooler Connection Strings
 *
 * Provide one or more URLs via env (never hard-code credentials):
 *   SUPABASE_DB_URL              — primary URL to test (required)
 *   SUPABASE_DB_URL_ALT          — optional second URL
 *   SUPABASE_DB_URL_DIRECT       — optional third URL
 *
 * Usage:
 *   SUPABASE_DB_URL="postgresql://..." npx tsx test-pooler-connections.ts
 */

import { Pool } from 'pg';

function redact(url: string): string {
  return url.replace(/:[^:@/]+@/, ':****@');
}

async function testConnection(url: string, name: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${name}...`);
  console.log('Connection string:', redact(url));

  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
    max: 1,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('\n1. Testing basic connection...');
    const testResult = await pool.query('SELECT NOW() as current_time, version() as pg_version');
    console.log('✅ Connection successful!');
    console.log('   Current time:', testResult.rows[0].current_time);

    console.log('\n2. Testing database access...');
    const dbResult = await pool.query('SELECT current_database() as db_name, current_user as db_user');
    console.log('✅ Database access successful!');
    console.log('   Database:', dbResult.rows[0].db_name);
    console.log('   User:', dbResult.rows[0].db_user);

    console.log(`\n✅ ${name} WORKS!`);
    return { success: true as const, url, name };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string })?.code;
    console.error(`\n❌ ${name} failed!`);
    console.error('Error:', message);
    console.error('Error code:', code);
    return { success: false as const, url, name, error: message };
  } finally {
    await pool.end();
  }
}

async function runTests() {
  const entries: Array<{ name: string; url: string }> = [];
  const primary = (process.env.SUPABASE_DB_URL || '').trim();
  if (primary) entries.push({ name: 'SUPABASE_DB_URL', url: primary });
  const alt = (process.env.SUPABASE_DB_URL_ALT || '').trim();
  if (alt) entries.push({ name: 'SUPABASE_DB_URL_ALT', url: alt });
  const direct = (process.env.SUPABASE_DB_URL_DIRECT || '').trim();
  if (direct) entries.push({ name: 'SUPABASE_DB_URL_DIRECT', url: direct });

  if (entries.length === 0) {
    console.error(
      'Missing connection URL(s). Set SUPABASE_DB_URL (and optionally SUPABASE_DB_URL_ALT / SUPABASE_DB_URL_DIRECT).'
    );
    process.exit(1);
  }

  console.log('Testing Supabase Connection Pooler Options');
  console.log('='.repeat(60));

  const results = [];
  for (const e of entries) {
    results.push(await testConnection(e.url, e.name));
  }

  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY:');
  console.log('='.repeat(60));

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  successful.forEach((r) => console.log(`✅ ${r.name}: WORKS`));
  failed.forEach((r) => console.log(`❌ ${r.name}: FAILED - ${'error' in r ? r.error : ''}`));

  if (successful.length === 0) {
    process.exit(1);
  }

  const best = successful[0];
  console.log(`\n🎯 Working connection (redacted): ${redact(best.url)}`);
}

runTests();
