/**
 * Compact historical copy of analytics.player_props_current for the frozen
 * 95-game cohort. Rows stay the original board quotes. Research closes are
 * not accepted as a substitute. This module does not open a database
 * connection and does not upload to S3.
 */
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { parseLineValue } from '@/lib/betting/prop-market-compare';
import type { BookLineQuote } from '@/lib/content/video/last5/snapshot';
import { consensusMainLine } from '@/lib/content/video/last5/snapshot';
import type { BookLegQuote } from '@/lib/parlay/true-cost';
import { quotesForLegs, type CurrentPropPriceRow, type TrueCostLegKey } from '@/lib/parlay/true-cost-quotes';
import {
  CURRENT_BOARD_BACKUP_ID,
  CURRENT_BOARD_BACKUP_SHA256,
  CURRENT_BOARD_MANIFEST_SHA256,
  FROZEN_BOARD_DELETE_ROWS,
  type BoardGame,
} from '@/lib/props/current-board-reclamation';

export const HISTORICAL_BOARD_ARCHIVE_VERSION = 'historical-board-archive.v1';
export const HISTORICAL_BOARD_SERIALIZATION = 'json-gzip.v1';
export const HISTORICAL_BOARD_S3_PREFIX =
  'historical-board/version=historical-board-archive.v1/backup_id=cc-pg-logical-20261114T191459Z/';
/** SHA-256 of the uploaded manifest.json bytes. */
export const HISTORICAL_BOARD_MANIFEST_SHA256 =
  '1c21be4abec6b16efa3b2c1be7d4c21ec65ba3e58063960c1d4074678ecfd309';
/** Largest approved partition is 593,671 bytes. Reject anything larger before decode. */
export const HISTORICAL_BOARD_MAX_COMPRESSED_BYTES = 1_000_000;
/** Largest approved partition expands to 11,305,521 bytes. */
export const HISTORICAL_BOARD_MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;

export const HISTORICAL_BOARD_COLUMNS = [
  'gameId',
  'playerId',
  'playerName',
  'teamId',
  'sportsbook',
  'propType',
  'marketType',
  'side',
  'lineText',
  'oddsAmerican',
  'oddsDecimalText',
  'impliedText',
  'snapshotAt',
  'snapshotMicros',
  'observedAt',
  'observationClock',
  'controllerEnqueuedAt',
  'providerUpdatedAt',
] as const;

export type HistoricalBoardRow = {
  gameId: number;
  playerId: number;
  playerName: string | null;
  teamId: number | null;
  sportsbook: string | null;
  propType: string | null;
  marketType: string | null;
  side: string | null;
  lineText: string | null;
  oddsAmerican: number | null;
  oddsDecimalText: string | null;
  impliedText: string | null;
  snapshotAt: string;
  snapshotMicros: string;
  observedAt: string | null;
  observationClock: string | null;
  controllerEnqueuedAt: string | null;
  providerUpdatedAt: string | null;
};

export type HistoricalBoardPartition = {
  id: string;
  fileName: string;
  objectKey: string;
  rows: number;
  byteLength: number;
  sha256: string;
};

export type HistoricalBoardGame = {
  gameId: number;
  dateEt: string;
  rows: number;
};

export type HistoricalBoardArchiveManifest = {
  version: typeof HISTORICAL_BOARD_ARCHIVE_VERSION;
  serialization: typeof HISTORICAL_BOARD_SERIALIZATION;
  columns: readonly string[];
  sourceBackupId: typeof CURRENT_BOARD_BACKUP_ID;
  sourceBackupSha256: typeof CURRENT_BOARD_BACKUP_SHA256;
  sourceManifestSha256: typeof CURRENT_BOARD_MANIFEST_SHA256;
  rowCount: number;
  games: HistoricalBoardGame[];
  partitions: HistoricalBoardPartition[];
};

export type DatedBoardRow = HistoricalBoardRow & { dateEt: string };

export type HistoricalBoardObjectStore = {
  getObject(objectKey: string): Promise<Buffer | null>;
};

type EncodedPartition = {
  version: string;
  dateEt: string;
  columns: string[];
  rows: unknown[][];
};

function compareText(left: string | null, right: string | null): number {
  if (left == null && right == null) return 0;
  if (left == null) return -1;
  if (right == null) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function historicalBoardObjectKey(dateEt: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateEt)) throw new Error('archive_date_rejected');
  return `${HISTORICAL_BOARD_S3_PREFIX}date=${dateEt}.json.gz`;
}

