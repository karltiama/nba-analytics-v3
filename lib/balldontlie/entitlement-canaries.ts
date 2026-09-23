/**
 * Local-only BallDontLie entitlement canaries.
 * Default is no network. Execution never writes analytics, raw, SQS, Lambda, schedules, or S3.
 * The provider key is a function argument from the caller's process env. This module does not
 * read Terraform, Lambda configuration, or the AWS CLI.
 */

import {
  BdlRateLimitError,
  createMemoryLiveRateLimitStore,
  fetchBdlLive,
  type LiveRateLimitStore,
} from '@/lib/balldontlie/live-rate-limit';
import { PROTECTED_HISTORY_SEASONS } from '@/lib/games/status-sync';

export const CANARY_ACCESS = ['ENTITLED', 'NOT_ENTITLED', 'INCONCLUSIVE', 'NOT_EXECUTED'] as const;
export type CanaryAccess = (typeof CANARY_ACCESS)[number];

export const GAMES_CANARY_SEASON = 2026;
export const GAMES_CANARY_MAX_REQUESTS = 3;
export const STATS_CANARY_MAX_REQUESTS = 3;
export const ODDS_CANARY_MAX_REQUESTS = 2;
export const PROPS_CANARY_MAX_REQUESTS = 1;
export const INJURY_CANARY_URL = 'https://api.balldontlie.io/nba/v1/player_injuries?per_page=1';

export const SPORTSBOOK_HANDOFF_UNTIL_CANARY = 'UNKNOWN_UNTIL_CANARY' as const;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const GAME_ID = /^\d+$/;

export type CanaryResult = {
  CANARY: string;
  EXECUTED: boolean;
  REQUEST_COUNT: number;
  HTTP_STATUS: number | null;
  ACCESS: CanaryAccess;
  SCHEMA_VALID: boolean;
  WRITE_COUNT: 0;
  RATE_LIMITER: 'shared_fetchBdlLive' | 'single_raw_fetch' | 'none';
  STOP_REASON: string | null;
};

export type CanaryFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** fetchBdlLive types fetchImpl as typeof fetch. Canaries only pass string URLs. */
function toRateLimitFetch(fetchImpl: CanaryFetch): typeof fetch {
  return (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return fetchImpl(url, init);
  };
}

export function wantsExecute(argv: readonly string[]): boolean {
  return argv.includes('--execute');
}

export function localKeyFromEnv(env: Record<string, string | undefined>): string | null {
  const key = (env.BALLDONTLIE_API_KEY ?? env.BALDONTLIE_API_KEY ?? '').trim();
  return key.length > 0 ? key : null;
}

/** One flag value. Repeated flags fail closed so a canary cannot fan out. */
export function singleFlag(argv: readonly string[], name: string): { ok: true; value: string } | { ok: false; reason: string } {
  const indexes: number[] = [];
  argv.forEach((token, i) => {
    if (token === name) indexes.push(i);
  });
  if (indexes.length === 0) return { ok: false, reason: `missing ${name}` };
  if (indexes.length > 1) return { ok: false, reason: `repeated ${name}` };
  const value = argv[indexes[0] + 1];
  if (!value || value.startsWith('--')) return { ok: false, reason: `missing ${name} value` };
  return { ok: true, value };
}

export function classifyHttpAccess(status: number | null, schemaValid: boolean): CanaryAccess {
  if (status == null) return 'INCONCLUSIVE';
  if (status === 401 || status === 403) return 'NOT_ENTITLED';
  if (status === 200 && schemaValid) return 'ENTITLED';
  return 'INCONCLUSIVE';
}

