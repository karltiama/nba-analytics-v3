/**
 * Virtual-time model of controller wave → SQS → event-source mapping → worker → shared BDL limiter.
 * Uses the real fetchPlayerPropsForGame / fetchBdlLive / acquireLiveBdlPermit with the in-memory store.
 * No network: the provider is a stub that only advances virtual time.
 */
import { fetchPlayerPropsForGame } from '../../fetch';
import {
  acquireLiveBdlPermit,
  createMemoryLiveRateLimitStore,
  readLiveRateLimitConfig,
} from '../../bdl-live-rate-limit';
import { isPreTipObservation } from '../../observation-clock';

export class VirtualClock {
  now = 0;
  private seq = 0;
  private timers: Array<{ at: number; seq: number; resolve: () => void }> = [];

  sleep = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => {
      this.timers.push({ at: this.now + Math.max(0, ms), seq: this.seq++, resolve });
    });

  private async flush(): Promise<void> {
    for (let i = 0; i < 3; i++) await new Promise<void>((r) => setImmediate(r));
  }

  async runUntil(done: () => boolean, maxMs: number): Promise<void> {
    while (true) {
      await this.flush();
      if (done()) return;
      if (this.timers.length === 0) throw new Error('simulation deadlock');
      this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.timers.shift()!;
      this.now = Math.max(this.now, next.at);
      if (this.now > maxMs) throw new Error(`simulation exceeded ${maxMs} ms`);
      next.resolve();
    }
  }
}

export type SimConfig = {
  games: number;
  /** Infinity models the current unbounded event-source mapping. */
  maxConcurrency: number;
  intervalMs?: number;
  acquireTimeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  visibilityMs?: number;
  lambdaTimeoutMs?: number;
  maxReceiveCount?: number;
  requestMs?: number;
  writeMs?: number;
  pollMs?: number;
  /** HTTP status per (game, provider attempt). Default 200. */
  providerStatus?: (game: number, attempt: number) => number;
  /** Tip time (virtual ms) per game. Default far in the future. */
  tipAtMs?: (game: number) => number;
  otherCollectors?: Array<{ name: string; atMs: number; acquireTimeoutMs: number }>;
  maxSimMs?: number;
};

export type SimResult = {
  drainMs: number;
  peakWorkers: number;
  succeeded: number[];
  dlq: number[];
  receives: number[];
  concurrentSameGame: number;
  successfulRunsPerGame: number[];
  providerCallTimes: number[];
  observations: Array<{ game: number; observedAtMs: number; tipAtMs: number; preTip: boolean }>;
  otherCollectors: Array<{ name: string; granted: boolean; waitMs: number }>;
  failures: Array<{ game: number; atMs: number; reason: string }>;
};

const EPOCH = Date.parse('2026-10-21T20:00:00.000Z');

