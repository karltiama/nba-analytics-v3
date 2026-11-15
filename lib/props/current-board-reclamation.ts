/**
 * Frozen allowlist for historical rows on analytics.player_props_current.
 * Selection is the 95 game ids already certified for snapshot reclamation.
 * Status is not a delete predicate. This module does not open a connection.
 */
import { FROZEN_OPEN_GAME_IDS } from '@/lib/props/research-materialization-runner';
import {
  PROTECTED_FINAL_GAME_IDS,
  SNAPSHOT_RECLAMATION_BACKUP_ID,
  SNAPSHOT_RECLAMATION_BACKUP_SHA256,
} from '@/lib/props/snapshot-reclamation';

export const CURRENT_BOARD_RECLAMATION_VERSION = 'current-board-reclamation.v1';
export const CURRENT_BOARD_BACKUP_ID = SNAPSHOT_RECLAMATION_BACKUP_ID;
export const CURRENT_BOARD_BACKUP_SHA256 = SNAPSHOT_RECLAMATION_BACKUP_SHA256;
export const BOARD_MAX_DELETE_BATCH_ROWS = 20_000;
export const FROZEN_BOARD_GAMES = 95;
export const FROZEN_BOARD_DELETE_ROWS = 142_602;
export const FROZEN_BOARD_SURVIVOR_ROWS = 27_867;
export const FROZEN_BOARD_BATCHES = 8;
export const CURRENT_BOARD_MANIFEST_SHA256 =
  'd810414febcf0a91604455b319bd0c1995e057ccb00d1d9030e6563cf60b6c0a';

const UNIQUE_KEY = ['game_id', 'player_id', 'sportsbook', 'prop_type', 'side', 'line_value'] as const;
const OPEN = new Set<number>(FROZEN_OPEN_GAME_IDS);
const PROTECTED = new Set<number>(PROTECTED_FINAL_GAME_IDS);

export type BoardGame = {
  gameId: number;
  rows: number;
};

export type BoardExclusion = {
  gameId: number;
  rows: number;
  reason: 'protected_final_game' | 'open_game';
};

export type CurrentBoardManifest = {
  version: typeof CURRENT_BOARD_RECLAMATION_VERSION;
  backupId: typeof CURRENT_BOARD_BACKUP_ID;
  backupSha256: typeof CURRENT_BOARD_BACKUP_SHA256;
  selection: 'game_id';
  uniqueKey: readonly string[];
  maxDeleteBatchRows: typeof BOARD_MAX_DELETE_BATCH_ROWS;
  expectedDeleteRows: number;
  expectedSurvivorRows: number;
  games: BoardGame[];
  exclusions: BoardExclusion[];
};

export type BoardDeletionBatch = {
  games: BoardGame[];
  expectedRows: number;
};

function rejection(text: string): void {
  if (/status|Final|player_prop_snapshots|prop_decision|prop_first_seen/i.test(text)) {
    throw new Error('unbounded_delete_rejected');
  }
}

