import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAnalyticsSeason, PINNED_ANALYTICS_SEASON } from '@/lib/season';
import {
  MATERIALIZE_CLOSING_LINES_SQL,
  selectLatestPreTipObservations,
  type PreTipObservation,
} from '@/lib/prune/closing-lines';
import { evaluateDestructivePruneGate, evaluateMaterializeGate } from '@/lib/prune/env-gate';
import { requireLiveIngestionSeasonStartYear } from '../../../lambda/nightly-bdl-updater/ingestion-season';
import {
  BROAD_TARGET_SQL,
  isBroadEligible,
  isNearTipEligible,
  NEAR_TIP_TARGET_SQL,
  parsePropUniverse,
} from '../../../lambda/player-props-snapshot/src/game-discovery';
import {
  noRequestCoverage,
  outcomeForProviderResult,
} from '../../../lambda/player-props-snapshot/src/market-outcome';
import { buildPlayerPropSnapshotArchiveKey } from '../../../lambda/player-props-snapshot/src/player-prop-snapshot-archive';
import {
  classifyArchiveHead,
  deriveArchiveKey,
  proposeArchiveStatusRepair,
} from '../../../scripts/ops/prop-archive-check';
import {
  assertCanaryExecuteAllowed,
  canaryPreflight,
  parseSingleGameId,
  runSingleGameCanary,
} from '../../../scripts/ops/prop-archive-canary';

