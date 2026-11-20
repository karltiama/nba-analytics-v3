import { describe, expect, it } from 'vitest';
import {
  CLUSTER_HALT_BYTES,
  CLUSTER_RESTRICT_BYTES,
  CLUSTER_WARNING_BYTES,
  CURRENT_SEASON_BOX_OPERATION_CAP_BYTES,
  FIVE_HUNDRED_MEBIBYTES,
  FREE_PLAN_QUOTA_BYTES,
  REQUIRED_CLUSTER_DATABASE_NAMES,
  STORAGE_MEASUREMENT_MAX_AGE_MS,
  assessClusterMeasurement,
  classifyFreePlanQuota,
  currentDatabaseQuotaIsFalsePass,
  decideHistoricalRecovery,
  decideLabeledStorageWrite,
  resolveStorageWriteCategory,
  sumClusterDatabaseBytes,
  type StorageMeasurement,
  type StorageOperationKind,
  type StoragePayloadEstimate,
  type StorageWriteCategory,
} from '@/lib/ops/storage-budget';
import * as storageBudget from '@/lib/ops/storage-budget';

function admit(
  category: StorageWriteCategory,
  measurement: StorageMeasurement,
  now: string,
  payload?: StoragePayloadEstimate
) {
  const kind: StorageOperationKind =
    category === 'current_season_box' ? 'current_season_ingestion' : category === 'injury' ? 'injury_ingestion' : category;
  const requestedCategory: StorageWriteCategory = category === 'current_season_box' ? 'optional_backfill' : 'current_season_box';
  return decideLabeledStorageWrite({ kind, requestedCategory }, measurement, now, payload);
}

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
    const decision = admit('historical_raw_props', { ...fresh, clusterBytes: 350_000_000 }, now);
    expect(decision.pressure).toBe('warning');
    expect(decision.allowed).toBe(true);
  });

  it('stops optional historical writes at 400,000,000 bytes', () => {
    expect(CLUSTER_RESTRICT_BYTES).toBe(400_000_000);
    for (const category of ['historical_raw_props', 'historical_raw_odds', 'optional_backfill'] as const) {
      expect(admit(category, { ...fresh, clusterBytes: 400_000_000 }, now).allowed).toBe(false);
    }
    expect(admit('current_board', { ...fresh, clusterBytes: 400_000_000 }, now).allowed).toBe(true);
  });

  it('stops high-volume writes at 450,000,000 bytes', () => {
    expect(CLUSTER_HALT_BYTES).toBe(450_000_000);
    expect(admit('current_board', { ...fresh, clusterBytes: 450_000_000 }, now).allowed).toBe(false);
    expect(admit('scoreboard', { ...fresh, clusterBytes: 450_000_000 }, now).allowed).toBe(false);
    expect(admit('game_status', { ...fresh, clusterBytes: 450_000_000 }, now).allowed).toBe(false);
    expect(admit('game_status', { ...fresh, clusterBytes: 449_999_999 }, now).allowed).toBe(true);
  });

  it('stops every PostgreSQL write at the 500,000,000 byte quota and still allows S3', () => {
    const measurement = { ...fresh, clusterBytes: 500_000_000 };
    expect(admit('game_status', measurement, now).allowed).toBe(false);
    expect(admit('current_board', measurement, now).allowed).toBe(false);
    expect(admit('s3_archive', measurement, now).allowed).toBe(true);
  });

  it('rejects a missing measurement for database writes', () => {
    expect(admit('historical_raw_props', { valid: false, clusterBytes: 1, measuredAt: fresh.measuredAt }, now).pressure).toBe('unmeasured');
    expect(admit('current_board', { valid: true, clusterBytes: null, measuredAt: fresh.measuredAt }, now).allowed).toBe(false);
  });

  it('rejects a stale small measurement', () => {
    const measuredAt = new Date(Date.parse(now) - STORAGE_MEASUREMENT_MAX_AGE_MS - 1).toISOString();
    const decision = admit('historical_raw_props', { valid: true, clusterBytes: 1_000, measuredAt }, now);
    expect(decision.pressure).toBe('stale');
    expect(decision.allowed).toBe(false);
  });

  it('keeps S3 archival eligible while database writes are halted', () => {
    const measurement = { ...fresh, clusterBytes: 1_176_416_433 };
    expect(admit('historical_raw_props', measurement, now).allowed).toBe(false);
    expect(admit('current_board', measurement, now).allowed).toBe(false);
    expect(admit('scoreboard', measurement, now).allowed).toBe(false);
    expect(admit('game_status', measurement, now).allowed).toBe(false);
    expect(admit('s3_archive', measurement, now).allowed).toBe(true);
    expect(admit('s3_archive', { valid: false }, now).allowed).toBe(true);
  });
});