export function canaryLimiterEnv(worker: string): Record<string, string | undefined> {
  return {
    DATA_MODE: 'live_api',
    OFFSEASON_MODE: '0',
    CRON_DRY_RUN: '0',
    BDL_RATE_LIMIT_BACKEND: 'dynamodb',
    BDL_RATE_LIMIT_TABLE: 'nba-bdl-rate-limit',
    BDL_RATE_LIMIT_INTERVAL_MS: '13000',
    BDL_RATE_LIMIT_MAX_REQUESTS: '1',
    BDL_RATE_LIMIT_BURST: '1',
    BDL_RATE_LIMIT_ACQUIRE_TIMEOUT_MS: '90000',
    BDL_RATE_LIMIT_WORKER: worker,
    MAX_RETRIES: '0',
  };
}

export function assertNoSecret(serialized: string, key: string | null): void {
  if (key && serialized.includes(key)) {
    throw new Error('CREDENTIAL_LEAK_STOP: canary output contained the provider key');
  }
  if (/authorization/i.test(serialized) && /bearer|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(serialized)) {
    throw new Error('CREDENTIAL_LEAK_STOP: canary output contained an authorization header');
  }
}

function baseResult(canary: string, limiter: CanaryResult['RATE_LIMITER']): CanaryResult {
  return {
    CANARY: canary,
    EXECUTED: false,
    REQUEST_COUNT: 0,
    HTTP_STATUS: null,
    ACCESS: 'NOT_EXECUTED',
    SCHEMA_VALID: false,
    WRITE_COUNT: 0,
    RATE_LIMITER: limiter,
    STOP_REASON: 'dry_run',
  };
}

function notExecuted(canary: string, limiter: CanaryResult['RATE_LIMITER'], reason: string): CanaryResult {
  return { ...baseResult(canary, limiter), STOP_REASON: reason };
}

async function readJson(res: Response): Promise<{ json: unknown | null; parseError: boolean }> {
  const raw = await res.text();
  if (!raw.trim()) return { json: null, parseError: true };
  try {
    return { json: JSON.parse(raw) as unknown, parseError: false };
  } catch {
    return { json: null, parseError: true };
  }
}

function dataArray(json: unknown): unknown[] | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const data = (json as { data?: unknown }).data;
  return Array.isArray(data) ? data : null;
}

function nextCursor(json: unknown): number | null {
  if (!json || typeof json !== 'object') return null;
  const cursor = (json as { meta?: { next_cursor?: unknown } }).meta?.next_cursor;
  return typeof cursor === 'number' ? cursor : null;
}

type LimitedPage = {
  status: number | null;
  json: unknown | null;
  schemaArray: boolean;
  stop: string | null;
  madeRequest: boolean;
};

async function oneLimitedGet(args: {
  url: string;
  key: string;
  worker: string;
  fetchImpl?: CanaryFetch;
  store?: LiveRateLimitStore;
  env?: Record<string, string | undefined>;
}): Promise<LimitedPage> {
  try {
    const res = await fetchBdlLive(
      args.url,
      { method: 'GET', headers: { Authorization: args.key } },
      {
        env: args.env ?? canaryLimiterEnv(args.worker),
        worker: args.worker,
        fetchImpl: args.fetchImpl ? toRateLimitFetch(args.fetchImpl) : undefined,
        store: args.store,
      }
    );
    const parsed = await readJson(res);
    return {
      status: res.status,
      json: parsed.json,
      schemaArray: dataArray(parsed.json) != null && !parsed.parseError,
      stop: null,
      madeRequest: true,
    };
  } catch (err) {
    if (err instanceof BdlRateLimitError) {
      const madeRequest = /429/.test(err.message);
      return {
        status: madeRequest ? 429 : null,
        json: null,
        schemaArray: false,
        stop: madeRequest ? 'provider_429' : err.code === 'replay' ? 'replay_skip' : err.code,
        madeRequest,
      };
    }
    return { status: null, json: null, schemaArray: false, stop: 'network', madeRequest: true };
  }
}

