import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PROTECTED_HISTORY_SEASONS } from '@/lib/games/status-sync';
import {
  GAMES_CANARY_MAX_REQUESTS,
  GAMES_CANARY_SEASON,
  INJURY_CANARY_URL,
  ODDS_CANARY_MAX_REQUESTS,
  PROPS_CANARY_MAX_REQUESTS,
  STATS_CANARY_MAX_REQUESTS,
  assertNoSecret,
  classifyHttpAccess,
  gamesCanaryUrl,
  localKeyFromEnv,
  memoryCanaryEnv,
  memoryCanaryStore,
  oddsCanaryUrl,
  propsCanaryUrl,
  runGamesEntitlementCanary,
  runInjuryEntitlementCanary,
  runOddsEntitlementCanary,
  runPropsEntitlementCanary,
  runStatsEntitlementCanary,
  statsCanaryUrl,
  wantsExecute,
} from '@/lib/balldontlie/entitlement-canaries';

const KEY = 'test-canary-key';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function pagingFetch(pages: unknown[][]): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    calls.push(url);
    const page = pages[calls.length - 1] ?? pages[pages.length - 1];
    return jsonResponse({ data: page, meta: { next_cursor: calls.length < 9 ? calls.length : null } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function runnerEnv(worker: string) {
  return {
    env: {
      ...memoryCanaryEnv(worker),
      BDL_RATE_LIMIT_INTERVAL_MS: '1',
      BDL_RATE_LIMIT_ALLOW_FAST: '1',
    },
    store: memoryCanaryStore(),
    key: KEY,
  };
}

describe('entitlement canary contract', () => {
  it('classifies 200, 401, 403, 429, and 5xx without treating them as entitled', () => {
    expect(classifyHttpAccess(200, true)).toBe('ENTITLED');
    expect(classifyHttpAccess(200, false)).toBe('INCONCLUSIVE');
    expect(classifyHttpAccess(401, false)).toBe('NOT_ENTITLED');
    expect(classifyHttpAccess(403, false)).toBe('NOT_ENTITLED');
    expect(classifyHttpAccess(429, false)).toBe('INCONCLUSIVE');
    expect(classifyHttpAccess(503, false)).toBe('INCONCLUSIVE');
    expect(classifyHttpAccess(null, false)).toBe('INCONCLUSIVE');
  });

  it('reads only the local env key and refuses to echo it', () => {
    expect(localKeyFromEnv({})).toBeNull();
    expect(localKeyFromEnv({ BALLDONTLIE_API_KEY: `  ${KEY}  ` })).toBe(KEY);
    expect(() => assertNoSecret(JSON.stringify({ authorization: KEY }), KEY)).toThrow(/CREDENTIAL_LEAK_STOP/);
    expect(wantsExecute(['node', 'script.ts'])).toBe(false);
    expect(wantsExecute(['node', 'script.ts', '--execute'])).toBe(true);
  });

  it('injury canary stays one per_page=1 request and does nothing by default', async () => {
    expect(INJURY_CANARY_URL).toBe('https://api.balldontlie.io/nba/v1/player_injuries?per_page=1');
    expect(INJURY_CANARY_URL.includes('cursor')).toBe(false);
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ status: 'Out' }] })) as unknown as typeof fetch;
    const dry = await runInjuryEntitlementCanary({ execute: false, key: KEY, fetchImpl });
    expect(dry.REQUEST_COUNT).toBe(0);
    expect(dry.ACCESS).toBe('NOT_EXECUTED');
    expect(dry.WRITE_COUNT).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    const live = await runInjuryEntitlementCanary({ execute: true, key: KEY, fetchImpl });
    expect(live.REQUEST_COUNT).toBe(1);
    expect(live.ACCESS).toBe('ENTITLED');
    expect(live.HTTP_STATUS).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('games canary is season 2026, one date, and stops at 3 requests', async () => {
    expect(GAMES_CANARY_SEASON).toBe(2026);
    expect([...PROTECTED_HISTORY_SEASONS]).toEqual(['2023', '2024', '2025']);
    const url = gamesCanaryUrl('2026-10-22', null);
    expect(url).toContain('seasons%5B%5D=2026');
    expect(url).toContain('start_date=2026-10-22');
    expect(url).toContain('end_date=2026-10-22');
    const dryFetch = vi.fn() as unknown as typeof fetch;
    const dry = await runGamesEntitlementCanary({
      execute: false,
      date: '2026-10-22',
      ...runnerEnv('games'),
      fetchImpl: dryFetch,
    });
    expect(dry.REQUEST_COUNT).toBe(0);
    expect(dryFetch).not.toHaveBeenCalled();

    const { fetchImpl, calls } = pagingFetch([[{ id: 1, season: 2026 }]]);
    const live = await runGamesEntitlementCanary({
      execute: true,
      date: '2026-10-22',
      ...runnerEnv('games'),
      fetchImpl,
    });
    expect(live.REQUEST_COUNT).toBe(GAMES_CANARY_MAX_REQUESTS);
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.includes('seasons%5B%5D=2026'))).toBe(true);
    expect(live.WRITE_COUNT).toBe(0);
  });

  it('games canary rejects a protected season row and does not keep paging', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ id: 9, season: 2025 }], meta: { next_cursor: 2 } })
    ) as unknown as typeof fetch;
    const result = await runGamesEntitlementCanary({
      execute: true,
      date: '2026-10-22',
      ...runnerEnv('games'),
      fetchImpl,
    });
    expect(result.rejectedProtectedSeasons).toBe(1);
    expect(result.SCHEMA_VALID).toBe(false);
    expect(result.REQUEST_COUNT).toBe(1);
    expect(result.STOP_REASON).toBe('protected_or_non_2026_season');
    expect(result.WRITE_COUNT).toBe(0);
  });

  it('stats canary requests /v1/stats only and caps pages', async () => {
    expect(statsCanaryUrl('18447937', null)).toContain('/v1/stats?');
    expect(statsCanaryUrl('18447937', null).includes('lineup')).toBe(false);
    const dryFetch = vi.fn() as unknown as typeof fetch;
    const dry = await runStatsEntitlementCanary({
      execute: false,
      gameId: '18447937',
      ...runnerEnv('stats'),
      fetchImpl: dryFetch,
    });
    expect(dry.REQUEST_COUNT).toBe(0);
    const { fetchImpl, calls } = pagingFetch([[{ player: { id: 7 }, min: '30', pts: 20 }]]);
    const live = await runStatsEntitlementCanary({
      execute: true,
      gameId: '18447937',
      ...runnerEnv('stats'),
      fetchImpl,
    });
    expect(live.REQUEST_COUNT).toBe(STATS_CANARY_MAX_REQUESTS);
    expect(calls.every((call) => call.includes('/v1/stats?') && !call.includes('lineup'))).toBe(true);
    expect(live.identity.withPlayerId).toBe(STATS_CANARY_MAX_REQUESTS);
    expect(live.identity.bridgeQueried).toBe(false);
    expect(live.WRITE_COUNT).toBe(0);
  });

  it('odds canary stays on one date, two requests, and zero upserts', async () => {
    expect(oddsCanaryUrl('2026-10-22', null)).toContain('/v2/odds?');
    expect(oddsCanaryUrl('2026-10-22', null)).toContain('dates%5B%5D=2026-10-22');
    const { fetchImpl, calls } = pagingFetch([
      [{ game_id: 1, vendor: 'draftkings', moneyline_home_odds: -110 }],
    ]);
    const live = await runOddsEntitlementCanary({
      execute: true,
      date: '2026-10-22',
      ...runnerEnv('odds'),
      fetchImpl,
    });
    expect(live.REQUEST_COUNT).toBe(ODDS_CANARY_MAX_REQUESTS);
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((call) => new URL(call).searchParams.get('dates[]')))).toEqual(new Set(['2026-10-22']));
    expect(live.upserts).toBe(0);
    expect(live.WRITE_COUNT).toBe(0);
    expect(live.rowsWithVendor).toBe(2);
  });

  it('props canary requires one game id, uses the shared limiter, and does not paginate', async () => {
    const dryFetch = vi.fn() as unknown as typeof fetch;
    const missing = await runPropsEntitlementCanary({
      execute: true,
      gameId: null,
      ...runnerEnv('props'),
      fetchImpl: dryFetch,
    });
    expect(missing.REQUEST_COUNT).toBe(0);
    expect(missing.STOP_REASON).toBe('missing_or_invalid_game_id');
    expect(dryFetch).not.toHaveBeenCalled();

    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe(propsCanaryUrl('18447937'));
      expect(url.includes('lineup')).toBe(false);
      return jsonResponse({
        data: [
          {
            id: 99,
            game_id: 18447937,
            player_id: 7,
            vendor: 'draftkings',
            prop_type: 'points',
            line_value: '22.5',
            market: { type: 'over_under', over_odds: -110, under_odds: -110, market_id: 'mkt' },
          },
        ],
        meta: { next_cursor: 50 },
      });
    }) as unknown as typeof fetch;
    const live = await runPropsEntitlementCanary({
      execute: true,
      gameId: '18447937',
      ...runnerEnv('props'),
      fetchImpl,
    });
    expect(live.REQUEST_COUNT).toBe(PROPS_CANARY_MAX_REQUESTS);
    expect(live.RATE_LIMITER).toBe('shared_fetchBdlLive');
    expect(live.rowsWithPlayerId).toBe(1);
    expect(live.rowsWithOdds).toBe(1);
    expect(live.handoffFieldNames).toContain('id');
    expect(live.handoffFieldNames).toContain('market_id');
    expect(live.SPORTSBOOK_HANDOFF_PROVIDER_FIELDS).toBe('OBSERVED_FIELD_NAMES_ONLY');
    expect(JSON.stringify(live).includes('22.5')).toBe(false);
    expect(live.WRITE_COUNT).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('canary script safety', () => {
  const root = process.cwd();
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

  const entrypoints = [
    'scripts/ops/bdl-injuries-entitlement-probe.ts',
    'scripts/ops/2026-schedule-status-canary.ts',
    'scripts/ops/2026-postgame-box-stats-canary.ts',
    'scripts/ops/2026-odds-canary.ts',
    'scripts/ops/2026-player-props-canary.ts',
  ];

  it('entrypoints load .env only and do not look up Lambda or Terraform', () => {
    for (const rel of entrypoints) {
      const src = read(rel);
      expect(src).toContain("path.join(process.cwd(), '.env')");
      expect(src).not.toContain('execFileSync');
      expect(src).not.toContain('get-function-configuration');
      expect(src).not.toContain('terraform.tfvars');
      expect(src).not.toContain('lambda_env');
      expect(src).not.toContain('STATUS_SYNC_MANUAL_CANARY');
      expect(src).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
      expect(src).toContain('wantsExecute');
    }
  });

  it('retired probes cannot reach AWS or a provider call', () => {
    const legacy = read('scripts/ops/probe-bdl-player-props.ts');
    expect(legacy).toContain('RETIRED_USE_scripts/ops/2026-player-props-canary.ts');
    expect(legacy).not.toContain('execFileSync');
    expect(legacy).not.toContain('fetch(');
    expect(legacy).not.toContain('fetchBdlLive');

    const combined = read('scripts/ops/2026-injuries-odds-canary.ts');
    expect(combined).toContain('RETIRED_USE_scripts/ops/bdl-injuries-entitlement-probe.ts');
    expect(combined).not.toContain('main().catch');
  });

  it('stats and odds scripts do not request lineups or upsert analytics', () => {
    const stats = read('scripts/ops/2026-postgame-box-stats-canary.ts');
    expect(stats).not.toContain('lineups');
    expect(stats).not.toContain('new Pool');
    const odds = read('scripts/ops/2026-odds-canary.ts');
    expect(odds).not.toContain('INSERT');
    expect(odds).not.toContain('analytics.game_odds');
    expect(odds).not.toContain('ON CONFLICT');
    const games = read('scripts/ops/2026-schedule-status-canary.ts');
    expect(games).not.toContain('new Pool');
  });

  it('production game-status-sync still receives its key only from lambda_env', () => {
    const tf = read('infra/game-status-sync.tf');
    expect(tf).toContain('lookup(var.lambda_env, "BALLDONTLIE_API_KEY"');
    expect(tf).not.toContain('.env');
  });
});
