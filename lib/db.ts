import { Pool, type QueryResult, type QueryResultRow } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL?.trim();
if (!connectionString) {
  throw new Error('Missing SUPABASE_DB_URL environment variable');
}

/** Match Lambdas (e.g. lambda/odds-pre-game-snapshot): trim avoids ENOTFOUND from stray newlines in host; SSL required for Supabase. */
const useSupabaseSsl =
  connectionString.includes('supabase.co') || connectionString.includes('pooler.supabase.com');

function resolvePoolMax(conn: string): number {
  const fromEnv = process.env.PG_POOL_MAX;
  if (fromEnv !== undefined && fromEnv !== '') {
    const n = Number(fromEnv);
    if (Number.isFinite(n) && n >= 1) return Math.min(Math.floor(n), 50);
  }
  // Supavisor session/transaction poolers enforce a small max *client* count per project tier.
  // Vercel spins many instances; each Pool with high `max` multiplies connections → MaxClientsInSessionMode.
  const pooledSupabase =
    conn.includes('pooler.supabase.com') || conn.includes(':6543');
  if (pooledSupabase) return 1;
  // Direct db.*.supabase.co — still serverless-friendly default (many concurrent lambdas).
  if (conn.includes('supabase.co')) return 5;
  return 20;
}

// Create a connection pool
const pool = new Pool({
  connectionString,
  ssl: useSupabaseSsl ? { rejectUnauthorized: false } : undefined,
  // Connection pool settings
  max: resolvePoolMax(connectionString),
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

