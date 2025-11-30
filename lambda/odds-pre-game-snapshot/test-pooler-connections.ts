/**
 * Test Supabase Pooler Connection Strings
 * 
 * Tests different Supabase connection pooler formats to find the one that works
 */

import { Pool } from 'pg';

// Test different connection string formats
const connectionStrings = {
  // Transaction pooler (port 6543) - recommended for Lambda - CORRECT FORMAT
  transactionPooler: 'postgresql://postgres.mbubzxjglvhaxikdghqb:1yXeythyGHb84Qkm@aws-1-us-east-2.pooler.supabase.com:6543/postgres',
  
  // Session pooler (port 6543) - alternative
  sessionPooler: 'postgresql://postgres.mbubzxjglvhaxikdghqb:1yXeythyGHb84Qkm@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
  
  // Direct connection (port 5432) - can hit limits
  direct: 'postgresql://postgres:1yXeythyGHb84Qkm@db.mbubzxjglvhaxikdghqb.supabase.co:5432/postgres',
  
  // Alternative direct format
  directAlt: 'postgresql://postgres.mbubzxjglvhaxikdghqb:1yXeythyGHb84Qkm@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
};

async function testConnection(url: string, name: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${name}...`);
  console.log('Connection string:', url.replace(/:[^:@]+@/, ':****@')); // Hide password
  
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 15000,
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
    
    console.log('\n2. Testing database access...');
    const dbResult = await pool.query('SELECT current_database() as db_name, current_user as db_user');
    console.log('✅ Database access successful!');
    console.log('   Database:', dbResult.rows[0].db_name);
    console.log('   User:', dbResult.rows[0].db_user);
    
    console.log(`\n✅ ${name} WORKS! Use this connection string in Lambda.`);
    return { success: true, url, name };
    
  } catch (error: any) {
    console.error(`\n❌ ${name} failed!`);
    console.error('Error:', error.message);
    console.error('Error code:', error.code);
    return { success: false, url, name, error: error.message };
  } finally {
    await pool.end();
  }
}

async function runTests() {
  console.log('Testing Supabase Connection Pooler Options');
  console.log('='.repeat(60));
  console.log('\nNOTE: You may need to update the connection strings with:');
  console.log('  - Your actual Supabase project reference ID');
  console.log('  - Your actual AWS region (e.g., us-east-1, us-west-2)');
  console.log('  - Your actual database password');
  console.log('\nGet these from: Supabase Dashboard → Settings → Database → Connection Pooling');
  
  const results = [];
  
  // Test transaction pooler
  results.push(await testConnection(connectionStrings.transactionPooler, 'TRANSACTION POOLER (port 6543, pgbouncer=true)'));
  
  // Test session pooler
  results.push(await testConnection(connectionStrings.sessionPooler, 'SESSION POOLER (port 6543, no pgbouncer)'));
  
  // Test direct connection
  results.push(await testConnection(connectionStrings.direct, 'DIRECT (port 5432, db. prefix)'));
  
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY:');
  console.log('='.repeat(60));
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  successful.forEach(r => {
    console.log(`✅ ${r.name}: WORKS`);
  });
  
  failed.forEach(r => {
    console.log(`❌ ${r.name}: FAILED - ${r.error}`);
  });
  
  if (successful.length > 0) {
    console.log('\n✅ RECOMMENDATION: Use one of the working connection strings above');
    console.log('\nFor Lambda, prefer:');
    console.log('  1. Transaction Pooler (best for serverless)');
    console.log('  2. Session Pooler (alternative)');
    console.log('  3. Direct connection (only if poolers don\'t work)');
    
    const best = successful.find(r => r.name.includes('TRANSACTION')) || successful[0];
    console.log(`\n🎯 Use this connection string in Lambda:`);
    console.log(`   ${best.url.replace(/:[^:@]+@/, ':****@')}`);
  } else {
    console.log('\n❌ All connection types failed. Check:');
    console.log('   - Supabase project is active (not paused)');
    console.log('   - Connection strings are correct (region, project ID, password)');
    console.log('   - Network/firewall settings');
    process.exit(1);
  }
}

runTests();

