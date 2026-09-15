import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  default: { query: vi.fn() },
}));
import {
  CollectionSchemaPreflightError,
  assertSchemaReady,
  readCollectionSchemaMode,
} from '@/lib/db/schema-capability';
import {
  SHADOW_ALLOWABLE_EXECUTION_LATENCY_SECONDS,
  SHADOW_DUE_LOOKAHEAD_MINUTES,
  SHADOW_SCHEDULER_INTERVAL_MINUTES,
} from '@/lib/betting/player-projection-shadow-protocol';
import { classifyShadowDueWindow, intendedCutoff } from '@/lib/betting/player-projection-shadow-scoring';
import {
  executionLatencyWithinSla,
  observeFirstRegularSeasonTipoff,
  qualifiesForPrimaryEvaluation,
} from '@/lib/betting/player-projection-shadow-timing';
import { runShadowScoreCycle } from '@/lib/betting/player-projection-shadow-worker';
import type { SqlQueryable } from '@/lib/db/schema-capability';

describe('schema preflight', () => {
  it('optional mode does not throw when relations are missing', () => {
    expect(readCollectionSchemaMode({})).toBe('optional');
    expect(() =>
      assertSchemaReady({ mode: 'optional', ready: false, missing: ['analytics.prediction_snapshots'] })
    ).not.toThrow();
  });

  it('required mode fails closed on missing schema', () => {
    expect(() =>
      assertSchemaReady({ mode: 'required', ready: false, missing: ['analytics.prediction_snapshots'] })
    ).toThrow(CollectionSchemaPreflightError);
  });
});

describe('T−60 amendment r1.1', () => {
  const tip = '2026-10-21T00:00:00.000Z';
  const cutoff = intendedCutoff(tip);

  it('uses a 5-minute scheduler and due lookahead', () => {
    expect(SHADOW_SCHEDULER_INTERVAL_MINUTES).toBe(5);
    expect(SHADOW_DUE_LOOKAHEAD_MINUTES).toBe(5);
    expect(SHADOW_ALLOWABLE_EXECUTION_LATENCY_SECONDS).toBe(90);
    expect(cutoff).toBe('2026-10-20T23:00:00.000Z');
  });

  it('does not treat 10 minutes before cutoff as due', () => {
    expect(classifyShadowDueWindow({ scheduledTipoff: tip, now: '2026-10-20T22:50:00.000Z' })).toBe(
      'too_early'
    );
    expect(classifyShadowDueWindow({ scheduledTipoff: tip, now: '2026-10-20T22:55:00.000Z' })).toBe('due');
    expect(classifyShadowDueWindow({ scheduledTipoff: tip, now: cutoff })).toBe('due');
    expect(classifyShadowDueWindow({ scheduledTipoff: tip, now: '2026-10-20T23:01:00.000Z' })).toBe(
      'late_open'
    );
  });

  it('does not reclassify late generation as on-time when latency is within SLA', () => {
    expect(
      executionLatencyWithinSla({
        dueAt: cutoff,
        startedAt: '2026-10-20T23:00:30.000Z',
      })
    ).toBe(true);
    expect(qualifiesForPrimaryEvaluation({
      delivery: 'late',
      eligibility: 'ok',
      scheduledTipoff: tip,
      windowStart: '2026-10-21T00:00:00.000Z',
    })).toBe(false);
    expect(qualifiesForPrimaryEvaluation({
      delivery: 'on_time',
      eligibility: 'ok',
      scheduledTipoff: tip,
      windowStart: '2026-10-21T00:00:00.000Z',
    })).toBe(true);
  });

  it('starts the evaluation window at the first scheduled RS tipoff, not the first prediction', () => {
    const observed = observeFirstRegularSeasonTipoff({
      games: [
        { gameId: 'pre', startTime: '2026-10-10T23:00:00.000Z', season: '2026' },
        { gameId: 'open', startTime: '2026-10-21T23:30:00.000Z', season: '2026' },
        { gameId: 'later', startTime: '2026-10-22T23:30:00.000Z', season: '2026' },
      ],
      observedAt: '2026-09-15T00:00:00.000Z',
    });
    expect(observed?.firstRegularSeasonTipoff).toBe('2026-10-21T23:30:00.000Z');
    const revised = observeFirstRegularSeasonTipoff({
      games: [
        { gameId: 'open2', startTime: '2026-10-21T00:00:00.000Z', season: '2026' },
      ],
      observedAt: '2026-09-16T00:00:00.000Z',
      previous: observed,
    });
    expect(revised?.revision).toBe(2);
    expect(revised?.previousTipoff).toBe(observed?.firstRegularSeasonTipoff);
  });
});

describe('shadow worker freeze skip', () => {
  it('skips writes while frozen even if SHADOW_SNAPSHOT_WRITES=1', async () => {
    const db: SqlQueryable = {
      query: async () => ({ rows: [] }),
    };
    const result = await runShadowScoreCycle({
      now: () => new Date('2026-09-15T00:00:00.000Z'),
      db,
      scorer: async () => [],
      loadArtifacts: async () => ({
        modelChecksums: { points: 'p', rebounds: 'r' },
        featureOrder: [],
      }),
      env: {
        DATA_MODE: 'replay',
        OFFSEASON_MODE: '1',
        CRON_DRY_RUN: '1',
        SHADOW_SNAPSHOT_WRITES: '1',
      },
    });
    expect(result.skipped).toBe(true);
    expect(result.status).toBe('skipped');
  });
});
