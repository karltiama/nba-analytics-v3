/**
 * Minimal The Odds API HTTP client for the Level-3 spike.
 * Optional: only used when an API key is provided. Fixture adapter does not need this.
 */

import type { OddsApiEventRaw } from './types';

export const ODDS_API_BASE_URL = 'https://api.the-odds-api.com/v4';
export const ODDS_API_NBA_SPORT = 'basketball_nba';

export type OddsApiClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export type OddsApiRequestMeta = {
  remainingCredits: number | null;
  usedCredits: number | null;
  requestsCost: number | null;
};

export type OddsApiFetchResult<T> = {
  data: T;
  meta: OddsApiRequestMeta;
};

function readHeaderInt(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function metaFromHeaders(headers: Headers): OddsApiRequestMeta {
  return {
    remainingCredits: readHeaderInt(headers, 'x-requests-remaining'),
    usedCredits: readHeaderInt(headers, 'x-requests-used'),
    requestsCost: readHeaderInt(headers, 'x-requests-last'),
  };
}

export class OddsApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OddsApiClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? ODDS_API_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** List NBA events (no odds) — typically low/no market credit cost. */
  async listNbaEvents(): Promise<OddsApiFetchResult<OddsApiEventRaw[]>> {
    const url = new URL(`${this.baseUrl}/sports/${ODDS_API_NBA_SPORT}/events`);
    url.searchParams.set('apiKey', this.apiKey);
    return this.getJson<OddsApiEventRaw[]>(url);
  }

  /**
   * Event player-prop odds for specific bookmakers/markets.
   * Cost ≈ (# unique markets returned) × (# regions). Prefer single market + bookmaker.
   */
  async getEventOdds(input: {
    eventId: string;
    markets: string[];
    bookmakers: string[];
    regions?: string;
    includeLinks?: boolean;
    includeSids?: boolean;
  }): Promise<OddsApiFetchResult<OddsApiEventRaw>> {
    const url = new URL(
      `${this.baseUrl}/sports/${ODDS_API_NBA_SPORT}/events/${input.eventId}/odds`
    );
    url.searchParams.set('apiKey', this.apiKey);
    url.searchParams.set('regions', input.regions ?? 'us');
    url.searchParams.set('oddsFormat', 'american');
    url.searchParams.set('markets', input.markets.join(','));
    url.searchParams.set('bookmakers', input.bookmakers.join(','));
    if (input.includeLinks !== false) url.searchParams.set('includeLinks', 'true');
    if (input.includeSids !== false) url.searchParams.set('includeSids', 'true');
    return this.getJson<OddsApiEventRaw>(url);
  }

  private async getJson<T>(url: URL): Promise<OddsApiFetchResult<T>> {
    const res = await this.fetchImpl(url.toString(), { method: 'GET' });
    const meta = metaFromHeaders(res.headers);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Odds API HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as T;
    return { data, meta };
  }
}

export function createOddsApiClientFromEnv(
  env: NodeJS.ProcessEnv = process.env
): OddsApiClient | null {
  const apiKey = env.ODDS_API_KEY?.trim();
  if (!apiKey) return null;
  return new OddsApiClient({ apiKey });
}
