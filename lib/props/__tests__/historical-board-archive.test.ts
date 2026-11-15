import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { consensusMainLine, resolveLast5Line, type BookLineQuote } from '@/lib/content/video/last5/snapshot';
import { mergeLast5Players, playersFromArchiveRows, selectLast5Players } from '@/lib/content/video/last5/historical-board';
import type { TonightPropPlayer } from '@/lib/content/video/last5/queries';
import { savedOfferTrueCostInput } from '@/lib/parlay/true-cost-presentation';
import { adaptPropsExplorerOffer } from '@/lib/parlay/adapt-props-explorer-offer';
import {
  CURRENT_BOARD_BACKUP_ID,
  CURRENT_BOARD_BACKUP_SHA256,
  CURRENT_BOARD_MANIFEST_SHA256,
  FROZEN_BOARD_DELETE_ROWS,
} from '@/lib/props/current-board-reclamation';
import {
  decodePartition,
  encodePartition,
  fillEmptyLegQuotes,
  historicalBoardObjectKey,
  quotesFromHistoricalBoard,
  readHistoricalBoardPartition,
  sha256,
  type HistoricalBoardArchiveManifest,
  type HistoricalBoardRow,
} from '@/lib/props/historical-board-archive';
import { s3HistoricalBoardStore } from '@/lib/props/historical-board-s3';

const DATE = '2026-11-12';

function row(overrides: Partial<HistoricalBoardRow> = {}): HistoricalBoardRow {
  return {
    gameId: 21718012,
    playerId: 203999,
    playerName: 'Nikola Jokic',
    teamId: 8,
    sportsbook: 'DraftKings',
    propType: 'rebounds',
    marketType: 'over_under',
    side: 'over',
    lineText: '24.50',
    oddsAmerican: -110,
    oddsDecimalText: '1.909',
    impliedText: '0.524',
    snapshotAt: '2026-11-12T23:00:00.000000Z',
    snapshotMicros: '1762988400000000',
    observedAt: '2026-11-12T22:59:00.000000Z',
    observationClock: 'RESPONSE_RECEIVED',
    controllerEnqueuedAt: null,
    providerUpdatedAt: null,
    ...overrides,
  };
}

function player(overrides: Partial<TonightPropPlayer> = {}): TonightPropPlayer {
  return {
    playerId: '1',
    playerName: 'A',
    gameId: '100',
    teamAbbr: 'DEN',
    opponentAbbr: 'OKC',
    isHome: true,
    startTime: '2026-11-12T00:00:00Z',
    quotes: [{ sportsbook: 'DraftKings', side: 'over', line: 24.5, impliedProbability: 0.524 }],
    linesAsOf: '2026-11-12T23:00:00.000000Z',
    ...overrides,
  };
}

function partitionManifest(bytes: Buffer, rows: number): HistoricalBoardArchiveManifest {
  return {
    version: 'historical-board-archive.v1',
    serialization: 'json-gzip.v1',
    columns: [],
    sourceBackupId: CURRENT_BOARD_BACKUP_ID,
    sourceBackupSha256: CURRENT_BOARD_BACKUP_SHA256,
    sourceManifestSha256: CURRENT_BOARD_MANIFEST_SHA256,
    rowCount: rows,
    games: [{ gameId: 21718012, dateEt: DATE, rows }],
    partitions: [{
      id: DATE,
      fileName: `date=${DATE}.json.gz`,
      objectKey: historicalBoardObjectKey(DATE),
      rows,
      byteLength: bytes.length,
      sha256: sha256(bytes),
    }],
  };
}

