import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import { noVigProbability } from '@/lib/betting/market-probability';
import { getPlayerPropsForExplorer } from '@/lib/betting/props-explorer-serving';
import { loadS3CurrentLegQuotes } from '@/lib/parlay/s3-current-quotes';
import { loadCurrentQuickBuilds } from '@/lib/quick-builds/current-board';
import { readCurrentBoard } from '@/lib/props/s3-current-board/read';
import { currentPropsSource } from '@/lib/props/s3-current-board/source';
import { publishCurrentSnapshot, type PublishRequest } from '@/lambda/player-props-snapshot/src/f39b/publish';
import type { ProviderPage } from '@/lambda/player-props-snapshot/src/f39b/pages';
import { InMemoryPrototypeStore } from '@/lambda/player-props-snapshot/src/f39b/store';
import { highVolumePropsMarketWrites } from '@/lambda/player-props-snapshot/src/f39b/writes';
import type { BdlPlayerPropRow } from '@/lambda/player-props-snapshot/src/types';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockQueryOne = queryOne as ReturnType<typeof vi.fn>;

const GAME_DATE = '2026-11-23';
const TIP = '2026-11-24T00:00:00.000Z';
const OBSERVED = '2026-11-23T22:00:00.000Z';
const ENQUEUED = '2026-11-23T21:59:00.000Z';
const NOW = new Date('2026-11-23T22:05:00.000Z');

function row(gameId: number, playerId: number, line: string, over: number, under: number, vendor = 'DraftKings', prop = 'points'): BdlPlayerPropRow {
  return {
    id: playerId,
    game_id: gameId,
    player_id: playerId,
    vendor,
    prop_type: prop,
    line_value: line,
    market: { type: 'over_under', over_odds: over, under_odds: under },
    updated_at: '2026-11-23T21:50:00.000Z',
  };
}

function page(rows: BdlPlayerPropRow[]): ProviderPage {
  return { httpStatus: 200, payload: { data: rows, meta: { next_cursor: null } } };
}

function publishGame(store: InMemoryPrototypeStore, gameId: number, pullRunId: number, rows: BdlPlayerPropRow[], observedAt = OBSERVED): Promise<Awaited<ReturnType<typeof publishCurrentSnapshot>>> {
  const request: PublishRequest = {
    store,
    gameId: String(gameId),
    bdlGameId: gameId,
    gameDate: GAME_DATE,
    gameStartTime: TIP,
    pullRunId,
    pages: [page(rows)],
    observedAt,
    controllerEnqueuedAt: new Date(Date.parse(ENQUEUED) + pullRunId * 1000).toISOString(),
  };
  return publishCurrentSnapshot(request);
}