export function gamesCanaryUrl(date: string, cursor: number | null): string {
  const params = new URLSearchParams();
  params.set('seasons[]', String(GAMES_CANARY_SEASON));
  params.set('start_date', date);
  params.set('end_date', date);
  params.set('per_page', '100');
  if (cursor != null) params.set('cursor', String(cursor));
  return `https://api.balldontlie.io/v1/games?${params.toString()}`;
}

export type GamesCanaryResult = CanaryResult & {
  date: string | null;
  season: typeof GAMES_CANARY_SEASON;
  rowCount: number;
  rejectedProtectedSeasons: number;
};

export async function runGamesEntitlementCanary(args: {
  execute: boolean;
  date: string | null;
  key: string | null;
  fetchImpl?: CanaryFetch;
  store?: LiveRateLimitStore;
  env?: Record<string, string | undefined>;
}): Promise<GamesCanaryResult> {
  const empty: GamesCanaryResult = {
    ...baseResult('games', 'shared_fetchBdlLive'),
    date: args.date,
    season: GAMES_CANARY_SEASON,
    rowCount: 0,
    rejectedProtectedSeasons: 0,
  };
  if (!args.execute) return { ...empty, STOP_REASON: 'dry_run' };
  if (!args.date || !YMD.test(args.date)) {
    return { ...empty, STOP_REASON: 'missing_or_invalid_date' };
  }
  if (!args.key) return { ...empty, date: args.date, STOP_REASON: 'missing_key' };

  let requestCount = 0;
  let lastStatus: number | null = null;
  let schemaValid = false;
  let rowCount = 0;
  let rejected = 0;
  let cursor: number | null = null;
  let stop: string | null = null;

  while (requestCount < GAMES_CANARY_MAX_REQUESTS) {
    const page = await oneLimitedGet({
      url: gamesCanaryUrl(args.date, cursor),
      key: args.key,
      worker: 'games-entitlement-canary',
      fetchImpl: args.fetchImpl,
      store: args.store,
      env: args.env,
    });
    if (page.madeRequest) requestCount += 1;
    lastStatus = page.status;
    if (page.stop) {
      stop = page.stop;
      break;
    }
    if (page.status === 401 || page.status === 403) {
      stop = `http_${page.status}`;
      break;
    }
    if (page.status !== 200 || !page.schemaArray) {
      stop = page.status == null ? 'no_status' : `http_${page.status}`;
      break;
    }
    const rows = dataArray(page.json) ?? [];
    schemaValid = true;
    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        schemaValid = false;
        continue;
      }
      const season = (row as { season?: unknown }).season;
      const seasonText = season == null ? '' : String(season);
      if (PROTECTED_HISTORY_SEASONS.has(seasonText) || (seasonText !== '' && seasonText !== String(GAMES_CANARY_SEASON))) {
        rejected += 1;
        schemaValid = false;
      } else {
        rowCount += 1;
      }
    }
    if (rejected > 0) {
      stop = 'protected_or_non_2026_season';
      break;
    }
    cursor = nextCursor(page.json);
    if (cursor == null) {
      stop = 'complete';
      break;
    }
    if (requestCount >= GAMES_CANARY_MAX_REQUESTS) {
      stop = 'request_cap';
      break;
    }
  }
  if (requestCount >= GAMES_CANARY_MAX_REQUESTS && cursor != null && stop == null) {
    stop = 'request_cap';
  }

  return {
    ...empty,
    EXECUTED: true,
    REQUEST_COUNT: requestCount,
    HTTP_STATUS: lastStatus,
    ACCESS: classifyHttpAccess(lastStatus, schemaValid && rejected === 0),
    SCHEMA_VALID: schemaValid && rejected === 0,
    STOP_REASON: stop,
    date: args.date,
    rowCount,
    rejectedProtectedSeasons: rejected,
  };
}

export function statsCanaryUrl(gameId: string, cursor: number | null): string {
  const params = new URLSearchParams();
  params.append('game_ids[]', gameId);
  params.set('per_page', '100');
  if (cursor != null) params.set('cursor', String(cursor));
  return `https://api.balldontlie.io/v1/stats?${params.toString()}`;
}

