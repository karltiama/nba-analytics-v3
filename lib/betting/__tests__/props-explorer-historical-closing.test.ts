import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('@/lib/betting/player-prop-inputs', () => ({
  getPlayerPropModelInputs: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import { InMemoryPrototypeStore } from '@/lambda/player-props-snapshot/src/f39b/store';
import { publishCurrentSnapshot } from '@/lambda/player-props-snapshot/src/f39b/publish';
import { checksumCanonical, buildPlayerPropSnapshotArchiveKey } from '@/lambda/player-props-snapshot/src/player-prop-snapshot-archive';
import { closingSnapshotKey } from '@/lambda/player-props-snapshot/src/s3-closing-snapshot';
import type { ClosingSnapshot } from '@/lambda/player-props-snapshot/src/s3-closing-snapshot';
import { historicalPropsSource } from '@/lib/props/s3-closing/source';
import { getPlayerPropsForExplorer } from '@/lib/betting/props-explorer-serving';
import { loadHistoricalClosingForGame } from '@/lib/betting/props-explorer-historical-closing';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockQueryOne = queryOne as ReturnType<typeof vi.fn>;
const GAME_ID = '101';
const STARTED = '2026-11-23T17:00:00.000Z';
const START = '2026-11-23T23:00:00.000Z';

function provider(playerId: number, vendor: string, prop: string, line: string) {
  return {
    id: playerId,
    game_id: 101,
    player_id: playerId,
    vendor,
    prop_type: prop,
    line_value: line,
    market: { type: 'over_under', over_odds: -110, under_odds: -110 },
    updated_at: STARTED,
  };
}

function finalGame(gameId = GAME_ID, status = 'Final') {
  return {
    game_id: gameId,
    status,
    game_date: '2026-11-23',
    start_time: START,
    away_abbr: 'BOS',
    home_abbr: 'NYK',
  };
}

async function publishBoard(store: InMemoryPrototypeStore, pullRunId: number, rows: ReturnType<typeof provider>[]) {
  const result = await publishCurrentSnapshot({
    store,
    gameId: GAME_ID,
    bdlGameId: 101,
    gameDate: '2026-11-23',
    gameStartTime: START,
    pullRunId,
    pages: [{ httpStatus: 200, payload: { data: rows, meta: { next_cursor: null } } }],
    observedAt: '2026-11-23T18:00:00.000Z',
    controllerEnqueuedAt: STARTED,
  });
  return result.archiveKey as string;
}

function archivedPull(pullRunId: number, archiveKey: string) {
  return {
    pull_run_id: pullRunId,
    pull_status: 'success',
    game_status: 'success',
    archive_status: 'archived',
    archive_key: archiveKey,
    started_at: STARTED,
    rows_fetched: 1,
    rows_stored: 0,
    provider_attempts: 1,
  };
}

function install(options: {
  decisionN?: string;
  game?: ReturnType<typeof finalGame> | null;
  pulls?: unknown[];
  dateGames?: unknown[];
  counts?: unknown[];
  decisionRows?: unknown[];
}) {
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    const text = String(sql);
    if (/\b(insert|update|delete)\b/i.test(text)) throw new Error('write');
    if (text.includes('player_props_current') || text.includes('player_prop_snapshots_v2')) {
      throw new Error('replacement historical source');
    }
    if (text.includes('player_prop_pull_runs')) return options.pulls ?? [];
    if (text.includes('ANY($1')) {
      if (text.includes('GROUP BY')) return options.counts ?? [];
      return options.decisionRows ?? [];
    }
    if (text.includes('count(*)')) return [{ n: options.decisionN ?? '0' }];
    if (text.includes('g.game_id::text = $1')) {
      const gameId = String(params?.[0] ?? GAME_ID);
      if (options.game && gameId === String(options.game.game_id)) return [options.game];
      if (options.dateGames) {
        const match = options.dateGames.find((game) => String((game as { game_id: string }).game_id) === gameId);
        return match ? [match] : [];
      }
      return options.game ? [options.game] : [];
    }
    if (text.includes('AT TIME ZONE')) return options.dateGames ?? [];
    throw new Error(`unmocked sql: ${text}`);
  });
}

describe('historical closing loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.HISTORICAL_PROPS_SOURCE;
  });

  it('keeps the feature off unless s3_closing is set', () => {
    expect(historicalPropsSource({})).toBe('postgres');
    expect(historicalPropsSource({ HISTORICAL_PROPS_SOURCE: 's3' })).toBe('postgres');
    expect(historicalPropsSource({ HISTORICAL_PROPS_SOURCE: 's3_closing' })).toBe('s3_closing');
  });

  it('returns DecisionCloseRow values from a complete artifact', async () => {
    const store = new InMemoryPrototypeStore();
    const archiveKey = await publishBoard(store, 1, [
      provider(77, 'draftkings', 'points', '12.5'),
      provider(77, 'fanduel', 'points', '10.5'),
    ]);
    const { publishClosingSnapshot } = await import('@/lambda/player-props-snapshot/src/s3-closing-snapshot');
    await publishClosingSnapshot({
      store,
      game: { gameId: GAME_ID, gameDate: '2026-11-23', status: 'Final', startTime: START },
      pulls: [{
        pullRunId: 1,
        queriedGame: true,
        gameRun: {
          status: 'success',
          archiveStatus: 'archived',
          archiveKey,
          startedAt: STARTED,
          rowsFetched: 1,
          rowsStored: 0,
          providerAttempts: 1,
        },
      }],
    });
    install({ game: finalGame(), pulls: [archivedPull(1, archiveKey)] });
    const loaded = await loadHistoricalClosingForGame({ gameId: GAME_ID, store });
    expect(loaded.status).toBe('s3');
    if (loaded.status !== 's3') return;
    expect(loaded.rows.find((row) => row.sportsbook === 'draftkings' && row.side === 'over')).toMatchObject({
      gameId: GAME_ID,
      playerId: '77',
      propType: 'points',
      lineValue: 12.5,
      decisionClock: 'RESPONSE_RECEIVED',
    });
  });

  it('treats a missing artifact as unavailable rather than no markets', async () => {
    const store = new InMemoryPrototypeStore();
    const archiveKey = await publishBoard(store, 1, [provider(77, 'draftkings', 'points', '12.5')]);
    install({ game: finalGame(), pulls: [archivedPull(1, archiveKey)] });
    const loaded = await loadHistoricalClosingForGame({ gameId: GAME_ID, store });
    expect(loaded).toEqual({ status: 'unavailable', reason: 'missing' });
  });

  it('rejects an artifact whose checksum does not match', async () => {
    const store = new InMemoryPrototypeStore();
    const archiveKey = await publishBoard(store, 1, [provider(77, 'draftkings', 'points', '12.5')]);
    const { publishClosingSnapshot } = await import('@/lambda/player-props-snapshot/src/s3-closing-snapshot');
    const published = await publishClosingSnapshot({
      store,
      game: { gameId: GAME_ID, gameDate: '2026-11-23', status: 'Final', startTime: START },
      pulls: [{
        pullRunId: 1,
        queriedGame: true,
        gameRun: {
          status: 'success',
          archiveStatus: 'archived',
          archiveKey,
          startedAt: STARTED,
          rowsFetched: 1,
          rowsStored: 0,
          providerAttempts: 1,
        },
      }],
    });
    const current = await store.get(published.key);
    const artifact = JSON.parse(current!.body.toString('utf8')) as ClosingSnapshot;
    artifact.lines[0] = { ...artifact.lines[0], lineValue: 99 };
    await store.put(published.key, Buffer.from(`${JSON.stringify(artifact)}\n`), current!.metadata, {
      kind: 'if-match',
      etag: current!.etag,
    });
    install({ game: finalGame(), pulls: [archivedPull(1, archiveKey)] });
    const loaded = await loadHistoricalClosingForGame({ gameId: GAME_ID, store });
    expect(loaded).toEqual({ status: 'unavailable', reason: 'invalid_checksum' });
  });

  it('fails closed when an archive is missing or the pull inventory is unverifiable', async () => {
    const missingStore = new InMemoryPrototypeStore();
    const missingKey = buildPlayerPropSnapshotArchiveKey({
      rawPrefix: 'raw',
      season: 2026,
      gameDate: '2026-11-23',
      gameId: GAME_ID,
      pullRunId: 1,
      snapshotAt: STARTED,
    });
    install({ game: finalGame(), pulls: [archivedPull(1, missingKey)] });
    await expect(loadHistoricalClosingForGame({ gameId: GAME_ID, store: missingStore })).resolves.toEqual({
      status: 'unavailable',
      reason: 'missing_archive',
    });

    const unverifiable = new InMemoryPrototypeStore();
    install({
      game: finalGame(),
      pulls: [{
        pull_run_id: 8,
        pull_status: 'started',
        game_status: null,
        archive_status: null,
        archive_key: null,
        started_at: null,
        rows_fetched: null,
        rows_stored: null,
        provider_attempts: null,
      }],
    });
    await expect(loadHistoricalClosingForGame({ gameId: GAME_ID, store: unverifiable })).resolves.toEqual({
      status: 'unavailable',
      reason: 'unverifiable',
    });
  });

  it('does not read S3 for a postponed game or for a game that already has decision rows', async () => {
    const store = new InMemoryPrototypeStore();
    let gets = 0;
    const watched = {
      get: async (key: string) => {
        gets += 1;
        return store.get(key);
      },
      put: store.put.bind(store),
      putIfAbsent: store.putIfAbsent.bind(store),
    };
    install({ game: finalGame(GAME_ID, 'Postponed') });
    await expect(loadHistoricalClosingForGame({ gameId: GAME_ID, store: watched })).resolves.toEqual({
      status: 'unavailable',
      reason: 'not_final',
    });
    install({ decisionN: '4', game: finalGame() });
    await expect(loadHistoricalClosingForGame({ gameId: GAME_ID, store: watched })).resolves.toEqual({ status: 'postgres' });
    expect(gets).toBe(0);
  });

  it('rejects duplicate closing identities', async () => {
    const store = new InMemoryPrototypeStore();
    const archiveKey = await publishBoard(store, 1, [provider(77, 'draftkings', 'points', '12.5')]);
    const { publishClosingSnapshot } = await import('@/lambda/player-props-snapshot/src/s3-closing-snapshot');
    const published = await publishClosingSnapshot({
      store,
      game: { gameId: GAME_ID, gameDate: '2026-11-23', status: 'Final', startTime: START },
      pulls: [{
        pullRunId: 1,
        queriedGame: true,
        gameRun: {
          status: 'success',
          archiveStatus: 'archived',
          archiveKey,
          startedAt: STARTED,
          rowsFetched: 1,
          rowsStored: 0,
          providerAttempts: 1,
        },
      }],
    });
    const current = await store.get(published.key);
    const artifact = JSON.parse(current!.body.toString('utf8')) as ClosingSnapshot;
    artifact.lines.push({ ...artifact.lines[0] });
    artifact.marketCount = artifact.lines.length;
    const { contentChecksum, ...body } = artifact;
    void contentChecksum;
    artifact.contentChecksum = checksumCanonical(body);
    await store.put(published.key, Buffer.from(`${JSON.stringify(artifact)}\n`), current!.metadata, {
      kind: 'if-match',
      etag: current!.etag,
    });
    install({ game: finalGame(), pulls: [archivedPull(1, archiveKey)] });
    await expect(loadHistoricalClosingForGame({ gameId: GAME_ID, store })).resolves.toEqual({
      status: 'unavailable',
      reason: 'duplicate',
    });
  });

  it('filters and sorts S3 rows without replacing a PostgreSQL game', async () => {
    process.env.HISTORICAL_PROPS_SOURCE = 's3_closing';
    const store = new InMemoryPrototypeStore();
    const archiveKey = await publishBoard(store, 1, [
      provider(77, 'draftkings', 'points', '12.5'),
      provider(88, 'fanduel', 'rebounds', '4.5'),
    ]);
    const { publishClosingSnapshot } = await import('@/lambda/player-props-snapshot/src/s3-closing-snapshot');
    const published = await publishClosingSnapshot({
      store,
      game: { gameId: GAME_ID, gameDate: '2026-11-23', status: 'Final', startTime: START },
      pulls: [{
        pullRunId: 1,
        queriedGame: true,
        gameRun: {
          status: 'success',
          archiveStatus: 'archived',
          archiveKey,
          startedAt: STARTED,
          rowsFetched: 1,
          rowsStored: 0,
          providerAttempts: 1,
        },
      }],
    });
    const current = await store.get(published.key);
    const artifact = JSON.parse(current!.body.toString('utf8')) as ClosingSnapshot;
    for (const line of artifact.lines) {
      line.playerName = line.playerId === '77' ? 'Luka Doncic' : 'Other Player';
      if (line.playerId === '77' && line.side === 'over') line.oddsAmerican = -150;
      if (line.playerId === '88' && line.side === 'over') line.oddsAmerican = -110;
    }
    const { contentChecksum, ...body } = artifact;
    void contentChecksum;
    artifact.contentChecksum = checksumCanonical(body);
    await store.put(published.key, Buffer.from(`${JSON.stringify(artifact)}\n`), current!.metadata, {
      kind: 'if-match',
      etag: current!.etag,
    });
    install({ game: finalGame(), pulls: [archivedPull(1, archiveKey)] });
    mockQueryOne.mockResolvedValueOnce({
      start_time: START,
      away_abbr: 'BOS',
      home_abbr: 'NYK',
    });
    const result = await getPlayerPropsForExplorer({
      dateEt: '2026-11-24',
      todayEt: '2026-11-24',
      gameId: GAME_ID,
      playerName: 'Luka',
      propType: 'points',
      side: 'over',
      sort: 'odds_american',
      dirAsc: true,
      limit: 100,
      offset: 0,
      closingStore: store,
    });
    expect(result.rows.map((row) => row.playerId)).toEqual([77]);
    expect(result.rows[0]).toMatchObject({
      playerName: 'Luka Doncic',
      propType: 'points',
      side: 'over',
      lineValue: 12.5,
      sourceTable: 's3.player_prop_closing',
      awayTeamAbbr: 'BOS',
    });
    expect(result.unavailableGames).toEqual([]);
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes('player_props_current'))).toBe(false);
    mockQueryOne.mockResolvedValueOnce({
      start_time: START,
      away_abbr: 'BOS',
      home_abbr: 'NYK',
    });
    const sorted = await getPlayerPropsForExplorer({
      dateEt: '2026-11-24',
      todayEt: '2026-11-24',
      gameId: GAME_ID,
      side: 'over',
      sort: 'odds_american',
      dirAsc: true,
      limit: 100,
      offset: 0,
      closingStore: store,
    });
    expect(sorted.rows.map((row) => [row.playerId, row.oddsAmerican])).toEqual([[77, -150], [88, -110]]);
  });

  it('keeps PostgreSQL rows and reports an unavailable game on the same date', async () => {
    process.env.HISTORICAL_PROPS_SOURCE = 's3_closing';
    const store = new InMemoryPrototypeStore();
    install({
      dateGames: [finalGame('101'), finalGame('202')],
      counts: [{ game_id: '101', n: '1' }],
      decisionRows: [{
        game_id: '101',
        player_id: '77',
        player_name: 'Luka Doncic',
        team_id: 1,
        sportsbook: 'draftkings',
        prop_type: 'points',
        market_type: 'over_under',
        side: 'over',
        line_value: 28.5,
        odds_american: -110,
        odds_decimal: 1.91,
        implied_probability: 0.52,
        decision_at: '2026-11-23T18:00:00.000Z',
        game_start_time: START,
        decision_clock: 'RESPONSE_RECEIVED',
      }],
      pulls: [{
        pull_run_id: 9,
        pull_status: 'started',
        game_status: null,
        archive_status: null,
        archive_key: null,
        started_at: null,
        rows_fetched: null,
        rows_stored: null,
        provider_attempts: null,
      }],
    });
    const result = await getPlayerPropsForExplorer({
      dateEt: '2026-11-23',
      todayEt: '2026-11-24',
      limit: 100,
      offset: 0,
      closingStore: store,
    });
    expect(result.rows.map((row) => [row.gameId, row.sourceTable])).toEqual([['101', 'research.prop_decision_lines']]);
    expect(result.unavailableGames).toEqual([{ gameId: '202', reason: 'unverifiable' }]);
    expect(result.lineLabel).toBe('Historical closing line');
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes('player_props_current'))).toBe(false);
  });

  it('keeps the existing PostgreSQL query when decision rows already exist', async () => {
    process.env.HISTORICAL_PROPS_SOURCE = 's3_closing';
    mockQueryOne
      .mockResolvedValueOnce({ start_time: '2026-05-01T23:30:00.000Z', away_abbr: 'DAL', home_abbr: 'LAL' })
      .mockResolvedValueOnce({ decision_n: '4', current_n: '9' });
    mockQuery
      .mockResolvedValueOnce([{ n: '4' }])
      .mockResolvedValueOnce([{ count: '1' }])
      .mockResolvedValueOnce([{
        game_id: '401585000',
        player_id: '1629027',
        player_name: 'Luka Doncic',
        sportsbook: 'DraftKings',
        prop_type: 'points',
        market_type: 'over_under',
        side: 'over',
        line_value: 28.5,
        odds_american: -110,
        odds_decimal: 1.91,
        implied_probability: 0.524,
        snapshot_at: '2026-05-01T23:00:00.000Z',
        game_start_time: '2026-05-01T23:30:00.000Z',
        nba_player_id: '1629027',
        away_team_abbr: 'DAL',
        home_team_abbr: 'LAL',
      }]);
    const store = new InMemoryPrototypeStore();
    const result = await getPlayerPropsForExplorer({
      dateEt: '2026-09-06',
      todayEt: '2026-09-06',
      gameId: '401585000',
      limit: 100,
      offset: 0,
      closingStore: store,
    });
    expect(result.sourceTable).toBe('research.prop_decision_lines');
    expect(result.rows[0]?.playerId).toBe(1629027);
    expect(result.unavailableGames).toBeUndefined();
    expect(store.gets).toBe(0);
    expect(String(mockQuery.mock.calls[1]?.[0])).toMatch(/research\.prop_decision_lines/);
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes('player_props_current'))).toBe(false);
  });

  it('does not call S3 when the historical flag is off', async () => {
    mockQueryOne.mockResolvedValueOnce({ decision_games: '1', current_only_games: '0' });
    mockQuery.mockResolvedValueOnce([{ count: '1' }]).mockResolvedValueOnce([{
      game_id: '401585000',
      player_id: '1629027',
      player_name: 'Luka Doncic',
      sportsbook: 'DraftKings',
      prop_type: 'points',
      market_type: 'over_under',
      side: 'over',
      line_value: 28.5,
      odds_american: -110,
      odds_decimal: 1.91,
      implied_probability: 0.524,
      snapshot_at: '2026-05-01T23:00:00.000Z',
      game_start_time: '2026-05-01T23:30:00.000Z',
      nba_player_id: '1629027',
      away_team_abbr: 'DAL',
      home_team_abbr: 'LAL',
    }]);
    const store = new InMemoryPrototypeStore();
    const result = await getPlayerPropsForExplorer({
      dateEt: '2026-05-01',
      todayEt: '2026-09-06',
      limit: 100,
      offset: 0,
      closingStore: store,
    });
    expect(result.sourceTable).toBe('research.prop_decision_lines');
    expect(result.rows).toHaveLength(1);
    expect(result.unavailableGames).toBeUndefined();
    expect(store.gets).toBe(0);
  });

  it('does not insert, update, or delete', () => {
    const source = readFileSync(new URL('../props-explorer-historical-closing.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\b(insert|update|delete)\b/i);
    expect(source).not.toMatch(/player_props_current|player_prop_snapshots_v2|CURRENT_PROPS_SOURCE|PROPS_PUBLICATION_MODE/);
    expect(source).toMatch(/decisionRowsFromClosingArtifact/);
    expect(source).toMatch(/assessClosingCoverage/);
  });
});
