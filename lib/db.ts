import { Pool, type QueryResult, type QueryResultRow } from 'pg';

if (!process.env.SUPABASE_DB_URL) {
  throw new Error('Missing SUPABASE_DB_URL environment variable');
}

// Create a connection pool
const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  // Connection pool settings
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 10000),
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 30000),
});

const RETRYABLE_CONNECTION_ERRORS = [
  'Connection terminated due to connection timeout',
  'ECONNRESET',
  'ETIMEDOUT',
  'Connection terminated unexpectedly',
];

function isRetryableConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return RETRYABLE_CONNECTION_ERRORS.some((token) => error.message.includes(token));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryWithRetry<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const maxAttempts = Number(process.env.DB_QUERY_MAX_ATTEMPTS ?? 2);
  let attempt = 1;
  while (true) {
    try {
      return await pool.query<T>(text, params);
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableConnectionError(error)) {
        throw error;
      }
      // Small backoff to let transient pool/connectivity issues recover.
      await sleep(150 * attempt);
      attempt += 1;
    }
  }
}

// Helper to execute queries
export async function query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await queryWithRetry<T>(text, params);
  return result.rows;
}

// Helper to get a single row
export async function queryOne<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<T | null> {
  const result = await queryWithRetry<T>(text, params);
  return result.rows[0] || null;
}

export default pool;