export type StatsCanaryResult = CanaryResult & {
  gameId: string | null;
  rowCount: number;
  identity: {
    withPlayerId: number;
    missingPlayerId: number;
    distinctPlayerIds: number;
    bridgeQueried: false;
  };
};

function playerIdOf(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const rec = row as { player?: { id?: unknown }; player_id?: unknown };
  const nested = rec.player && typeof rec.player === 'object' ? rec.player.id : null;
  const id = nested ?? rec.player_id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  if (typeof id === 'string' && id.trim()) return id.trim();
  return null;
}

export async function runStatsEntitlementCanary(args: {
  execute: boolean;
  gameId: string | null;
  key: string | null;
  fetchImpl?: CanaryFetch;
  store?: LiveRateLimitStore;
  env?: Record<string, string | undefined>;
}): Promise<StatsCanaryResult> {
  const identity = { withPlayerId: 0, missingPlayerId: 0, distinctPlayerIds: 0, bridgeQueried: false as const };
  const empty: StatsCanaryResult = {
    ...baseResult('stats', 'shared_fetchBdlLive'),
    gameId: args.gameId,
    rowCount: 0,
    identity,
  };
  if (!args.execute) return { ...empty, STOP_REASON: 'dry_run' };
  if (!args.gameId || !GAME_ID.test(args.gameId)) {
    return { ...empty, STOP_REASON: 'missing_or_invalid_game_id' };
  }
  if (!args.key) return { ...empty, gameId: args.gameId, STOP_REASON: 'missing_key' };

  const seen = new Set<string>();
  let requestCount = 0;
  let lastStatus: number | null = null;
  let schemaValid = false;
  let cursor: number | null = null;
  let stop: string | null = null;
  let withPlayerId = 0;
  let missingPlayerId = 0;

  while (requestCount < STATS_CANARY_MAX_REQUESTS) {
    const url = statsCanaryUrl(args.gameId, cursor);
    if (url.includes('lineup')) {
      return { ...empty, gameId: args.gameId, EXECUTED: true, STOP_REASON: 'lineups_forbidden' };
    }
    const page = await oneLimitedGet({
      url,
      key: args.key,
      worker: 'stats-entitlement-canary',
      fetchImpl: args.fetchImpl,
      store: args.store,
      env: args.env,
    });
    if (page.madeRequest) requestCount += 1;
    lastStatus = page.status;
    if (page.stop) {
      stop = page.stop;
      break;
    }
    if (page.status === 401 || page.status === 403) {
      stop = `http_${page.status}`;
      break;
    }
    if (page.status !== 200 || !page.schemaArray) {
      stop = page.status == null ? 'no_status' : `http_${page.status}`;
      break;
    }
    schemaValid = true;
    for (const row of dataArray(page.json) ?? []) {
      const pid = playerIdOf(row);
      if (!pid) missingPlayerId += 1;
      else {
        withPlayerId += 1;
        seen.add(pid);
      }
    }
    cursor = nextCursor(page.json);
    if (cursor == null) {
      stop = 'complete';
      break;
    }
  }
  if (cursor != null && stop == null) stop = 'request_cap';

  return {
    ...empty,
    EXECUTED: true,
    REQUEST_COUNT: requestCount,
    HTTP_STATUS: lastStatus,
    ACCESS: classifyHttpAccess(lastStatus, schemaValid),
    SCHEMA_VALID: schemaValid,
    STOP_REASON: stop,
    gameId: args.gameId,
    rowCount: withPlayerId + missingPlayerId,
    identity: {
      withPlayerId,
      missingPlayerId,
      distinctPlayerIds: seen.size,
      bridgeQueried: false,
    },
  };
}

