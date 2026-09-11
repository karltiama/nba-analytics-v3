import { describe, expect, it } from 'vitest';
import { ingestionRunIsPartial } from '@/lib/ops/ingestion-run-result';
import {
  classifyFeedFreshness,
  classifyIdentityObservability,
  classifyIdentityRunSpike,
  classifyProviderErrors,
  classifyMissedRun,
  classifyQueueHealth,
  classifyReservedConcurrency,
  classifyScheduleCompleteness,
  classifyScheduleMismatch,
  classifyVolumeAnomaly,
  correlateExecutionAndFreshness,
  INGESTION_FAMILY_CATALOG,
  resolveFeedConfig,
  rollupScheduleObserved,
  SCHEDULE_2026_EXPECTED_RS,
  SCHEDULE_2026_PROVIDER_PUBLISHED,
  SCHEDULE_2026_UNPUBLISHED,
} from '@/lib/ops/ingestion-observability';
import { INGESTION_CADENCE } from '@/lib/ops/ingestion-cadence';

const now = new Date('2026-09-10T18:00:00.000Z');
const injuries = INGESTION_FAMILY_CATALOG.find((f) => f.id === 'injuries')!;
const role = INGESTION_FAMILY_CATALOG.find((f) => f.id === 'season_averages_role')!;
const mm = INGESTION_FAMILY_CATALOG.find((f) => f.id === 'market_movement_capture')!;

describe('feed config vs freshness', () => {
  it('frozen feed with no recent run is FROZEN, not stale/error', () => {
    const config = resolveFeedConfig({
      family: injuries,
      liveIngestionEnabled: false,
      freezeSkipsMutations: true,
      goatSubscriptionActive: false,
    });
    expect(config).toBe('FROZEN');
    const r = classifyFeedFreshness({
      config,
      lastSuccessAt: null,
      now,
      slaHours: 36,
    });
    expect(r.state).toBe('FROZEN');
    expect(r.health).toBe('FROZEN_EXPECTED');
  });

  it('active fresh feed is FRESH', () => {
    const r = classifyFeedFreshness({
      config: 'ACTIVE',
      lastSuccessAt: new Date('2026-09-10T12:00:00.000Z'),
      now,
      slaHours: 36,
    });
    expect(r.state).toBe('FRESH');
    expect(r.health).toBe('HEALTHY');
  });

  it('active stale feed is STALE', () => {
    const r = classifyFeedFreshness({
      config: 'ACTIVE',
      lastSuccessAt: new Date('2026-09-08T12:00:00.000Z'),
      now,
      slaHours: 36,
    });
    expect(r.state).toBe('STALE');
    expect(r.health).toBe('STALE');
  });

  it('never-seen active feed is UNAVAILABLE', () => {
    const r = classifyFeedFreshness({
      config: 'ACTIVE',
      lastSuccessAt: null,
      now,
      slaHours: 12,
    });
    expect(r.state).toBe('UNAVAILABLE');
    expect(r.health).toBe('UNKNOWN');
  });

  it('subscription blocked is BLOCKED, not generic FAILED', () => {
    const config = resolveFeedConfig({
      family: injuries,
      liveIngestionEnabled: true,
      freezeSkipsMutations: false,
      goatSubscriptionActive: false,
    });
    expect(config).toBe('BLOCKED_BY_SUBSCRIPTION');
    const r = classifyFeedFreshness({
      config,
      lastSuccessAt: null,
      now,
      slaHours: 36,
    });
    expect(r.state).toBe('BLOCKED');
    expect(r.health).toBe('BLOCKED');
    const provider = classifyProviderErrors({
      config,
      counts: { http401: 3, http403: 0, http429: 0, http5xx: 0, timeout: 0, malformed: 0 },
    });
    expect(provider.health).toBe('BLOCKED');
    expect(provider.reason).toMatch(/subscription-blocked/);
  });

  it('manual-only and not-deployed stay frozen, not unhealthy', () => {
    expect(
      resolveFeedConfig({
        family: role,
        liveIngestionEnabled: true,
        freezeSkipsMutations: false,
        goatSubscriptionActive: true,
      })
    ).toBe('MANUAL_ONLY');
    expect(
      resolveFeedConfig({
        family: mm,
        liveIngestionEnabled: true,
        freezeSkipsMutations: false,
        goatSubscriptionActive: true,
      })
    ).toBe('NOT_DEPLOYED');
  });
});