export async function simulateWave(cfg: SimConfig): Promise<SimResult> {
  const c = {
    intervalMs: 13_000,
    acquireTimeoutMs: 90_000,
    maxRetries: 3,
    retryBaseMs: 60_000,
    visibilityMs: 630_000,
    lambdaTimeoutMs: 600_000,
    maxReceiveCount: 4,
    requestMs: 1_500,
    writeMs: 5_000,
    pollMs: 1_000,
    maxSimMs: 6 * 3_600_000,
    ...cfg,
  };
  const clock = new VirtualClock();
  const store = createMemoryLiveRateLimitStore();
  const env = {
    DATA_MODE: 'live_api',
    BDL_RATE_LIMIT_BACKEND: 'memory',
    BDL_RATE_LIMIT_INTERVAL_MS: String(c.intervalMs),
    BDL_RATE_LIMIT_ACQUIRE_TIMEOUT_MS: String(c.acquireTimeoutMs),
    BDL_RATE_LIMIT_MAX_RETRIES: String(c.maxRetries),
    BDL_RATE_LIMIT_RETRY_BASE_MS: String(c.retryBaseMs),
  };

  type Msg = { game: number; receiveCount: number; visibleAt: number; done: boolean; dlq: boolean };
  const msgs: Msg[] = Array.from({ length: c.games }, (_, game) => ({
    game,
    receiveCount: 0,
    visibleAt: 0,
    done: false,
    dlq: false,
  }));
  const result: SimResult = {
    drainMs: 0,
    peakWorkers: 0,
    succeeded: [],
    dlq: [],
    receives: Array(c.games).fill(0),
    concurrentSameGame: 0,
    successfulRunsPerGame: Array(c.games).fill(0),
    providerCallTimes: [],
    observations: [],
    otherCollectors: [],
    failures: [],
  };
  const attemptsPerGame = Array(c.games).fill(0);
  const processing = Array(c.games).fill(0);
  let active = 0;
  let othersPending = c.otherCollectors?.length ?? 0;

  const runJob = async (m: Msg): Promise<void> => {
    active += 1;
    processing[m.game] += 1;
    if (processing[m.game] > 1) result.concurrentSameGame += 1;
    result.peakWorkers = Math.max(result.peakWorkers, active);
    const job = (async () => {
      const fetched = await fetchPlayerPropsForGame('k', 10_000 + m.game, {
        limiter: { env, store, nowMs: () => clock.now, sleepFn: clock.sleep },
        now: () => new Date(EPOCH + clock.now),
        baseFetch: async () => {
          result.providerCallTimes.push(clock.now);
          const attempt = attemptsPerGame[m.game]++;
          await clock.sleep(c.requestMs);
          const status = c.providerStatus?.(m.game, attempt) ?? 200;
          return status === 200
            ? new Response(JSON.stringify({ data: [] }), { status })
            : new Response('err', { status, headers: status === 429 ? { 'retry-after': '30' } : {} });
        },
      });
      await clock.sleep(c.writeMs);
      return fetched;
    })();
    const timeout = clock.sleep(c.lambdaTimeoutMs).then(() => 'timeout' as const);
    try {
      const outcome = await Promise.race([job, timeout]);
      if (outcome === 'timeout') throw new Error('lambda_timeout');
      const observedAtMs = outcome.observation.responseReceivedAt.getTime() - EPOCH;
      const tipAtMs = c.tipAtMs?.(m.game) ?? Number.MAX_SAFE_INTEGER;
      result.observations.push({
        game: m.game,
        observedAtMs,
        tipAtMs,
        preTip: isPreTipObservation(outcome.observation.responseReceivedAt, new Date(EPOCH + tipAtMs)),
      });
      result.successfulRunsPerGame[m.game] += 1;
      if (!m.done) {
        m.done = true;
        result.succeeded.push(m.game);
      }
    } catch (err) {
      job.catch(() => undefined);
      result.failures.push({ game: m.game, atMs: clock.now, reason: err instanceof Error ? err.message : String(err) });
    } finally {
      active -= 1;
      processing[m.game] -= 1;
    }
  };

  const poller = async (): Promise<void> => {
    while (msgs.some((m) => !m.done && !m.dlq)) {
      const visible = msgs
        .filter((m) => !m.done && !m.dlq && m.visibleAt <= clock.now)
        .sort((a, b) => a.visibleAt - b.visibleAt || a.game - b.game);
      for (const m of visible) {
        if (active >= c.maxConcurrency) break;
        if (m.receiveCount >= c.maxReceiveCount) {
          m.dlq = true;
          result.dlq.push(m.game);
          continue;
        }
        m.receiveCount += 1;
        result.receives[m.game] = m.receiveCount;
        m.visibleAt = clock.now + c.visibilityMs;
        void runJob(m);
      }
      await clock.sleep(c.pollMs);
    }
  };

  for (const other of c.otherCollectors ?? []) {
    void (async () => {
      await clock.sleep(other.atMs);
      const started = clock.now;
      const config = readLiveRateLimitConfig({ ...env, BDL_RATE_LIMIT_ACQUIRE_TIMEOUT_MS: String(other.acquireTimeoutMs) });
      try {
        await acquireLiveBdlPermit({ store, config, nowMs: () => clock.now, sleepFn: clock.sleep });
        result.providerCallTimes.push(clock.now);
        result.otherCollectors.push({ name: other.name, granted: true, waitMs: clock.now - started });
      } catch {
        result.otherCollectors.push({ name: other.name, granted: false, waitMs: clock.now - started });
      } finally {
        othersPending -= 1;
      }
    })();
  }

  void poller();
  await clock.runUntil(
    () => msgs.every((m) => m.done || m.dlq) && active === 0 && othersPending === 0,
    c.maxSimMs
  );
  result.drainMs = clock.now;
  result.providerCallTimes.sort((a, b) => a - b);
  return result;
}
