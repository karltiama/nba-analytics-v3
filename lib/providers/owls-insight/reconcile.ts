import { readOwlsEnvelope, type OwlsObjectStore } from './archive';
import type { CheckpointState } from './checkpoint';
import type { ReconcileReport } from './types';

export async function reconcileOwlsPropBackfill(args: {
  runId: string;
  state: CheckpointState | null;
  store: OwlsObjectStore;
}): Promise<ReconcileReport> {
  const missing: string[] = [];
  const checksumMismatch: string[] = [];
  const failedPages: string[] = [];
  const incompleteGames = new Set<string>();
  const expectedKeys: string[] = [];

  if (!args.state) {
    return {
      run_id: args.runId,
      expected_objects: 0,
      actual_objects: 0,
      missing: [`checkpoint missing for ${args.runId}`],
      checksum_mismatch: [],
      failed_pages: [],
      incomplete_games: [],
      ok: false,
    };
  }

  for (const unit of Object.values(args.state.units)) {
    if (unit.status === 'FAILED') {
      failedPages.push(unit.unit_id);
      if (unit.court_context_game_id) incompleteGames.add(unit.court_context_game_id);
      continue;
    }
    if (unit.status === 'SKIPPED' || unit.status === 'PENDING' || unit.status === 'FETCHING') {
      if (unit.status !== 'SKIPPED' && unit.court_context_game_id) {
        incompleteGames.add(unit.court_context_game_id);
      }
      continue;
    }
    if (!unit.archive_key) {
      missing.push(unit.unit_id);
      if (unit.court_context_game_id) incompleteGames.add(unit.court_context_game_id);
      continue;
    }
    expectedKeys.push(unit.archive_key);
    try {
      const envelope = await readOwlsEnvelope(args.store, unit.archive_key);
      if (unit.checksum && envelope.checksum !== unit.checksum) {
        checksumMismatch.push(unit.archive_key);
      }
    } catch {
      missing.push(unit.archive_key);
    }
  }

  const ok =
    missing.length === 0 &&
    checksumMismatch.length === 0 &&
    failedPages.length === 0 &&
    incompleteGames.size === 0;
  return {
    run_id: args.runId,
    expected_objects: expectedKeys.length,
    actual_objects: expectedKeys.length - missing.filter((m) => expectedKeys.includes(m)).length,
    missing,
    checksum_mismatch: checksumMismatch,
    failed_pages: failedPages,
    incomplete_games: [...incompleteGames],
    ok,
  };
}

export async function reconcileOwlsClosingOddsBackfill(args: {
  runId: string;
  state: CheckpointState | null;
  store: OwlsObjectStore;
  universeGameIds?: string[];
}): Promise<ReconcileReport> {
  const base = await reconcileOwlsPropBackfill(args);
  if (!args.state) return base;
  const incomplete = new Set(base.incomplete_games);
  const failedPages = [...base.failed_pages];
  for (const [cc, acq] of Object.entries(args.state.game_acquisition ?? {})) {
    if (acq.state === 'REQUEST_FAILED' || acq.state === 'ARCHIVE_FAILED') {
      incomplete.add(cc);
      failedPages.push(`${acq.state}:${cc}`);
    }
  }
  if (args.universeGameIds) {
    for (const id of args.universeGameIds) {
      if (!args.state.game_acquisition?.[id]) incomplete.add(id);
    }
  }
  const ok = base.missing.length === 0 && base.checksum_mismatch.length === 0 && failedPages.length === 0 && incomplete.size === 0;
  return {
    ...base,
    failed_pages: failedPages,
    incomplete_games: [...incomplete],
    ok,
  };
}
