/**
 * Minimal BallDontLie API client for archive/backfill workflows.
 *
 * Differs from `lib/balldontlie/refresh-schedule-from-bdl.ts` in two ways:
 *   1. Preserves raw response envelopes (`{ data, meta }`) instead of flattening
 *      to row arrays - the archive script writes them verbatim to S3.
 *   2. Pure HTTP - never touches Postgres.
 *
 * Pagination:
 *   - `cursor`: BDL v1 style for `/players`, `/games`, `/stats` (next_cursor).
 *   - `page`: BDL v1 style for `/teams` (next_page).
 *
 * Retry behavior matches the existing scripts: 429/5xx honor Retry-After when
 * present, otherwise exponential backoff with a 60s base (`MAX_RETRIES`).
 * Between successful pages, sleep `BALLDONTLIE_REQUEST_DELAY_MS` (default 200ms).
 * BDL_TRIAL_MODE=1 forces concurrency 1 and >=12s spacing (prefer 13s).
 */

import { delayForRateLimit } from './retry-after';
import {
  isBdlTrialMode,
  resolveBdlRequestDelayMs,
  withBdlTrialExclusive,
} from './trial-limiter';

export const BDL_BASE_URL = 'https://api.balldontlie.io/v1';
export const BDL_NBA_BASE_URL = 'https://api.balldontlie.io';

export type PaginationStyle = 'cursor' | 'page';

/**
 * Raw envelope returned by BDL endpoints. We type `data` as unknown[] and
 * preserve `meta` verbatim - we do not transform either.
 */
