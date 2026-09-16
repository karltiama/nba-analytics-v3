/**
 * Postgres-backed XRay guardrail store.
 * Requires the proposed tables in sql/proposed/parlay-xray-extraction-guardrails.sql.
 * This module does NOT create or migrate those tables.
 *
 * Missing tables → store_unavailable (fail closed, no provider call).
 */

import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  XrayCachedExtraction,
  XrayExtractionStore,
  XrayQuotaSnapshot,
  XrayReservation,
  XrayReserveFailure,
  XrayReserveInput,
  XrayUsageRecord,
} from './store';
import { XrayStoreUnavailableError } from './store';

const UNDEFINED_TABLE = '42P01';

function isUndefinedTable(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === UNDEFINED_TABLE);
}

async function withClient<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export function createPostgresXrayStore(pool: Pool): XrayExtractionStore {
  return {
    async getQuota(userId, dayKey) {
      try {
        return await withClient(pool, async (client) => {
          const userRow = await client.query<{ count: number }>(
            `SELECT count FROM parlay_xray_daily_counters WHERE bucket_date = $1::date AND scope = $2`,
            [dayKey, `user:${userId}`]
          );
          const globalRow = await client.query<{ count: number }>(
            `SELECT count FROM parlay_xray_daily_counters WHERE bucket_date = $1::date AND scope = 'global'`,
            [dayKey]
          );
          const cool = await client.query<{ last_attempt_at: Date }>(
            `SELECT last_attempt_at FROM parlay_xray_cooldowns WHERE user_id = $1`,
            [userId]
          );
          return {
            userUsed: userRow.rows[0]?.count ?? 0,
            globalUsed: globalRow.rows[0]?.count ?? 0,
            lastAttemptAt: cool.rows[0]?.last_attempt_at ? cool.rows[0].last_attempt_at.getTime() : null,
          } satisfies XrayQuotaSnapshot;
        });
      } catch (error) {
        if (isUndefinedTable(error)) {
          throw new XrayStoreUnavailableError();
        }
        throw error;
      }
    },

    async getCached(identity, now) {
      try {
        return await withClient(pool, async (client) => {
          const row = await client.query<{ result: XrayExtractedJson }>(
            `SELECT result_json AS result FROM parlay_xray_dedupe
             WHERE identity = $1 AND expires_at > to_timestamp($2 / 1000.0)`,
            [identity, now]
          );
          const stored = row.rows[0]?.result;
          if (!stored) return null;
          return { result: stored.result, legs: stored.legs, message: stored.message };
        });
      } catch (error) {
        if (isUndefinedTable(error)) return null;
        throw error;
      }
    },

    async putCached(identity, value, now, ttlMs) {
      try {
        await withClient(pool, async (client) => {
          await client.query(
            `INSERT INTO parlay_xray_dedupe (identity, result_json, created_at, expires_at)
             VALUES ($1, $2::jsonb, to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0))
             ON CONFLICT (identity) DO UPDATE SET result_json = EXCLUDED.result_json, expires_at = EXCLUDED.expires_at`,
            [identity, JSON.stringify(value), now, now + ttlMs]
          );
        });
      } catch (error) {
        if (isUndefinedTable(error)) return;
        throw error;
      }
    },

    async reserve(input: XrayReserveInput) {
      try {
        return await withClient(pool, async (client) => {
          await client.query('BEGIN');
          try {
            await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`xray-inflight:${input.userId}`]);
            await client.query(`DELETE FROM parlay_xray_inflight WHERE expires_at <= to_timestamp($1 / 1000.0)`, [
              input.now,
            ]);
            const lock = await client.query(
              `SELECT reservation_id FROM parlay_xray_inflight WHERE user_id = $1 FOR UPDATE`,
              [input.userId]
            );
            if (lock.rows.length > 0) {
              await client.query('ROLLBACK');
              return { ok: false as const, reason: 'inflight' as XrayReserveFailure };
            }

            const cool = await client.query<{ last_attempt_at: Date }>(
              `SELECT last_attempt_at FROM parlay_xray_cooldowns WHERE user_id = $1 FOR UPDATE`,
              [input.userId]
            );
            const last = cool.rows[0]?.last_attempt_at?.getTime() ?? null;
            if (last != null && input.now - last < input.cooldownMs) {
              await client.query('ROLLBACK');
              return { ok: false as const, reason: 'cooldown' as XrayReserveFailure };
            }

            await client.query(
              `INSERT INTO parlay_xray_daily_counters (bucket_date, scope, count)
               VALUES ($1::date, 'global', 0)
               ON CONFLICT (bucket_date, scope) DO NOTHING`,
              [input.dayKey]
            );
            await client.query(
              `INSERT INTO parlay_xray_daily_counters (bucket_date, scope, count)
               VALUES ($1::date, $2, 0)
               ON CONFLICT (bucket_date, scope) DO NOTHING`,
              [input.dayKey, `user:${input.userId}`]
            );

            const global = await client.query<{ count: number }>(
              `SELECT count FROM parlay_xray_daily_counters WHERE bucket_date = $1::date AND scope = 'global' FOR UPDATE`,
              [input.dayKey]
            );
            const user = await client.query<{ count: number }>(
              `SELECT count FROM parlay_xray_daily_counters WHERE bucket_date = $1::date AND scope = $2 FOR UPDATE`,
              [input.dayKey, `user:${input.userId}`]
            );
            const globalUsed = global.rows[0]?.count ?? 0;
            const userUsed = user.rows[0]?.count ?? 0;
            if (userUsed >= input.userLimit) {
              await client.query('ROLLBACK');
              return { ok: false as const, reason: 'user_quota' as XrayReserveFailure };
            }
            if (globalUsed >= input.globalLimit) {
              await client.query('ROLLBACK');
              return { ok: false as const, reason: 'global_quota' as XrayReserveFailure };
            }

            await client.query(
              `UPDATE parlay_xray_daily_counters SET count = count + 1 WHERE bucket_date = $1::date AND scope = 'global'`,
              [input.dayKey]
            );
            await client.query(
              `UPDATE parlay_xray_daily_counters SET count = count + 1 WHERE bucket_date = $1::date AND scope = $2`,
              [input.dayKey, `user:${input.userId}`]
            );

            const reservationId = randomUUID();
            await client.query(
              `INSERT INTO parlay_xray_inflight (user_id, reservation_id, acquired_at, expires_at)
               VALUES ($1, $2, to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0))`,
              [input.userId, reservationId, input.now, input.now + input.inflightTtlMs]
            );
            await client.query('COMMIT');
            return {
              ok: true as const,
              reservation: { reservationId, dayKey: input.dayKey, userId: input.userId },
            };
          } catch (inner) {
            await client.query('ROLLBACK');
            throw inner;
          }
        });
      } catch (error) {
        if (isUndefinedTable(error)) {
          return { ok: false as const, reason: 'store_unavailable' as XrayReserveFailure };
        }
        throw error;
      }
    },

    async finalizeAttempt(reservation, record) {
      try {
        await withClient(pool, async (client) => {
          await client.query('BEGIN');
          try {
            await client.query(`DELETE FROM parlay_xray_inflight WHERE user_id = $1 AND reservation_id = $2`, [
              reservation.userId,
              reservation.reservationId,
            ]);
            await client.query(
              `INSERT INTO parlay_xray_cooldowns (user_id, last_attempt_at)
               VALUES ($1, $2::timestamptz)
               ON CONFLICT (user_id) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at`,
              [reservation.userId, record.timestamp]
            );
            await insertUsage(client, record);
            await client.query('COMMIT');
          } catch (inner) {
            await client.query('ROLLBACK');
            throw inner;
          }
        });
      } catch (error) {
        if (isUndefinedTable(error)) return;
        throw error;
      }
    },

    async releaseBeforeProvider(reservation) {
      try {
        await withClient(pool, async (client) => {
          await client.query('BEGIN');
          try {
            await client.query(`DELETE FROM parlay_xray_inflight WHERE user_id = $1 AND reservation_id = $2`, [
              reservation.userId,
              reservation.reservationId,
            ]);
            await client.query(
              `UPDATE parlay_xray_daily_counters SET count = GREATEST(count - 1, 0)
               WHERE bucket_date = $1::date AND scope = $2`,
              [reservation.dayKey, `user:${reservation.userId}`]
            );
            await client.query(
              `UPDATE parlay_xray_daily_counters SET count = GREATEST(count - 1, 0)
               WHERE bucket_date = $1::date AND scope = 'global'`,
              [reservation.dayKey]
            );
            await client.query('COMMIT');
          } catch (inner) {
            await client.query('ROLLBACK');
            throw inner;
          }
        });
      } catch (error) {
        if (isUndefinedTable(error)) return;
        throw error;
      }
    },

    async recordCacheHitUsage(record) {
      try {
        await withClient(pool, async (client) => {
          await insertUsage(client, record);
        });
      } catch (error) {
        if (isUndefinedTable(error)) return;
        throw error;
      }
    },
  };
}

type XrayExtractedJson = XrayCachedExtraction;

async function insertUsage(client: PoolClient, record: XrayUsageRecord): Promise<void> {
  await client.query(
    `INSERT INTO parlay_xray_extraction_usage (
       id, user_id, created_at, extraction_version, schema_version, model, image_hash,
       original_width, original_height, original_bytes,
       normalized_width, normalized_height, normalized_bytes,
       cache_hit, provider_attempted, success, latency_ms, provider_request_id,
       prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, error_category
     ) VALUES (
       $1, $2, $3::timestamptz, $4, $5, $6, $7,
       $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $17, $18,
       $19, $20, $21, $22, $23
     )`,
    [
      randomUUID(),
      record.userId,
      record.timestamp,
      record.extractionVersion,
      record.schemaVersion,
      record.model,
      record.imageHash,
      record.originalWidth,
      record.originalHeight,
      record.originalBytes,
      record.normalizedWidth,
      record.normalizedHeight,
      record.normalizedBytes,
      record.cacheHit,
      record.providerAttempted,
      record.success,
      record.latencyMs,
      record.providerRequestId,
      record.promptTokens,
      record.completionTokens,
      record.totalTokens,
      record.estimatedCostUsd,
      record.errorCategory,
    ]
  );
}
