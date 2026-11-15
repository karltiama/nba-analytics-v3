/**
 * Frozen allowlist for the first historical snapshot deletion.
 * A game is eligible only when every live pull on that game has an archived
 * key and the archived row count equals the SQL row count. Status Final is
 * not a delete predicate.
 */
import { FROZEN_FINAL_GAME_IDS, FROZEN_OPEN_GAME_IDS } from '@/lib/props/research-materialization-runner';

export const SNAPSHOT_RECLAMATION_VERSION = 'snapshot-reclamation.v1';
export const SNAPSHOT_RECLAMATION_BACKUP_ID = 'cc-pg-logical-20261114T191459Z';
export const SNAPSHOT_RECLAMATION_BACKUP_SHA256 =
  '5794d3c86dc6bd154dbaa41d652d8329d6307f8b3ea87996db081d22da4e9cad';
export const MAX_COHORT_GAMES = 95;
export const MAX_DELETE_BATCH_ROWS = 20_000;
export const FROZEN_DELETION_ROWS = 1_153_754;
export const FROZEN_PROTECTED_ROWS = 58_292;
export const FROZEN_PULL_PAIRS = 386;
export const FROZEN_BATCH_COUNT = 63;
export const MANIFEST_SHA256 = '41f0e5a3c974851ef23170eb2664b907aa1ed242ab5c9637b31206ef1affbeea';

/** Whole games kept out of the first cohort. */
export const PROTECTED_FINAL_GAME_IDS = [21717855, 21717922, 21718094] as const;

export type PullFact = {
  gameId: number;
  pullRunId: number;
  gameStatus: string | null;
  sqlRows: number;
  nonOverUnderRows: number;
  archiveStatus: string | null;
  archiveKey: string | null;
  rowsArchived: number | null;
};

export type EligiblePull = {
  pullRunId: number;
  sqlRows: number;
  nonOverUnderRows: number;
  rowsArchived: number;
  archiveKey: string;
};

export type EligibleGame = {
  gameId: number;
  sqlRows: number;
  pulls: EligiblePull[];
};

export type ExcludedGame = {
  gameId: number;
  reason: string;
  sqlRows: number;
  pullRunIds: number[];
};

export type SnapshotReclamationManifest = {
  version: typeof SNAPSHOT_RECLAMATION_VERSION;
  backupId: typeof SNAPSHOT_RECLAMATION_BACKUP_ID;
  backupSha256: typeof SNAPSHOT_RECLAMATION_BACKUP_SHA256;
  maxCohortGames: typeof MAX_COHORT_GAMES;
  maxDeleteBatchRows: typeof MAX_DELETE_BATCH_ROWS;
  games: EligibleGame[];
  expectedDeleteRows: number;
  exclusions: ExcludedGame[];
};

export type DeletionBatch = {
  pulls: Array<{ gameId: number; pullRunId: number; sqlRows: number }>;
  expectedRows: number;
};

const FROZEN = new Set<number>(FROZEN_FINAL_GAME_IDS);
const OPEN = new Set<number>(FROZEN_OPEN_GAME_IDS);
const PROTECTED = new Set<number>(PROTECTED_FINAL_GAME_IDS);

function pullProblem(pull: PullFact): string | null {
  if (pull.gameStatus !== 'Final') return 'status_not_final';
  if (pull.archiveStatus !== 'archived' || pull.archiveKey == null || pull.archiveKey.trim() === '') {
    return 'archive_incomplete';
  }
  if (pull.rowsArchived == null || pull.rowsArchived !== pull.sqlRows) return 'count_mismatch';
  if (pull.sqlRows <= 0) return 'empty_pull';
  if (pull.nonOverUnderRows < 0 || pull.nonOverUnderRows > pull.sqlRows) return 'market_count_invalid';
  return null;
}

function exclusion(gameId: number, reason: string, pulls: readonly PullFact[]): ExcludedGame {
  return {
    gameId,
    reason,
    sqlRows: pulls.reduce((sum, pull) => sum + pull.sqlRows, 0),
    pullRunIds: pulls.map((pull) => pull.pullRunId).sort((a, b) => a - b),
  };
}