describe('current-season box admission', () => {
  const now = '2026-11-18T20:00:00.000Z';
  const fresh = { valid: true as const, measuredAt: '2026-11-18T19:30:00.000Z' };
  const withinCap = { estimatedPayloadBytes: 1_000_000 };

  it('allows a current-season box write under restrict', () => {
    expect(CLUSTER_RESTRICT_BYTES).toBe(400_000_000);
    const decision = admit(
      'current_season_box',
      { ...fresh, clusterBytes: CLUSTER_RESTRICT_BYTES },
      now,
      withinCap
    );
    expect(decision.pressure).toBe('restrict');
    expect(decision.allowed).toBe(true);
    expect(admit('optional_backfill', { ...fresh, clusterBytes: CLUSTER_RESTRICT_BYTES }, now).allowed).toBe(false);
    expect(admit('current_board', { ...fresh, clusterBytes: CLUSTER_RESTRICT_BYTES }, now).allowed).toBe(true);
  });

  it('denies a current-season box write at halt', () => {
    expect(CLUSTER_HALT_BYTES).toBe(450_000_000);
    const decision = admit(
      'current_season_box',
      { ...fresh, clusterBytes: CLUSTER_HALT_BYTES },
      now,
      withinCap
    );
    expect(decision.pressure).toBe('halt');
    expect(decision.allowed).toBe(false);
    expect(admit('game_status', { ...fresh, clusterBytes: CLUSTER_HALT_BYTES }, now).allowed).toBe(false);
    expect(admit('game_status', { ...fresh, clusterBytes: CLUSTER_HALT_BYTES - 1 }, now).allowed).toBe(true);
  });

  it('allows the 2,000,000 byte cap and denies one byte over it', () => {
    expect(CURRENT_SEASON_BOX_OPERATION_CAP_BYTES).toBe(2_000_000);
    const measurement = { ...fresh, clusterBytes: CLUSTER_RESTRICT_BYTES };
    expect(admit('current_season_box', measurement, now, { estimatedPayloadBytes: 2_000_000 }).allowed).toBe(true);
    const oversized = admit('current_season_box', measurement, now, { estimatedPayloadBytes: 2_000_001 });
    expect(oversized.allowed).toBe(false);
    expect(oversized.reason).toContain('2,000,000');
  });

  it('denies a current-season box write without an integer payload estimate', () => {
    const measurement = { ...fresh, clusterBytes: CLUSTER_RESTRICT_BYTES };
    expect(admit('current_season_box', measurement, now).allowed).toBe(false);
    expect(admit('current_season_box', measurement, now, { estimatedPayloadBytes: 1.5 }).allowed).toBe(false);
    expect(admit('current_season_box', measurement, now, { estimatedPayloadBytes: -1 }).allowed).toBe(false);
  });

  it('denies a stale, missing, invalid, or future-dated measurement', () => {
    const staleAt = new Date(Date.parse(now) - STORAGE_MEASUREMENT_MAX_AGE_MS - 1).toISOString();
    const stale = admit(
      'current_season_box',
      { valid: true, clusterBytes: 1_000, measuredAt: staleAt },
      now,
      withinCap
    );
    expect(stale.pressure).toBe('stale');
    expect(stale.allowed).toBe(false);
    expect(admit('current_season_box', { valid: false, clusterBytes: 1_000, measuredAt: fresh.measuredAt }, now, withinCap).allowed).toBe(false);
    expect(admit('current_season_box', { valid: true, clusterBytes: null, measuredAt: fresh.measuredAt }, now, withinCap).pressure).toBe('unmeasured');
    expect(admit('current_season_box', { valid: true, clusterBytes: 1_000 }, now, withinCap).allowed).toBe(false);
    const future = admit(
      'current_season_box',
      { valid: true, clusterBytes: 1_000, measuredAt: '2026-11-18T20:00:00.001Z' },
      now,
      withinCap
    );
    expect(future.allowed).toBe(false);
    expect(future.pressure).toBe('stale');
    expect(future.reason).toContain('future-dated');
  });

  it('does not let a historical backfill become a current-season box by relabeling', () => {
    const measurement = { ...fresh, clusterBytes: CLUSTER_RESTRICT_BYTES };
    expect(
      resolveStorageWriteCategory({ kind: 'historical_backfill', requestedCategory: 'current_season_box' })
    ).toBe('optional_backfill');
    const relabeled = decideLabeledStorageWrite(
      { kind: 'historical_backfill', requestedCategory: 'current_season_box' },
      measurement,
      now,
      withinCap
    );
    expect(relabeled.category).toBe('optional_backfill');
    expect(relabeled.allowed).toBe(false);
    const currentSeason = decideLabeledStorageWrite(
      { kind: 'current_season_ingestion', requestedCategory: 'optional_backfill' },
      measurement,
      now,
      withinCap
    );
    expect(currentSeason.category).toBe('current_season_box');
    expect(currentSeason.allowed).toBe(true);
  });

  it('does not authorize historical recovery or the 36-game repair', () => {
    const measurement = { ...fresh, clusterBytes: 1_000 };
    const gameIds = Array.from({ length: 36 }, (_, index) => String(21_718_095 + index));
    const decision = decideHistoricalRecovery(
      { requestedCategory: 'current_season_box', approved: true, gameIds },
      measurement,
      now
    );
    expect(decision.category).toBe('optional_backfill');
    expect(decision.allowed).toBe(false);
    const throughKind = decideLabeledStorageWrite(
      { kind: 'historical_recovery', requestedCategory: 'current_season_box', approved: true, gameIds },
      measurement,
      now,
      withinCap
    );
    expect(throughKind.category).toBe('optional_backfill');
    expect(throughKind.allowed).toBe(false);
    const withGrantField = decideHistoricalRecovery(
      {
        approved: true,
        gameIds: ['21718095'],
        oneDay: { date: '2026-11-13', approval: 'one-day-recovery:2026-11-13' },
      } as never,
      measurement,
      now
    );
    expect(withGrantField.allowed).toBe(false);
    expect(withGrantField.reason).toContain('do not grant it');
    expect(admit('current_season_box', measurement, now, withinCap).category).toBe('current_season_box');
    expect(admit('current_season_box', measurement, now, withinCap).allowed).toBe(true);
  });

  it('keeps the S3 exemption when a current-season box write is halted', () => {
    const measurement = { ...fresh, clusterBytes: FREE_PLAN_QUOTA_BYTES };
    expect(admit('current_season_box', measurement, now, withinCap).allowed).toBe(false);
    expect(admit('s3_archive', { valid: false }, now).allowed).toBe(true);
  });

  it('allows one byte under halt and denies the halt byte, including a zero payload estimate', () => {
    const underHalt = { ...fresh, clusterBytes: CLUSTER_HALT_BYTES - 1 };
    expect(admit('current_season_box', underHalt, now, { estimatedPayloadBytes: 0 }).allowed).toBe(true);
    expect(admit('current_season_box', underHalt, now, { estimatedPayloadBytes: 2_000_000 }).allowed).toBe(true);
    expect(admit('current_season_box', { ...fresh, clusterBytes: CLUSTER_HALT_BYTES }, now, { estimatedPayloadBytes: 0 }).allowed).toBe(false);
  });
});