export function oddsCanaryUrl(date: string, cursor: number | null): string {
  const params = new URLSearchParams();
  params.append('dates[]', date);
  params.set('per_page', '100');
  if (cursor != null) params.set('cursor', String(cursor));
  return `https://api.balldontlie.io/v2/odds?${params.toString()}`;
}

export type OddsCanaryResult = CanaryResult & {
  date: string | null;
  rowCount: number;
  rowsWithGameId: number;
  rowsWithVendor: number;
  rowsWithPrice: number;
  upserts: 0;
};

function oddsRowShape(row: unknown): { game: boolean; vendor: boolean; price: boolean } {
  if (!row || typeof row !== 'object') return { game: false, vendor: false, price: false };
  const rec = row as Record<string, unknown>;
  const price = ['moneyline_home_odds', 'moneyline_away_odds', 'spread_home_odds', 'total_over_odds', 'total_under_odds'].some(
    (key) => rec[key] != null
  );
  return {
    game: rec.game_id != null,
    vendor: typeof rec.vendor === 'string' && rec.vendor.trim().length > 0,
    price,
  };
}

export async function runOddsEntitlementCanary(args: {
  execute: boolean;
  date: string | null;
  key: string | null;
  fetchImpl?: CanaryFetch;
  store?: LiveRateLimitStore;
  env?: Record<string, string | undefined>;
}): Promise<OddsCanaryResult> {
  const empty: OddsCanaryResult = {
    ...baseResult('odds', 'shared_fetchBdlLive'),
    date: args.date,
    rowCount: 0,
    rowsWithGameId: 0,
    rowsWithVendor: 0,
    rowsWithPrice: 0,
    upserts: 0,
  };
  if (!args.execute) return { ...empty, STOP_REASON: 'dry_run' };
  if (!args.date || !YMD.test(args.date)) return { ...empty, STOP_REASON: 'missing_or_invalid_date' };
  if (!args.key) return { ...empty, date: args.date, STOP_REASON: 'missing_key' };

  let requestCount = 0;
  let lastStatus: number | null = null;
  let schemaValid = false;
  let cursor: number | null = null;
  let stop: string | null = null;
  let rowCount = 0;
  let rowsWithGameId = 0;
  let rowsWithVendor = 0;
  let rowsWithPrice = 0;

  while (requestCount < ODDS_CANARY_MAX_REQUESTS) {
    const page = await oneLimitedGet({
      url: oddsCanaryUrl(args.date, cursor),
      key: args.key,
      worker: 'odds-entitlement-canary',
      fetchImpl: args.fetchImpl,
      store: args.store,
      env: args.env,
    });
    if (page.madeRequest) requestCount += 1;
    lastStatus = page.status;
    if (page.stop) {
      stop = page.stop;
      break;
    }
    if (page.status === 401 || page.status === 403) {
      stop = `http_${page.status}`;
      break;
    }
    if (page.status !== 200 || !page.schemaArray) {
      stop = page.status == null ? 'no_status' : `http_${page.status}`;
      break;
    }
    schemaValid = true;
    for (const row of dataArray(page.json) ?? []) {
      rowCount += 1;
      const shape = oddsRowShape(row);
      if (shape.game) rowsWithGameId += 1;
      if (shape.vendor) rowsWithVendor += 1;
      if (shape.price) rowsWithPrice += 1;
    }
    cursor = nextCursor(page.json);
    if (cursor == null) {
      stop = 'complete';
      break;
    }
  }
  if (cursor != null && stop == null) stop = 'request_cap';

  return {
    ...empty,
    EXECUTED: true,
    REQUEST_COUNT: requestCount,
    HTTP_STATUS: lastStatus,
    ACCESS: classifyHttpAccess(lastStatus, schemaValid),
    SCHEMA_VALID: schemaValid,
    STOP_REASON: stop,
    date: args.date,
    rowCount,
    rowsWithGameId,
    rowsWithVendor,
    rowsWithPrice,
    upserts: 0,
  };
}

