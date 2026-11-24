import { describe, expect, it } from 'vitest';

import { combinedAmericanOdds } from '@/lib/parlay-xray/combined-odds';
import { loadCurrentQuickBuilds } from '@/lib/quick-builds/current-board';
import { QuickBuildInputError } from '@/lib/quick-builds/types';
import { readCurrentBoard } from '@/lib/props/s3-current-board/read';
import { publishCurrentSnapshot, type PublishRequest } from '@/lambda/player-props-snapshot/src/f39b/publish';
import type { ProviderPage } from '@/lambda/player-props-snapshot/src/f39b/pages';
import { InMemoryPrototypeStore } from '@/lambda/player-props-snapshot/src/f39b/store';
import type { BdlPlayerPropRow } from '@/lambda/player-props-snapshot/src/types';

const GAME_DATE = '2026-11-24';
const OBSERVED_ORL = '2026-11-24T19:13:25.922Z';
const OBSERVED_WAS = '2026-11-24T19:13:38.738Z';
const TIP_ORL = '2026-11-25T00:00:00.000Z';
const TIP_WAS = '2026-11-25T01:00:00.000Z';
const ENQUEUED = '2026-11-24T19:13:02.207Z';
const NOW = new Date('2026-11-24T19:20:00.000Z');

function prop(
  gameId: number,
  playerId: number,
  vendor: string,
  over: number,
  under: number,
  propType = 'points'
): BdlPlayerPropRow {
  return {
    id: playerId,
    game_id: gameId,
    player_id: playerId,
    vendor,
    prop_type: propType,
    line_value: '12.5',
    market: { type: 'over_under', over_odds: over, under_odds: under },
    updated_at: ENQUEUED,
  };
}

function page(rows: BdlPlayerPropRow[]): ProviderPage {
  return { httpStatus: 200, payload: { data: rows, meta: { next_cursor: null } } };
}

function publish(
  store: InMemoryPrototypeStore,
  gameId: number,
  pullRunId: number,
  rows: BdlPlayerPropRow[],
  observedAt: string,
  gameStartTime: string
) {
  const request: PublishRequest = {
    store,
    gameId: String(gameId),
    bdlGameId: gameId,
    gameDate: GAME_DATE,
    gameStartTime,
    pullRunId,
    pages: [page(rows)],
    observedAt,
    controllerEnqueuedAt: ENQUEUED,
  };
  return publishCurrentSnapshot(request);
}

function fillers(gameId: number, count: number, vendor: string, startId: number): BdlPlayerPropRow[] {
  return Array.from({ length: count }, (_, index) => prop(gameId, startId + index, vendor, -110, -110));
}

