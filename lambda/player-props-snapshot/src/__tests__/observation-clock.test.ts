import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { fetchPlayerPropsForGame } from '../../src/fetch';
import {
  OBSERVATION_CLOCK_RESPONSE_RECEIVED,
  assertObservationClockSchema,
  createAttemptRecorder,
  describeObservation,
  isPreTipObservation,
  resetObservationClockSchemaCacheForTests,
} from '../../src/observation-clock';
import { bulkInsertRawV2, bulkUpsertCurrent } from '../../src/bulk-writers';
import { createMemoryLiveRateLimitStore } from '../../src/bdl-live-rate-limit';
import type { NormalizedPropRow } from '../../src/types';

const TIP = new Date('2026-10-21T23:30:00.000Z');
const at = (minutesBeforeTip: number) => new Date(TIP.getTime() - minutesBeforeTip * 60_000);

const LIMITER_ENV = {
  DATA_MODE: 'live_api',
  BDL_RATE_LIMIT_BACKEND: 'memory',
  BDL_RATE_LIMIT_ALLOW_FAST: '1',
  BDL_RATE_LIMIT_INTERVAL_MS: '1',
  BDL_RATE_LIMIT_MAX_RETRIES: '2',
};

const PROVIDER_BODY = {
  data: [
    {
      id: 1,
      game_id: 12345,
      player_id: 77,
      vendor: 'draftkings',
      prop_type: 'points',
      line_value: '27.5',
      market: { type: 'over_under', over_odds: -110, under_odds: -110 },
      updated_at: at(120).toISOString(),
    },
  ],
};

function clockSequence(times: Date[]): () => Date {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)];
}

function limiter() {
  return { env: LIMITER_ENV, store: createMemoryLiveRateLimitStore(), sleepFn: async () => {} };
}

function row(partial: Partial<NormalizedPropRow> = {}): NormalizedPropRow {
  return {
    game_id: 12345,
    player_id: 77,
    player_name: 'P',
    team_id: 14,
    sportsbook: 'draftkings',
    prop_type: 'points',
    market_type: 'over_under',
    side: 'over',
    line_value: 27.5,
    odds_american: -110,
    odds_decimal: 1.91,
    implied_probability: 0.524,
    raw_json: { id: 1 },
    provider_updated_at: at(120),
    ...partial,
  };
}

function recordingPool(handler?: (sql: string, values: unknown[]) => { rows: unknown[]; rowCount?: number } | undefined) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const pool = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      return handler?.(sql, values) ?? { rows: [], rowCount: 1 };
    }),
  } as unknown as Pool;
  return { pool, calls };
}

describe('provider attempt clocks', () => {
  it('observed_at is response_received_at of the returned attempt, not request start', async () => {
    const result = await fetchPlayerPropsForGame('k', 12345, {
      limiter: limiter(),
      baseFetch: async () => new Response(JSON.stringify(PROVIDER_BODY), { status: 200 }),
      now: clockSequence([at(178.5), at(178)]),
    });
    expect(result.observation.requestStartedAt).toEqual(at(178.5));
    expect(result.observation.responseReceivedAt).toEqual(at(178));
    expect(result.observation.attempts).toHaveLength(1);
    expect(result.rows).toHaveLength(1);
  });

  it('429 pre-tip then success post-tip: observation is the post-tip response', async () => {
    const responses = [
      new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } }),
      new Response(JSON.stringify(PROVIDER_BODY), { status: 200 }),
    ];
    const result = await fetchPlayerPropsForGame('k', 12345, {
      limiter: limiter(),
      baseFetch: async () => responses.shift() as Response,
      now: clockSequence([at(2), at(1.5), at(-0.5), at(-1)]),
    });
    expect(result.observation.attempts.map((a) => a.status)).toEqual([429, 200]);
    expect(result.observation.attempts[0].responseReceivedAt).toEqual(at(1.5));
    expect(result.observation.responseReceivedAt).toEqual(at(-1));
    expect(isPreTipObservation(result.observation.responseReceivedAt, TIP)).toBe(false);
  });

  it('no response means no observation (fails closed)', () => {
    const recorder = createAttemptRecorder(async () => new Response('', { status: 200 }));
    expect(() => recorder.observation()).toThrow(/response_received_at/);
  });

  it('observation equal to tip is not pre-tip; missing tip is not pre-tip', () => {
    expect(isPreTipObservation(TIP, TIP)).toBe(false);
    expect(isPreTipObservation(at(1), null)).toBe(false);
  });

  it('log summary separates intended and actual T-minus', () => {
    const d = describeObservation({ controllerEnqueuedAt: at(60), observedAt: at(48), tip: TIP, attempts: 1 });
    expect(d.intended_t_minus_seconds).toBe(3600);
    expect(d.actual_t_minus_seconds).toBe(2880);
    expect(d.pre_tip).toBe(true);
  });
});

describe('writers keep clocks separate', () => {
  it('raw insert: fetched_at keeps controller time; observed_at, provider_updated_at and clock are distinct', async () => {
    const { pool, calls } = recordingPool();
    await bulkInsertRawV2(pool, [row()], at(180), { enabled: false, sampleRate: 0 }, 42, {
      controllerEnqueuedAt: at(180),
      observedAt: at(178),
    });
    const { sql, values } = calls[0];
    expect(sql).toContain('fetched_at, raw_json, pull_run_id,');
    expect(sql).toContain('observed_at, controller_enqueued_at, provider_updated_at, observation_clock');
    expect(values).toHaveLength(19);
    expect(values[12]).toEqual(at(180));
    expect(values[15]).toEqual(at(178));
    expect(values[16]).toEqual(at(180));
    expect(values[17]).toEqual(at(120));
    expect(values[18]).toBe(OBSERVATION_CLOCK_RESPONSE_RECEIVED);
  });

  it('current upsert: never rolls back to an older observation', async () => {
    const { pool, calls } = recordingPool();
    await bulkUpsertCurrent(pool, [row()], at(60), { controllerEnqueuedAt: at(60), observedAt: at(48) });
    const { sql, values } = calls[0];
    expect(values).toHaveLength(17);
    expect(values[12]).toEqual(at(60));
    expect(values[13]).toEqual(at(48));
    expect(values[15]).toEqual(at(120));
    expect(sql.replace(/\s+/g, ' ')).toContain(
      'WHERE analytics.player_props_current.observed_at IS NULL OR excluded.observed_at >= analytics.player_props_current.observed_at'
    );
  });
});

describe('schema gate', () => {
  beforeEach(() => resetObservationClockSchemaCacheForTests());

  it('throws when the observation-clock columns are absent', async () => {
    const { pool } = recordingPool(() => ({ rows: [] }));
    await expect(assertObservationClockSchema(pool)).rejects.toThrow(/schema missing/);
  });

  it('passes when all columns exist', async () => {
    const cols = ['observed_at', 'controller_enqueued_at', 'provider_updated_at', 'observation_clock'];
    const { pool } = recordingPool(() => ({
      rows: [
        ...cols.map((c) => ({ table_schema: 'raw', table_name: 'player_prop_snapshots_v2', column_name: c })),
        ...cols.map((c) => ({ table_schema: 'analytics', table_name: 'player_props_current', column_name: c })),
      ],
    }));
    await expect(assertObservationClockSchema(pool)).resolves.toBeUndefined();
  });
});
