/**
 * Validated reads of one manifest and one date partition.
 * A request never opens the other twelve partitions.
 */
import { FROZEN_OPEN_GAME_IDS } from '@/lib/props/research-materialization-runner';
import { PROTECTED_FINAL_GAME_IDS } from '@/lib/props/snapshot-reclamation';
import {
  CURRENT_BOARD_BACKUP_ID,
  CURRENT_BOARD_BACKUP_SHA256,
  CURRENT_BOARD_MANIFEST_SHA256,
  FROZEN_BOARD_DELETE_ROWS,
  FROZEN_BOARD_GAMES,
} from '@/lib/props/current-board-reclamation';
import {
  HISTORICAL_BOARD_ARCHIVE_VERSION,
  HISTORICAL_BOARD_MANIFEST_SHA256,
  HISTORICAL_BOARD_S3_PREFIX,
  HISTORICAL_BOARD_SERIALIZATION,
  historicalBoardObjectKey,
  readHistoricalBoardPartition,
  sha256,
  type HistoricalBoardArchiveManifest,
  type HistoricalBoardObjectStore,
  type HistoricalBoardRow,
} from '@/lib/props/historical-board-archive';

const MANIFEST_KEY = `${HISTORICAL_BOARD_S3_PREFIX}manifest.json`;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED_PARTITIONS = 4;
const PROTECTED = new Set<number>([...PROTECTED_FINAL_GAME_IDS, ...FROZEN_OPEN_GAME_IDS]);

type CacheEntry<T> = { at: number; value: T };

const manifests = new Map<string, CacheEntry<HistoricalBoardArchiveManifest>>();
const partitions = new Map<string, CacheEntry<HistoricalBoardRow[]>>();

export function clearHistoricalBoardCache(): void {
  manifests.clear();
  partitions.clear();
}

export function assertReadableArchiveManifest(manifest: HistoricalBoardArchiveManifest): void {
  if (manifest.version !== HISTORICAL_BOARD_ARCHIVE_VERSION) throw new Error('archive_version_rejected');
  if (manifest.serialization !== HISTORICAL_BOARD_SERIALIZATION) throw new Error('archive_serialization_rejected');
  if (manifest.sourceBackupId !== CURRENT_BOARD_BACKUP_ID || manifest.sourceBackupSha256 !== CURRENT_BOARD_BACKUP_SHA256) {
    throw new Error('archive_backup_rejected');
  }
  if (manifest.sourceManifestSha256 !== CURRENT_BOARD_MANIFEST_SHA256) throw new Error('archive_manifest_rejected');
  if (manifest.rowCount !== FROZEN_BOARD_DELETE_ROWS || manifest.games.length !== FROZEN_BOARD_GAMES) {
    throw new Error('archive_row_count_rejected');
  }
  if (manifest.partitions.length !== 13) throw new Error('archive_partition_rejected');
  const seen = new Set<number>();
  let gameRows = 0;
  for (const game of manifest.games) {
    if (PROTECTED.has(game.gameId) || seen.has(game.gameId)) throw new Error('archive_game_rejected');
    seen.add(game.gameId);
    gameRows += game.rows;
  }
  if (gameRows !== FROZEN_BOARD_DELETE_ROWS) throw new Error('archive_row_count_rejected');
  let partitionRows = 0;
  for (const partition of manifest.partitions) {
    if (partition.objectKey !== historicalBoardObjectKey(partition.id)) throw new Error('archive_partition_rejected');
    partitionRows += partition.rows;
  }
  if (partitionRows !== FROZEN_BOARD_DELETE_ROWS) throw new Error('archive_row_count_rejected');
}

export async function loadHistoricalBoardManifest(
  store: HistoricalBoardObjectStore,
  cacheKey: string
): Promise<HistoricalBoardArchiveManifest> {
  const cached = manifests.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const bytes = await store.getObject(MANIFEST_KEY);
  if (!bytes) throw new Error('archive_object_missing');
  if (sha256(bytes) !== HISTORICAL_BOARD_MANIFEST_SHA256) throw new Error('archive_checksum_mismatch');
  const manifest = JSON.parse(bytes.toString('utf8')) as HistoricalBoardArchiveManifest;
  assertReadableArchiveManifest(manifest);
  manifests.set(cacheKey, { at: Date.now(), value: manifest });
  return manifest;
}

export async function loadHistoricalBoardDate(
  store: HistoricalBoardObjectStore,
  manifest: HistoricalBoardArchiveManifest,
  dateEt: string,
  cacheKey: string
): Promise<HistoricalBoardRow[]> {
  const key = `${cacheKey}|${dateEt}`;
  const cached = partitions.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    partitions.delete(key);
    partitions.set(key, cached);
    return cached.value;
  }
  const rows = await readHistoricalBoardPartition(store, manifest, dateEt);
  partitions.set(key, { at: Date.now(), value: rows });
  while (partitions.size > MAX_CACHED_PARTITIONS) {
    const oldest = partitions.keys().next().value;
    if (oldest == null) break;
    partitions.delete(oldest);
  }
  return rows;
}