export function buildSnapshotReclamationManifest(pulls: readonly PullFact[]): SnapshotReclamationManifest {
  const byGame = new Map<number, PullFact[]>();
  for (const pull of pulls) {
    if (!Number.isSafeInteger(pull.gameId) || !Number.isSafeInteger(pull.pullRunId)) {
      throw new Error('pull_identity_invalid');
    }
    const list = byGame.get(pull.gameId) ?? [];
    if (list.some((item) => item.pullRunId === pull.pullRunId)) throw new Error('duplicate_pull');
    list.push(pull);
    byGame.set(pull.gameId, list);
  }

  const exclusions: ExcludedGame[] = [];
  const games: EligibleGame[] = [];

  for (const gameId of FROZEN_FINAL_GAME_IDS) {
    const gamePulls = byGame.get(gameId) ?? [];
    if (PROTECTED.has(gameId)) {
      exclusions.push(exclusion(gameId, 'protected_final_game', gamePulls));
      continue;
    }
    if (gamePulls.length === 0) {
      exclusions.push(exclusion(gameId, 'no_live_snapshots', gamePulls));
      continue;
    }
    const problems = [...new Set(gamePulls.map(pullProblem).filter((item): item is string => item != null))].sort();
    if (problems.length > 0) {
      exclusions.push(exclusion(gameId, problems.join('+'), gamePulls));
      continue;
    }
    const eligiblePulls = gamePulls
      .map((pull) => ({
        pullRunId: pull.pullRunId,
        sqlRows: pull.sqlRows,
        nonOverUnderRows: pull.nonOverUnderRows,
        rowsArchived: pull.rowsArchived ?? 0,
        archiveKey: pull.archiveKey ?? '',
      }))
      .sort((a, b) => a.pullRunId - b.pullRunId);
    games.push({
      gameId,
      sqlRows: eligiblePulls.reduce((sum, pull) => sum + pull.sqlRows, 0),
      pulls: eligiblePulls,
    });
  }

  for (const [gameId, gamePulls] of [...byGame.entries()].sort((a, b) => a[0] - b[0])) {
    if (FROZEN.has(gameId)) continue;
    const reason = OPEN.has(gameId) || PROTECTED.has(gameId) ? 'protected_open_or_named_game' : 'outside_frozen_cohort';
    exclusions.push(exclusion(gameId, reason, gamePulls));
  }

  if (games.length > MAX_COHORT_GAMES) throw new Error('cohort_exceeds_upper_bound');
  const expectedDeleteRows = games.reduce((sum, game) => sum + game.sqlRows, 0);
  return {
    version: SNAPSHOT_RECLAMATION_VERSION,
    backupId: SNAPSHOT_RECLAMATION_BACKUP_ID,
    backupSha256: SNAPSHOT_RECLAMATION_BACKUP_SHA256,
    maxCohortGames: MAX_COHORT_GAMES,
    maxDeleteBatchRows: MAX_DELETE_BATCH_ROWS,
    games,
    expectedDeleteRows,
    exclusions: exclusions.sort((a, b) => a.gameId - b.gameId),
  };
}

export function assertManifest(manifest: SnapshotReclamationManifest): void {
  if (manifest.version !== SNAPSHOT_RECLAMATION_VERSION) throw new Error('manifest_version_rejected');
  if (manifest.backupId !== SNAPSHOT_RECLAMATION_BACKUP_ID) throw new Error('manifest_backup_rejected');
  if (manifest.backupSha256 !== SNAPSHOT_RECLAMATION_BACKUP_SHA256) throw new Error('manifest_backup_rejected');
  if (manifest.games.length > MAX_COHORT_GAMES) throw new Error('cohort_exceeds_upper_bound');
  const seen = new Set<string>();
  let rows = 0;
  for (const game of manifest.games) {
    if (!FROZEN.has(game.gameId) || PROTECTED.has(game.gameId) || OPEN.has(game.gameId)) {
      throw new Error('manifest_game_rejected');
    }
    let gameRows = 0;
    for (const pull of game.pulls) {
      const key = `${game.gameId}:${pull.pullRunId}`;
      if (seen.has(key) || pull.sqlRows <= 0 || pull.rowsArchived !== pull.sqlRows || pull.archiveKey.trim() === '') {
        throw new Error('manifest_pull_rejected');
      }
      seen.add(key);
      gameRows += pull.sqlRows;
      rows += pull.sqlRows;
    }
    if (gameRows !== game.sqlRows) throw new Error('manifest_game_count_rejected');
  }
  if (rows !== manifest.expectedDeleteRows) throw new Error('manifest_total_rejected');
}

