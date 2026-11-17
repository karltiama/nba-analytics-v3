import { describe, expect, it } from 'vitest';
import {
  CLUSTER_HALT_BYTES,
  CLUSTER_RESTRICT_BYTES,
  CLUSTER_WARNING_BYTES,
  FIVE_HUNDRED_MEBIBYTES,
  FREE_PLAN_QUOTA_BYTES,
  STORAGE_MEASUREMENT_MAX_AGE_MS,
  classifyFreePlanQuota,
  currentDatabaseQuotaIsFalsePass,
  decideStorageWrite,
  sumClusterDatabaseBytes,
} from '@/lib/ops/storage-budget';

describe('free-plan cluster quota', () => {
  it('uses 500,000,000 bytes and not 500 MiB', () => {
    expect(FREE_PLAN_QUOTA_BYTES).toBe(500_000_000);
    expect(FIVE_HUNDRED_MEBIBYTES).toBe(524_288_000);
    expect(FREE_PLAN_QUOTA_BYTES).not.toBe(FIVE_HUNDRED_MEBIBYTES);
  });

  it('classifies below, at, and above the quota', () => {
    expect(classifyFreePlanQuota(499_999_999)).toMatchObject({ status: 'under', pass: true });
    expect(classifyFreePlanQuota(500_000_000)).toMatchObject({ status: 'at_quota', pass: false });
    expect(classifyFreePlanQuota(500_000_001)).toMatchObject({ status: 'over', pass: false });
  });

  it('sums every database in the cluster', () => {
    const measured = sumClusterDatabaseBytes([
      { datname: 'postgres', bytes: '400000000' },
      { datname: 'template1', bytes: 100_000_001 },
    ]);
    expect(measured.ok).toBe(true);
    if (!measured.ok) return;
    expect(measured.databases).toHaveLength(2);
    expect(measured.clusterBytes).toBe(500_000_001);
    expect(classifyFreePlanQuota(measured.clusterBytes).status).toBe('over');
  });

  it('does not pass when only the current database is under the quota', () => {
    const postgresBytes = 499_000_000;
    const clusterBytes = postgresBytes + 15_090_718;
    expect(classifyFreePlanQuota(postgresBytes).pass).toBe(true);
    expect(classifyFreePlanQuota(clusterBytes).pass).toBe(false);
    expect(currentDatabaseQuotaIsFalsePass(postgresBytes, clusterBytes)).toBe(true);
    expect(postgresBytes).toBeLessThan(FIVE_HUNDRED_MEBIBYTES);
    expect(clusterBytes).toBeGreaterThan(FREE_PLAN_QUOTA_BYTES);
  });

  it('fails closed when the measurement is missing or invalid', () => {
    expect(sumClusterDatabaseBytes(null)).toEqual({ ok: false, reason: 'missing' });
    expect(sumClusterDatabaseBytes([])).toEqual({ ok: false, reason: 'missing' });
    expect(sumClusterDatabaseBytes([{ datname: 'postgres', bytes: 'nope' }])).toEqual({ ok: false, reason: 'invalid' });
    expect(sumClusterDatabaseBytes([{ datname: '', bytes: 1 }])).toEqual({ ok: false, reason: 'invalid' });
    expect(classifyFreePlanQuota(null)).toMatchObject({ status: 'unmeasured', pass: false, clusterBytes: null });
    expect(classifyFreePlanQuota(Number.NaN).pass).toBe(false);
    expect(classifyFreePlanQuota(-1).pass).toBe(false);
  });
});

describe('storage write gate', () => {
  const now = '2026-11-13T20:00:00.000Z';
  const fresh = { valid: true as const, measuredAt: '2026-11-13T19:30:00.000Z' };

  it('warns at 350,000,000 bytes and still allows historical writes', () => {
    expect(CLUSTER_WARNING_BYTES).toBe(350_000_000);
    const decision = decideStorageWrite('historical_raw_props', { ...fresh, clusterBytes: 350_000_000 }, now);
    expect(decision.pressure).toBe('warning');
    expect(decision.allowed).toBe(true);
  });

  it('stops optional historical writes at 400,000,000 bytes', () => {
    expect(CLUSTER_RESTRICT_BYTES).toBe(400_000_000);
    for (const category of ['historical_raw_props', 'historical_raw_odds', 'optional_backfill'] as const) {
      expect(decideStorageWrite(category, { ...fresh, clusterBytes: 400_000_000 }, now).allowed).toBe(false);
    }
    expect(decideStorageWrite('current_board', { ...fresh, clusterBytes: 400_000_000 }, now).allowed).toBe(true);
  });

  it('stops high-volume writes at 450,000,000 bytes', () => {
    expect(CLUSTER_HALT_BYTES).toBe(450_000_000);
    expect(decideStorageWrite('current_board', { ...fresh, clusterBytes: 450_000_000 }, now).allowed).toBe(false);
    expect(decideStorageWrite('scoreboard', { ...fresh, clusterBytes: 450_000_000 }, now).allowed).toBe(false);
    expect(decideStorageWrite('game_status', { ...fresh, clusterBytes: 450_000_000 }, now).allowed).toBe(true);
  });

  it('stops every PostgreSQL write at the 500,000,000 byte quota and still allows S3', () => {
    const measurement = { ...fresh, clusterBytes: 500_000_000 };
    expect(decideStorageWrite('game_status', measurement, now).allowed).toBe(false);
    expect(decideStorageWrite('current_board', measurement, now).allowed).toBe(false);
    expect(decideStorageWrite('s3_archive', measurement, now).allowed).toBe(true);
  });

  it('rejects a missing measurement for database writes', () => {
    expect(decideStorageWrite('historical_raw_props', { valid: false, clusterBytes: 1, measuredAt: fresh.measuredAt }, now).pressure).toBe('unmeasured');
    expect(decideStorageWrite('current_board', { valid: true, clusterBytes: null, measuredAt: fresh.measuredAt }, now).allowed).toBe(false);
  });

  it('rejects a stale small measurement', () => {
    const measuredAt = new Date(Date.parse(now) - STORAGE_MEASUREMENT_MAX_AGE_MS - 1).toISOString();
    const decision = decideStorageWrite('historical_raw_props', { valid: true, clusterBytes: 1_000, measuredAt }, now);
    expect(decision.pressure).toBe('stale');
    expect(decision.allowed).toBe(false);
  });

  it('keeps S3 archival eligible while database writes are halted', () => {
    const measurement = { ...fresh, clusterBytes: 1_176_416_433 };
    expect(decideStorageWrite('historical_raw_props', measurement, now).allowed).toBe(false);
    expect(decideStorageWrite('current_board', measurement, now).allowed).toBe(false);
    expect(decideStorageWrite('scoreboard', measurement, now).allowed).toBe(false);
    expect(decideStorageWrite('game_status', measurement, now).allowed).toBe(false);
    expect(decideStorageWrite('s3_archive', measurement, now).allowed).toBe(true);
    expect(decideStorageWrite('s3_archive', { valid: false }, now).allowed).toBe(true);
  });
});
