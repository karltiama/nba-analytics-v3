import { parseRetryAfterMs } from '@/lib/balldontlie/retry-after';
import {
  OWLS_DEFAULT_BASE_URL,
  OWLS_DEFAULT_HISTORY_CONCURRENCY,
  OWLS_DEFAULT_MAX_RETRIES,
  OWLS_DEFAULT_TIMEOUT_MS,
  OWLS_HARD_CAP_HISTORY_CONCURRENCY,
  OWLS_HISTORY_CONCURRENCY_RETRY_AFTER_SECONDS,
  OWLS_PAGE_LIMITS,
  OWLS_PATHS,
} from './contract';
import {
  OwlsApiKeyRequiredError,
  OwlsAuthenticationError,
  OwlsExecuteRequiredError,
  OwlsForbiddenError,
  OwlsInsightError,
  OwlsRateLimitError,
  OwlsServiceBusyError,
} from './errors';
import type { OwlsEndpointName, OwlsMode, OwlsPage, OwlsRequest, OwlsResponseMetadata } from './types';

export type OwlsClientMetrics = {
  requestsAttempted: number;
  requestsSuccessful: number;
  requestsRetried: number;
  status429: number;
  status503: number;
  rowsReceived: number;
  pagesCompleted: number;
};

export type OwlsClientOpts = {
  mode: OwlsMode;
  apiKey?: string | null;
  baseUrl?: string;
  timeoutMs?: number;
  historyConcurrency?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  fixtures?: Record<string, unknown>;
};

const sleepDefault = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function readOwlsApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const a = env.OWLS_API_KEY?.trim();
  const b = env.OWLS_INSIGHT_API_KEY?.trim();
  return a || b || null;
}

export function capHistoryConcurrency(requested: number | undefined): number {
  const n = requested ?? OWLS_DEFAULT_HISTORY_CONCURRENCY;
  if (!Number.isFinite(n) || n < 1) return OWLS_DEFAULT_HISTORY_CONCURRENCY;
  return Math.min(Math.floor(n), OWLS_HARD_CAP_HISTORY_CONCURRENCY);
}

export function assertExecuteAllowed(mode: OwlsMode, apiKey: string | null | undefined): void {
  if (mode !== 'execute') {
    throw new OwlsExecuteRequiredError();
  }
  if (!apiKey?.trim()) {
    throw new OwlsApiKeyRequiredError();
  }
}

class ConcurrencyLimiter {
  private inFlight = 0;
  readonly maxObserved = { value: 0 };
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  get inFlightCount(): number {
    return this.inFlight;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.inFlight < this.max) {
      this.inFlight += 1;
      this.maxObserved.value = Math.max(this.maxObserved.value, this.inFlight);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.inFlight += 1;
        this.maxObserved.value = Math.max(this.maxObserved.value, this.inFlight);
        resolve();
      });
    });
  }

  private release(): void {
    this.inFlight -= 1;
    const next = this.waiting.shift();
    if (next) next();
  }
}

export class OwlsInsightClient {
  readonly mode: OwlsMode;
  readonly baseUrl: string;
  readonly historyConcurrency: number;
  readonly maxObservedConcurrency: { value: number };
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly fixtures: Record<string, unknown>;
  private readonly limiter: ConcurrencyLimiter;
  private readonly metrics: OwlsClientMetrics = {
    requestsAttempted: 0,
    requestsSuccessful: 0,
    requestsRetried: 0,
    status429: 0,
    status503: 0,
    rowsReceived: 0,
    pagesCompleted: 0,
  };

