/**
 * Checked-out PostgreSQL client for one cluster measurement transaction.
 * The pool is injected. This module does not import `pg`, construct a Pool,
 * or read a connection string. Production entrypoints do not call it.
 *
 * Installed node-pg is 8.16.3 (`pg` range ^8.13.1). Ingestion Lambdas run
 * nodejs22.x. `pg-pool` removes a client when `release` receives a truthy
 * error, and throws if `release` is called again. `release()` with no error
 * returns a healthy client to the idle pool.
 */

import {
  CLUSTER_MEASUREMENT_BEGIN_SQL,
  CLUSTER_MEASUREMENT_ROLLBACK_SQL,
  type ClusterMeasurementLeasor,
  type ClusterMeasurementRelease,
} from '@/lib/ops/cluster-measurement';

export interface ClusterMeasurementPgClient {
  query(sql: string): Promise<{ rows?: readonly Record<string, unknown>[] }>;
  release(error?: Error): void;
}

export interface ClusterMeasurementPgPool {
  connect(): Promise<ClusterMeasurementPgClient>;
}

const CONNECTION_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNABORTED',
]);

function isConnectionFailure(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return true;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string' || code.length === 0) return true;
  if (CONNECTION_ERROR_CODES.has(code)) return true;
  return code.length === 5 && code.startsWith('08');
}

/**
 * One `pool.connect()` client owns BEGIN, SET LOCAL, both SELECTs, and ROLLBACK.
 * A connection or protocol failure stays discard for the life of the lease.
 * Successful ROLLBACK does not clear it. An ordinary statement error may
 * return the client only after ROLLBACK resolves and no connection failure
 * was seen. Failed BEGIN and failed ROLLBACK stay discard. A second release
 * throws and does not call the client again.
 */
export function createClusterMeasurementPgLeasor(pool: ClusterMeasurementPgPool): ClusterMeasurementLeasor {
  return {
    async acquire() {
      const client = await pool.connect();
      let released = false;
      let beginFailed = false;
      let rollbackFailed = false;
      let rollbackSucceeded = false;
      let connectionFailed = false;
      let statementFailed = false;

      return {
        session: {
          async query(sql: string) {
            if (released) {
              throw new Error('cluster measurement client was already released');
            }
            try {
              const result = await client.query(sql);
              if (sql === CLUSTER_MEASUREMENT_ROLLBACK_SQL) rollbackSucceeded = true;
              const rows = result != null && Array.isArray(result.rows) ? result.rows : [];
              return { rows };
            } catch (error) {
              if (sql === CLUSTER_MEASUREMENT_BEGIN_SQL) {
                beginFailed = true;
              } else if (isConnectionFailure(error)) {
                connectionFailed = true;
                if (sql === CLUSTER_MEASUREMENT_ROLLBACK_SQL) rollbackFailed = true;
              } else if (sql === CLUSTER_MEASUREMENT_ROLLBACK_SQL) {
                rollbackFailed = true;
              } else {
                statementFailed = true;
              }
              throw error;
            }
          },
        },
        async release(result: ClusterMeasurementRelease) {
          if (released) {
            throw new Error('cluster measurement client released twice');
          }
          released = true;
          const statementCleared = !statementFailed || rollbackSucceeded;
          const trustworthy =
            result === 'clean' && !beginFailed && !rollbackFailed && !connectionFailed && statementCleared;
          if (!trustworthy) {
            client.release(new Error('cluster measurement client discarded'));
            return;
          }
          client.release();
        },
      };
    },
  };
}
