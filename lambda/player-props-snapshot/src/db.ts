import { Pool } from 'pg';

let sharedPool: Pool | null = null;

export function getDbPool(connectionString: string): Pool {
  if (sharedPool) return sharedPool;
  sharedPool = new Pool({
    connectionString,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
    max: 2,
    ssl: { rejectUnauthorized: false },
  });
  return sharedPool;
}
