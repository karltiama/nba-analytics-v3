/**
 * Fail-safe environment gates for destructive props pruning.
 *
 * Missing / malformed flags deny mutations. Never default DATA_MODE to live_api.
 */

export type ExplicitTriState = '1' | '0' | 'missing' | 'invalid';

export type PruneEnvSnapshot = {
  pruneEnabled: ExplicitTriState;
  dataMode: string | null;
  offseasonMode: ExplicitTriState;
  cronDryRun: ExplicitTriState;
  pruneMaxDeletePercent: number;
  pruneMaxDeleteRows: number;
  pruneAllowLargeDelete: boolean;
};

export type GateDecision = {
  allowed: boolean;
  reason: string;
  snapshot: PruneEnvSnapshot;
};

const DEFAULT_MAX_DELETE_PERCENT = 35;
const DEFAULT_MAX_DELETE_ROWS = 200_000;

export function parseExplicitFlag(raw: string | undefined): ExplicitTriState {
  if (raw === undefined || raw.trim() === '') return 'missing';
  const v = raw.trim();
  if (v === '1' || v === '0') return v;
  return 'invalid';
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function readPruneEnvSnapshot(
  env: Record<string, string | undefined> = process.env
): PruneEnvSnapshot {
  const dataModeRaw = env.DATA_MODE;
  return {
    pruneEnabled: parseExplicitFlag(env.PRUNE_ENABLED),
    dataMode:
      dataModeRaw === undefined || dataModeRaw.trim() === ''
        ? null
        : dataModeRaw.trim().toLowerCase(),
    offseasonMode: parseExplicitFlag(env.OFFSEASON_MODE),
    cronDryRun: parseExplicitFlag(env.CRON_DRY_RUN),
    pruneMaxDeletePercent: parsePositiveInt(
      env.PRUNE_MAX_DELETE_PERCENT,
      DEFAULT_MAX_DELETE_PERCENT
    ),
    pruneMaxDeleteRows: parsePositiveInt(
      env.PRUNE_MAX_DELETE_ROWS,
      DEFAULT_MAX_DELETE_ROWS
    ),
    pruneAllowLargeDelete: env.PRUNE_ALLOW_LARGE_DELETE === '1',
  };
}

/**
 * Non-destructive closing-line materialization may run only with explicit live flags.
 * Does not require PRUNE_ENABLED.
 */
export function evaluateMaterializeGate(
  env: Record<string, string | undefined> = process.env
): GateDecision {
  const snapshot = readPruneEnvSnapshot(env);
  if (snapshot.dataMode === null) {
    return {
      allowed: false,
      reason: 'DATA_MODE is missing; refusing materialize (fail-safe)',
      snapshot,
    };
  }
  if (snapshot.dataMode !== 'live_api') {
    return {
      allowed: false,
      reason: `DATA_MODE=${snapshot.dataMode}; materialize requires live_api`,
      snapshot,
    };
  }
  if (snapshot.offseasonMode !== '0') {
    return {
      allowed: false,
      reason: `OFFSEASON_MODE must be explicitly 0 (got ${snapshot.offseasonMode})`,
      snapshot,
    };
  }
  if (snapshot.cronDryRun !== '0') {
    return {
      allowed: false,
      reason: `CRON_DRY_RUN must be explicitly 0 (got ${snapshot.cronDryRun})`,
      snapshot,
    };
  }
  return { allowed: true, reason: 'materialize permitted', snapshot };
}

/**
 * Destructive prune requires explicit PRUNE_ENABLED=1 plus live/in-season/non-dry-run.
 */
export function evaluateDestructivePruneGate(
  env: Record<string, string | undefined> = process.env
): GateDecision {
  const snapshot = readPruneEnvSnapshot(env);
  if (snapshot.pruneEnabled !== '1') {
    return {
      allowed: false,
      reason: `PRUNE_ENABLED must be explicitly 1 (got ${snapshot.pruneEnabled})`,
      snapshot,
    };
  }
  const materialize = evaluateMaterializeGate(env);
  if (!materialize.allowed) {
    return {
      allowed: false,
      reason: materialize.reason,
      snapshot,
    };
  }
  return { allowed: true, reason: 'destructive prune permitted', snapshot };
}

export const PRUNE_ENV_DEFAULTS = {
  maxDeletePercent: DEFAULT_MAX_DELETE_PERCENT,
  maxDeleteRows: DEFAULT_MAX_DELETE_ROWS,
} as const;
