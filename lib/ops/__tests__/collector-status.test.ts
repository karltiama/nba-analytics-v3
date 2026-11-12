import { describe, expect, it } from 'vitest';
import {
  classifyCollectorOperations,
  classifyObservedFreshness,
  classifyWebIngestion,
  deriveExecutionEvidence,
  formatScheduleEvidence,
  isPropsControllerScheduled,
  rollupEnabledCollectors,
} from '@/lib/ops/collector-status';

const now = new Date('2026-11-12T21:00:00.000Z');

describe('collector status is independent of the web ingestion flag', () => {
  it('enabled collector with a recent execution and a recent write is HEALTHY while the web process is restricted', () => {
    const web = classifyWebIngestion({ liveIngestionEnabled: false, freezeSkipsMutations: true });
    const collector = classifyCollectorOperations({
      awsAccess: 'QUERIED',
      schedule: 'ENABLED',
      execution: 'RECENT',
      writes: 'RECENT',
    });
    expect(web.state).toBe('RESTRICTED');
    expect(collector.status).toBe('HEALTHY');
    expect(collector.reason).toMatch(/database write/);
  });

  it('a disabled schedule with no executions is FROZEN', () => {
    expect(
      classifyCollectorOperations({
        awsAccess: 'QUERIED',
        schedule: 'DISABLED',
        execution: 'NONE',
        writes: 'STALE',
      }).status
    ).toBe('FROZEN');
    expect(
      classifyCollectorOperations({
        awsAccess: 'QUERIED',
        schedule: 'DISABLED',
        execution: 'UNKNOWN',
        writes: 'MISSING',
      }).status
    ).toBe('FROZEN');
  });

  it('unreadable AWS state is UNKNOWN or BLOCKED and is never labeled DISABLED', () => {
    const unread = classifyCollectorOperations({
      awsAccess: 'NOT_QUERIED',
      schedule: 'UNKNOWN',
      execution: 'UNKNOWN',
      writes: 'STALE',
    });
    const blocked = classifyCollectorOperations({
      awsAccess: 'UNAVAILABLE',
      schedule: 'UNKNOWN',
      execution: 'UNKNOWN',
      writes: 'MISSING',
    });
    expect(unread.status).toBe('UNKNOWN');
    expect(blocked.status).toBe('BLOCKED');
    expect(formatScheduleEvidence({ schedule: 'UNKNOWN', awsAccess: 'NOT_QUERIED' })).toBe('UNKNOWN');
    expect(formatScheduleEvidence({ schedule: 'UNKNOWN', awsAccess: 'UNAVAILABLE' })).toBe('BLOCKED');
    expect(formatScheduleEvidence({ schedule: 'UNKNOWN', awsAccess: 'QUERIED' })).not.toBe('DISABLED');
    expect(unread.reason).not.toMatch(/DISABLED/);
    expect(blocked.reason).not.toMatch(/DISABLED/);
  });

  it('a successful execution without the expected database write is DEGRADED', () => {
    const missing = classifyCollectorOperations({
      awsAccess: 'QUERIED',
      schedule: 'ENABLED',
      execution: 'RECENT',
      writes: 'MISSING',
    });
    const stale = classifyCollectorOperations({
      awsAccess: 'QUERIED',
      schedule: 'ENABLED',
      execution: 'RECENT',
      writes: 'STALE',
    });
    expect(missing.status).toBe('DEGRADED');
    expect(stale.status).toBe('DEGRADED');
    expect(missing.reason).toMatch(/database write/);
  });

  it('an enabled collector with no eligible work is not DEGRADED', () => {
    const idle = classifyCollectorOperations({
      awsAccess: 'QUERIED',
      schedule: 'ENABLED',
      execution: 'RECENT',
      writes: 'MISSING',
      idleNoEligibleWork: true,
    });
    expect(idle.status).toBe('HEALTHY');
    expect(idle.status).not.toBe('DEGRADED');
    expect(idle.reason).toMatch(/no eligible work/);
  });

  it('stale database records are not marked fresh', () => {
    const stale = classifyObservedFreshness({
      lastWriteAt: new Date('2026-11-01T21:00:00.000Z'),
      now,
      slaHours: 4,
    });
    const fresh = classifyObservedFreshness({
      lastWriteAt: new Date('2026-11-12T20:00:00.000Z'),
      now,
      slaHours: 4,
    });
    const missing = classifyObservedFreshness({ lastWriteAt: null, now, slaHours: 4 });
    expect(stale.state).toBe('STALE');
    expect(stale.state).not.toBe('FRESH');
    expect(fresh.state).toBe('FRESH');
    expect(missing.state).toBe('UNAVAILABLE');
  });

  it('a gap inside the data SLA is not a missed run, and a gap past the SLA is', () => {
    const inside = deriveExecutionEvidence({
      queried: true,
      lastInvocationAt: new Date('2026-11-12T15:00:00.000Z'),
      errors24h: 0,
      now,
      intervalHours: 0.5,
      graceHours: 0.5,
      slaHours: 12,
    });
    const past = deriveExecutionEvidence({
      queried: true,
      lastInvocationAt: new Date('2026-11-11T21:00:00.000Z'),
      errors24h: 0,
      now,
      intervalHours: 0.5,
      graceHours: 0.5,
      slaHours: 12,
    });
    expect(inside).toBe('RECENT');
    expect(past).toBe('MISSED');
  });

  it('a recovered execution with a fresh write stays HEALTHY and still reports the error count', () => {
    const recovered = classifyCollectorOperations({
      awsAccess: 'QUERIED',
      schedule: 'ENABLED',
      execution: 'RECENT',
      writes: 'RECENT',
      recentErrorCount: 1,
    });
    const unrecovered = classifyCollectorOperations({
      awsAccess: 'QUERIED',
      schedule: 'ENABLED',
      execution: 'RECENT',
      writes: 'STALE',
      recentErrorCount: 1,
    });
    expect(recovered.status).toBe('HEALTHY');
    expect(recovered.warning).toMatch(/1 execution error/);
    expect(unrecovered.status).toBe('DEGRADED');
    expect(unrecovered.reason).toMatch(/1 execution error/);
  });

  it('idle without a recent execution is not HEALTHY', () => {
    const idle = classifyCollectorOperations({
      awsAccess: 'QUERIED',
      schedule: 'ENABLED',
      execution: 'NONE',
      writes: 'STALE',
      idleNoEligibleWork: true,
    });
    expect(idle.status).not.toBe('HEALTHY');
  });

  it('player props are not scheduled overnight in New York', () => {
    expect(isPropsControllerScheduled(new Date('2026-11-12T10:00:00.000Z'))).toBe(false);
    expect(isPropsControllerScheduled(new Date('2026-11-12T18:00:00.000Z'))).toBe(true);
  });

  it('a frozen disabled pipeline does not paint enabled collectors as frozen', () => {
    expect(
      rollupEnabledCollectors([
        { scheduleLabel: 'ENABLED', status: 'HEALTHY' },
        { scheduleLabel: 'DISABLED', status: 'FROZEN_EXPECTED' },
      ])
    ).toBe('HEALTHY');
  });
});
