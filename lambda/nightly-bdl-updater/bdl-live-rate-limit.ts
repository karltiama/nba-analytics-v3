/**
 * Account-level BALLDONTLIE rate limit for live AWS / Vercel workers.
 * Historical archive crawls keep lib/balldontlie/trial-limiter.ts — do not use this there.
 *
 * Default interval (13000ms / burst 1) is the activation-canary safety rate until
 * paid GOAT entitlement is confirmed. Fail-closed: coordination errors and
 * acquire timeouts do not call BDL. 429 still publishes a global Retry-After cooldown.
 * Every in-process wait is bounded by acquire timeout, BDL_RATE_LIMIT_MAX_RETRY_WAIT_MS,
 * and the optional caller deadline, so retries never outlive the Lambda.
 */

export const BDL_LIVE_RATE_LIMIT_SKIP = 'BDL live request skipped by replay/offseason/dry-run flags';
export const BDL_LIVE_RATE_LIMIT_TIMEOUT = 'BDL rate-limit acquire timed out';
export const BDL_LIVE_RATE_LIMIT_COORDINATION = 'BDL rate-limit coordination unavailable';
export const BDL_LIVE_RATE_LIMIT_TABLE_REQUIRED =
  'BDL_RATE_LIMIT_TABLE is required when BDL_RATE_LIMIT_BACKEND=dynamodb (or live_api without an explicit memory backend)';

const LIVE_DATA_MODE = 'live_api';
const DEFAULT_INTERVAL_MS = 13_000;
const DEFAULT_MAX_REQUESTS = 1;
const DEFAULT_BURST = 1;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 5_000;
const DEFAULT_MAX_RETRY_WAIT_MS = 30_000;
const DEFAULT_HTTP_TIMEOUT_MS = 20_000;
const ENV_INTERVAL_FLOOR_MS = 200;
const BUCKET_PK = 'bdl';
const BUCKET_SK = 'token-bucket';
const COOLDOWN_SK = 'cooldown';

export type LiveRateLimitConfig = {
  intervalMs: number;
  maxRequests: number;
  burst: number;
  acquireTimeoutMs: number;
  /** Retries after the original attempt on 429 (0 = one attempt total). */
  maxRetries: number;
  /** Set when BDL_RATE_LIMIT_MAX_RETRIES is invalid; assertLiveRateLimitConfig fails closed on it. */
  maxRetriesError: string | null;
  retryBaseDelayMs: number;
  /** Longest in-process wait after a 429. A longer Retry-After is published as cooldown, then fails. */
  maxRetryWaitMs: number;
  /** Per-request abort when the caller supplies no signal. Covers headers and body. */
  httpTimeoutMs: number;
  worker: string;
  backend: 'memory' | 'dynamodb';
  tableName: string | null;
  slotTtlSeconds: number;
};

export type BucketState = {
  tokens: number;
  lastRefillMs: number;
  version: number;
};

export type LiveRateLimitStore = {
  loadBucket(): Promise<BucketState | null>;
  /** Conditional write. conflict = lost race; unavailable = store error. */
  saveBucket(
    next: BucketState,
    expectedVersion: number | null
  ): Promise<'ok' | 'conflict' | 'unavailable'>;
  getCooldownUntilMs(): Promise<number | null>;
  setCooldownUntilMs(untilMs: number, ttlSeconds: number): Promise<void>;
};

export type AcquirePermitResult = {
  granted: true;
  waitMs: number;
  retries: number;
};

export class BdlRateLimitError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'skip'
      | 'timeout'
      | 'coordination'
      | 'config'
      | 'replay'
  ) {
    super(message);
    this.name = 'BdlRateLimitError';
  }
}

export function parseRetryAfterMs(
  header: string | null | undefined,
  nowMs: number = Date.now()
): number | null {
  if (header == null) return null;
  const raw = header.trim();
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return Math.ceil(seconds * 1000);
  }
  const when = Date.parse(raw);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - nowMs);
}