describe('historical board archive', () => {
  it('round-trips line text, odds, and timestamps without a numeric rewrite', () => {
    const original = row();
    const first = encodePartition(DATE, [original]);
    const second = encodePartition(DATE, [original]);
    expect(sha256(first)).toBe(sha256(second));
    const decoded = decodePartition(first).rows[0];
    expect(decoded?.lineText).toBe('24.50');
    expect(decoded?.oddsAmerican).toBe(-110);
    expect(decoded?.oddsDecimalText).toBe('1.909');
    expect(decoded?.impliedText).toBe('0.524');
    expect(decoded?.snapshotAt).toBe(original.snapshotAt);
    expect(decoded?.snapshotMicros).toBe(original.snapshotMicros);
  });

  it('rejects a missing object, a bad checksum, and a short partition', async () => {
    const bytes = encodePartition(DATE, [row(), row({ sportsbook: 'FanDuel', oddsAmerican: -105, impliedText: '0.512' })]);
    const manifest = partitionManifest(bytes, 2);
    await expect(readHistoricalBoardPartition({ getObject: async () => null }, manifest, DATE)).rejects.toThrow('archive_object_missing');
    const corrupt = Buffer.from(bytes);
    corrupt[corrupt.length - 1] ^= 0xff;
    await expect(readHistoricalBoardPartition({ getObject: async () => corrupt }, manifest, DATE)).rejects.toThrow('archive_checksum_mismatch');
    const short = encodePartition(DATE, [row()]);
    manifest.partitions[0].byteLength = short.length;
    manifest.partitions[0].sha256 = sha256(short);
    await expect(readHistoricalBoardPartition({ getObject: async () => short }, manifest, DATE)).rejects.toThrow('archive_row_count_rejected');
    await expect(readHistoricalBoardPartition({ getObject: async () => bytes }, manifest, '2026-11-11')).rejects.toThrow('archive_partition_missing');
  });

  it('keeps alternate lines and uses the original board consensus', () => {
    const rows = [
      row({ lineText: '24.50', impliedText: '0.524', side: 'over' }),
      row({ lineText: '20.50', impliedText: '0.800', side: 'over' }),
      row({ sportsbook: 'FanDuel', lineText: '24.50', impliedText: '0.510', oddsAmerican: -105, side: 'over' }),
      row({ sportsbook: 'FanDuel', lineText: '20.50', impliedText: '0.790', oddsAmerican: -130, side: 'over' }),
    ];
    const quotes = rows.map((item): BookLineQuote => ({
      sportsbook: item.sportsbook ?? '',
      side: 'over',
      line: Number(item.lineText),
      impliedProbability: Number(item.impliedText),
    }));
    expect(consensusMainLine(quotes)).toEqual({ line: 24.5, bookCount: 2 });
    const players = playersFromArchiveRows(rows, 'rebounds', new Map([
      ['21718012|203999', {
        playerId: '203999',
        playerName: 'Nikola Jokic',
        gameId: '21718012',
        teamAbbr: 'DEN',
        homeAbbr: 'DEN',
        awayAbbr: 'OKC',
        isHome: true,
        startTime: '2026-11-12T00:00:00Z',
        injured: false,
      }],
    ]));
    expect(consensusMainLine(players[0]?.quotes ?? [])).toEqual({ line: 24.5, bookCount: 2 });
    expect(resolveLast5Line({
      date: DATE,
      todayEt: '2026-11-14',
      gamesOnDate: 8,
      boardQuotes: players[0]?.quotes ?? [],
      researchCloses: [{ sportsbook: 'DraftKings', side: 'over', line: 20.5, impliedProbability: 0.8 }],
    })).toEqual({ status: 'ready', line: 24.5, bookCount: 2 });
  });

  it('merges a protected game with an archived game and keeps one copy of a shared game', () => {
    const archived = player({ gameId: '21718012', playerId: '10' });
    const protectedGame = player({ gameId: '21718094', playerId: '11', quotes: [{ sportsbook: 'BetMGM', side: 'over', line: 8.5, impliedProbability: 0.5 }] });
    const merged = mergeLast5Players({
      sqlPlayers: [archived, protectedGame],
      archivePlayers: [archived],
      archivedGameIds: new Set(['21718012']),
    });
    expect(merged.map((item) => item.gameId).sort()).toEqual(['21718012', '21718094']);
    expect(merged.filter((item) => item.gameId === '21718012')).toHaveLength(1);
    expect(() => mergeLast5Players({
      sqlPlayers: [player({ quotes: [{ sportsbook: 'DraftKings', side: 'over', line: 20.5, impliedProbability: 0.8 }] })],
      archivePlayers: [player()],
      archivedGameIds: new Set(['100']),
    })).toThrow('archive_sql_conflict');
  });

  it('does not let an archive replace the current-date board', () => {
    const sql = [player({ gameId: '21718103', quotes: [{ sportsbook: 'DraftKings', side: 'over', line: 18.5, impliedProbability: 0.52 }] })];
    const archive = [player({ gameId: '21718012' })];
    expect(selectLast5Players({
      date: '2026-11-14',
      todayEt: '2026-11-14',
      sqlPlayers: sql,
      archivePlayers: archive,
      archivedGameIds: new Set(['21718012']),
    })).toBe(sql);
  });

  it('reconstructs the opposite side and best book without replacing the saved price', () => {
    const rows = [
      row({ propType: 'points', lineText: '27.5', side: 'over', oddsAmerican: -125, sportsbook: 'DraftKings' }),
      row({ propType: 'points', lineText: '27.5', side: 'under', oddsAmerican: -105, sportsbook: 'DraftKings' }),
      row({ propType: 'points', lineText: '27.5', side: 'over', oddsAmerican: -108, sportsbook: 'FanDuel' }),
      row({ propType: 'points', lineText: '27.5', side: 'under', oddsAmerican: -112, sportsbook: 'FanDuel' }),
      row({ propType: 'points', lineText: '24.5', side: 'over', oddsAmerican: -130, sportsbook: 'DraftKings' }),
    ];
    const leg = { gameId: '21718012', playerId: '203999', market: 'points', side: 'over' as const, line: 27.5 };
    const quotes = quotesFromHistoricalBoard(rows, [leg])[0] ?? [];
    expect(quotes.map((quote) => quote.vendor).sort()).toEqual(['draftkings', 'fanduel']);
    expect(quotes.find((quote) => quote.vendor === 'draftkings')).toMatchObject({
      priceAmerican: -125,
      oppositeAmerican: -105,
    });
    const adapted = adaptPropsExplorerOffer({
      playerId: '203999',
      playerName: 'Nikola Jokic',
      gameId: '21718012',
      propType: 'points',
      side: 'over',
      lineValue: 27.5,
      sportsbook: 'DraftKings',
      oddsAmerican: -110,
      snapshotAt: '2026-11-12T23:00:00.000Z',
      marketContext: 'historical',
      sourceTable: 'research.prop_decision_lines',
    });
    if (!adapted.ok) throw new Error(adapted.code);
    expect(savedOfferTrueCostInput({ offer: adapted.offer, gameLabel: 'DEN vs OKC' }, quotes).priceAmerican).toBe(-110);
    const sqlQuotes = [[{ vendor: 'draftkings', displayName: 'DraftKings', priceAmerican: -115, oppositeAmerican: -105 }]];
    expect(fillEmptyLegQuotes(sqlQuotes, [quotes])[0]?.[0]?.priceAmerican).toBe(-115);
    expect(fillEmptyLegQuotes([[]], [quotes])[0]?.find((quote) => quote.vendor === 'draftkings')?.oppositeAmerican).toBe(-105);
  });

  it('prepares a read-only S3 key and leaves the deletion manifest unchanged', async () => {
    expect(historicalBoardObjectKey(DATE)).toBe(
      'historical-board/version=historical-board-archive.v1/backup_id=cc-pg-logical-20261114T191459Z/date=2026-11-12.json.gz'
    );
    const store = s3HistoricalBoardStore({
      bucket: 'unused',
      getObject: async () => ({ Body: null }),
    });
    await expect(store.getObject('other/key')).rejects.toThrow('archive_key_rejected');
    expect('putObject' in store).toBe(false);
    const raw = readFileSync('lib/props/current-board-reclamation-manifest.json');
    expect(createHash('sha256').update(raw).digest('hex')).toBe(CURRENT_BOARD_MANIFEST_SHA256);
    expect(FROZEN_BOARD_DELETE_ROWS).toBe(142_602);
    const source = readFileSync('lib/props/historical-board-archive.ts', 'utf8');
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|VACUUM)\b/);
  });
});
