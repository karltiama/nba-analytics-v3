/**
 * Preview-only proof that the deployed function read the historical archive.
 * The report has counts and checksums. It has no player quotes and no credentials.
 */
import { createHash } from 'node:crypto';
import { parseLineValue } from '@/lib/betting/prop-market-compare';
import { mergeLast5Players } from '@/lib/content/video/last5/historical-board';
import type { TonightPropPlayer } from '@/lib/content/video/last5/queries';
import { resolveLast5Line } from '@/lib/content/video/last5/snapshot';
import { adaptPropsExplorerOffer } from '@/lib/parlay/adapt-props-explorer-offer';
import { savedOfferTrueCostInput } from '@/lib/parlay/true-cost-presentation';
import { quotesFromHistoricalBoard } from '@/lib/props/historical-board-archive';
import {
  HISTORICAL_BOARD_MANIFEST_SHA256,
  consensusByPlayer,
  historicalBoardObjectKey,
  sha256,
  type HistoricalBoardArchiveManifest,
  type HistoricalBoardObjectStore,
  type HistoricalBoardRow,
} from '@/lib/props/historical-board-archive';
import { HISTORICAL_BOARD_BUCKET, HISTORICAL_BOARD_REGION, historicalBoardSourceFromEnv, shouldReadHistoricalBoard } from '@/lib/props/historical-board-config';
import { legsThatNeedArchive } from '@/lib/parlay/historical-board-quotes';
import {
  clearHistoricalBoardCache,
  loadHistoricalBoardDate,
  loadHistoricalBoardManifest,
} from '@/lib/props/historical-board-read';

const NOVEMBER_12 = '2026-11-12';
const PROTECTED_GAME = '21718094';
const OPEN_GAME = '21718103';
const SAVED_PRICE = -110;
const AWS_NAMES = new Set([
  'AccessDenied',
  'InvalidIdentityToken',
  'ExpiredTokenException',
  'IDPCommunicationErrorException',
  'IDPRejectedClaim',
  'MalformedPolicyDocument',
  'PackedPolicyTooLarge',
  'RegionDisabledException',
  'CredentialsProviderError',
]);

export function historicalBoardCanaryAllowed(env: { VERCEL_ENV?: string }): boolean {
  return env.VERCEL_ENV === 'preview';
}

export function publicFailureCategory(error: unknown): string {
  const name = errorName(error);
  if (AWS_NAMES.has(name)) return name;
  if (error instanceof Error && error.message.startsWith('archive_')) return error.message;
  return 'credential_rejected';
}

function errorName(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const record = error as { name?: unknown; cause?: unknown };
  if (typeof record.name === 'string' && record.name !== 'Error') return record.name;
  return errorName(record.cause);
}

export async function readCanaryArchive(store: HistoricalBoardObjectStore): Promise<{
  reads: Array<{ name: string; sha256: string; bytes: number }>;
  manifest: HistoricalBoardArchiveManifest;
  rows: HistoricalBoardRow[];
}> {
  clearHistoricalBoardCache();
  const reads: Array<{ name: string; sha256: string; bytes: number }> = [];
  const recording: HistoricalBoardObjectStore = {
    async getObject(objectKey: string) {
      const bytes = await store.getObject(objectKey);
      if (bytes) {
        const name = objectKey.split('/').at(-1) ?? 'object';
        reads.push({ name, sha256: sha256(bytes), bytes: bytes.length });
      }
      return bytes;
    },
  };
  const manifest = await loadHistoricalBoardManifest(recording, 'preview-canary');
  const rows = await loadHistoricalBoardDate(recording, manifest, NOVEMBER_12, 'preview-canary');
  return { reads, manifest, rows };
}