export type BdlEnvelope = {
  data: unknown[];
  meta?: {
    next_cursor?: number | string | null;
    next_page?: number | null;
    per_page?: number;
    total_pages?: number;
    total_count?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type BdlPage = {
  /** 1-indexed page number used for the S3 key (`page=<n>.json`). */
  pageIndex: number;
  /** Verbatim API response (preserves both `data` and `meta`). */
  body: BdlEnvelope;
  /** Resolved URL we fetched (useful for logging). */
  url: string;
  /** True iff the API reports more pages after this one. */
  hasMore: boolean;
};

export type BdlClientOpts = {
  apiKey: string;
  baseUrl?: string;
  /** Sleep between successful pages (ms). Default reads BALLDONTLIE_REQUEST_DELAY_MS or 200. */
  requestDelayMs?: number;
  /** Retry count for 429 / 5xx. Default reads MAX_RETRIES or 3. */
  maxRetries?: number;
  /** Base delay for exponential backoff (ms). Default 60000 (60s). */
  retryBaseDelayMs?: number;
  /** Optional fetch override for tests; defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Optional logger; defaults to console.log. */
  logger?: (msg: string) => void;
};

export type BdlClientMetrics = {
  httpAttempts: number;
  httpSuccess: number;
  status429: number;
  status5xx: number;
  retries: number;
  retryAfterUsed: number;
  spacingSamplesMs: number[];
};

export type PaginateOpts = {
  /** Endpoint path under baseUrl, e.g. `/games`. */
  path: string;
  /** Static query params (per_page added automatically). */
  params?: Record<string, string | number | string[]>;
  paginationStyle: PaginationStyle;
  /** Page size (BDL max 100). Default 100. */
  perPage?: number;
  /**
   * Optional starting cursor (cursor pagination). Used when resuming a partial
   * archive: pass the next_cursor read from the previously-archived page.
   */
  startCursor?: number | string | null;
  /**
   * Optional starting page index (page pagination). Used when resuming.
   * 1-indexed; defaults to 1.
   */
  startPage?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function buildParams(
  staticParams: Record<string, string | number | string[]> | undefined,
  perPage: number
): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(staticParams ?? {})) {
    if (Array.isArray(v)) {
      for (const item of v) out.append(k, String(item));
    } else {
      out.set(k, String(v));
    }
  }
  out.set('per_page', String(perPage));
  return out;
}

export class BdlArchiveClient {
  readonly baseUrl: string;
  readonly requestDelayMs: number;
  readonly trialMode: boolean;
  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: (msg: string) => void;
  private requestNumber = 0;
  private lastAttemptAt: number | null = null;
  private readonly metrics: BdlClientMetrics = {
    httpAttempts: 0,
    httpSuccess: 0,
    status429: 0,
    status5xx: 0,
    retries: 0,
    retryAfterUsed: 0,
    spacingSamplesMs: [],
  };

  constructor(opts: BdlClientOpts) {
    if (!opts.apiKey) throw new Error('BdlArchiveClient: apiKey is required');
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? BDL_BASE_URL).replace(/\/+$/, '');
    const delay = resolveBdlRequestDelayMs({ requestedDelayMs: opts.requestDelayMs });
    this.requestDelayMs = delay.delayMs;
    this.trialMode = delay.trialMode;
    this.maxRetries = opts.maxRetries ?? envInt('MAX_RETRIES', 3);
    this.retryBaseDelayMs = opts.retryBaseDelayMs ?? 60_000;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.logger = opts.logger ?? ((msg: string) => console.log(msg));
  }

  getMetrics(): BdlClientMetrics {
    return {
      ...this.metrics,
      spacingSamplesMs: [...this.metrics.spacingSamplesMs],
    };
  }

  /**
   * Fetch a single URL with 429/5xx retry + exponential backoff.
   * Authorization header matches existing BDL scripts (raw key, not Bearer).
   */
  async fetchWithRetry(url: string): Promise<Response> {
    const run = async () => {
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        this.requestNumber += 1;
        const n = this.requestNumber;
        const now = Date.now();
        if (this.lastAttemptAt != null) this.metrics.spacingSamplesMs.push(now - this.lastAttemptAt);
        this.lastAttemptAt = now;
        this.metrics.httpAttempts += 1;
        if (this.trialMode) {
          this.logger(
            `[bdl-trial] request #${n} delayMs=${this.requestDelayMs} (no API key logged) ${redactUrl(url)}`
          );
        }
        const res = await this.fetchImpl(url, { headers: { Authorization: this.apiKey } });
        if (res.status === 429) {
          this.metrics.status429 += 1;
          const { delayMs, source } = delayForRateLimit({
            retryAfterHeader: res.headers.get('retry-after'),
            attempt,
            retryBaseDelayMs: this.retryBaseDelayMs,
          });
          if (source === 'retry-after') this.metrics.retryAfterUsed += 1;
          this.logger(
            `[bdl] 429 rate-limited; ${source} backoff ${Math.round(delayMs / 1000)}s ` +
              `(attempt ${attempt + 1}/${this.maxRetries + 1} request #${n}) ${redactUrl(url)}`
          );
          if (attempt >= this.maxRetries) return res;
          this.metrics.retries += 1;
          await sleep(delayMs);
          continue;
        }
        if (res.status >= 500 && res.status < 600) {
          this.metrics.status5xx += 1;
          const { delayMs, source } = delayForRateLimit({
            retryAfterHeader: res.headers.get('retry-after'),
            attempt,
            retryBaseDelayMs: this.retryBaseDelayMs,
          });
          if (source === 'retry-after') this.metrics.retryAfterUsed += 1;
          this.logger(
            `[bdl] ${res.status} server error; ${source} backoff ${Math.round(delayMs / 1000)}s ` +
              `(attempt ${attempt + 1}/${this.maxRetries + 1} request #${n}) ${redactUrl(url)}`
          );
          if (attempt >= this.maxRetries) return res;
          this.metrics.retries += 1;
          await sleep(delayMs);
          continue;
        }
        if (res.ok) this.metrics.httpSuccess += 1;
        return res;
      }
      throw new Error(`BDL exhausted retries: ${redactUrl(url)}`);
    };
    return this.trialMode ? withBdlTrialExclusive(run) : run();
  }

  /**
   * Fetch a single page; preserves the response envelope verbatim.
   *
   * For cursor pagination, pass `cursor` (number | string | null).
   * For page pagination, pass `page` (1-indexed).
   */
  private async fetchPage(args: {
    path: string;
    params: URLSearchParams;
    paginationStyle: PaginationStyle;
    cursor?: number | string | null;
    page?: number;
  }): Promise<{ url: string; body: BdlEnvelope }> {
    const params = new URLSearchParams(args.params);
    if (args.paginationStyle === 'cursor' && args.cursor !== undefined && args.cursor !== null) {
      params.set('cursor', String(args.cursor));
    } else if (args.paginationStyle === 'page' && args.page !== undefined && args.page > 1) {
      params.set('page', String(args.page));
    }
    const url = `${this.baseUrl}${args.path}?${params.toString()}`;
    const res = await this.fetchWithRetry(url);
    if (!res.ok) {
      const text = await res.text().catch(() => '<unreadable>');
      throw new Error(`BDL ${args.path} returned ${res.status}: ${text.slice(0, 300)}`);
    }
    const body = (await res.json()) as BdlEnvelope;
    return { url, body };
  }

  /**
   * Stream pages for an endpoint. Yields each raw envelope as a `BdlPage`.
   * The orchestrator decides whether to persist each page.
   *
   * Sleeps `requestDelayMs` between pages to respect free-tier rate limits.
   */
  async *paginate(opts: PaginateOpts): AsyncIterable<BdlPage> {
    const perPage = opts.perPage ?? 100;
    const baseParams = buildParams(opts.params, perPage);

    let cursor: number | string | null | undefined =
      opts.paginationStyle === 'cursor' ? opts.startCursor ?? null : undefined;
    let pageIndex = opts.paginationStyle === 'page' ? opts.startPage ?? 1 : 1;
    let firstPage = true;

    while (true) {
      if (!firstPage) await sleep(this.requestDelayMs);
      firstPage = false;

      const { url, body } =
        opts.paginationStyle === 'cursor'
          ? await this.fetchPage({
              path: opts.path,
              params: baseParams,
              paginationStyle: 'cursor',
              cursor,
            })
          : await this.fetchPage({
              path: opts.path,
              params: baseParams,
              paginationStyle: 'page',
              page: pageIndex,
            });

      const meta = body.meta ?? {};
      const nextCursor = meta.next_cursor ?? null;
      const nextPage = meta.next_page ?? null;
      const hasMore =
        opts.paginationStyle === 'cursor' ? nextCursor !== null : nextPage !== null;

      yield { pageIndex, body, url, hasMore };

      if (!hasMore) break;
      if (opts.paginationStyle === 'cursor') {
        cursor = nextCursor;
      } else {
        pageIndex = (nextPage as number) ?? pageIndex + 1;
        continue;
      }
      pageIndex += 1;
    }
  }
}

/**
 * Read `BALLDONTLIE_API_KEY` (or the typo alias `BALDONTLIE_API_KEY` still
 * supported elsewhere in this codebase). Throws if neither is set.
 */
export function readBdlApiKey(): string {
  const k = (process.env.BALLDONTLIE_API_KEY ?? process.env.BALDONTLIE_API_KEY ?? '').trim();
  if (!k) {
    throw new Error(
      'Missing BALLDONTLIE_API_KEY (or BALDONTLIE_API_KEY) - required for BDL archive client.'
    );
  }
  return k;
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('api_key');
    u.searchParams.delete('apiKey');
    return `${u.origin}${u.pathname}?${u.searchParams.toString()}`;
  } catch {
    return url.split('?')[0] ?? url;
  }
}

export function isTrialLimiterActive(env: Record<string, string | undefined> = process.env): boolean {
  return isBdlTrialMode(env);
}
