/**
 * Test Supabase Connection
 *
 * Tests SUPABASE_DB_URL locally before deploying to Lambda.
 * Usage: SUPABASE_DB_URL="postgresql://..." npx tsx test-connection.ts
 *
 * Never hard-code credentials in this file.
 */

import { Pool } from 'pg';

function redact(url: string): string {
  return url.replace(/:[^:@/]+@/, ':****@');
}

async function testConnection(url: string, name: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${name} connection...`);
  console.log('Connection string:', redact(url));

  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 10000,
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
    const versionParts = String(testResult.rows[0].pg_version).split(' ');
    console.log('   PostgreSQL version:', `${versionParts[0]} ${versionParts[1]}`);

    console.log('\n2. Testing database access...');
    const dbResult = await pool.query('SELECT current_database() as db_name, current_user as db_user');
    console.log('✅ Database access successful!');
    console.log('   Database:', dbResult.rows[0].db_name);
    console.log('   User:', dbResult.rows[0].db_user);

    console.log(`\n✅ All tests passed for ${name}!`);
    return true;
  } catch (error: unknown) {
    const err = error as {
      constructor: { name: string };
      message: string;
      code?: string;
      errno?: number;
      syscall?: string;
      address?: string;
      port?: number;
    };
    console.error('\n❌ Connection test failed!');
    console.error('Error type:', err.constructor?.name);
    console.error('Error message:', err.message);
    console.error('Error code:', err.code);
    console.error('Error details:', {
      errno: err.errno,
      syscall: err.syscall,
      address: err.address,
      port: err.port,
    });
    return false;
  } finally {
    await pool.end();
    console.log(`\n${name} connection closed.`);
  }
}

async function runTests() {
  const url = (process.env.SUPABASE_DB_URL || '').trim();
  if (!url) {
    console.error('Missing SUPABASE_DB_URL. Set it in the environment (never commit real credentials).');
    process.exit(1);
  }

  console.log('Testing Supabase Connection String from SUPABASE_DB_URL');
  console.log('='.repeat(60));

  const ok = await testConnection(url, 'SUPABASE_DB_URL');
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY:', ok ? '✅ WORKS' : '❌ FAILED');
  process.exit(ok ? 0 : 1);
}

runTests();
