import { randomUUID } from 'node:crypto';
import type {
  XrayCachedExtraction,
  XrayExtractionStore,
  XrayQuotaSnapshot,
  XrayReservation,
  XrayReserveFailure,
  XrayReserveInput,
  XrayUsageRecord,
} from './store';

type CounterKey = string;

function userCounterKey(dayKey: string, userId: string): CounterKey {
  return `${dayKey}:user:${userId}`;
}

function globalCounterKey(dayKey: string): CounterKey {
  return `${dayKey}:global`;
}

/**
 * Process-local store. Race-safe via a mutex. Suitable for tests and a
 * single-instance operator canary. Not durable across deploys or instances.
 */
export function createMemoryXrayStore(): XrayExtractionStore & { usage: XrayUsageRecord[] } {
  const counters = new Map<CounterKey, number>();
  const inflight = new Map<string, { reservationId: string; expiresAt: number }>();
  const lastAttempt = new Map<string, number>();
  const cache = new Map<string, { value: XrayCachedExtraction; expiresAt: number }>();
  const usage: XrayUsageRecord[] = [];
  let chain: Promise<unknown> = Promise.resolve();

  const locked = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  return {
    usage,
    async getQuota(userId, dayKey) {
      return locked(() => ({
        userUsed: counters.get(userCounterKey(dayKey, userId)) ?? 0,
        globalUsed: counters.get(globalCounterKey(dayKey)) ?? 0,
        lastAttemptAt: lastAttempt.get(userId) ?? null,
      }));
    },
    async getCached(identity, now) {
      return locked(() => {
        const hit = cache.get(identity);
        if (!hit || hit.expiresAt <= now) {
          if (hit) cache.delete(identity);
          return null;
        }
        return {
          result: hit.value.result,
          legs: hit.value.legs.map((leg) => ({ ...leg })),
        };
      });
    },
    async putCached(identity, value, now, ttlMs) {
      return locked(() => {
        cache.set(identity, { value: { result: value.result, legs: value.legs.map((l) => ({ ...l })) }, expiresAt: now + ttlMs });
      });
    },
    async reserve(input: XrayReserveInput) {
      return locked((): { ok: true; reservation: XrayReservation } | { ok: false; reason: XrayReserveFailure } => {
        const existing = inflight.get(input.userId);
        if (existing && existing.expiresAt > input.now) {
          return { ok: false, reason: 'inflight' };
        }
        if (existing) inflight.delete(input.userId);

        const last = lastAttempt.get(input.userId);
        if (last != null && input.now - last < input.cooldownMs) {
          return { ok: false, reason: 'cooldown' };
        }

        const userKey = userCounterKey(input.dayKey, input.userId);
        const globalKey = globalCounterKey(input.dayKey);
        const userUsed = counters.get(userKey) ?? 0;
        const globalUsed = counters.get(globalKey) ?? 0;
        if (userUsed >= input.userLimit) return { ok: false, reason: 'user_quota' };
        if (globalUsed >= input.globalLimit) return { ok: false, reason: 'global_quota' };

        counters.set(userKey, userUsed + 1);
        counters.set(globalKey, globalUsed + 1);
        const reservationId = randomUUID();
        inflight.set(input.userId, { reservationId, expiresAt: input.now + input.inflightTtlMs });
        return {
          ok: true,
          reservation: { reservationId, dayKey: input.dayKey, userId: input.userId },
        };
      });
    },
    async finalizeAttempt(reservation: XrayReservation, record: XrayUsageRecord) {
      return locked(() => {
        const lock = inflight.get(reservation.userId);
        if (lock && lock.reservationId === reservation.reservationId) {
          inflight.delete(reservation.userId);
        }
        lastAttempt.set(reservation.userId, Date.parse(record.timestamp) || Date.now());
        usage.push(record);
      });
    },
    async releaseBeforeProvider(reservation: XrayReservation) {
      return locked(() => {
        const lock = inflight.get(reservation.userId);
        if (lock && lock.reservationId === reservation.reservationId) {
          inflight.delete(reservation.userId);
        }
        const userKey = userCounterKey(reservation.dayKey, reservation.userId);
        const globalKey = globalCounterKey(reservation.dayKey);
        const userUsed = counters.get(userKey) ?? 0;
        const globalUsed = counters.get(globalKey) ?? 0;
        if (userUsed > 0) counters.set(userKey, userUsed - 1);
        if (globalUsed > 0) counters.set(globalKey, globalUsed - 1);
      });
    },
    async recordCacheHitUsage(record: XrayUsageRecord) {
      return locked(() => {
        usage.push(record);
      });
    },
  };
}

export function snapshotQuota(store: XrayExtractionStore, userId: string, dayKey: string): Promise<XrayQuotaSnapshot> {
  return store.getQuota(userId, dayKey);
}