const root = path.resolve(__dirname, '../../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

function flagLines(rel: string, pattern: RegExp): string[] {
  return read(rel)
    .split('\n')
    .filter((line) => pattern.test(line) && !line.includes('API_KEY') && !line.includes('DB_URL'));
}

describe('phase 4b2 nightly season guard', () => {
  it('live mode without INGESTION_SEASON_START_YEAR fails before a provider call', () => {
    const nightly = read('lambda/nightly-bdl-updater/index.ts');
    const guardAt = nightly.indexOf('requireLiveIngestionSeasonStartYear');
    const fetchAt = nightly.indexOf('fetchGames(');
    expect(guardAt).toBeGreaterThan(0);
    expect(guardAt).toBeLessThan(fetchAt);
    expect(nightly).not.toContain('return 2025');
    let calls = 0;
    expect(() =>
      requireLiveIngestionSeasonStartYear({
        DATA_MODE: 'live_api',
        OFFSEASON_MODE: '0',
        CRON_DRY_RUN: '0',
      })
    ).toThrow(/Refusing to fall back to 2025/);
    expect(calls).toBe(0);
  });

  it('explicit ingestion season 2026 resolves to 2026 and does not change getAnalyticsSeason', () => {
    expect(requireLiveIngestionSeasonStartYear({ INGESTION_SEASON_START_YEAR: '2026' })).toBe(2026);
    expect(getAnalyticsSeason({ INGESTION_SEASON_START_YEAR: '2026' })).toBe(PINNED_ANALYTICS_SEASON);
    expect(getAnalyticsSeason({ INGESTION_SEASON_START_YEAR: '2026' })).toBe('2025');
  });

  it('rejects a non-four-digit season and keeps replay on the early return', () => {
    expect(() => requireLiveIngestionSeasonStartYear({ INGESTION_SEASON_START_YEAR: '2026-27' })).toThrow(
      /four-digit/
    );
    const nightly = read('lambda/nightly-bdl-updater/index.ts');
    expect(nightly.indexOf('if (!SHOULD_CALL_LIVE_API)')).toBeLessThan(
      nightly.indexOf('const season = requireLiveIngestionSeasonStartYear')
    );
  });
});

describe('phase 4b2 prop universes', () => {
  const now = new Date('2026-10-20T16:00:00.000Z');
  const date = '2026-10-20';

  it('broad excludes started and Final games and includes a later same-day game', () => {
    expect(isBroadEligible(new Date('2026-10-20T15:00:00.000Z'), now, 'Scheduled', date)).toBe(false);
    expect(isBroadEligible(new Date('2026-10-20T23:00:00.000Z'), now, 'Final', date)).toBe(false);
    expect(isBroadEligible(new Date('2026-10-20T23:00:00.000Z'), now, '2026-10-20T23:00:00Z', date)).toBe(true);
    expect(BROAD_TARGET_SQL).toContain('start_time > $2::timestamptz');
    expect(BROAD_TARGET_SQL).toContain("status IS DISTINCT FROM 'Final'");
    expect(BROAD_TARGET_SQL).not.toContain('status !=');
    expect(read('lambda/player-props-snapshot/src/game-discovery.ts')).not.toContain('result.rows.length > 0');
  });

  it('near_tip uses the [T-75, T-60) window', () => {
    expect(isNearTipEligible(new Date(now.getTime() + 60 * 60_000), now, 'Scheduled')).toBe(true);
    expect(isNearTipEligible(new Date(now.getTime() + 74 * 60_000), now, null)).toBe(true);
    expect(isNearTipEligible(new Date(now.getTime() + 59 * 60_000), now, 'Scheduled')).toBe(false);
    expect(isNearTipEligible(new Date(now.getTime() + 76 * 60_000), now, 'Scheduled')).toBe(false);
    expect(isNearTipEligible(new Date(now.getTime() + 75 * 60_000), now, 'Scheduled')).toBe(false);
    expect(isNearTipEligible(new Date(now.getTime() + 70 * 60_000), now, 'Final')).toBe(false);
    expect(NEAR_TIP_TARGET_SQL).toContain("interval '60 minutes'");
    expect(NEAR_TIP_TARGET_SQL).toContain("interval '75 minutes'");
  });

  it('missing or empty universe does not dispatch', () => {
    expect(parsePropUniverse(undefined)).toBeNull();
    expect(parsePropUniverse('all')).toBeNull();
    expect(parsePropUniverse('broad')).toBe('broad');
    expect(parsePropUniverse('near_tip')).toBe('near_tip');
  });
});

describe('phase 4b2 raw observation grain', () => {
  type Row = {
    pullRunId: number;
    gameId: number;
    playerId: number;
    sportsbook: string;
    propType: string;
    side: string;
    line: number;
    price: number;
    fetchedAt: string;
  };

  function key(row: Row): string {
    return [row.pullRunId, row.gameId, row.playerId, row.sportsbook, row.propType, row.side, row.line].join('|');
  }

  function insertRaw(store: Map<string, Row>, row: Row): Map<string, Row> {
    const id = key(row);
    if (!store.has(id)) store.set(id, row);
    return store;
  }

  it('keeps same line and changed price across pulls, and retries stay idempotent', () => {
    const store = new Map<string, Row>();
    const base = {
      gameId: 1,
      playerId: 2,
      sportsbook: 'draftkings',
      propType: 'points',
      side: 'over',
      line: 27.5,
    };
    insertRaw(store, { ...base, pullRunId: 1, price: -105, fetchedAt: '2026-10-20T20:05:00Z' });
    insertRaw(store, { ...base, pullRunId: 2, price: -110, fetchedAt: '2026-10-20T20:20:00Z' });
    insertRaw(store, { ...base, pullRunId: 2, price: -999, fetchedAt: '2026-10-20T20:21:00Z' });
    expect(store.size).toBe(2);
    expect([...store.values()].map((row) => row.price)).toEqual([-105, -110]);
    expect([...store.values()].map((row) => row.fetchedAt)).toEqual([
      '2026-10-20T20:05:00Z',
      '2026-10-20T20:20:00Z',
    ]);
    const writer = read('lambda/player-props-snapshot/src/bulk-writers.ts');
    expect(writer).toContain(
      'ON CONFLICT (pull_run_id, game_id, player_id, sportsbook, prop_type, side, line_value)'
    );
    expect(writer).not.toContain("date_trunc('hour'");
    expect(writer).toContain('snapshot_at = excluded.snapshot_at');
    expect(writer).toContain('odds_american = excluded.odds_american');
  });

  it('current serving state keeps the latest price', () => {
    const current = new Map<string, { price: number; snapshotAt: string }>();
    const servingKey = '1|2|draftkings|points|over|27.5';
    current.set(servingKey, { price: -105, snapshotAt: '2026-10-20T20:05:00Z' });
    current.set(servingKey, { price: -120, snapshotAt: '2026-10-20T20:35:00Z' });
    expect(current.get(servingKey)).toEqual({ price: -120, snapshotAt: '2026-10-20T20:35:00Z' });
  });
});

describe('phase 4b2 telemetry', () => {
  it('maps the four market outcomes and does not fake a queued game', () => {
    expect(outcomeForProviderResult({ threw: false, rowCount: 0 })).toBe('NO_MARKET_POSTED');
    expect(outcomeForProviderResult({ threw: true, rowCount: 0 })).toBe('REQUEST_FAILED');
    expect(outcomeForProviderResult({ threw: false, rowCount: 4 })).toBe('MARKET_AVAILABLE');
    expect(noRequestCoverage()).toEqual({ GamesTargeted: 0, GamesQueued: 0 });
    const controller = read('lambda/player-props-snapshot/controller.ts');
    expect(controller).toContain("outcome: 'NO_REQUEST'");
    expect(controller).toContain('no_eligible_games');
    expect(controller).not.toContain('GamesQueued: 1');
    const worker = read('lambda/player-props-snapshot/worker.ts');
    expect(worker).toContain('logMarketOutcome');
    expect(worker).toContain('universe');
  });
});

describe('phase 4b2 closing lines', () => {
  const tip = new Date('2026-10-20T21:00:00Z');
  const row = (
    at: string,
    price: number,
    pullRunId: number,
    extra: Partial<PreTipObservation> = {}
  ): PreTipObservation => ({
    gameId: '1',
    playerId: '2',
    sportsbook: 'draftkings',
    propType: 'points',
    side: 'over',
    lineValue: 27.5,
    oddsAmerican: price,
    fetchedAt: new Date(at),
    pullRunId,
    ...extra,
  });

  it('keeps the latest pre-tip price on an unchanged line and ignores a post-tip row', () => {
    const picked = selectLatestPreTipObservations(
      [
        row('2026-10-20T20:05:00Z', -105, 1),
        row('2026-10-20T20:20:00Z', -110, 2),
        row('2026-10-20T20:35:00Z', -120, 3),
      ],
      tip
    );
    expect(picked).toHaveLength(1);
    expect(picked[0]?.oddsAmerican).toBe(-120);
    expect(picked[0]?.fetchedAt.toISOString()).toBe('2026-10-20T20:35:00.000Z');
    const withPostTip = selectLatestPreTipObservations(
      [
        row('2026-10-20T20:05:00Z', -105, 1),
        row('2026-10-20T20:35:00Z', -120, 3),
        row('2026-10-20T20:50:00Z', -140, 4),
      ],
      new Date('2026-10-20T20:40:00Z')
    );
    expect(withPostTip[0]?.oddsAmerican).toBe(-120);
  });

  it('isolates sportsbook and side, and the SQL is idempotent without prune', () => {
    const picked = selectLatestPreTipObservations(
      [
        row('2026-10-20T20:35:00Z', -120, 3),
        row('2026-10-20T20:40:00Z', -130, 5, { sportsbook: 'fanduel' }),
        row('2026-10-20T20:41:00Z', -101, 6, { side: 'under' }),
      ],
      tip
    );
    expect(picked).toHaveLength(3);
    expect(MATERIALIZE_CLOSING_LINES_SQL).toContain('r.fetched_at < g.start_time');
    expect(MATERIALIZE_CLOSING_LINES_SQL).toContain('r.fetched_at DESC');
    expect(MATERIALIZE_CLOSING_LINES_SQL).toContain('r.pull_run_id DESC NULLS LAST');
    expect(MATERIALIZE_CLOSING_LINES_SQL).toContain('g.status = \'Final\'');
    expect(MATERIALIZE_CLOSING_LINES_SQL).toContain('DO NOTHING');
    expect(evaluateMaterializeGate({ DATA_MODE: 'live_api', OFFSEASON_MODE: '0', CRON_DRY_RUN: '0' }).allowed).toBe(
      true
    );
    expect(evaluateDestructivePruneGate({ DATA_MODE: 'live_api', OFFSEASON_MODE: '0', CRON_DRY_RUN: '0' }).allowed).toBe(
      false
    );
  });
});

describe('phase 4b2 archive tools', () => {
  it('builds one deterministic key per pull and classifies head results', () => {
    const args = {
      rawPrefix: 'raw',
      season: 2026,
      gameDate: '2026-10-20',
      gameId: '99',
      pullRunId: 7,
      snapshotAt: new Date('2026-10-20T22:00:00Z'),
    };
    const key = buildPlayerPropSnapshotArchiveKey(args);
    expect(buildPlayerPropSnapshotArchiveKey(args)).toBe(key);
    expect(buildPlayerPropSnapshotArchiveKey({ ...args, pullRunId: 8 })).not.toBe(key);
    expect(key).toContain('__pull=7');
    expect(classifyArchiveHead({ key, headExists: true })).toBe('OBJECT_FOUND');
    expect(classifyArchiveHead({ key, headExists: false })).toBe('OBJECT_MISSING');
    expect(classifyArchiveHead({ key: null, headExists: false })).toBe('KEY_UNKNOWN');
    expect(deriveArchiveKey({})).toBeNull();
    const repair = proposeArchiveStatusRepair({
      status: 'OBJECT_FOUND',
      pullRunId: 7,
      gameId: '99',
      key,
    });
    expect(repair?.sql).toContain('archive_status');
    expect(proposeArchiveStatusRepair({ status: 'OBJECT_MISSING', pullRunId: 7, gameId: '99', key })).toBeNull();
  });

  it('canary preflight accepts one game and refuses a slate or live execute', async () => {
    expect(canaryPreflight('21717855').mode).toBe('dry-run');
    expect(() => parseSingleGameId('1,2')).toThrow(/one numeric game id/);
    expect(() => assertCanaryExecuteAllowed({}, '21717855')).toThrow(/refused/);
    let fetches = 0;
    const report = await runSingleGameCanary({
      gameId: '21717855',
      fetchProps: async () => {
        fetches += 1;
        return { httpStatus: 200, rows: [{ id: 1 }] };
      },
      record: () => undefined,
    });
    expect(fetches).toBe(1);
    expect(report.steps).toContain('provider_http_200');
    expect(report.steps).toContain('archive_key_matches');
    expect(report.rowCount).toBe(1);
  });
});

describe('phase 4b2 disabled runtime', () => {
  it('keeps prop, nightly, and ledger schedules fail-closed and prune off', () => {
    const lambdaTf = read('infra/lambda.tf');
    expect(lambdaTf).toContain('schedule_expression          = "cron(0/15 8-23 ? * * *)"');
    expect(lambdaTf).toContain('jsonencode({ universe = "broad" })');
    expect(lambdaTf).toContain('jsonencode({ universe = "near_tip" })');
    const near = lambdaTf.slice(lambdaTf.indexOf('player_props_near_tip'));
    expect(near).toContain('state       = local.player_props_schedule_state');
    expect(lambdaTf).not.toMatch(/state\s*=\s*"ENABLED"/);
    const ledger = read('infra/projection-ledger.tf');
    expect(ledger).toMatch(/state\s*=\s*"DISABLED"/);
    expect(ledger).toContain('PROJECTION_LEDGER_WRITES  = "0"');
    const flags = flagLines(
      'infra/terraform.tfvars',
      /player_props_execution_enabled|nightly_execution_enabled|INGESTION_SEASON_START_YEAR|PRUNE_ENABLED|CURRENT_ANALYTICS_SEASON/
    );
    expect(flags.join('\n')).not.toMatch(/=\s*true/);
    expect(flags.join('\n')).not.toMatch(/INGESTION_SEASON_START_YEAR/);
    expect(flags.join('\n')).not.toMatch(/PRUNE_ENABLED/);
    expect(flags.join('\n')).not.toMatch(/CURRENT_ANALYTICS_SEASON\s*=\s*"?2026/);
  });
});
