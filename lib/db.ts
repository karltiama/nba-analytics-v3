import { Pool } from 'pg';

if (!process.env.SUPABASE_DB_URL) {
  throw new Error('Missing SUPABASE_DB_URL environment variable');
}

// Create a connection pool
const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  // Connection pool settings
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Helper to execute queries
export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows;
}

// Helper to get a single row
export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

export default pool;