const HANDOFF_KEY_NAMES = [
  'id',
  'offer_id',
  'fixture_id',
  'event_id',
  'market_id',
  'selection_id',
  'option_id',
  'outcome_id',
  'vendor_id',
  'book_id',
  'sportsbook_id',
] as const;

export function propsCanaryUrl(gameId: string): string {
  const params = new URLSearchParams();
  params.set('game_id', gameId);
  params.set('per_page', '100');
  return `https://api.balldontlie.io/v2/odds/player_props?${params.toString()}`;
}

export function collectSchemaKeyNames(value: unknown, depth = 0): string[] {
  if (!value || typeof value !== 'object' || depth > 2) return [];
  const keys = Object.keys(value as Record<string, unknown>);
  const nested = keys.flatMap((key) => collectSchemaKeyNames((value as Record<string, unknown>)[key], depth + 1));
  return [...new Set([...keys, ...nested])].sort();
}

export function handoffKeyHits(keyNames: readonly string[]): string[] {
  const wanted = new Set(HANDOFF_KEY_NAMES.map((name) => name.toLowerCase()));
  return keyNames.filter((name) => wanted.has(name.toLowerCase()));
}

export type PropsCanaryResult = CanaryResult & {
  gameId: string | null;
  rowCount: number;
  schemaFieldNames: string[];
  rowsWithGameId: number;
  rowsWithPlayerId: number;
  rowsWithVendor: number;
  rowsWithPropType: number;
  rowsWithLine: number;
  rowsWithOdds: number;
  rowsWithProviderOfferId: number;
  handoffFieldNames: string[];
  SPORTSBOOK_HANDOFF_PROVIDER_FIELDS: typeof SPORTSBOOK_HANDOFF_UNTIL_CANARY | 'OBSERVED_FIELD_NAMES_ONLY';
};

function propFlags(row: unknown): {
  game: boolean;
  player: boolean;
  vendor: boolean;
  propType: boolean;
  line: boolean;
  odds: boolean;
  offer: boolean;
} {
  if (!row || typeof row !== 'object') {
    return { game: false, player: false, vendor: false, propType: false, line: false, odds: false, offer: false };
  }
  const rec = row as Record<string, unknown>;
  const market = rec.market;
  const marketRec = market && typeof market === 'object' ? (market as Record<string, unknown>) : null;
  const odds =
    (marketRec != null && (marketRec.over_odds != null || marketRec.under_odds != null || marketRec.odds != null)) ||
    rec.odds != null;
  return {
    game: rec.game_id != null,
    player: rec.player_id != null,
    vendor: typeof rec.vendor === 'string' && rec.vendor.trim().length > 0,
    propType: typeof rec.prop_type === 'string' && rec.prop_type.trim().length > 0,
    line: rec.line_value != null,
    odds,
    offer: rec.id != null || rec.offer_id != null,
  };
}