export function assertFrozenManifest(manifest: SnapshotReclamationManifest, fileSha256?: string): void {
  assertManifest(manifest);
  if (fileSha256 != null && fileSha256 !== MANIFEST_SHA256) throw new Error('manifest_hash_rejected');
  if (manifest.games.length !== MAX_COHORT_GAMES) throw new Error('manifest_game_count_rejected');
  const pulls = manifest.games.reduce((sum, game) => sum + game.pulls.length, 0);
  if (pulls !== FROZEN_PULL_PAIRS) throw new Error('manifest_pull_count_rejected');
  if (manifest.expectedDeleteRows !== FROZEN_DELETION_ROWS) throw new Error('manifest_total_rejected');
  const protectedRows = manifest.exclusions.reduce((sum, game) => sum + game.sqlRows, 0);
  if (protectedRows !== FROZEN_PROTECTED_ROWS) throw new Error('protected_rows_rejected');
  for (const gameId of PROTECTED_FINAL_GAME_IDS) {
    const found = manifest.exclusions.find((game) => game.gameId === gameId);
    if (found?.reason !== 'protected_final_game') throw new Error('protected_game_missing');
  }
  for (const gameId of FROZEN_OPEN_GAME_IDS) {
    if (!manifest.exclusions.some((game) => game.gameId === gameId)) throw new Error('protected_game_missing');
  }
  if (manifest.games.some((game) => PROTECTED.has(game.gameId) || OPEN.has(game.gameId))) {
    throw new Error('manifest_game_rejected');
  }
  const batches = planDeletionBatches(manifest);
  if (batches.length !== FROZEN_BATCH_COUNT) throw new Error('manifest_batch_count_rejected');
  if (batches.some((batch) => batch.expectedRows > MAX_DELETE_BATCH_ROWS || batch.expectedRows <= 0)) {
    throw new Error('batch_too_large');
  }
}

export function planDeletionBatches(manifest: SnapshotReclamationManifest): DeletionBatch[] {
  assertManifest(manifest);
  const batches: DeletionBatch[] = [];
  let current: DeletionBatch = { pulls: [], expectedRows: 0 };
  for (const game of manifest.games) {
    for (const pull of game.pulls) {
      if (pull.sqlRows > MAX_DELETE_BATCH_ROWS) throw new Error('pull_exceeds_batch');
      if (current.expectedRows + pull.sqlRows > MAX_DELETE_BATCH_ROWS && current.pulls.length > 0) {
        batches.push(current);
        current = { pulls: [], expectedRows: 0 };
      }
      current.pulls.push({ gameId: game.gameId, pullRunId: pull.pullRunId, sqlRows: pull.sqlRows });
      current.expectedRows += pull.sqlRows;
    }
  }
  if (current.pulls.length > 0) batches.push(current);
  const planned = batches.reduce((sum, batch) => sum + batch.expectedRows, 0);
  if (planned !== manifest.expectedDeleteRows) throw new Error('batch_total_rejected');
  return batches;
}

function valuesSql(batch: DeletionBatch): { values: string; params: number[] } {
  const params: number[] = [];
  const rows = batch.pulls.map((pull) => {
    params.push(pull.pullRunId, pull.gameId);
    const pullParam = params.length - 1;
    const gameParam = params.length;
    return `($${pullParam}::bigint, $${gameParam}::integer)`;
  });
  return { values: rows.join(', '), params };
}

export function deletionCountSql(batch: DeletionBatch): { text: string; params: number[] } {
  const { values, params } = valuesSql(batch);
  return {
    text: `SELECT count(*)::int AS n
  FROM raw.player_prop_snapshots_v2 AS t
  INNER JOIN (VALUES ${values}) AS allowed(pull_run_id, game_id)
    ON t.pull_run_id = allowed.pull_run_id
   AND t.game_id = allowed.game_id`,
    params,
  };
}

export function deletionSql(batch: DeletionBatch): { text: string; params: number[] } {
  const { values, params } = valuesSql(batch);
  const text = `DELETE FROM raw.player_prop_snapshots_v2 AS t
 USING (VALUES ${values}) AS allowed(pull_run_id, game_id)
 WHERE t.pull_run_id = allowed.pull_run_id
   AND t.game_id = allowed.game_id`;
  if (/status|Final/i.test(text)) throw new Error('unbounded_delete_rejected');
  return { text, params };
}