export function boardRowKey(row: HistoricalBoardRow): string {
  return [row.gameId, row.playerId, row.sportsbook, row.propType, row.side, row.lineText].join('\u001f');
}

export function sortBoardRows(rows: readonly HistoricalBoardRow[]): HistoricalBoardRow[] {
  return [...rows].sort((left, right) =>
    left.gameId - right.gameId
    || left.playerId - right.playerId
    || compareText(left.sportsbook, right.sportsbook)
    || compareText(left.propType, right.propType)
    || compareText(left.marketType, right.marketType)
    || compareText(left.side, right.side)
    || compareText(left.lineText, right.lineText)
    || compareText(left.snapshotMicros, right.snapshotMicros)
  );
}

function toTuple(row: HistoricalBoardRow): unknown[] {
  return HISTORICAL_BOARD_COLUMNS.map((column) => row[column]);
}

function fromTuple(values: unknown[]): HistoricalBoardRow {
  if (values.length !== HISTORICAL_BOARD_COLUMNS.length) throw new Error('archive_row_width_rejected');
  const row = {} as HistoricalBoardRow;
  HISTORICAL_BOARD_COLUMNS.forEach((column, index) => {
    (row as Record<string, unknown>)[column] = values[index];
  });
  return row;
}

export function encodePartition(dateEt: string, rows: readonly HistoricalBoardRow[]): Buffer {
  const payload = Buffer.from(JSON.stringify({
    version: HISTORICAL_BOARD_ARCHIVE_VERSION,
    dateEt,
    columns: HISTORICAL_BOARD_COLUMNS,
    rows: sortBoardRows(rows).map(toTuple),
  }));
  return gzipSync(payload, { level: 9 });
}