describe('identity observability', () => {
  it('no quarantine rows is healthy even with Class C census 81', () => {
    const r = classifyIdentityObservability({
      unresolved: 0,
      conflicts: 0,
      resolved: 0,
      classCCanonical: 81,
    });
    expect(r.health).toBe('HEALTHY');
    expect(r.alert).toBe(false);
    expect(r.reason).toMatch(/Class C/);
  });

  it('unresolved ingest observation is visible and distinct from conflict', () => {
    const unresolved = classifyIdentityObservability({
      unresolved: 2,
      conflicts: 0,
      resolved: 0,
      classCCanonical: 81,
    });
    const conflict = classifyIdentityObservability({
      unresolved: 0,
      conflicts: 1,
      resolved: 4,
      classCCanonical: 81,
    });
    expect(unresolved.alert).toBe(true);
    expect(unresolved.reason).toMatch(/quarantine/);
    expect(conflict.alert).toBe(true);
    expect(conflict.reason).toMatch(/conflict/);
    expect(conflict.reason).not.toBe(unresolved.reason);
  });

  it('resolved history does not fail identity health', () => {
    const r = classifyIdentityObservability({
      unresolved: 0,
      conflicts: 0,
      resolved: 12,
      classCCanonical: 81,
    });
    expect(r.health).toBe('HEALTHY');
    expect(r.alert).toBe(false);
  });

  it('live identity spike is degraded without whole-run failure language', () => {
    const r = classifyIdentityRunSpike({
      unresolved: 1,
      conflicts: 0,
      notServingYet: 1,
      quarantined: 1,
    });
    expect(r.health).toBe('DEGRADED');
  });
});

describe('job partial / queues / schedule mismatch', () => {
  it('partial skipped rows are represented without whole-run failure', () => {
    expect(
      ingestionRunIsPartial({ status: 'partial', skippedCount: 1, quarantinedCount: 1 })
    ).toBe(true);
    const r = classifyVolumeAnomaly({
      config: 'ACTIVE',
      status: 'partial',
      outputCount: 9,
      expectedMinOutput: 1,
    });
    expect(r.health).toBe('DEGRADED');
    expect(r.reason).toMatch(/partial/);
  });

  it('zero rows is bad only when ACTIVE and a minimum is expected', () => {
    expect(
      classifyVolumeAnomaly({
        config: 'FROZEN',
        status: 'success',
        outputCount: 0,
        expectedMinOutput: 1,
      }).health
    ).toBe('FROZEN_EXPECTED');
    expect(
      classifyVolumeAnomaly({
        config: 'ACTIVE',
        status: 'success',
        outputCount: 0,
        expectedMinOutput: 1,
      }).health
    ).toBe('DEGRADED');
  });

  it('schedule mismatch health is accurate', () => {
    expect(
      classifyScheduleMismatch({ liveIngestionEnabled: false, observed: 'DISABLED' }).health
    ).toBe('FROZEN_EXPECTED');
    expect(
      classifyScheduleMismatch({ liveIngestionEnabled: true, observed: 'DISABLED' }).health
    ).toBe('FAILED');
    expect(
      classifyScheduleMismatch({ liveIngestionEnabled: false, observed: 'ENABLED' }).health
    ).toBe('DEGRADED');
    expect(
      classifyScheduleMismatch({ liveIngestionEnabled: true, observed: 'ENABLED' }).health
    ).toBe('HEALTHY');
  });

  it('non-zero DLQ is visible even while frozen', () => {
    const r = classifyQueueHealth({
      config: 'FROZEN',
      queueDepth: 0,
      oldestAgeSeconds: 0,
      dlqDepth: 3,
      reservedConcurrencyApplied: false,
    });
    expect(r.health).toBe('DEGRADED');
    expect(r.reason).toMatch(/DLQ/);
  });

  it('NOT_DEPLOYED queue is not an incident', () => {
    const r = classifyQueueHealth({
      config: 'NOT_DEPLOYED',
      queueDepth: null,
      oldestAgeSeconds: null,
      dlqDepth: null,
      reservedConcurrencyApplied: null,
      deployed: false,
    });
    expect(r.health).toBe('FROZEN_EXPECTED');
    expect(r.reason).toMatch(/NOT_DEPLOYED/);
  });

  it('429 stays distinct from auth failures', () => {
    const r = classifyProviderErrors({
      config: 'ACTIVE',
      counts: { http401: 0, http403: 0, http429: 4, http5xx: 0, timeout: 0, malformed: 0 },
    });
    expect(r.health).toBe('DEGRADED');
    expect(r.reason).toMatch(/429/);
  });

  it('1200/1230 unpublished games are not an alert', () => {
    expect(SCHEDULE_2026_UNPUBLISHED).toBe(30);
    const r = classifyScheduleCompleteness({
      localCount: 1200,
      providerPublished: SCHEDULE_2026_PROVIDER_PUBLISHED,
      expectedRs: SCHEDULE_2026_EXPECTED_RS,
    });
    expect(r.health).toBe('HEALTHY');
    expect(r.reconciliation).toBe('PROVIDER_NOT_YET_PUBLISHED');
  });

  it('lineups and plays are GOAT-required in the catalog (13F.1 correction)', () => {
    expect(INGESTION_FAMILY_CATALOG.find((f) => f.id === 'starters_lineups')?.goatRequired).toBe(true);
    expect(INGESTION_FAMILY_CATALOG.find((f) => f.id === 'plays')?.goatRequired).toBe(true);
    expect(INGESTION_FAMILY_CATALOG.find((f) => f.id === 'advanced_postgame')?.goatRequired).toBe(true);
    expect(INGESTION_FAMILY_CATALOG.find((f) => f.id === 'game_flow')?.goatRequired).toBe(false);
  });
});

