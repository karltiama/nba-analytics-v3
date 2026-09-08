/**
 * Read-only trial storage stop rules. Consumes checkpoint JSON written by
 * scripts/ops/storage-checkpoint.ts. Never prune/vacuum.
 */

export const AFTER_2024_MAX_DB_MB = 340;
export const AFTER_2024_MAX_DELTA_MB = 35;
export const GLOBAL_HARD_STOP_MB = 450;

export type TrialStoragePhase = 'after-2024' | 'after-2023' | 'global' | 'materialize-2022';

export type StorageCheckpointLike = {
  label?: string;
  postgres?: {
    bytes?: number;
    mb?: number;
  };
};

export type TrialStorageGateResult = {
  ok: boolean;
  phase: TrialStoragePhase;
  previousMb: number | null;
  currentMb: number;
  deltaMb: number | null;
  failures: string[];
};

function checkpointMb(doc: StorageCheckpointLike): number {
  if (typeof doc.postgres?.mb === 'number' && Number.isFinite(doc.postgres.mb)) {
    return doc.postgres.mb;
  }
  const bytes = doc.postgres?.bytes;
  if (typeof bytes === 'number' && Number.isFinite(bytes)) {
    return Math.round((bytes / (1024 * 1024)) * 100) / 100;
  }
  throw new Error('Checkpoint JSON missing postgres.bytes / postgres.mb');
}

export function evaluateTrialStorageGate(args: {
  phase: TrialStoragePhase;
  previous: StorageCheckpointLike | null;
  current: StorageCheckpointLike;
}): TrialStorageGateResult {
  const currentMb = checkpointMb(args.current);
  const previousMb = args.previous ? checkpointMb(args.previous) : null;
  const deltaMb =
    previousMb != null ? Math.round((currentMb - previousMb) * 100) / 100 : null;
  const failures: string[] = [];

  if (currentMb >= GLOBAL_HARD_STOP_MB) {
    failures.push(`Global hard stop: DB ${currentMb} MB >= ${GLOBAL_HARD_STOP_MB} MB`);
  }

  if (args.phase === 'materialize-2022') {
    failures.push('2022 Postgres materialization is prohibited (S3-archive-only by default).');
  }

  if (args.phase === 'after-2024') {
    if (currentMb > AFTER_2024_MAX_DB_MB) {
      failures.push(`After 2024: DB ${currentMb} MB > ${AFTER_2024_MAX_DB_MB} MB`);
    }
    if (deltaMb != null && deltaMb > AFTER_2024_MAX_DELTA_MB) {
      failures.push(`After 2024: delta ${deltaMb} MB > ${AFTER_2024_MAX_DELTA_MB} MB`);
    }
  }

  return {
    ok: failures.length === 0,
    phase: args.phase,
    previousMb,
    currentMb,
    deltaMb,
    failures,
  };
}

export function parseTrialStoragePhase(raw: string | undefined): TrialStoragePhase {
  const v = (raw ?? '').trim();
  if (v === 'after-2024' || v === 'after-2023' || v === 'global' || v === 'materialize-2022') {
    return v;
  }
  throw new Error('Missing or invalid --phase=after-2024|after-2023|global|materialize-2022');
}