export function shouldSkipLiveBdlHttp(
  env: Record<string, string | undefined> = process.env
): boolean {
  const dataMode = (env.DATA_MODE ?? '').trim().toLowerCase();
  const offseason = env.OFFSEASON_MODE === '1';
  const cronDryRun = env.CRON_DRY_RUN === '1';
  return cronDryRun || offseason || dataMode !== LIVE_DATA_MODE;
}

function envInt(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number
): number {
  const raw = env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Canonical BDL limiter retry setting. The generic MAX_RETRIES belongs to other retry loops. */
export const BDL_RATE_LIMIT_MAX_RETRIES_ENV = 'BDL_RATE_LIMIT_MAX_RETRIES';

/**
 * Unset or empty → DEFAULT_MAX_RETRIES. A non-negative base-10 integer → that value.
 * Anything else (negative, decimal, non-numeric) → error with value 0, never a larger budget.
 */
export function parseBdlMaxRetries(raw: string | undefined): { value: number; error: string | null } {
  if (raw == null || raw.trim() === '') return { value: DEFAULT_MAX_RETRIES, error: null };
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { value: 0, error: `${BDL_RATE_LIMIT_MAX_RETRIES_ENV} must be a non-negative integer` };
  }
  return { value: Number(trimmed), error: null };
}

export function readLiveRateLimitConfig(
  env: Record<string, string | undefined> = process.env
): LiveRateLimitConfig {
  const intervalRaw = envInt(env, 'BDL_RATE_LIMIT_INTERVAL_MS', DEFAULT_INTERVAL_MS);
  const allowFast = env.BDL_RATE_LIMIT_ALLOW_FAST === '1';
  const intervalMs = allowFast ? Math.max(1, intervalRaw) : Math.max(ENV_INTERVAL_FLOOR_MS, intervalRaw);
  const maxRequests = Math.max(1, envInt(env, 'BDL_RATE_LIMIT_MAX_REQUESTS', DEFAULT_MAX_REQUESTS));
  const burst = Math.max(
    1,
    envInt(env, 'BDL_RATE_LIMIT_BURST', envInt(env, 'BDL_RATE_LIMIT_MAX_REQUESTS', DEFAULT_BURST))
  );
  const backendRaw = (env.BDL_RATE_LIMIT_BACKEND ?? '').trim().toLowerCase();
  const tableName = (env.BDL_RATE_LIMIT_TABLE ?? '').trim() || null;
  let backend: 'memory' | 'dynamodb';
  if (backendRaw === 'memory') backend = 'memory';
  else if (backendRaw === 'dynamodb') backend = 'dynamodb';
  else if (tableName) backend = 'dynamodb';
  else if (env.VITEST === 'true' || env.NODE_ENV === 'test') backend = 'memory';
  else backend = 'dynamodb';
  const retries = parseBdlMaxRetries(env[BDL_RATE_LIMIT_MAX_RETRIES_ENV]);

  return {
    intervalMs,
    maxRequests,
    burst: Math.max(burst, maxRequests),
    acquireTimeoutMs: Math.max(1, envInt(env, 'BDL_RATE_LIMIT_ACQUIRE_TIMEOUT_MS', DEFAULT_ACQUIRE_TIMEOUT_MS)),
    maxRetries: retries.value,
    maxRetriesError: retries.error,
    retryBaseDelayMs: Math.max(1, envInt(env, 'BDL_RATE_LIMIT_RETRY_BASE_MS', DEFAULT_RETRY_BASE_MS)),
    maxRetryWaitMs: Math.max(1, envInt(env, 'BDL_RATE_LIMIT_MAX_RETRY_WAIT_MS', DEFAULT_MAX_RETRY_WAIT_MS)),
    httpTimeoutMs: Math.max(1, envInt(env, 'BDL_HTTP_TIMEOUT_MS', DEFAULT_HTTP_TIMEOUT_MS)),
    worker: (env.BDL_RATE_LIMIT_WORKER ?? env.AWS_LAMBDA_FUNCTION_NAME ?? 'unknown').trim() || 'unknown',
    backend,
    tableName,
    slotTtlSeconds: Math.max(30, envInt(env, 'BDL_RATE_LIMIT_SLOT_TTL_SECONDS', 120)),
  };
}