  constructor(opts: OwlsClientOpts) {
    this.mode = opts.mode;
    this.apiKey = opts.apiKey?.trim() || null;
    this.baseUrl = (opts.baseUrl ?? OWLS_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? OWLS_DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? OWLS_DEFAULT_MAX_RETRIES;
    this.historyConcurrency = capHistoryConcurrency(opts.historyConcurrency);
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.sleep = opts.sleep ?? sleepDefault;
    this.now = opts.now ?? Date.now;
    this.fixtures = opts.fixtures ?? {};
    this.limiter = new ConcurrencyLimiter(this.historyConcurrency);
    this.maxObservedConcurrency = this.limiter.maxObserved;
  }

  getMetrics(): OwlsClientMetrics {
    return { ...this.metrics };
  }

  buildUrl(request: OwlsRequest): string {
    const url = new URL(request.path, this.baseUrl);
    for (const [k, v] of Object.entries(request.query)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  async request(request: OwlsRequest): Promise<{ body: unknown; metadata: OwlsResponseMetadata; url: string }> {
    if (this.mode === 'dry-run') {
      throw new OwlsExecuteRequiredError('Dry-run Owls client does not perform network requests');
    }
    if (this.mode === 'fixture') {
      return this.fixtureResponse(request);
    }
    assertExecuteAllowed(this.mode, this.apiKey);
    return this.limiter.run(() => this.requestWithRetry(request));
  }

  async *paginate(args: {
    path: string;
    query: Record<string, string | number | boolean | undefined>;
    limit: number;
    startOffset?: number;
    startPageIndex?: number;
  }): AsyncGenerator<OwlsPage> {
    let offset = args.startOffset ?? 0;
    let pageIndex = args.startPageIndex ?? 1;
    while (true) {
      const request: OwlsRequest = {
        method: 'GET',
        path: args.path,
        query: { ...args.query, limit: args.limit, offset },
      };
      const page = await this.request(request);
      const rows = extractRows(page.body);
      const exhausted = pageIsExhausted(page.body, rows.length, args.limit);
      this.metrics.rowsReceived += rows.length;
      this.metrics.pagesCompleted += 1;
      yield {
        request,
        url: page.url,
        body: page.body,
        metadata: page.metadata,
        rowCount: rows.length,
        pageIndex,
        offset,
        limit: args.limit,
        exhausted,
      };
      if (exhausted) return;
      offset += args.limit;
      pageIndex += 1;
    }
  }

  historyGamesQuery(args: {
    sport?: string;
    season?: string;
    team?: string;
    gameType?: string;
    startDate?: string;
    endDate?: string;
  }): OwlsRequest {
    return {
      method: 'GET',
      path: OWLS_PATHS.historyGames,
      query: {
        sport: args.sport ?? 'nba',
        season: args.season,
        team: args.team,
        gameType: args.gameType,
        startDate: args.startDate,
        endDate: args.endDate,
        limit: OWLS_PAGE_LIMITS.historyGames.max,
        offset: 0,
      },
    };
  }

  historyPlayerPropsQuery(args: {
    eventId?: string;
    sport?: string;
    player?: string;
    propType?: string;
    book?: string;
    startDate?: string;
    endDate?: string;
  }): OwlsRequest {
    return {
      method: 'GET',
      path: OWLS_PATHS.historyPlayerProps,
      query: {
        eventId: args.eventId,
        sport: args.sport ?? 'nba',
        player: args.player,
        propType: args.propType,
        book: args.book,
        startDate: args.startDate,
        endDate: args.endDate,
        limit: OWLS_PAGE_LIMITS.historyPlayerProps.max,
        offset: 0,
      },
    };
  }

  historyPropsQuery(args: {
    eventId: string;
    playerName?: string;
    propType?: string;
    book?: string;
    opening?: boolean;
  }): OwlsRequest {
    return {
      method: 'GET',
      path: OWLS_PATHS.historyProps,
      query: {
        eventId: args.eventId,
        playerName: args.playerName,
        propType: args.propType,
        book: args.book,
        opening: args.opening,
        limit: OWLS_PAGE_LIMITS.historyProps.default,
        offset: 0,
      },
    };
  }

  endpointNameForPath(path: string): OwlsEndpointName {
    if (path.includes('/history/player-props')) return 'history_player_props';
    if (path.includes('/history/closing-odds')) return 'history_closing_odds';
    if (path.includes('/history/public-betting')) return 'history_public_betting';
    if (path.includes('/history/props')) return 'history_props';
    if (path.includes('/history/odds')) return 'history_odds';
    if (path.includes('/history/coverage')) return 'history_coverage';
    return 'history_games';
  }

  private fixtureResponse(request: OwlsRequest): {
    body: unknown;
    metadata: OwlsResponseMetadata;
    url: string;
  } {
    const url = this.buildUrl(request);
    const key = fixtureKey(request);
    const body = this.fixtures[key] ?? this.fixtures[request.path] ?? { success: true, data: [], meta: { fixture: true } };
    return {
      body,
      url,
      metadata: {
        status: 200,
        headers: { 'x-owls-mode': 'fixture' },
        durationMs: 0,
      },
    };
  }

  private async requestWithRetry(
    request: OwlsRequest
  ): Promise<{ body: unknown; metadata: OwlsResponseMetadata; url: string }> {
    const url = this.buildUrl(request);
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      this.metrics.requestsAttempted += 1;
      const started = this.now();
      try {
        const res = await this.fetchWithTimeout(url);
        const durationMs = this.now() - started;
        const headerMap = headerObject(res.headers);
        const retryAfterMs =
          parseRetryAfterMs(res.headers.get('retry-after'), this.now()) ??
          (res.status === 429 && headerMap['x-owls-code'] === 'HISTORY_CONCURRENCY'
            ? OWLS_HISTORY_CONCURRENCY_RETRY_AFTER_SECONDS * 1000
            : null);
        const text = await res.text();
        const parsed = parseJson(text);
        const code = readErrorCode(parsed, headerMap);

        if (res.status === 401) throw new OwlsAuthenticationError();
        if (res.status === 403) throw new OwlsForbiddenError();
        if (res.status === 429) {
          this.metrics.status429 += 1;
          throw new OwlsRateLimitError(
            `Owls 429 ${code ?? ''}`.trim(),
            retryAfterMs ?? OWLS_HISTORY_CONCURRENCY_RETRY_AFTER_SECONDS * 1000,
            code
          );
        }
        if (res.status === 503) {
          this.metrics.status503 += 1;
          throw new OwlsServiceBusyError('Owls 503', retryAfterMs);
        }
        if (res.status >= 500) {
          throw new OwlsInsightError(`Owls HTTP ${res.status}`, {
            status: res.status,
            retryAfterMs,
          });
        }
        if (!res.ok) {
          const extra = parsed != null ? ` ${JSON.stringify(parsed).slice(0, 400)}` : '';
          throw new OwlsInsightError(`Owls HTTP ${res.status}${extra}`, { status: res.status, code });
        }
        this.metrics.requestsSuccessful += 1;
        return {
          url,
          body: parsed,
          metadata: { status: res.status, headers: headerMap, durationMs },
        };
      } catch (err) {
        lastErr = err;
        const retryable =
          err instanceof OwlsRateLimitError ||
          err instanceof OwlsServiceBusyError ||
          (err instanceof OwlsInsightError && err.status != null && err.status >= 500);
        if (!retryable || attempt === this.maxRetries) throw err;
        this.metrics.requestsRetried += 1;
        const retryAfterMs =
          err instanceof OwlsInsightError && err.retryAfterMs != null
            ? err.retryAfterMs
            : 500 * 2 ** attempt;
        await this.sleep(retryAfterMs);
      }
    }
    throw lastErr instanceof Error ? lastErr : new OwlsInsightError(String(lastErr));
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
        },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }
  }
}