describe('admission runtime seal', () => {
  const now = '2026-11-18T20:00:00.000Z';
  const fresh = { valid: true as const, measuredAt: '2026-11-18T19:30:00.000Z', clusterBytes: 1_000 };
  const payload = { estimatedPayloadBytes: 1_000 };

  it('does not export a category-only admission function', () => {
    expect(storageBudget).not.toHaveProperty('decideStorageWrite');
  });

  it('denies unknown categories and kinds, including a category string used as a kind', () => {
    const inputs: unknown[] = [
      null,
      'current_season_box',
      { kind: 'current_season_box', requestedCategory: 'current_season_box' },
      { kind: 'not-a-kind' },
      { kind: null },
      { kind: 1 },
      { category: 'current_season_box' },
    ];
    for (const input of inputs) {
      const decision = decideLabeledStorageWrite(input as never, fresh, now, payload);
      expect(decision.allowed).toBe(false);
    }
    const unknownKind = decideLabeledStorageWrite({ kind: 'current_season_box' } as never, fresh, now, payload);
    expect(unknownKind.category).toBeNull();
    expect(resolveStorageWriteCategory({ kind: 'current_season_box', requestedCategory: 'current_season_box' })).toBeNull();
    expect(resolveStorageWriteCategory(null)).toBeNull();
    const historicalLabel = decideLabeledStorageWrite(
      { kind: 'historical_backfill', requestedCategory: 'not-a-category' } as never,
      { ...fresh, clusterBytes: CLUSTER_RESTRICT_BYTES },
      now,
      payload
    );
    expect(historicalLabel.category).toBe('optional_backfill');
    expect(historicalLabel.allowed).toBe(false);
  });
});

