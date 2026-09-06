import { describe, expect, it } from 'vitest';
import {
  classifyArchiveManifest,
  classifyCoverage,
  classifyIngestionSource,
  classifyInjuryServing,
  classifyPruneOutcome,
  rollupHealthStatus,
} from '@/lib/ops/health-status';

const now = new Date('2026-09-06T18:00:00.000Z');

describe('classifyIngestionSource', () => {
  it('frozen + no recent ingest is expected', () => {
    const r = classifyIngestionSource({
      frozen: true,
      latestStatus: 'success',
      lastSuccessAt: new Date('2026-05-06T18:00:00.000Z'),
      lastStartedAt: new Date('2026-05-06T18:00:00.000Z'),
      now,
    });
    expect(r.status).toBe('FROZEN_EXPECTED');
  });

  it('live + fresh success is healthy', () => {
    const r = classifyIngestionSource({
      frozen: false,
      latestStatus: 'success',
      lastSuccessAt: new Date('2026-09-06T12:00:00.000Z'),
      lastStartedAt: new Date('2026-09-06T12:00:00.000Z'),
      now,
      staleHours: 24,
    });
    expect(r.status).toBe('HEALTHY');
  });

  it('live + stale success is stale', () => {
    const r = classifyIngestionSource({
      frozen: false,
      latestStatus: 'success',
      lastSuccessAt: new Date('2026-05-06T18:00:00.000Z'),
      lastStartedAt: new Date('2026-05-06T18:00:00.000Z'),
      now,
      staleHours: 24,
    });
    expect(r.status).toBe('STALE');
  });

  it('live + latest error is FAILED', () => {
    const r = classifyIngestionSource({
      frozen: false,
      latestStatus: 'error',
      lastSuccessAt: new Date('2026-09-06T12:00:00.000Z'),
      lastStartedAt: new Date('2026-09-06T17:00:00.000Z'),
      now,
    });
    expect(r.status).toBe('FAILED');
  });

  it('frozen + old leftover started run is expected, not stuck', () => {
    const r = classifyIngestionSource({
      frozen: true,
      latestStatus: 'started',
      lastSuccessAt: new Date('2026-05-02T18:00:00.000Z'),
      lastStartedAt: new Date('2026-05-06T18:00:00.000Z'),
      now,
    });
    expect(r.status).toBe('FROZEN_EXPECTED');
  });

  it('recent started run while frozen is degraded', () => {
    const r = classifyIngestionSource({
      frozen: true,
      latestStatus: 'started',
      lastSuccessAt: new Date('2026-05-06T18:00:00.000Z'),
      lastStartedAt: new Date('2026-09-06T16:00:00.000Z'),
      now,
    });
    expect(r.status).toBe('DEGRADED');
  });

  it('stuck started is degraded', () => {
    const r = classifyIngestionSource({
      frozen: false,
      latestStatus: 'started',
      lastSuccessAt: new Date('2026-09-06T10:00:00.000Z'),
      lastStartedAt: new Date('2026-09-06T16:00:00.000Z'),
      now,
      stuckMinutes: 30,
    });
    expect(r.status).toBe('DEGRADED');
    expect(r.reason).toMatch(/stuck/);
  });

  it('recent success while frozen is degraded', () => {
    const r = classifyIngestionSource({
      frozen: true,
      latestStatus: 'success',
      lastSuccessAt: new Date('2026-09-06T16:00:00.000Z'),
      lastStartedAt: new Date('2026-09-06T16:00:00.000Z'),
      now,
    });
    expect(r.status).toBe('DEGRADED');
    expect(r.reason).toMatch(/freeze/);
  });
});

describe('classifyCoverage / archive / prune', () => {
  it('unresolved coverage > 0 is degraded', () => {
    expect(classifyCoverage(0).status).toBe('HEALTHY');
    expect(classifyCoverage(12).status).toBe('DEGRADED');
    expect(classifyCoverage(null).status).toBe('UNKNOWN');
  });

  it('failed archive is FAILED', () => {
    expect(classifyArchiveManifest({ present: false, status: null, recordCount: null }).status).toBe(
      'UNKNOWN'
    );
    expect(
      classifyArchiveManifest({ present: true, status: 'error', recordCount: 10 }).status
    ).toBe('FAILED');
    expect(
      classifyArchiveManifest({ present: true, status: 'success', recordCount: 24469 }).status
    ).toBe('HEALTHY');
  });

  it('safely refused dry-run prune is not a generic failure', () => {
    const r = classifyPruneOutcome({
      dryRun: true,
      outcome: 'aborted',
      pruneAllowed: false,
      maxDeleteAllowed: false,
      archiveOk: true,
      coverageOk: true,
    });
    expect(r.status).toBe('HEALTHY');
    expect(r.reason).toMatch(/refused safely/);
  });

  it('freeze-skipped prune is FROZEN_EXPECTED', () => {
    expect(
      classifyPruneOutcome({
        dryRun: true,
        outcome: 'skipped',
        pruneAllowed: false,
        maxDeleteAllowed: null,
        archiveOk: null,
        coverageOk: null,
      }).status
    ).toBe('FROZEN_EXPECTED');
  });

  it('missing prune metric is UNKNOWN rather than crash', () => {
    expect(
      classifyPruneOutcome({
        dryRun: true,
        outcome: null,
        pruneAllowed: null,
        maxDeleteAllowed: null,
        archiveOk: null,
        coverageOk: null,
      }).status
    ).toBe('UNKNOWN');
  });
});

describe('classifyInjuryServing', () => {
  it('frozen current injury is not authoritative', () => {
    const r = classifyInjuryServing({
      frozen: true,
      snapshotAt: new Date('2026-05-06T18:00:00.000Z'),
      now,
      freshnessHours: 36,
    });
    expect(r.status).toBe('FROZEN_EXPECTED');
    expect(r.authoritative).toBe(false);
  });
});

describe('rollupHealthStatus', () => {
  it('failed outranks frozen expected', () => {
    expect(rollupHealthStatus(['FROZEN_EXPECTED', 'HEALTHY', 'FAILED'])).toBe('FAILED');
    expect(rollupHealthStatus(['FROZEN_EXPECTED', 'HEALTHY'])).toBe('FROZEN_EXPECTED');
  });
});