export function decodePartition(bytes: Buffer): { dateEt: string; rows: HistoricalBoardRow[] } {
  if (bytes.length > HISTORICAL_BOARD_MAX_COMPRESSED_BYTES) throw new Error('archive_too_large');
  let parsed: EncodedPartition;
  try {
    const text = gunzipSync(bytes, { maxOutputLength: HISTORICAL_BOARD_MAX_UNCOMPRESSED_BYTES }).toString('utf8');
    parsed = JSON.parse(text) as EncodedPartition;
  } catch (error) {
    if (error instanceof RangeError) throw new Error('archive_too_large');
    throw new Error('archive_unreadable');
  }
  if (parsed.version !== HISTORICAL_BOARD_ARCHIVE_VERSION) throw new Error('archive_version_rejected');
  if (!Array.isArray(parsed.columns) || parsed.columns.join() !== HISTORICAL_BOARD_COLUMNS.join()) {
    throw new Error('archive_schema_rejected');
  }
  if (!Array.isArray(parsed.rows)) throw new Error('archive_rows_rejected');
  return { dateEt: parsed.dateEt, rows: parsed.rows.map(fromTuple) };
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function buildHistoricalBoardArchive(
  datedRows: readonly DatedBoardRow[],
  frozenGames: readonly BoardGame[]
): { manifest: HistoricalBoardArchiveManifest; files: Map<string, Buffer> } {
  const expected = new Map(frozenGames.map((game) => [game.gameId, game.rows]));
  if (expected.size !== frozenGames.length) throw new Error('archive_game_rejected');
  const byDate = new Map<string, HistoricalBoardRow[]>();
  const seen = new Set<string>();
  const gameRows = new Map<number, { dateEt: string; rows: number }>();
  for (const dated of datedRows) {
    if (!expected.has(dated.gameId)) throw new Error('archive_game_rejected');
    if (dated.sportsbook == null || dated.propType == null || dated.side == null || dated.lineText == null) {
      throw new Error('archive_key_incomplete');
    }
    const key = boardRowKey(dated);
    if (seen.has(key)) throw new Error('archive_duplicate_key');
    seen.add(key);
    const { dateEt, ...row } = dated;
    const list = byDate.get(dateEt) ?? [];
    list.push(row);
    byDate.set(dateEt, list);
    const game = gameRows.get(dated.gameId) ?? { dateEt, rows: 0 };
    if (game.dateEt !== dateEt) throw new Error('archive_game_date_conflict');
    game.rows += 1;
    gameRows.set(dated.gameId, game);
  }
  if (seen.size !== FROZEN_BOARD_DELETE_ROWS) throw new Error('archive_row_count_rejected');
  for (const [gameId, rows] of expected) {
    if (gameRows.get(gameId)?.rows !== rows) throw new Error('archive_game_count_rejected');
  }
  const files = new Map<string, Buffer>();
  const partitions: HistoricalBoardPartition[] = [];
  for (const dateEt of [...byDate.keys()].sort()) {
    const rows = byDate.get(dateEt) ?? [];
    const bytes = encodePartition(dateEt, rows);
    const fileName = `date=${dateEt}.json.gz`;
    files.set(fileName, bytes);
    partitions.push({
      id: dateEt,
      fileName,
      objectKey: historicalBoardObjectKey(dateEt),
      rows: rows.length,
      byteLength: bytes.length,
      sha256: sha256(bytes),
    });
  }
  const manifest: HistoricalBoardArchiveManifest = {
    version: HISTORICAL_BOARD_ARCHIVE_VERSION,
    serialization: HISTORICAL_BOARD_SERIALIZATION,
    columns: HISTORICAL_BOARD_COLUMNS,
    sourceBackupId: CURRENT_BOARD_BACKUP_ID,
    sourceBackupSha256: CURRENT_BOARD_BACKUP_SHA256,
    sourceManifestSha256: CURRENT_BOARD_MANIFEST_SHA256,
    rowCount: seen.size,
    games: [...gameRows.entries()]
      .map(([gameId, game]) => ({ gameId, dateEt: game.dateEt, rows: game.rows }))
      .sort((left, right) => left.gameId - right.gameId),
    partitions,
  };
  return { manifest, files };
}

export function assertHistoricalBoardArchive(
  manifest: HistoricalBoardArchiveManifest,
  files: ReadonlyMap<string, Buffer>,
  frozenGames: readonly BoardGame[]
): void {
  if (manifest.version !== HISTORICAL_BOARD_ARCHIVE_VERSION) throw new Error('archive_version_rejected');
  if (manifest.serialization !== HISTORICAL_BOARD_SERIALIZATION) throw new Error('archive_serialization_rejected');
  if (manifest.columns.join() !== HISTORICAL_BOARD_COLUMNS.join()) throw new Error('archive_schema_rejected');
  if (manifest.sourceBackupId !== CURRENT_BOARD_BACKUP_ID || manifest.sourceBackupSha256 !== CURRENT_BOARD_BACKUP_SHA256) {
    throw new Error('archive_backup_rejected');
  }
  if (manifest.sourceManifestSha256 !== CURRENT_BOARD_MANIFEST_SHA256) throw new Error('archive_manifest_rejected');
  if (manifest.rowCount !== FROZEN_BOARD_DELETE_ROWS) throw new Error('archive_row_count_rejected');
  const expected = new Map(frozenGames.map((game) => [game.gameId, game.rows]));
  if (manifest.games.length !== expected.size) throw new Error('archive_game_rejected');
  const dates = new Set<string>();
  let gameSum = 0;
  for (const game of manifest.games) {
    if (expected.get(game.gameId) !== game.rows) throw new Error('archive_game_count_rejected');
    dates.add(game.dateEt);
    gameSum += game.rows;
  }
  if (gameSum !== FROZEN_BOARD_DELETE_ROWS) throw new Error('archive_row_count_rejected');
  if (manifest.partitions.length !== dates.size) throw new Error('archive_partition_rejected');
  const seen = new Set<string>();
  let partitionSum = 0;
  for (const partition of manifest.partitions) {
    if (!dates.has(partition.id) || partition.objectKey !== historicalBoardObjectKey(partition.id)) {
      throw new Error('archive_partition_rejected');
    }
    const bytes = files.get(partition.fileName);
    if (!bytes || bytes.length !== partition.byteLength || sha256(bytes) !== partition.sha256) {
      throw new Error('archive_checksum_mismatch');
    }
    const decoded = decodePartition(bytes);
    if (decoded.dateEt !== partition.id || decoded.rows.length !== partition.rows) {
      throw new Error('archive_row_count_rejected');
    }
    for (const row of decoded.rows) {
      const key = boardRowKey(row);
      if (seen.has(key)) throw new Error('archive_duplicate_key');
      seen.add(key);
    }
    partitionSum += partition.rows;
  }
  if (partitionSum !== FROZEN_BOARD_DELETE_ROWS || seen.size !== FROZEN_BOARD_DELETE_ROWS) {
    throw new Error('archive_row_count_rejected');
  }
}

export async function readHistoricalBoardPartition(
  store: HistoricalBoardObjectStore,
  manifest: HistoricalBoardArchiveManifest,
  dateEt: string
): Promise<HistoricalBoardRow[]> {
  const partition = manifest.partitions.find((item) => item.id === dateEt);
  if (!partition) throw new Error('archive_partition_missing');
  const bytes = await store.getObject(partition.objectKey);
  if (!bytes) throw new Error('archive_object_missing');
  if (bytes.length !== partition.byteLength || sha256(bytes) !== partition.sha256) {
    throw new Error('archive_checksum_mismatch');
  }
  const decoded = decodePartition(bytes);
  if (decoded.dateEt !== dateEt || decoded.rows.length !== partition.rows) throw new Error('archive_row_count_rejected');
  return decoded.rows;
}

function numberOrNull(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Same latest-snapshot rule as the Last-5 SQL: one snapshot per game, player, and book. */
export function latestBoardQuotes(rows: readonly HistoricalBoardRow[], market: string): BookLineQuote[] {
  const matching = rows.filter((row) =>
    row.propType === market
    && row.marketType === 'over_under'
    && (row.side === 'over' || row.side === 'under')
  );
  const latest = new Map<string, string>();
  for (const row of matching) {
    const key = `${row.gameId}|${row.playerId}|${row.sportsbook ?? ''}`;
    const current = latest.get(key);
    if (current == null || BigInt(row.snapshotMicros) > BigInt(current)) latest.set(key, row.snapshotMicros);
  }
  return matching
    .filter((row) => latest.get(`${row.gameId}|${row.playerId}|${row.sportsbook ?? ''}`) === row.snapshotMicros)
    .map((row) => ({
      sportsbook: row.sportsbook ?? '',
      side: row.side as 'over' | 'under',
      line: numberOrNull(row.lineText) ?? Number.NaN,
      impliedProbability: numberOrNull(row.impliedText),
    }));
}

export function consensusByPlayer(
  rows: readonly HistoricalBoardRow[],
  market: string
): Map<string, { line: number; bookCount: number }> {
  const groups = new Map<string, BookLineQuote[]>();
  const matching = rows.filter((row) => row.propType === market && row.marketType === 'over_under');
  const latest = new Map<string, string>();
  for (const row of matching) {
    const bookKey = `${row.gameId}|${row.playerId}|${row.sportsbook ?? ''}`;
    const current = latest.get(bookKey);
    if (current == null || BigInt(row.snapshotMicros) > BigInt(current)) latest.set(bookKey, row.snapshotMicros);
  }
  for (const row of matching) {
    if (latest.get(`${row.gameId}|${row.playerId}|${row.sportsbook ?? ''}`) !== row.snapshotMicros) continue;
    if (row.side !== 'over' && row.side !== 'under') continue;
    const playerKey = `${row.gameId}|${row.playerId}`;
    const list = groups.get(playerKey) ?? [];
    list.push({
      sportsbook: row.sportsbook ?? '',
      side: row.side,
      line: numberOrNull(row.lineText) ?? Number.NaN,
      impliedProbability: numberOrNull(row.impliedText),
    });
    groups.set(playerKey, list);
  }
  const result = new Map<string, { line: number; bookCount: number }>();
  for (const [key, quotes] of groups) {
    const line = consensusMainLine(quotes);
    if (line) result.set(key, line);
  }
  return result;
}

export function archivePriceRows(rows: readonly HistoricalBoardRow[], leg: TrueCostLegKey): CurrentPropPriceRow[] {
  return rows
    .filter((row) =>
      String(row.gameId) === leg.gameId
      && String(row.playerId) === leg.playerId
      && row.marketType === 'over_under'
      && parseLineValue(row.lineText) === leg.line
      && row.oddsAmerican != null
    )
    .map((row) => ({
      game_id: row.gameId,
      player_id: row.playerId,
      sportsbook: row.sportsbook,
      prop_type: row.propType,
      side: row.side,
      line_value: row.lineText,
      odds_american: row.oddsAmerican,
      snapshot_at: row.snapshotAt,
    }));
}

export function quotesFromHistoricalBoard(rows: readonly HistoricalBoardRow[], legs: readonly TrueCostLegKey[]): BookLegQuote[][] {
  return legs.map((leg) => quotesForLegs([leg], archivePriceRows(rows, leg))[0] ?? []);
}

/** SQL quotes win when present. An empty SQL leg may use the archive. Prices are not invented. */
export function fillEmptyLegQuotes(
  sqlQuotes: readonly BookLegQuote[][],
  archiveQuotes: readonly BookLegQuote[][]
): BookLegQuote[][] {
  return sqlQuotes.map((quotes, index) => (quotes.length > 0 ? [...quotes] : [...(archiveQuotes[index] ?? [])]));
}
