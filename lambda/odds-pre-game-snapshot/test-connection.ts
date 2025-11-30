/**
 * Test Supabase Connection
 * 
 * Tests the connection string locally to verify it works before deploying to Lambda
 */

import { Pool } from 'pg';

// Test connection strings with different formats
const SUPABASE_DB_URL_WITH_DB_PREFIX = 'postgresql://postgres:1yXeythyGHb84Qkm@db.mbubzxjglvhaxikdghqb.supabase.co:5432/postgres';
const SUPABASE_DB_URL_NO_PREFIX = 'postgresql://postgres:1yXeythyGHb84Qkm@mbubzxjglvhaxikdghqb.supabase.co:5432/postgres';
const SUPABASE_DB_URL_POOLED = 'postgresql://postgres:1yXeythyGHb84Qkm@mbubzxjglvhaxikdghqb.supabase.co:6543/postgres?pgbouncer=true';

async function testConnection(url: string, name: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${name} connection...`);
  console.log('Connection string:', url.replace(/:[^:@]+@/, ':****@')); // Hide password
  
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 10000, // 10 seconds
    idleTimeoutMillis: 30000,
    max: 1,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('\n1. Testing basic connection...');
    const testResult = await pool.query('SELECT NOW() as current_time, version() as pg_version');
    console.log('✅ Connection successful!');
    console.log('   Current time:', testResult.rows[0].current_time);
    console.log('   PostgreSQL version:', testResult.rows[0].pg_version.split(' ')[0] + ' ' + testResult.rows[0].pg_version.split(' ')[1]);
    
    console.log('\n2. Testing database access...');
    const dbResult = await pool.query('SELECT current_database() as db_name, current_user as db_user');
    console.log('✅ Database access successful!');
    console.log('   Database:', dbResult.rows[0].db_name);
    console.log('   User:', dbResult.rows[0].db_user);
    
    console.log('\n3. Testing staging_events table access...');
    const stagingResult = await pool.query('SELECT COUNT(*) as count FROM staging_events LIMIT 1');
    console.log('✅ staging_events table accessible!');
    console.log('   Total records:', stagingResult.rows[0].count);
    
    console.log('\n4. Testing markets table access...');
    const marketsResult = await pool.query('SELECT COUNT(*) as count FROM markets LIMIT 1');
    console.log('✅ markets table accessible!');
    console.log('   Total records:', marketsResult.rows[0].count);
    
    console.log('\n5. Testing bbref_schedule table access...');
    const scheduleResult = await pool.query('SELECT COUNT(*) as count FROM bbref_schedule LIMIT 1');
    console.log('✅ bbref_schedule table accessible!');
    console.log('   Total records:', scheduleResult.rows[0].count);
    
    console.log(`\n✅ All tests passed for ${name}! Connection string is valid and working.`);
    return true;
    
  } catch (error: any) {
    console.error('\n❌ Connection test failed!');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error details:', {
      errno: error.errno,
      syscall: error.syscall,
      address: error.address,
      port: error.port
    });
    
    if (error.code === 'ETIMEDOUT') {
      console.error('\n⚠️  Connection timeout - possible causes:');
      console.error('   - Network/firewall blocking port 6543');
      console.error('   - Supabase project might be paused');
      console.error('   - Try direct connection (port 5432) instead');
    } else if (error.code === 'ENOTFOUND') {
      console.error('\n⚠️  DNS resolution failed - check hostname');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('\n⚠️  Connection refused - port might be blocked');
    }
    
    return false;
  } finally {
    await pool.end();
    console.log(`\n${name} connection closed.`);
  }
}

async function runTests() {
  console.log('Testing Supabase Connection Strings');
  console.log('='.repeat(60));
  
  // Test connection with db. prefix (from Supabase dashboard)
  const dbPrefixSuccess = await testConnection(SUPABASE_DB_URL_WITH_DB_PREFIX, 'WITH db. PREFIX (port 5432)');
  
  // Test connection without prefix
  const noPrefixSuccess = await testConnection(SUPABASE_DB_URL_NO_PREFIX, 'NO PREFIX (port 5432)');
  
  // Test pooled connection
  const pooledSuccess = await testConnection(SUPABASE_DB_URL_POOLED, 'POOLED (port 6543)');
  
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY:');
  console.log('='.repeat(60));
  console.log(`With db. prefix (5432): ${dbPrefixSuccess ? '✅ WORKS' : '❌ FAILED'}`);
  console.log(`No prefix (5432):      ${noPrefixSuccess ? '✅ WORKS' : '❌ FAILED'}`);
  console.log(`Pooled (6543):         ${pooledSuccess ? '✅ WORKS' : '❌ FAILED'}`);
  
  if (dbPrefixSuccess) {
    console.log('\n✅ RECOMMENDATION: Use connection WITH db. prefix in Lambda');
    console.log('   Connection string: postgresql://postgres:1yXeythyGHb84Qkm@db.mbubzxjglvhaxikdghqb.supabase.co:5432/postgres');
  } else if (noPrefixSuccess) {
    console.log('\n✅ RECOMMENDATION: Use DIRECT connection (no prefix) in Lambda');
    console.log('   Connection string: postgresql://postgres:1yXeythyGHb84Qkm@mbubzxjglvhaxikdghqb.supabase.co:5432/postgres');
  } else if (pooledSuccess) {
    console.log('\n✅ RECOMMENDATION: Use POOLED connection (port 6543) in Lambda');
  } else {
    console.log('\n❌ All connection types failed locally.');
    console.log('   This might be a local network/firewall issue.');
    console.log('   Lambda might still work since it uses AWS network.');
    console.log('\n   Try using the db. prefix format in Lambda:');
    console.log('   postgresql://postgres:1yXeythyGHb84Qkm@db.mbubzxjglvhaxikdghqb.supabase.co:5432/postgres');
  }
}

runTests();

