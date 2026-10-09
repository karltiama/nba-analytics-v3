import { Pool } from 'pg';

/** Single-connection pg pool for short-lived ingestion Lambdas. Missing SUPABASE_DB_URL throws. */
export function createLambdaPgPool(env: Record<string, string | undefined> = process.env): Pool {
  const connectionString = (env.SUPABASE_DB_URL ?? '').trim();
  if (!connectionString) {
    throw new Error('Missing SUPABASE_DB_URL environment variable');
  }
  const useSsl =
    connectionString.includes('supabase.co') || connectionString.includes('pooler.supabase.com');
  return new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: Number(env.DB_CONNECTION_TIMEOUT_MS ?? 10_000),
    statement_timeout: Number(env.DB_STATEMENT_TIMEOUT_MS ?? 15_000),
  });
}