export function assertLiveRateLimitConfig(config: LiveRateLimitConfig): void {
  if (config.backend === 'dynamodb' && !config.tableName) {
    throw new BdlRateLimitError(BDL_LIVE_RATE_LIMIT_TABLE_REQUIRED, 'config');
  }
  if (config.maxRetriesError) {
    throw new BdlRateLimitError(config.maxRetriesError, 'config');
  }
}

export function refillBucket(state: BucketState, nowMs: number, config: LiveRateLimitConfig): BucketState {
  const elapsed = Math.max(0, nowMs - state.lastRefillMs);
  const rate = config.maxRequests / config.intervalMs;
  const tokens = Math.min(config.burst, state.tokens + elapsed * rate);
  return { tokens, lastRefillMs: nowMs, version: state.version };
}

function emptyBucket(nowMs: number, config: LiveRateLimitConfig): BucketState {
  return { tokens: config.burst, lastRefillMs: nowMs, version: 0 };
}

export function createMemoryLiveRateLimitStore(): LiveRateLimitStore & { reset(): void } {
  let bucket: BucketState | null = null;
  let cooldownUntilMs: number | null = null;
  let chain = Promise.resolve();

  const exclusive = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  return {
    reset() {
      bucket = null;
      cooldownUntilMs = null;
    },
    loadBucket: () => exclusive(() => (bucket ? { ...bucket } : null)),
    saveBucket: (next, expectedVersion) =>
      exclusive(() => {
        const currentVersion = bucket?.version ?? null;
        if (expectedVersion !== currentVersion) return 'conflict' as const;
        bucket = { ...next };
        return 'ok' as const;
      }),
    getCooldownUntilMs: () => exclusive(() => cooldownUntilMs),
    setCooldownUntilMs: (untilMs) =>
      exclusive(() => {
        cooldownUntilMs = untilMs;
      }),
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function logBdlThrottle(fields: Record<string, unknown>): void {
  const payload: Record<string, unknown> = { evt: 'bdl_throttle', ...fields };
  delete payload.apiKey;
  delete payload.authorization;
  delete payload.body;
  console.log(JSON.stringify(payload));
}

export async function acquireLiveBdlPermit(args: {
  store: LiveRateLimitStore;
  config: LiveRateLimitConfig;
  nowMs?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
  /** Tighter bound than config.acquireTimeoutMs, e.g. from a caller deadline. */
  timeoutMs?: number;
}): Promise<AcquirePermitResult> {
  const nowMs = args.nowMs ?? Date.now;
  const sleepFn = args.sleepFn ?? sleep;
  const started = nowMs();
  const limitMs = Math.min(args.config.acquireTimeoutMs, args.timeoutMs ?? Infinity);
  let retries = 0;
  let waitMs = 0;

  while (true) {
    const now = nowMs();
    if (now - started > limitMs) {
      throw new BdlRateLimitError(BDL_LIVE_RATE_LIMIT_TIMEOUT, 'timeout');
    }

    try {
      const cooldown = await args.store.getCooldownUntilMs();
      if (cooldown != null && cooldown > now) {
        const delay = Math.min(cooldown - now, limitMs - (now - started));
        if (delay <= 0) throw new BdlRateLimitError(BDL_LIVE_RATE_LIMIT_TIMEOUT, 'timeout');
        waitMs += delay;
        await sleepFn(delay);
        retries += 1;
        continue;
      }
    } catch (err) {
      if (err instanceof BdlRateLimitError) throw err;
      throw new BdlRateLimitError(BDL_LIVE_RATE_LIMIT_COORDINATION, 'coordination');
    }

    let loaded: BucketState | null;
    try {
      loaded = await args.store.loadBucket();
    } catch {
      throw new BdlRateLimitError(BDL_LIVE_RATE_LIMIT_COORDINATION, 'coordination');
    }

    const current = refillBucket(loaded ?? emptyBucket(nowMs(), args.config), nowMs(), args.config);
    if (current.tokens < 1) {
      const deficit = 1 - current.tokens;
      const wait = Math.ceil((deficit / args.config.maxRequests) * args.config.intervalMs);
      const delay = Math.min(Math.max(1, wait), limitMs - (nowMs() - started));
      if (delay <= 0) throw new BdlRateLimitError(BDL_LIVE_RATE_LIMIT_TIMEOUT, 'timeout');
      waitMs += delay;
      await sleepFn(delay);
      retries += 1;
      continue;
    }

    const next: BucketState = {
      tokens: current.tokens - 1,
      lastRefillMs: current.lastRefillMs,
      version: current.version + 1,
    };
    let save: 'ok' | 'conflict' | 'unavailable';
    try {
      save = await args.store.saveBucket(next, loaded ? loaded.version : null);
    } catch {
      throw new BdlRateLimitError(BDL_LIVE_RATE_LIMIT_COORDINATION, 'coordination');
    }
    if (save === 'unavailable') {
      throw new BdlRateLimitError(BDL_LIVE_RATE_LIMIT_COORDINATION, 'coordination');
    }
    if (save === 'conflict') {
      retries += 1;
      continue;
    }
    return { granted: true, waitMs, retries };
  }
}

export type FetchBdlLiveOptions = {
  env?: Record<string, string | undefined>;
  store?: LiveRateLimitStore;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
  worker?: string;
  /** Absolute epoch ms the caller must finish by (e.g. Lambda remaining time minus a margin). */
  deadlineMs?: number;
  randomFn?: () => number;
};

let defaultMemoryStore: ReturnType<typeof createMemoryLiveRateLimitStore> | null = null;

export function getDefaultMemoryLiveRateLimitStore(): ReturnType<typeof createMemoryLiveRateLimitStore> {
  if (!defaultMemoryStore) defaultMemoryStore = createMemoryLiveRateLimitStore();
  return defaultMemoryStore;
}

export function resetDefaultMemoryLiveRateLimitStore(): void {
  defaultMemoryStore?.reset();
  defaultMemoryStore = createMemoryLiveRateLimitStore();
}

export async function resolveLiveRateLimitStore(
  config: LiveRateLimitConfig,
  injected?: LiveRateLimitStore
): Promise<LiveRateLimitStore> {
  if (injected) return injected;
  if (config.backend === 'memory') return getDefaultMemoryLiveRateLimitStore();
  const { createDynamoLiveRateLimitStore } = await import('./bdl-live-rate-limit-dynamo');
  return createDynamoLiveRateLimitStore(config);
}

export async function fetchBdlLive(
  url: string,
  init: RequestInit | undefined,
  options: FetchBdlLiveOptions = {}
): Promise<Response> {
  const env = options.env ?? process.env;
  const workerHint =
    options.worker ?? env.BDL_RATE_LIMIT_WORKER ?? env.AWS_LAMBDA_FUNCTION_NAME ?? 'unknown';
  if (shouldSkipLiveBdlHttp(env)) {
    logBdlThrottle({ worker: workerHint, decision: 'replay_skip' });
    throw new BdlRateLimitError(BDL_LIVE_RATE_LIMIT_SKIP, 'replay');
  }
  const config = readLiveRateLimitConfig(env);
  if (options.worker) config.worker = options.worker;
  try {
    assertLiveRateLimitConfig(config);
  } catch (err) {
    logBdlThrottle({
      worker: config.worker,
      decision: 'config_error',
      code: err instanceof BdlRateLimitError ? err.code : 'config',
    });
    throw err;
  }

  let store: LiveRateLimitStore;
  try {
    store = await resolveLiveRateLimitStore(config, options.store);
  } catch (err) {
    logBdlThrottle({
      worker: config.worker,
      decision: 'coordination_error',
      phase: 'resolve_store',
    });
    if (err instanceof BdlRateLimitError) throw err;
    throw new BdlRateLimitError(BDL_LIVE_RATE_LIMIT_COORDINATION, 'coordination');
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleepFn = options.sleepFn ?? sleep;
  const clock = options.nowMs ?? Date.now;
  const randomFn = options.randomFn ?? Math.random;
  const deadlineMs = options.deadlineMs;

  let attempt = 0;
  while (true) {
    let budgetMs: number | undefined;
    if (deadlineMs != null) {
      budgetMs = deadlineMs - clock() - config.httpTimeoutMs;
      if (budgetMs <= 0) {
        logBdlThrottle({ worker: config.worker, decision: 'deadline', phase: 'acquire', attempt });
        throw new BdlRateLimitError(BDL_LIVE_RATE_LIMIT_TIMEOUT, 'timeout');
      }
    }
    let permit: AcquirePermitResult;
    try {
      permit = await acquireLiveBdlPermit({
        store,
        config,
        nowMs: options.nowMs,
        sleepFn,
        timeoutMs: budgetMs,
      });
    } catch (err) {
      logBdlThrottle({
        worker: config.worker,
        decision: err instanceof BdlRateLimitError ? err.code : 'coordination_error',
        attempt,
      });
      throw err;
    }
    logBdlThrottle({
      worker: config.worker,
      decision: 'granted',
      wait_ms: permit.waitMs,
      acquire_retries: permit.retries,
      attempt,
    });

    const attemptInit: RequestInit = init?.signal
      ? init
      : { ...init, signal: AbortSignal.timeout(config.httpTimeoutMs) };
    let res: Response;
    try {
      res = await fetchImpl(url, attemptInit);
    } catch (err) {
      logBdlThrottle({
        worker: config.worker,
        decision: 'http_error',
        error: err instanceof Error ? err.name : 'unknown',
        attempt,
      });
      throw err;
    }
    if (res.status !== 429) return res;

    const retryAfter = parseRetryAfterMs(res.headers.get('retry-after'));
    let delayMs: number;
    if (retryAfter != null) {
      delayMs = retryAfter;
    } else {
      const capped = Math.min(config.maxRetryWaitMs, config.retryBaseDelayMs * Math.pow(2, Math.min(attempt, 8)));
      delayMs = Math.ceil(capped / 2 + (randomFn() * capped) / 2);
    }
    logBdlThrottle({
      worker: config.worker,
      decision: 'provider_429',
      retry_after_ms: retryAfter,
      delay_ms: delayMs,
      attempt,
    });
    try {
      await store.setCooldownUntilMs(
        clock() + delayMs,
        Math.max(config.slotTtlSeconds, Math.ceil(delayMs / 1000) + 5)
      );
    } catch {
      logBdlThrottle({
        worker: config.worker,
        decision: 'coordination_error',
        phase: 'set_cooldown',
      });
      throw new BdlRateLimitError(BDL_LIVE_RATE_LIMIT_COORDINATION, 'coordination');
    }
    if (attempt >= config.maxRetries) {
      throw new BdlRateLimitError(
        `BDL 429 after ${config.maxRetries + 1} attempts`,
        'timeout'
      );
    }
    if (delayMs > config.maxRetryWaitMs) {
      logBdlThrottle({ worker: config.worker, decision: 'retry_wait_exceeds_budget', delay_ms: delayMs, attempt });
      throw new BdlRateLimitError(`BDL 429 retry wait ${delayMs}ms exceeds ${config.maxRetryWaitMs}ms`, 'timeout');
    }
    if (deadlineMs != null && clock() + delayMs + config.httpTimeoutMs > deadlineMs) {
      logBdlThrottle({ worker: config.worker, decision: 'deadline', phase: 'retry', delay_ms: delayMs, attempt });
      throw new BdlRateLimitError(`BDL 429 retry would pass the caller deadline`, 'timeout');
    }
    attempt += 1;
    await sleepFn(delayMs);
  }
}

export const BDL_LIVE_RATE_LIMIT_DEFAULTS = {
  intervalMs: DEFAULT_INTERVAL_MS,
  maxRequests: DEFAULT_MAX_REQUESTS,
  burst: DEFAULT_BURST,
  acquireTimeoutMs: DEFAULT_ACQUIRE_TIMEOUT_MS,
  envIntervalFloorMs: ENV_INTERVAL_FLOOR_MS,
  bucketPk: BUCKET_PK,
  bucketSk: BUCKET_SK,
  cooldownSk: COOLDOWN_SK,
} as const;