describe('F39C current board adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CURRENT_PROPS_SOURCE;
  });

  afterEach(() => {
    delete process.env.CURRENT_PROPS_SOURCE;
  });

  it('reads a complete current snapshot and rejects a bad manifest, a stale pointer, and an expired pointer', async () => {
    const store = new InMemoryPrototypeStore();
    const published = await publishGame(store, 501, 2, [row(501, 10, '22.5', -115, -105)]);
    const board = await readCurrentBoard({ store, gameId: '501', now: NOW.toISOString() });
    expect(board.available).toBe(true);
    if (!board.available) return;
    expect(board.snapshotClass).toBe('current_stored_snapshot');
    expect(board.rows.map((item) => [item.playerId, item.side, item.oddsAmerican])).toEqual([
      ['10', 'over', -115],
      ['10', 'under', -105],
    ]);

    const manifest = await store.get(published.manifestKey!);
    manifest!.body = Buffer.from(manifest!.body.toString('utf8').replace(board.snapshot.manifestChecksum, '0'.repeat(64)));
    expect(await readCurrentBoard({ store, gameId: '501', now: NOW.toISOString() })).toMatchObject({ available: false, reason: 'unavailable' });

    const fresh = new InMemoryPrototypeStore();
    await publishGame(fresh, 501, 3, [row(501, 10, '22.5', -115, -105)]);
    const stale = await readCurrentBoard({ store: fresh, gameId: '501', now: new Date(Date.parse(OBSERVED) + 30 * 60 * 1000 + 1).toISOString() });
    const expired = await readCurrentBoard({ store: fresh, gameId: '501', now: TIP });
    expect(stale).toMatchObject({ available: false, reason: 'stale' });
    expect(expired).toMatchObject({ available: false, reason: 'expired' });
    expect(await readCurrentBoard({ store: fresh, gameId: 'raw/historical/object', now: NOW.toISOString() })).toMatchObject({ reason: 'unavailable' });
  });

  it('serves the current explorer contract from the board and drops a removed line', async () => {
    process.env.CURRENT_PROPS_SOURCE = 's3';
    const store = new InMemoryPrototypeStore();
    await publishGame(store, 501, 2, [row(501, 10, '22.5', -115, -105), row(501, 11, '18.5', -110, -110)]);
    await publishGame(store, 501, 4, [row(501, 11, '18.5', -110, -110)], '2026-11-23T22:04:00.000Z');
    mockQueryOne.mockResolvedValue({ start_time: TIP, away_abbr: 'BOS', home_abbr: 'NYK' });
    mockQuery.mockImplementation(async (sql: string) => {
      if (/player_props_current|player_prop_snapshots|player_prop_game_runs/i.test(sql)) throw new Error('postgres props read');
      if (sql.includes('analytics.players')) return [{ player_id: '11', full_name: 'Player Eleven' }];
      return [];
    });

    const result = await getPlayerPropsForExplorer({
      dateEt: GAME_DATE,
      todayEt: GAME_DATE,
      gameId: '501',
      now: NOW,
      limit: 100,
      offset: 0,
      store,
    });

    expect(result.sourceTable).toBe('s3.player_prop_current');
    expect(result.marketContext).toBe('live');
    expect(result.lineLabel).toBe('Latest observed line');
    expect(result.rows.map((item) => [item.playerId, item.playerName, item.side, item.oddsAmerican, item.oddsDecimal])).toEqual([
      [11, 'Player Eleven', 'over', -110, expect.any(Number)],
      [11, 'Player Eleven', 'under', -110, expect.any(Number)],
    ]);
    expect(result.rows.some((item) => item.playerId === 10)).toBe(false);
  });

  it('compares one book with the whole snapshot and keeps the hidden opposite side for no-vig', async () => {
    process.env.CURRENT_PROPS_SOURCE = 's3';
    const store = new InMemoryPrototypeStore();
    await publishGame(store, 501, 2, [row(501, 12, '10.5', -110, -110)]);
    const milestone: BdlPlayerPropRow = {
      id: 10,
      game_id: 501,
      player_id: 10,
      vendor: 'DraftKings',
      prop_type: 'points',
      line_value: '25',
      market: { type: 'milestone', odds: -150 },
      updated_at: '2026-11-23T21:50:00.000Z',
    };
    await publishGame(store, 501, 4, [
      row(501, 10, '22.5', -120, -110, 'DraftKings'),
      row(501, 10, '22.5', -110, -120, 'FanDuel'),
      row(501, 10, '22.5', -105, -130, 'BetMGM'),
      row(501, 11, '22.5', -101, -101, 'BetMGM'),
      row(501, 10, '30.5', -101, -101, 'BetMGM', 'rebounds'),
      milestone,
    ], '2026-11-23T22:04:00.000Z');
    const verified = await readCurrentBoard({ store, gameId: '501', now: NOW.toISOString() });
    if (!verified.available) throw new Error('board unavailable');
    const quote = (playerId: string, book: string, side: string, prop = 'points', line = 22.5) =>
      verified.rows.find((item) => item.playerId === playerId && item.sportsbook === book && item.side === side && item.propType === prop && item.line === line);
    mockQueryOne.mockResolvedValue({ start_time: TIP, away_abbr: 'BOS', home_abbr: 'NYK' });
    mockQuery.mockImplementation(async (sql: string) => {
      if (/player_props_current|player_prop_snapshots|player_prop_game_runs/i.test(sql)) throw new Error('postgres props read');
      return [];
    });
    const load = (partial: Parameters<typeof getPlayerPropsForExplorer>[0]) => getPlayerPropsForExplorer({
      dateEt: GAME_DATE,
      todayEt: GAME_DATE,
      gameId: '501',
      now: NOW,
      limit: 100,
      offset: 0,
      store,
      ...partial,
    });

    const oneBook = await load({ sportsbook: 'DraftKings', side: 'over', limit: 100, offset: 0, dateEt: GAME_DATE });
    const dkPoints = oneBook.rows.find((item) => item.playerId === 10 && item.propType === 'points' && item.lineValue === 22.5);
    expect(oneBook.priceScope).toBe('market');
    expect(oneBook.rows.every((item) => item.sportsbook === 'draftkings' && item.side === 'over')).toBe(true);
    expect(oneBook.rows.some((item) => item.playerId === 12)).toBe(false);
    expect(dkPoints?.bestPrice).toMatchObject({ sportsbook: 'betmgm', oddsAmerican: -105, bookCount: 3, isBest: false, marketWide: true });
    expect(dkPoints?.fairProbability).toBe(noVigProbability(quote('10', 'draftkings', 'over')?.impliedProbability, quote('10', 'draftkings', 'under')?.impliedProbability));

    const underOnly = await load({ sportsbook: 'DraftKings', side: 'under', limit: 100, offset: 0, dateEt: GAME_DATE });
    const dkUnder = underOnly.rows.find((item) => item.playerId === 10 && item.propType === 'points' && item.lineValue === 22.5);
    expect(underOnly.rows.every((item) => item.side === 'under')).toBe(true);
    expect(dkUnder?.fairProbability).toBe(noVigProbability(quote('10', 'draftkings', 'under')?.impliedProbability, quote('10', 'draftkings', 'over')?.impliedProbability));

    const severalBooks = await load({ sportsbook: 'DraftKings,FanDuel', side: 'over', limit: 100, offset: 0, dateEt: GAME_DATE });
    const scoped = severalBooks.rows.find((item) => item.playerId === 10 && item.propType === 'points' && item.lineValue === 22.5 && item.sportsbook === 'draftkings');
    expect(severalBooks.priceScope).toBe('selected_books');
    expect(scoped?.bestPrice).toMatchObject({ sportsbook: 'fanduel', oddsAmerican: -110, bookCount: 2, marketWide: false });

    const openMarket = await load({ side: 'over', limit: 100, offset: 0, dateEt: GAME_DATE });
    const openPoints = openMarket.rows.find((item) => item.playerId === 10 && item.propType === 'points' && item.lineValue === 22.5 && item.sportsbook === 'draftkings');
    expect(openMarket.priceScope).toBe('selected_books');
    expect(openPoints?.bestPrice).toMatchObject({ sportsbook: 'betmgm', oddsAmerican: -105, bookCount: 3, marketWide: false });
    const withMilestone = await load({ side: 'all', marketType: 'all', limit: 100, offset: 0, dateEt: GAME_DATE });
    expect(withMilestone.rows.find((item) => item.marketType === 'milestone')?.fairProbability).toBeNull();
    expect(withMilestone.rows.some((item) => item.playerId === 12)).toBe(false);
  });

  it('keeps a historical date on the research source while S3 mode is selected', async () => {
    process.env.CURRENT_PROPS_SOURCE = 's3';
    mockQueryOne.mockResolvedValueOnce({ decision_games: '1', current_only_games: '0' });
    mockQuery.mockResolvedValueOnce([{ count: '1' }]).mockResolvedValueOnce([{
      game_id: '401',
      player_id: '10',
      player_name: 'Historical Player',
      sportsbook: 'DraftKings',
      prop_type: 'points',
      market_type: 'over_under',
      side: 'over',
      line_value: 20,
      odds_american: -110,
      odds_decimal: 1.91,
      implied_probability: 0.52,
      snapshot_at: '2026-05-01T23:00:00.000Z',
      game_start_time: '2026-05-01T23:30:00.000Z',
      nba_player_id: '10',
      away_team_abbr: 'BOS',
      home_team_abbr: 'NYK',
    }]);

    const result = await getPlayerPropsForExplorer({
      dateEt: '2026-05-01',
      todayEt: GAME_DATE,
      now: NOW,
      limit: 100,
      offset: 0,
    });

    expect(result.marketContext).toBe('historical');
    expect(result.sourceTable).toBe('research.prop_decision_lines');
    expect(String(mockQuery.mock.calls[0]?.[0])).toMatch(/research\.prop_decision_lines/);
  });

  it('builds across two games, keeps one book, and leaves a missing game out', async () => {
    const store = new InMemoryPrototypeStore();
    await publishGame(store, 601, 2, [row(601, 10, '22.5', -250, -250), row(601, 10, '22.5', -250, -250, 'FanDuel')]);
    await publishGame(store, 602, 3, [row(602, 11, '8.5', -250, -250, 'DraftKings', 'rebounds')]);
    const games = [
      { gameId: '601', startTime: TIP, status: 'Scheduled' },
      { gameId: '602', startTime: TIP, status: 'Scheduled' },
      { gameId: '603', startTime: TIP, status: 'Scheduled' },
    ];
    const result = await loadCurrentQuickBuilds({ sportsbook: 'draftkings', preset: 'balanced', now: NOW, games, store });
    expect(result.snapshotClass).toBe('current_stored_snapshot');
    expect(result.builds.length).toBeGreaterThan(0);
    const legs = result.builds.flatMap((build) => build.legs);
    expect(new Set(legs.map((leg) => leg.gameId))).toEqual(new Set(['601', '602']));
    expect(legs.every((leg) => leg.sportsbook === 'draftkings')).toBe(true);
    expect(legs.some((leg) => leg.playerId === '10') && legs.some((leg) => leg.playerId === '11')).toBe(true);

    const finals = await loadCurrentQuickBuilds({
      sportsbook: 'draftkings',
      preset: 'balanced',
      now: NOW,
      games: [{ gameId: '601', startTime: TIP, status: 'Final' }],
      store,
    });
    expect(finals.builds).toEqual([]);
    expect(finals.emptyReason).toBe('NO_UPCOMING_GAMES');
  });

  it('returns unavailable without reading PostgreSQL when the board cannot be verified', async () => {
    process.env.CURRENT_PROPS_SOURCE = 's3';
    mockQueryOne.mockResolvedValue({ start_time: TIP, away_abbr: 'BOS', home_abbr: 'NYK' });
    mockQuery.mockImplementation(async (sql: string) => {
      if (/player_props_current|player_prop_snapshots/i.test(sql)) throw new Error('postgres props read');
      return [];
    });
    const result = await getPlayerPropsForExplorer({
      dateEt: GAME_DATE,
      todayEt: GAME_DATE,
      gameId: '501',
      now: NOW,
      limit: 50,
      offset: 0,
      store: { async get() { throw new Error('s3 down'); } },
    });
    expect(result).toMatchObject({ rows: [], sourceTable: 's3.player_prop_current', lineLabel: 'Unavailable' });
    const quotes = await loadS3CurrentLegQuotes({
      legs: [{ gameId: '501', playerId: '10', market: 'points', side: 'over', line: 22.5 }],
      vendors: ['draftkings'],
      bestBookEnabled: true,
      now: NOW,
      store: { async get() { throw new Error('s3 down'); } },
    });
    expect(quotes).toEqual({ quotesPerLeg: [[]], quoteSource: 's3.player_prop_current' });
  });

  it('prices a parlay leg from the current board only', async () => {
    const store = new InMemoryPrototypeStore();
    await publishGame(store, 501, 2, [row(501, 10, '22.5', -115, -105)]);
    const quotes = await loadS3CurrentLegQuotes({
      legs: [{ gameId: '501', playerId: '10', market: 'points', side: 'over', line: 22.5 }],
      vendors: ['draftkings'],
      bestBookEnabled: false,
      now: NOW,
      store,
    });
    expect(quotes.quoteSource).toBe('s3.player_prop_current');
    expect(quotes.quotesPerLeg[0]).toEqual([
      expect.objectContaining({ vendor: 'draftkings', priceAmerican: -115, oppositeAmerican: -105 }),
    ]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('leaves the PostgreSQL reader in place when the flag is unset and records no market writes', async () => {
    expect(currentPropsSource()).toBe('postgres');
    expect(currentPropsSource({ CURRENT_PROPS_SOURCE: 's3' })).toBe('s3');
    mockQueryOne.mockResolvedValue({ start_time: TIP, away_abbr: 'BOS', home_abbr: 'NYK' });
    mockQuery.mockImplementation(async (sql: string) => (String(sql).includes('count(*)') ? [{ count: '0' }] : []));
    const result = await getPlayerPropsForExplorer({
      dateEt: GAME_DATE,
      todayEt: GAME_DATE,
      gameId: '501',
      now: NOW,
      limit: 25,
      offset: 0,
    });
    expect(result.sourceTable).toBe('analytics.player_props_current');
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes('analytics.player_props_current'))).toBe(true);

    const roots = [
      'lib/props/s3-current-board',
      'lib/betting/props-explorer-current-board.ts',
      'lib/quick-builds/current-board.ts',
      'lib/parlay/s3-current-quotes.ts',
    ].map((item) => path.join(process.cwd(), item));
    const files = roots.flatMap((item) => {
      if (!fs.existsSync(item)) return [];
      if (fs.statSync(item).isFile()) return [item];
      return fs.readdirSync(item).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts')).map((name) => path.join(item, name));
    });
    const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(source).not.toMatch(/player_props_current|player_prop_snapshots_v2/);
    expect(highVolumePropsMarketWrites).toEqual({ inserts: 0, updates: 0 });
  });
});
