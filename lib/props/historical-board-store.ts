/**
 * Local reader for a historical-board archive directory.
 * The directory is outside the repository. This module does not upload.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  HISTORICAL_BOARD_ARCHIVE_VERSION,
  readHistoricalBoardPartition,
  type HistoricalBoardArchiveManifest,
  type HistoricalBoardObjectStore,
  type HistoricalBoardRow,
} from '@/lib/props/historical-board-archive';

export async function readLocalArchiveManifest(directory: string): Promise<HistoricalBoardArchiveManifest> {
  const raw = await readFile(path.join(directory, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(raw) as HistoricalBoardArchiveManifest;
  if (manifest.version !== HISTORICAL_BOARD_ARCHIVE_VERSION) throw new Error('archive_version_rejected');
  return manifest;
}

export function localHistoricalBoardStore(directory: string): HistoricalBoardObjectStore {
  return {
    async getObject(objectKey: string) {
      const fileName = objectKey.split('/').pop();
      if (!fileName || !/^(manifest\.json|date=\d{4}-\d{2}-\d{2}\.json\.gz)$/.test(fileName)) {
        throw new Error('archive_key_rejected');
      }
      try {
        return await readFile(path.join(directory, fileName));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return null;
        throw error;
      }
    },
  };
}

export async function readLocalBoardPartition(directory: string, dateEt: string): Promise<HistoricalBoardRow[]> {
  const manifest = await readLocalArchiveManifest(directory);
  return readHistoricalBoardPartition(localHistoricalBoardStore(directory), manifest, dateEt);
}

export function archivedGameIdsForDate(manifest: HistoricalBoardArchiveManifest, dateEt: string): Set<string> {
  return new Set(
    manifest.games.filter((game) => game.dateEt === dateEt).map((game) => String(game.gameId))
  );
}