describe('activation-aware missed-run', () => {
  const cadence = { intervalHours: 24, graceHours: 6 };

  it('frozen jobs are never MISSED even with an old invocation', () => {
    const r = classifyMissedRun({
      config: 'FROZEN',
      scheduleObserved: 'DISABLED',
      ...cadence,
      lastInvocationAt: new Date('2026-01-01T00:00:00.000Z'),
      invocationQueried: true,
      now,
    });
    expect(r.status).toBe('NOT_EXPECTED');
    expect(r.health).toBe('FROZEN_EXPECTED');
  });

  it('ACTIVE + recent invocation is OK', () => {
    const r = classifyMissedRun({
      config: 'ACTIVE',
      scheduleObserved: 'ENABLED',
      intervalHours: 0.5,
      graceHours: 0.5,
      lastInvocationAt: new Date('2026-09-10T17:45:00.000Z'),
      invocationQueried: true,
      now,
    });
    expect(r.status).toBe('OK');
    expect(r.health).toBe('HEALTHY');
  });

  it('ACTIVE + schedule enabled + overdue execution is MISSED', () => {
    const r = classifyMissedRun({
      config: 'ACTIVE',
      scheduleObserved: 'ENABLED',
      ...cadence,
      lastInvocationAt: new Date('2026-09-08T12:00:00.000Z'),
      invocationQueried: true,
      now,
    });
    expect(r.status).toBe('MISSED');
    expect(r.health).toBe('DEGRADED');
  });

  it('ACTIVE + schedule disabled is CONFIG_MISMATCH FAILED', () => {
    const r = classifyMissedRun({
      config: 'ACTIVE',
      scheduleObserved: 'DISABLED',
      ...cadence,
      lastInvocationAt: new Date('2026-09-10T17:00:00.000Z'),
      invocationQueried: true,
      now,
    });
    expect(r.status).toBe('CONFIG_MISMATCH');
    expect(r.health).toBe('FAILED');
  });

  it('AWS unavailable is UNKNOWN, not MISSED', () => {
    const r = classifyMissedRun({
      config: 'ACTIVE',
      scheduleObserved: 'UNKNOWN',
      ...cadence,
      lastInvocationAt: null,
      invocationQueried: false,
      now,
    });
    expect(r.status).toBe('UNKNOWN');
    expect(r.health).toBe('UNKNOWN');
  });

  it('CADENCE_UNSET does not false-alarm', () => {
    const r = classifyMissedRun({
      config: 'ACTIVE',
      scheduleObserved: 'ENABLED',
      intervalHours: null,
      graceHours: 6,
      lastInvocationAt: null,
      invocationQueried: true,
      now,
    });
    expect(r.status).toBe('CADENCE_UNSET');
    expect(r.health).toBe('UNKNOWN');
  });

  it('frozen + AWS schedule ENABLED stays a schedule mismatch, not missed-run', () => {
    expect(
      classifyScheduleMismatch({ liveIngestionEnabled: false, observed: 'ENABLED' }).health
    ).toBe('DEGRADED');
    expect(
      classifyMissedRun({
        config: 'FROZEN',
        scheduleObserved: 'ENABLED',
        ...cadence,
        lastInvocationAt: null,
        invocationQueried: true,
        now,
      }).status
    ).toBe('NOT_EXPECTED');
  });

  it('correlates lambda ran + stale data as PARTIAL', () => {
    const r = correlateExecutionAndFreshness({
      config: 'ACTIVE',
      missedRun: 'OK',
      freshness: 'STALE',
      lastInvocationAt: now,
      invocationQueried: true,
    });
    expect(r.grade).toBe('PARTIAL');
    expect(r.health).toBe('DEGRADED');
  });

  it('game_status_sync family: frozen is NOT_EXPECTED; active+recent OK; disabled FAILED; overdue MISSED', () => {
    const cadence = INGESTION_CADENCE.game_status_sync;
    expect(cadence.intervalHours).toBe(0.25);
    expect(cadence.graceHours).toBe(0.25);
    expect(
      classifyMissedRun({
        config: 'FROZEN',
        scheduleObserved: 'DISABLED',
        ...cadence,
        lastInvocationAt: new Date('2026-01-01T00:00:00.000Z'),
        invocationQueried: true,
        now,
      }).status
    ).toBe('NOT_EXPECTED');
    expect(
      classifyMissedRun({
        config: 'ACTIVE',
        scheduleObserved: 'ENABLED',
        ...cadence,
        lastInvocationAt: new Date('2026-09-10T17:50:00.000Z'),
        invocationQueried: true,
        now,
      }).status
    ).toBe('OK');
    expect(
      classifyMissedRun({
        config: 'ACTIVE',
        scheduleObserved: 'DISABLED',
        ...cadence,
        lastInvocationAt: new Date('2026-09-10T17:50:00.000Z'),
        invocationQueried: true,
        now,
      })
    ).toMatchObject({ status: 'CONFIG_MISMATCH', health: 'FAILED' });
    expect(
      classifyMissedRun({
        config: 'ACTIVE',
        scheduleObserved: 'ENABLED',
        ...cadence,
        lastInvocationAt: new Date('2026-09-10T16:00:00.000Z'),
        invocationQueried: true,
        now,
      }).status
    ).toBe('MISSED');
  });

  it('correlates fresh data + AWS unknown as HEALTHY with AWS_UNKNOWN', () => {
    const r = correlateExecutionAndFreshness({
      config: 'ACTIVE',
      missedRun: 'UNKNOWN',
      freshness: 'FRESH',
      lastInvocationAt: null,
      invocationQueried: false,
    });
    expect(r.grade).toBe('AWS_UNKNOWN');
    expect(r.health).toBe('HEALTHY');
  });

  it('reserved concurrency unapplied is explicit metadata', () => {
    expect(classifyReservedConcurrency(false).state).toBe('UNAPPLIED');
    expect(classifyReservedConcurrency(false).reason).toMatch(/RESERVED_CONCURRENCY_UNAPPLIED/);
  });

  it('rollup prefers ENABLED if any schedule is on', () => {
    expect(rollupScheduleObserved(['DISABLED', 'ENABLED', 'NOT_FOUND'])).toBe('ENABLED');
    expect(rollupScheduleObserved(['DISABLED', 'NOT_FOUND'])).toBe('DISABLED');
    expect(rollupScheduleObserved(['UNKNOWN', 'NOT_FOUND'])).toBe('UNKNOWN');
  });
});