export function assertBoardManifest(manifest: CurrentBoardManifest, fileSha256?: string): void {
  if (manifest.version !== CURRENT_BOARD_RECLAMATION_VERSION) throw new Error('manifest_version_rejected');
  if (manifest.backupId !== CURRENT_BOARD_BACKUP_ID || manifest.backupSha256 !== CURRENT_BOARD_BACKUP_SHA256) {
    throw new Error('manifest_backup_rejected');
  }
  if (manifest.selection !== 'game_id') throw new Error('manifest_selection_rejected');
  if (manifest.uniqueKey.join() !== UNIQUE_KEY.join()) throw new Error('manifest_key_rejected');
  if (manifest.maxDeleteBatchRows !== BOARD_MAX_DELETE_BATCH_ROWS) throw new Error('manifest_batch_cap_rejected');
  if (fileSha256 != null && fileSha256 !== CURRENT_BOARD_MANIFEST_SHA256) throw new Error('manifest_hash_rejected');
  if (manifest.games.length !== FROZEN_BOARD_GAMES) throw new Error('manifest_game_count_rejected');

  const seen = new Set<number>();
  let rows = 0;
  for (const game of manifest.games) {
    if (!Number.isSafeInteger(game.gameId) || !Number.isSafeInteger(game.rows) || game.rows <= 0) {
      throw new Error('manifest_game_rejected');
    }
    if (seen.has(game.gameId) || OPEN.has(game.gameId) || PROTECTED.has(game.gameId)) {
      throw new Error('manifest_game_rejected');
    }
    seen.add(game.gameId);
    rows += game.rows;
  }
  if (rows !== manifest.expectedDeleteRows || rows !== FROZEN_BOARD_DELETE_ROWS) {
    throw new Error('manifest_total_rejected');
  }

  const excluded = new Set<number>();
  let survivors = 0;
  for (const game of manifest.exclusions) {
    const expectedReason = PROTECTED.has(game.gameId)
      ? 'protected_final_game'
      : OPEN.has(game.gameId)
        ? 'open_game'
        : null;
    if (
      expectedReason == null
      || game.reason !== expectedReason
      || !Number.isSafeInteger(game.rows)
      || game.rows <= 0
      || excluded.has(game.gameId)
      || seen.has(game.gameId)
    ) {
      throw new Error('protected_game_rejected');
    }
    excluded.add(game.gameId);
    survivors += game.rows;
  }
  for (const gameId of [...PROTECTED_FINAL_GAME_IDS, ...FROZEN_OPEN_GAME_IDS]) {
    if (!excluded.has(gameId)) throw new Error('protected_game_missing');
  }
  if (survivors !== manifest.expectedSurvivorRows || survivors !== FROZEN_BOARD_SURVIVOR_ROWS) {
    throw new Error('protected_rows_rejected');
  }
}

export function planBoardDeletionBatches(manifest: CurrentBoardManifest): BoardDeletionBatch[] {
  assertBoardManifest(manifest);
  const batches: BoardDeletionBatch[] = [];
  let current: BoardDeletionBatch = { games: [], expectedRows: 0 };
  for (const game of manifest.games) {
    if (game.rows > BOARD_MAX_DELETE_BATCH_ROWS) throw new Error('game_exceeds_batch');
    if (current.expectedRows + game.rows > BOARD_MAX_DELETE_BATCH_ROWS && current.games.length > 0) {
      batches.push(current);
      current = { games: [], expectedRows: 0 };
    }
    current.games.push(game);
    current.expectedRows += game.rows;
  }
  if (current.games.length > 0) batches.push(current);
  const planned = batches.reduce((sum, batch) => sum + batch.expectedRows, 0);
  if (planned !== manifest.expectedDeleteRows || batches.length !== FROZEN_BOARD_BATCHES) {
    throw new Error('batch_total_rejected');
  }
  if (batches.some((batch) => batch.expectedRows <= 0 || batch.expectedRows > BOARD_MAX_DELETE_BATCH_ROWS)) {
    throw new Error('batch_too_large');
  }
  return batches;
}

function valuesSql(batch: BoardDeletionBatch): { values: string; params: number[] } {
  const params = batch.games.map((game) => game.gameId);
  const values = params.map((_, index) => `($${index + 1}::integer)`).join(', ');
  return { values, params };
}

export function boardDeletionCountSql(batch: BoardDeletionBatch): { text: string; params: number[] } {
  const { values, params } = valuesSql(batch);
  const text = `SELECT count(*)::int AS n
  FROM analytics.player_props_current AS t
  INNER JOIN (VALUES ${values}) AS allowed(game_id)
    ON t.game_id = allowed.game_id`;
  rejection(text);
  return { text, params };
}

export function boardDeletionSql(batch: BoardDeletionBatch): { text: string; params: number[] } {
  const { values, params } = valuesSql(batch);
  const text = `DELETE FROM analytics.player_props_current AS t
 USING (VALUES ${values}) AS allowed(game_id)
 WHERE t.game_id = allowed.game_id`;
  rejection(text);
  return { text, params };
}