export async function runPropsEntitlementCanary(args: {
  execute: boolean;
  gameId: string | null;
  key: string | null;
  fetchImpl?: CanaryFetch;
  store?: LiveRateLimitStore;
  env?: Record<string, string | undefined>;
}): Promise<PropsCanaryResult> {
  const empty: PropsCanaryResult = {
    ...baseResult('props', 'shared_fetchBdlLive'),
    gameId: args.gameId,
    rowCount: 0,
    schemaFieldNames: [],
    rowsWithGameId: 0,
    rowsWithPlayerId: 0,
    rowsWithVendor: 0,
    rowsWithPropType: 0,
    rowsWithLine: 0,
    rowsWithOdds: 0,
    rowsWithProviderOfferId: 0,
    handoffFieldNames: [],
    SPORTSBOOK_HANDOFF_PROVIDER_FIELDS: SPORTSBOOK_HANDOFF_UNTIL_CANARY,
  };
  if (!args.execute) return { ...empty, STOP_REASON: 'dry_run' };
  if (!args.gameId || !GAME_ID.test(args.gameId)) {
    return { ...empty, STOP_REASON: 'missing_or_invalid_game_id' };
  }
  if (!args.key) return { ...empty, gameId: args.gameId, STOP_REASON: 'missing_key' };

  const page = await oneLimitedGet({
    url: propsCanaryUrl(args.gameId),
    key: args.key,
    worker: 'props-entitlement-canary',
    fetchImpl: args.fetchImpl,
    store: args.store,
    env: args.env,
  });
  const rows = page.schemaArray ? dataArray(page.json) ?? [] : [];
  const flags = rows.map(propFlags);
  const schemaFieldNames = rows[0] ? collectSchemaKeyNames(rows[0]) : [];
  const schemaValid = page.status === 200 && page.schemaArray;
  return {
    ...empty,
    EXECUTED: true,
    REQUEST_COUNT: page.madeRequest ? 1 : 0,
    HTTP_STATUS: page.status,
    ACCESS: classifyHttpAccess(page.status, schemaValid),
    SCHEMA_VALID: schemaValid,
    STOP_REASON: page.stop ?? (schemaValid ? 'single_request' : page.status == null ? 'no_status' : `http_${page.status}`),
    gameId: args.gameId,
    rowCount: rows.length,
    schemaFieldNames,
    rowsWithGameId: flags.filter((row) => row.game).length,
    rowsWithPlayerId: flags.filter((row) => row.player).length,
    rowsWithVendor: flags.filter((row) => row.vendor).length,
    rowsWithPropType: flags.filter((row) => row.propType).length,
    rowsWithLine: flags.filter((row) => row.line).length,
    rowsWithOdds: flags.filter((row) => row.odds).length,
    rowsWithProviderOfferId: flags.filter((row) => row.offer).length,
    handoffFieldNames: handoffKeyHits(schemaFieldNames),
    SPORTSBOOK_HANDOFF_PROVIDER_FIELDS: schemaValid ? 'OBSERVED_FIELD_NAMES_ONLY' : SPORTSBOOK_HANDOFF_UNTIL_CANARY,
  };
}

export async function runInjuryEntitlementCanary(args: {
  execute: boolean;
  key: string | null;
  fetchImpl?: CanaryFetch;
}): Promise<CanaryResult & { recordCount: number | null }> {
  const empty = { ...baseResult('injury', 'single_raw_fetch'), recordCount: null as number | null };
  if (!args.execute) return { ...empty, STOP_REASON: 'dry_run' };
  if (!args.key) return { ...empty, STOP_REASON: 'missing_key' };
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  let res: Response;
  try {
    res = await fetchImpl(INJURY_CANARY_URL, { method: 'GET', headers: { Authorization: args.key } });
  } catch {
    return {
      ...empty,
      EXECUTED: true,
      REQUEST_COUNT: 1,
      ACCESS: 'INCONCLUSIVE',
      STOP_REASON: 'network',
    };
  }
  const parsed = await readJson(res);
  const rows = dataArray(parsed.json);
  const schemaValid = res.status === 200 && rows != null && !parsed.parseError;
  return {
    ...empty,
    EXECUTED: true,
    REQUEST_COUNT: 1,
    HTTP_STATUS: res.status,
    ACCESS: classifyHttpAccess(res.status, schemaValid),
    SCHEMA_VALID: schemaValid,
    STOP_REASON: schemaValid ? 'single_request' : `http_${res.status}`,
    recordCount: rows ? rows.length : null,
  };
}

export function memoryCanaryStore(): LiveRateLimitStore {
  return createMemoryLiveRateLimitStore();
}

export function memoryCanaryEnv(worker: string): Record<string, string | undefined> {
  return { ...canaryLimiterEnv(worker), BDL_RATE_LIMIT_BACKEND: 'memory' };
}

export function notExecutedResult(canary: string, reason: string): CanaryResult {
  return notExecuted(canary, 'none', reason);
}