const NESTED_ROW_KEYS = [
  'games',
  'playerProps',
  'player_props',
  'props',
  'snapshots',
  'propSnapshots',
  'propsSnapshots',
  'closingOdds',
  'closing_odds',
  'odds',
  'markets',
  'betting',
  'publicBetting',
  'public_betting',
  'percentages',
  'rows',
  'items',
  'results',
] as const;

export function extractRows(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    const rec = body as Record<string, unknown>;
    if (Array.isArray(rec.data)) return rec.data;
    if (Array.isArray(rec.rows)) return rec.rows;
    if (Array.isArray(rec.games)) return rec.games;
    const nested =
      rec.data && typeof rec.data === 'object' && !Array.isArray(rec.data)
        ? (rec.data as Record<string, unknown>)
        : null;
    if (nested) {
      for (const key of NESTED_ROW_KEYS) {
        if (Array.isArray(nested[key])) return nested[key] as unknown[];
      }
    }
  }
  return [];
}

export function pageIsExhausted(body: unknown, rowCount: number, limit: number): boolean {
  if (rowCount === 0) return true;
  const hasMore = readHasMore(body);
  if (hasMore === false) return true;
  if (hasMore === true) return false;
  return rowCount < limit;
}

function readHasMore(body: unknown): boolean | null {
  if (!body || typeof body !== 'object') return null;
  const rec = body as Record<string, unknown>;
  const candidates = [rec.pagination, rec.meta, rec.data];
  if (rec.data && typeof rec.data === 'object' && !Array.isArray(rec.data)) {
    const nested = rec.data as Record<string, unknown>;
    candidates.push(nested.pagination, nested.meta);
  }
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const hasMore = (candidate as { hasMore?: unknown }).hasMore;
    if (typeof hasMore === 'boolean') return hasMore;
  }
  return null;
}

export function fixtureKey(request: OwlsRequest): string {
  const eventId = request.query.eventId;
  if (typeof eventId === 'string' && eventId) return `${request.path}?eventId=${eventId}`;
  return request.path;
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function headerObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

function readErrorCode(body: unknown, headers: Record<string, string>): string | null {
  if (headers['x-owls-code']) return headers['x-owls-code'];
  if (body && typeof body === 'object') {
    const rec = body as Record<string, unknown>;
    if (typeof rec.code === 'string') return rec.code;
    if (rec.error && typeof rec.error === 'object' && typeof (rec.error as { code?: string }).code === 'string') {
      return (rec.error as { code: string }).code;
    }
  }
  return null;
}