describe('cluster measurement completeness', () => {
  const phaseB1 = [
    { datname: 'postgres', bytes: 463_572_115 },
    { datname: 'template1', bytes: 7_586_319 },
    { datname: 'template0', bytes: 7_504_399, datallowconn: false },
  ];

  it('accepts the Phase B1 databases, including template0, only when the independent total matches', () => {
    expect(REQUIRED_CLUSTER_DATABASE_NAMES).toEqual(['postgres', 'template1', 'template0']);
    const assessed = assessClusterMeasurement(phaseB1, 478_662_833);
    expect(assessed.valid).toBe(true);
    expect(assessed.clusterBytes).toBe(478_662_833);
  });

  it('rejects a partial sum that drops template0 even when that partial sum is passed as the total', () => {
    const withoutTemplate0 = phaseB1.filter((row) => row.datname !== 'template0');
    const partial = 463_572_115 + 7_586_319;
    expect(assessClusterMeasurement(withoutTemplate0, partial).valid).toBe(false);
    expect(assessClusterMeasurement(withoutTemplate0, partial).clusterBytes).toBeNull();
    expect(assessClusterMeasurement([{ datname: 'postgres', bytes: 463_572_115 }], 463_572_115).valid).toBe(false);
  });

  it('rejects a row sum that does not match the independent total', () => {
    const assessed = assessClusterMeasurement(phaseB1, 478_662_832);
    expect(assessed.valid).toBe(false);
    expect(assessed.clusterBytes).toBeNull();
  });

  it('keeps an extra database in the sum and rejects a repeated name', () => {
    const withExtra = [...phaseB1, { datname: 'extra', bytes: 10 }];
    expect(assessClusterMeasurement(withExtra, 478_662_843).valid).toBe(true);
    const repeated = [...phaseB1, { datname: 'template0', bytes: 1 }];
    expect(assessClusterMeasurement(repeated, 478_662_834).valid).toBe(false);
  });
});
