import { beforeEach, describe, expect, it, vi } from 'vitest';
import { simulateWave, type SimResult } from './helpers/queue-sim';

const SHAPED = { maxConcurrency: 2, visibilityMs: 630_000, lambdaTimeoutMs: 600_000 };
const CURRENT = { maxConcurrency: Infinity, visibilityMs: 630_000, lambdaTimeoutMs: 600_000 };
const INTERVAL_MS = 13_000;

function expectLimiterSpacing(r: SimResult) {
  const t = r.providerCallTimes;
  for (let i = 1; i < t.length; i++) {
    expect(t[i] - t[i - 1]).toBeGreaterThanOrEqual(INTERVAL_MS - 1);
  }
}

function expectHealthyDrain(r: SimResult, games: number) {
  expect(r.peakWorkers).toBeLessThanOrEqual(2);
  expect(r.succeeded.sort((a, b) => a - b)).toEqual([...Array(games).keys()]);
  expect(r.dlq).toEqual([]);
  expect(r.failures).toEqual([]);
  expect(Math.max(...r.receives)).toBe(1);
  expect(r.concurrentSameGame).toBe(0);
  expect(r.successfulRunsPerGame.every((n) => n === 1)).toBe(true);
  expectLimiterSpacing(r);
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('LIVE-CLOCK-P0B shaped waves (event-source max concurrency 2)', () => {
  it.each([5, 10, 15])('%i-game wave drains at limiter pace with no failures', async (games) => {
    const r = await simulateWave({ games, ...SHAPED });
    expectHealthyDrain(r, games);
    expect(r.providerCallTimes).toHaveLength(games);
    // (games-1) permit intervals + one request + one write; no throughput above the limiter.
    expect(r.drainMs).toBeGreaterThanOrEqual((games - 1) * INTERVAL_MS);
    expect(r.drainMs).toBeLessThanOrEqual((games - 1) * INTERVAL_MS + 10_000);
  });

  it('overlapping broad + near-tip waves (30 jobs) still drain without DLQ', async () => {
    const r = await simulateWave({ games: 30, ...SHAPED });
    expectHealthyDrain(r, 30);
    expect(r.drainMs).toBeLessThanOrEqual(29 * INTERVAL_MS + 10_000);
  });

  it('persistent provider failure still reaches the DLQ after maxReceiveCount receives', async () => {
    const r = await simulateWave({
      games: 5,
      ...SHAPED,
      providerStatus: (game) => (game === 3 ? 500 : 200),
    });
    expect(r.dlq).toEqual([3]);
    expect(r.receives[3]).toBe(4);
    expect(r.succeeded.sort()).toEqual([0, 1, 2, 4]);
    expect(r.failures.filter((f) => f.game === 3)).toHaveLength(4);
    expect(r.concurrentSameGame).toBe(0);
    expectLimiterSpacing(r);
  });

  it('a 20 s-acquire collector (game-status-sync) still gets a permit during a 15-game wave', async () => {
    const r = await simulateWave({
      games: 15,
      ...SHAPED,
      otherCollectors: [
        { name: 'game-status-sync', atMs: 20_000, acquireTimeoutMs: 20_000 },
        { name: 'injuries', atMs: 40_000, acquireTimeoutMs: 90_000 },
      ],
    });
    expectHealthyDrain(r, 15);
    expect(r.otherCollectors.every((o) => o.granted)).toBe(true);
    expect(r.providerCallTimes).toHaveLength(17);
  });

  it('P0A: a game that tips while its job waits in the queue is recorded post-tip', async () => {
    const r = await simulateWave({
      games: 15,
      ...SHAPED,
      tipAtMs: (game) => (game === 14 ? 120_000 : 3_600_000),
    });
    expectHealthyDrain(r, 15);
    const late = r.observations.find((o) => o.game === 14)!;
    expect(late.observedAtMs).toBeGreaterThan(late.tipAtMs);
    expect(late.preTip).toBe(false);
    expect(r.observations.filter((o) => o.game !== 14).every((o) => o.preTip)).toBe(true);
    // observed_at is the provider response time, not enqueue or worker start.
    for (const o of r.observations) {
      expect(r.providerCallTimes).toContain(o.observedAtMs - 1_500);
    }
  });
});

describe('LIVE-CLOCK-P0B current model (unbounded fan-out) — documents the root cause', () => {
  it('15-game wave: limiter timeouts force visibility-timeout redeliveries', async () => {
    const r = await simulateWave({ games: 15, ...CURRENT });
    expect(r.peakWorkers).toBe(15);
    expect(r.failures.length).toBeGreaterThan(0);
    expect(r.failures.every((f) => /timed out|timeout/i.test(f.reason))).toBe(true);
    expect(Math.max(...r.receives)).toBeGreaterThanOrEqual(3);
    expect(r.drainMs).toBeGreaterThan(2 * 630_000);
    expectLimiterSpacing(r);
  });

  it('30 overlapping jobs: healthy jobs reach the DLQ from waiting alone', async () => {
    const r = await simulateWave({ games: 30, ...CURRENT });
    expect(r.dlq.length).toBeGreaterThan(0);
    expect(r.failures.every((f) => /timed out|timeout/i.test(f.reason))).toBe(true);
  });

  it('15-game wave: a 20 s-acquire collector times out', async () => {
    const r = await simulateWave({
      games: 15,
      ...CURRENT,
      otherCollectors: [{ name: 'game-status-sync', atMs: 20_000, acquireTimeoutMs: 20_000 }],
    });
    expect(r.otherCollectors[0]).toMatchObject({ granted: false });
  });
});