export function buildHistoricalBoardCanaryReport(args: {
  manifest: HistoricalBoardArchiveManifest;
  rows: HistoricalBoardRow[];
  reads: Array<{ name: string; sha256: string; bytes: number }>;
  todayEt: string;
}) {
  const manifestRead = args.reads.find((read) => read.name === 'manifest.json');
  const partitionRead = args.reads.find((read) => read.name === `date=${NOVEMBER_12}.json.gz`);
  if (!manifestRead || manifestRead.sha256 !== HISTORICAL_BOARD_MANIFEST_SHA256) throw new Error('archive_checksum_mismatch');
  if (!partitionRead) throw new Error('archive_object_missing');
  const declared = args.manifest.partitions.find((partition) => partition.id === NOVEMBER_12);
  if (!declared || partitionRead.sha256 !== declared.sha256) throw new Error('archive_checksum_mismatch');
  const consensus = consensusByPlayer(args.rows, 'rebounds');
  const fingerprint = createHash('sha256')
    .update([...consensus.values()].map((item) => `${item.line}:${item.bookCount}`).sort().join('\n'))
    .digest('hex');
  const archivedIds = new Set(
    args.manifest.games.filter((game) => game.dateEt === NOVEMBER_12).map((game) => String(game.gameId))
  );
  const archivedGame = [...archivedIds][0];
  if (!archivedGame) throw new Error('archive_partition_missing');
  const merged = mergeLast5Players({
    sqlPlayers: [marker(PROTECTED_GAME)],
    archivePlayers: [marker(archivedGame)],
    archivedGameIds: archivedIds,
  });
  const mergedIds = merged.map((player) => player.gameId);
  const source = historicalBoardSourceFromEnv({
    HISTORICAL_BOARD_ARCHIVE: 's3',
    HISTORICAL_BOARD_S3_BUCKET: HISTORICAL_BOARD_BUCKET,
    AWS_REGION: HISTORICAL_BOARD_REGION,
  });
  const consensusLine = [...consensus.values()][0]?.line;
  const boardLine = consensusLine == null ? { status: 'empty_slate' as const } : resolveLast5Line({
    date: NOVEMBER_12,
    todayEt: args.todayEt,
    gamesOnDate: archivedIds.size,
    boardQuotes: [{ sportsbook: 'DraftKings', side: 'over', line: consensusLine, impliedProbability: 0.52 }],
    researchCloses: [{ sportsbook: 'DraftKings', side: 'over', line: consensusLine + 3, impliedProbability: 0.8 }],
  });
  return {
    manifest: {
      sha256: manifestRead.sha256,
      rows: args.manifest.rowCount,
      games: args.manifest.games.length,
      partitions: args.manifest.partitions.length,
    },
    november12: {
      name: `date=${NOVEMBER_12}.json.gz`,
      sha256: partitionRead.sha256,
      bytes: partitionRead.bytes,
      rows: args.rows.length,
      objectKeyMatches: declared.objectKey === historicalBoardObjectKey(NOVEMBER_12),
      protectedGamePresent: args.rows.some((row) => String(row.gameId) === PROTECTED_GAME),
    },
    last5: {
      market: 'rebounds',
      consensusGroups: consensus.size,
      lineFingerprint: fingerprint,
      protectedGameInArchive: archivedIds.has(PROTECTED_GAME),
      mergedGameIds: [...new Set(mergedIds)].sort(),
      duplicateGames: mergedIds.length !== new Set(mergedIds).size,
      researchCloseSubstituted: boardLine.status === 'ready' && boardLine.line !== consensusLine,
      boardLineReady: boardLine.status === 'ready' && boardLine.line === consensusLine,
    },
    trueCost: trueCostProof(args.rows),
    current: {
      todayReadsArchive: shouldReadHistoricalBoard(source, args.todayEt, args.todayEt),
      openGameArchiveLegs: legsThatNeedArchive(
        [{ gameId: OPEN_GAME, playerId: '1', market: 'points', side: 'over', line: 20.5 }],
        [[]]
      ).length,
      objectsRead: args.reads.map((read) => read.name),
    },
  };
}

function marker(gameId: string): TonightPropPlayer {
  return {
    playerId: '1',
    playerName: 'marker',
    gameId,
    teamAbbr: 'DEN',
    opponentAbbr: 'OKC',
    isHome: true,
    startTime: '2026-11-12T00:00:00.000Z',
    quotes: [{ sportsbook: 'DraftKings', side: 'over', line: 8.5, impliedProbability: 0.52 }],
    linesAsOf: '2026-11-12T00:00:00.000Z',
  };
}

function supportedBook(name: string | null): string | null {
  const value = (name ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (value.includes('draftkings')) return 'DraftKings';
  if (value.includes('fanduel')) return 'FanDuel';
  if (value.includes('betmgm')) return 'BetMGM';
  if (value.includes('caesars')) return 'Caesars';
  return null;
}

function trueCostProof(rows: readonly HistoricalBoardRow[]) {
  const groups = new Map<string, { over: HistoricalBoardRow | null; under: HistoricalBoardRow | null; book: string; line: number }>();
  for (const row of rows) {
    if (row.marketType !== 'over_under' || (row.side !== 'over' && row.side !== 'under')) continue;
    const book = supportedBook(row.sportsbook);
    const line = parseLineValue(row.lineText);
    if (!book || line == null || row.propType == null) continue;
    const key = `${row.gameId}|${row.playerId}|${row.propType}|${book}|${line}`;
    const group = groups.get(key) ?? { over: null, under: null, book, line };
    if (row.side === 'over') group.over = row;
    if (row.side === 'under') group.under = row;
    groups.set(key, group);
  }
  const paired = [...groups.values()].find((group) => group.over && group.under);
  if (!paired?.over) throw new Error('archive_unreadable');
  const leg = offerLeg(paired.over, paired.line);
  const quotes = quotesFromHistoricalBoard(rows, [leg.key])[0] ?? [];
  const other = quotesFromHistoricalBoard(rows, [{ ...leg.key, line: paired.line + 10 }])[0] ?? [];
  const saved = savedOfferTrueCostInput(leg.selected, quotes);
  const missing = savedOfferTrueCostInput(leg.selected, []);
  return {
    savedPriceAmerican: saved.priceAmerican,
    oppositePresent: saved.oppositeAmerican != null,
    quoteCountAtSavedLine: quotes.length,
    quoteCountAtOtherLine: other.length,
    missingOppositeRemainsEmpty: missing.oppositeAmerican == null && missing.priceAmerican === SAVED_PRICE,
  };
}

function offerLeg(row: HistoricalBoardRow, line: number) {
  const book = supportedBook(row.sportsbook);
  if (!book || row.propType == null) throw new Error('archive_unreadable');
  const adapted = adaptPropsExplorerOffer({
    playerId: String(row.playerId),
    playerName: 'archived',
    gameId: String(row.gameId),
    propType: row.propType,
    side: 'over',
    lineValue: line,
    sportsbook: book,
    oddsAmerican: SAVED_PRICE,
    snapshotAt: row.snapshotAt,
    marketContext: 'historical',
    sourceTable: 'analytics.player_props_current',
  });
  if (!adapted.ok) throw new Error('archive_unreadable');
  return {
    key: {
      gameId: String(row.gameId),
      playerId: String(row.playerId),
      market: row.propType,
      side: 'over' as const,
      line,
    },
    selected: { offer: adapted.offer, gameLabel: 'archived' },
  };
}
