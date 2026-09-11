import { describe, expect, it } from 'vitest';
import { collectAwsIngestionSnapshot, type AwsIngestionPorts } from '@/lib/ops/aws-ingestion-status';

function ports(overrides?: Partial<AwsIngestionPorts>): AwsIngestionPorts {
  return {
    getFunction: async () => ({
      exists: true,
      state: 'Active',
      reservedConcurrentExecutions: null,
    }),
    getInvocationMetrics: async () => ({
      lastInvocationAt: new Date('2026-09-10T12:00:00.000Z'),
      errors24h: 0,
      throttles24h: 0,
      durationMs: 1200,
    }),
    describeRule: async () => 'DISABLED',
    getSchedule: async () => 'DISABLED',
    getQueue: async (name) => {
      if (name.includes('postgame')) {
        return { exists: false, visible: null, notVisible: null, oldestAgeSeconds: null };
      }
      return { exists: true, visible: 0, notVisible: 0, oldestAgeSeconds: 0 };
    },
    ...overrides,
  };
}

describe('collectAwsIngestionSnapshot', () => {
  it('does not fabricate invocation success', async () => {
    const snapshot = await collectAwsIngestionSnapshot(ports());
    expect(snapshot.lambdas.every((row) => row.lastInvocationSuccess === 'UNKNOWN')).toBe(true);
    expect(snapshot.scheduleObserved).toBe('DISABLED');
    expect(snapshot.reservedConcurrencyApplied).toBe(false);
  });

  it('marks missing postgame queue NOT_DEPLOYED rather than unhealthy', async () => {
    const snapshot = await collectAwsIngestionSnapshot(ports());
    const postgame = snapshot.queues.find((row) => row.id === 'postgame_stage');
    expect(postgame?.deployState).toBe('NOT_DEPLOYED');
    expect(postgame?.deployed).toBe(false);
  });

  it('surfaces DLQ depth when present', async () => {
    const snapshot = await collectAwsIngestionSnapshot(
      ports({
        getQueue: async (name) => {
          if (name.endsWith('-dlq') && name.includes('props')) {
            return { exists: true, visible: 4, notVisible: 0, oldestAgeSeconds: 12 };
          }
          if (name.includes('postgame')) {
            return { exists: false, visible: null, notVisible: null, oldestAgeSeconds: null };
          }
          return { exists: true, visible: 1, notVisible: 2, oldestAgeSeconds: 30 };
        },
      })
    );
    expect(snapshot.dlqDepth).toBe(4);
    expect(snapshot.queueDepth).toBe(1);
  });

  it('optional missing Lambda is NOT_DEPLOYED', async () => {
    const snapshot = await collectAwsIngestionSnapshot(
      ports({
        getFunction: async (name) => ({
          exists: !name.includes('postgame'),
          state: name.includes('postgame') ? null : 'Active',
          reservedConcurrentExecutions: null,
        }),
      })
    );
    expect(snapshot.lambdas.find((row) => row.id === 'postgame_stage_worker')?.deployState).toBe(
      'NOT_DEPLOYED'
    );
  });
});