describe('current-board quick builds apply the book before the observation cap', () => {
  it('evaluates the F69 two-game DraftKings slate instead of stopping at 4,000 raw rows', async () => {
    const store = new InMemoryPrototypeStore();
    const keys: string[] = [];
    const inner = store.get.bind(store);
    store.get = async (key: string) => {
      keys.push(key);
      return inner(key);
    };
    await publish(store, 21718181, 720, [
      prop(21718181, 101, 'DraftKings', -250, -250, 'points'),
      ...fillers(21718181, 1711, 'FanDuel', 10_000),
    ], OBSERVED_ORL, TIP_ORL);
    await publish(store, 21718182, 720, [
      prop(21718182, 202, 'DraftKings', -250, -250, 'rebounds'),
      ...fillers(21718182, 1638, 'FanDuel', 20_000),
    ], OBSERVED_WAS, TIP_WAS);
    await publish(store, 21718183, 721, fillers(21718183, 2001, 'DraftKings', 30_000), OBSERVED_WAS, '2026-11-25T03:00:00.000Z');

    const orl = await readCurrentBoard({ store, gameId: '21718181', now: NOW.toISOString() });
    const was = await readCurrentBoard({ store, gameId: '21718182', now: NOW.toISOString() });
    expect(orl.available && was.available).toBe(true);
    if (!orl.available || !was.available) return;
    expect(orl.rows.length + was.rows.length).toBe(6702);
    expect(orl.rows.length).toBe(3424);
    expect(was.rows.length).toBe(3278);
    expect(orl.rows.filter((row) => row.sportsbook === 'draftkings').length).toBe(2);
    expect(was.rows.filter((row) => row.sportsbook === 'draftkings').length).toBe(2);
    keys.length = 0;

    const result = await loadCurrentQuickBuilds({
      sportsbook: 'draftkings',
      preset: 'balanced',
      legCount: 2,
      now: NOW,
      games: [
        { gameId: '21718181', startTime: TIP_ORL, status: 'Scheduled' },
        { gameId: '21718182', startTime: TIP_WAS, status: 'Scheduled' },
      ],
      store,
      query: async (sql: string) => {
        if (/player_props_current|player_prop_snapshots/i.test(sql)) throw new Error('postgres props read');
        return [];
      },
    });

    expect(keys.some((key) => key.includes('21718183'))).toBe(false);
    expect(result.snapshotClass).toBe('current_stored_snapshot');
    expect(result.emptyReason).toBeNull();
    expect(result.builds.length).toBeGreaterThan(0);
    const build = result.builds[0];
    expect(build?.legs.map((leg) => leg.gameId).sort()).toEqual(['21718181', '21718182']);
    expect(build?.legs.every((leg) => leg.sportsbook === 'draftkings')).toBe(true);
    expect(build?.combinedAmerican).toBe(combinedAmericanOdds(build?.legs.map((leg) => leg.oddsAmerican) ?? []));
    expect(build?.combinedAmerican).toBe(combinedAmericanOdds([-250, -250]));
  }, 60_000);

  it('still returns the observation limit after the requested book is the one that exceeds it', async () => {
    const store = new InMemoryPrototypeStore();
    await publish(store, 21718181, 720, fillers(21718181, 2001, 'DraftKings', 40_000), OBSERVED_ORL, TIP_ORL);
    await expect(loadCurrentQuickBuilds({
      sportsbook: 'draftkings',
      preset: 'balanced',
      now: NOW,
      games: [{ gameId: '21718181', startTime: TIP_ORL, status: 'Scheduled' }],
      store,
    })).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED', message: 'observations exceed 4000' });
  }, 60_000);

  it('refuses one archive that is larger than the raw board bound before counting the requested book', async () => {
    const store = new InMemoryPrototypeStore();
    await publish(store, 21718181, 720, [
      prop(21718181, 101, 'DraftKings', -250, -250),
      ...fillers(21718181, 4096, 'FanDuel', 50_000),
    ], OBSERVED_ORL, TIP_ORL);
    await expect(loadCurrentQuickBuilds({
      sportsbook: 'draftkings',
      preset: 'balanced',
      now: NOW,
      games: [{ gameId: '21718181', startTime: TIP_ORL, status: 'Scheduled' }],
      store,
    })).rejects.toBeInstanceOf(QuickBuildInputError);
    await expect(loadCurrentQuickBuilds({
      sportsbook: 'draftkings',
      preset: 'balanced',
      now: NOW,
      games: [{ gameId: '21718181', startTime: TIP_ORL, status: 'Scheduled' }],
      store,
    })).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED', message: 'raw board rows exceed 8192' });
  }, 60_000);

  it('does not build from an invalid archive, a stale board, an expired board, a missing game, or the wrong book', async () => {
    const store = new InMemoryPrototypeStore();
    await publish(store, 21718181, 720, [prop(21718181, 101, 'FanDuel', -110, -110)], OBSERVED_ORL, TIP_ORL);
    await publish(store, 21718182, 720, [prop(21718182, 202, 'DraftKings', -250, -250)], OBSERVED_WAS, TIP_WAS);

    const pointerKey = [...store.objects.keys()].find((key) => key.includes('game_id=21718182') && key.endsWith('pointer.json'));
    expect(pointerKey).toBeTruthy();
    const pointer = JSON.parse(store.objects.get(pointerKey!)!.body.toString('utf8')) as { archiveKey: string };
    const archive = store.objects.get(pointer.archiveKey);
    expect(archive).toBeTruthy();
    store.objects.set(pointer.archiveKey, { ...archive!, body: Buffer.from('not an archive') });

    const broken = await readCurrentBoard({ store, gameId: '21718182', now: NOW.toISOString() });
    expect(broken).toMatchObject({ available: false, reason: 'unavailable' });
    const stale = await readCurrentBoard({ store, gameId: '21718181', now: '2026-11-24T19:44:00.000Z' });
    expect(stale).toMatchObject({ available: false, reason: 'stale' });
    const expired = await readCurrentBoard({ store, gameId: '21718181', now: TIP_ORL });
    expect(expired).toMatchObject({ available: false, reason: 'expired' });
    const missing = await readCurrentBoard({ store, gameId: '21718999', now: NOW.toISOString() });
    expect(missing).toMatchObject({ available: false, reason: 'missing' });

    const wrongBook = await loadCurrentQuickBuilds({
      sportsbook: 'draftkings',
      preset: 'balanced',
      now: NOW,
      games: [
        { gameId: '21718181', startTime: TIP_ORL, status: 'Scheduled' },
        { gameId: '21718182', startTime: TIP_WAS, status: 'Scheduled' },
      ],
      store,
    });
    expect(wrongBook.snapshotClass).toBe('current_stored_snapshot');
    expect(wrongBook.builds).toEqual([]);
    expect(wrongBook.emptyReason).toBe('NO_SUCCESSFUL_PULL');

    const unavailable = await loadCurrentQuickBuilds({
      sportsbook: 'fanduel',
      preset: 'balanced',
      now: new Date('2026-11-24T19:44:00.000Z'),
      games: [{ gameId: '21718181', startTime: TIP_ORL, status: 'Scheduled' }],
      store,
    });
    expect(unavailable.builds).toEqual([]);
    expect(unavailable.emptyReason).toBe('NO_SUCCESSFUL_PULL');
  });

  it('returns a valid no-build when the requested book has no pair inside the payout band', async () => {
    const store = new InMemoryPrototypeStore();
    await publish(store, 21718181, 720, [prop(21718181, 101, 'DraftKings', 400, 400)], OBSERVED_ORL, TIP_ORL);
    await publish(store, 21718182, 720, [prop(21718182, 202, 'DraftKings', 400, 400, 'rebounds')], OBSERVED_WAS, TIP_WAS);
    const result = await loadCurrentQuickBuilds({
      sportsbook: 'draftkings',
      preset: 'balanced',
      now: NOW,
      games: [
        { gameId: '21718181', startTime: TIP_ORL, status: 'Scheduled' },
        { gameId: '21718182', startTime: TIP_WAS, status: 'Scheduled' },
      ],
      store,
    });
    expect(result.snapshotClass).toBe('current_stored_snapshot');
    expect(result.builds).toEqual([]);
    expect(result.emptyReason).toBe('NO_PAIRS_IN_BAND');
  });
});
