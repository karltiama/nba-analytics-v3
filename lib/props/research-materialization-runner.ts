/**
 * Guarded per-game research materialization.
 * Dry-run is the default. This module does not open a connection by itself.
 * The filesystem-available-byte gate stays unverified. A dashboard record is a separate rule.
 */

import {
  MATERIALIZE_CLOSING_LINES_OBSERVED_SQL,
  MATERIALIZE_FIRST_SEEN_LINES_SQL,
} from '@/lib/prune/closing-lines';

const FROZEN_DELETION_OPERATION = 'a8aca536-5078-454e-a367-a497b9abd6f6';
const PROJECT_REF = 'mbubzxjglvhaxikdghqb';

function range(start: number, end: number): number[] {
  const values: number[] = [];
  for (let value = start; value <= end; value += 1) values.push(value);
  return values;
}

export const FROZEN_FINAL_GAME_IDS: readonly number[] = [
  21717855, 21717856, 21717857, 21717858, 21717859, 21717860, 21717861,
  21717922, 21717923, 21717924, 21717926, 21717927, 21717928, 21717929, 21717930, 21717931,
  ...range(21718012, 21718076),
  ...range(21718078, 21718094),
];

export const FROZEN_OPEN_GAME_IDS: readonly number[] = range(21718095, 21718103);

export const FROZEN_SOURCE_BASELINE = {
  clusterBytes: 1_176_416_433,
  snapshotRows: 1_212_046,
  decisionRows: 94_086,
  decisionRowsOnCohort: 0,
  firstSeenRows: 0,
  otherClocks: 0,
} as const;

/** Measured after the committed canary. Later games may grow the cluster above this. */
export const POST_CANARY_CLUSTER_BYTES = 1_176_670_385;
export const HISTORICAL_DECISION_ROWS = 94_086;
export const CANARY_GAME_ID = 21717856;
/** Phase 5F research-relation growth for the whole frozen cohort. */
export const COHORT_RESEARCH_RELATION_GROWTH_BYTES = 49_504_256;
/**
 * One multiple is the relation growth. The second covers production full-page
 * writes and commit records that the scratch measurement did not include.
 */
export const CLUSTER_GROWTH_LIMIT_BYTES = COHORT_RESEARCH_RELATION_GROWTH_BYTES * 2;

/** Phase 6E SQL snapshot rows for the committed canary. */
export const VERIFIED_SOURCE_OBSERVATIONS: Readonly<Record<number, number>> = {
  21717856: 2_018,
};

/**
 * Distinct pre-tip keys from the published scoped statements on the local
 * recovery copy. Closing and first-seen matched on every game. Sum is 87,894.
 */
export const EXPECTED_RESEARCH_ROWS: Readonly<Record<number, number>> = {
  21717855: 348, 21717856: 378, 21717857: 406, 21717858: 852, 21717859: 738, 21717860: 828, 21717861: 890,
  21717922: 862, 21717923: 810, 21717924: 804, 21717926: 852, 21717927: 786, 21717928: 882, 21717929: 850, 21717930: 858, 21717931: 708,
  21718012: 884, 21718013: 782, 21718014: 758, 21718015: 864, 21718016: 806, 21718017: 950, 21718018: 734, 21718019: 990, 21718020: 904,
  21718021: 814, 21718022: 918, 21718023: 1000, 21718024: 886, 21718025: 810, 21718026: 894, 21718027: 910, 21718028: 978, 21718029: 1072,
  21718030: 958, 21718031: 918, 21718032: 780, 21718033: 862, 21718034: 920, 21718035: 902, 21718036: 902, 21718037: 918, 21718038: 916,
  21718039: 790, 21718040: 960, 21718041: 968, 21718042: 940, 21718043: 1048, 21718044: 900, 21718045: 950, 21718046: 924, 21718047: 918,
  21718048: 1114, 21718049: 984, 21718050: 942, 21718051: 946, 21718052: 828, 21718053: 890, 21718054: 970, 21718055: 1024, 21718056: 926,
  21718057: 982, 21718058: 982, 21718059: 976, 21718060: 960, 21718061: 872, 21718062: 802, 21718063: 900, 21718064: 966, 21718065: 918,
  21718066: 982, 21718067: 846, 21718068: 880, 21718069: 978, 21718070: 616, 21718071: 982, 21718072: 1014, 21718073: 1040, 21718074: 1026,
  21718075: 904, 21718076: 988, 21718078: 1000, 21718079: 922, 21718080: 996, 21718081: 824, 21718082: 966, 21718083: 928, 21718084: 982,
  21718085: 962, 21718086: 1050, 21718087: 1078, 21718088: 770, 21718089: 1014, 21718090: 1002, 21718091: 944, 21718092: 910, 21718093: 984,
  21718094: 1044,
};

/** Six hours. A later execution must bring a newer dashboard reading. */
export const DASHBOARD_EVIDENCE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const UNUSED_TOLERANCE_GB = 0.05;
const UTILIZATION_TOLERANCE_POINTS = 0.5;
const COMPONENT_TOLERANCE_GB = 0.15;
const SAFETY_RESERVE_BYTES = 2_000_000_000;
const MINIMUM_LOWER_BOUND_BYTES = 1_000_000_000;

export type DashboardCapacityEvidence = {
  source: 'dashboard';
  observedAt: string;
  projectRef: string;
  totalDiskGb: number;
  databaseGb: number;
  walMb: number;
  systemMb: number;
  totalUsedGb: number;
  utilizationPercent: number;
  unusedDiskGb: number;
  fsAvailBytes: null;
};

export type CapacityAssessment = {
  filesystemAvailableBytes: 'unverified';
  alternativeGate: 'accepted' | 'refused';
  reason: string;
  lowerBoundBytes: number | null;
};

/** Direct Postgres only. The session-pooler hostname is not in this list. */
export const APPROVED_PRODUCTION_ENDPOINTS = [
  {
    method: 'direct' as const,
    projectRef: PROJECT_REF,
    host: 'db.mbubzxjglvhaxikdghqb.supabase.co',
    port: 5432,
    database: 'postgres',
    username: 'postgres',
    tls: 'require' as const,
  },
] as const;

export type DatabaseTarget =
  | {
      kind: 'production';
      method: 'direct';
      projectRef: string;
      host: string;
      port: number;
      database: string;
      username: string;
      tls: 'require';
    }
  | { kind: 'local-disposable'; host: string; port: number; database: string };

export type MaterializationMode = 'dry-run' | 'canary' | 'cohort';

export type SourceSnapshot = {
  clusterBytes: number;
  snapshotRows: number;
  decisionRows: number;
  decisionRowsOutsideCohort: number;
  decisionRowsOnCohort: number;
  firstSeenRows: number;
  otherClocks: number;
  cohortNotFinal: readonly number[];
  openNowFinal: readonly number[];
};

export type GameResearchCounts = {
  decisionRows: number;
  firstSeenRows: number;
  decisionRowsValid?: number;
  firstSeenRowsValid?: number;
};

export type ProgressLine = {
  gameId: number;
  statementNames: readonly ['MATERIALIZE_CLOSING_LINES_OBSERVED_SQL', 'MATERIALIZE_FIRST_SEEN_LINES_SQL'];
  closingRows: number;
  firstSeenRows: number;
  durationMs: number;
  committedAt: string;
  source: 'commit' | 'reconciled-existing';
};

export type RunnerTx = {
  query(sql: string, params?: readonly unknown[]): Promise<{ rowCount: number | null }>;
  commit(): Promise<'committed' | 'unknown'>;
  rollback(): Promise<void>;
};

export type RunnerDeps = {
  now(): Date;
  readBaseline(): Promise<SourceSnapshot>;
  readGameResearch(gameId: number): Promise<GameResearchCounts>;
  readGameSnapshotCount(gameId: number): Promise<number>;
  readClusterBytes(): Promise<number>;
  readEffectiveTempFileLimit(): Promise<string>;
  connect(): Promise<{ begin(): Promise<RunnerTx> }>;
  readProgress(): Promise<readonly ProgressLine[]>;
  appendProgress(line: ProgressLine): Promise<void>;
};

export type MaterializationRequest = {
  mode?: MaterializationMode;
  execute?: boolean;
  gameId?: number;
  target: DatabaseTarget;
  evidence: DashboardCapacityEvidence | null;
  ingestionTriggersDisabled: boolean;
  resumeOperationId?: string | null;
};

export type MaterializationReport = {
  mode: MaterializationMode;
  executed: boolean;
  status: 'dry-run' | 'completed' | 'refused' | 'stopped' | 'commit-unknown';
  reasons: string[];
  capacity: CapacityAssessment | null;
  games: number[];
  progress: ProgressLine[];
  effectiveTempFileLimit: string | null;
};

function finiteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function assessDashboardCapacity(
  evidence: DashboardCapacityEvidence | null,
  now: Date
): CapacityAssessment {
  const unverified = (reason: string): CapacityAssessment => ({
    filesystemAvailableBytes: 'unverified',
    alternativeGate: 'refused',
    reason,
    lowerBoundBytes: null,
  });
  if (evidence == null) return unverified('capacity_evidence_missing');
  if (evidence.source !== 'dashboard') return unverified('capacity_source_not_dashboard');
  if (evidence.fsAvailBytes !== null) return unverified('filesystem_bytes_not_measured');
  if (evidence.projectRef !== PROJECT_REF) return unverified('capacity_project_mismatch');
  const numbers = [
    evidence.totalDiskGb, evidence.databaseGb, evidence.walMb, evidence.systemMb,
    evidence.totalUsedGb, evidence.utilizationPercent, evidence.unusedDiskGb,
  ];
  if (numbers.some((value) => !finiteNonnegative(value)) || evidence.totalDiskGb <= 0) {
    return unverified('capacity_evidence_incomplete');
  }
  const observedAt = Date.parse(evidence.observedAt);
  if (!Number.isFinite(observedAt)) return unverified('capacity_timestamp_invalid');
  if (now.getTime() - observedAt > DASHBOARD_EVIDENCE_MAX_AGE_MS || observedAt > now.getTime() + 5 * 60 * 1000) {
    return unverified('capacity_evidence_stale');
  }
  const unusedFromParts = evidence.totalDiskGb - evidence.totalUsedGb;
  if (Math.abs(unusedFromParts - evidence.unusedDiskGb) > UNUSED_TOLERANCE_GB) {
    return unverified('capacity_unused_disagrees');
  }
  const utilizationFromParts = (evidence.totalUsedGb / evidence.totalDiskGb) * 100;
  if (Math.abs(utilizationFromParts - evidence.utilizationPercent) > UTILIZATION_TOLERANCE_POINTS) {
    return unverified('capacity_utilization_disagrees');
  }
  const componentGb = evidence.databaseGb + (evidence.walMb + evidence.systemMb) / 1000;
  if (Math.abs(componentGb - evidence.totalUsedGb) > COMPONENT_TOLERANCE_GB) {
    return unverified('capacity_components_disagree');
  }
  const lowerBoundBytes = Math.floor(evidence.unusedDiskGb * 1_000_000_000 - SAFETY_RESERVE_BYTES);
  if (lowerBoundBytes < MINIMUM_LOWER_BOUND_BYTES) {
    return {
      filesystemAvailableBytes: 'unverified',
      alternativeGate: 'refused',
      reason: 'dashboard_reserve_below_minimum',
      lowerBoundBytes,
    };
  }
  return {
    filesystemAvailableBytes: 'unverified',
    alternativeGate: 'accepted',
    reason: 'dashboard_reserve_accepted',
    lowerBoundBytes,
  };
}

export function assertDatabaseTarget(target: DatabaseTarget): string | null {
  if (target.kind === 'local-disposable') {
    if (target.host !== '127.0.0.1' || !Number.isInteger(target.port) || target.port <= 0) {
      return 'local_target_not_loopback';
    }
    return null;
  }
  if (target.kind !== 'production') return 'database_target_unknown';
  const match = APPROVED_PRODUCTION_ENDPOINTS.find((endpoint) =>
    endpoint.method === target.method
    && endpoint.projectRef === target.projectRef
    && endpoint.host === target.host
    && endpoint.port === target.port
    && endpoint.database === target.database
    && endpoint.username === target.username
    && endpoint.tls === target.tls
  );
  if (!match) return 'database_target_rejected';
  return null;
}

export function scopeObservedMaterializeSql(source: string, gameId: number): string {
  if (!Number.isSafeInteger(gameId) || !FROZEN_FINAL_GAME_IDS.includes(gameId)) {
    throw new Error('game id is outside the frozen cohort');
  }
  const needle = "WHERE g.status = 'Final'";
  if (!source.includes(needle) || !source.includes('ON CONFLICT')) {
    throw new Error('observed SQL shape changed');
  }
  return source.replace(needle, `${needle}\n      AND r.game_id = $1`);
}

export function sessionSettings(): readonly string[] {
  return [
    "SET LOCAL lock_timeout = '5s'",
    "SET LOCAL statement_timeout = '60s'",
    "SET LOCAL work_mem = '32MB'",
  ];
}

export function assertProgressPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('current_props_operations')) return 'progress_path_is_operation_ledger';
  if (normalized.includes('/nba-analytics-v3/')) return 'progress_path_inside_repo';
  return null;
}

export function continuationGameIds(): number[] {
  return FROZEN_FINAL_GAME_IDS.filter((id) => id !== CANARY_GAME_ID);
}

export function clusterGrowthReason(clusterBytes: number, continuationHasCommittedRows: boolean): string | null {
  if (!Number.isSafeInteger(clusterBytes) || clusterBytes < POST_CANARY_CLUSTER_BYTES) return 'cluster_bytes_changed';
  if (!continuationHasCommittedRows) {
    return clusterBytes === POST_CANARY_CLUSTER_BYTES ? null : 'cluster_bytes_changed';
  }
  if (clusterBytes - POST_CANARY_CLUSTER_BYTES > CLUSTER_GROWTH_LIMIT_BYTES) return 'cluster_growth_exceeded';
  return null;
}

function counted(raw: GameResearchCounts): Required<GameResearchCounts> {
  return {
    decisionRows: raw.decisionRows,
    firstSeenRows: raw.firstSeenRows,
    decisionRowsValid: raw.decisionRowsValid ?? raw.decisionRows,
    firstSeenRowsValid: raw.firstSeenRowsValid ?? raw.firstSeenRows,
  };
}

function researchProblem(gameId: number, raw: GameResearchCounts): string | null {
  const counts = counted(raw);
  const expected = EXPECTED_RESEARCH_ROWS[gameId];
  if (counts.decisionRows === 0 && counts.firstSeenRows === 0 && counts.decisionRowsValid === 0 && counts.firstSeenRowsValid === 0) {
    return null;
  }
  if ((counts.decisionRows === 0) !== (counts.firstSeenRows === 0)) return 'partial_research_rows';
  if (counts.decisionRows !== counts.firstSeenRows) return 'research_counts_unequal';
  if (counts.decisionRows !== expected) return 'incomplete_research_rows';
  if (counts.decisionRowsValid !== counts.decisionRows || counts.firstSeenRowsValid !== counts.firstSeenRows) return 'observation_clock_invalid';
  return null;
}

function isComplete(gameId: number, raw: GameResearchCounts): boolean {
  const counts = counted(raw);
  return researchProblem(gameId, counts) == null && counts.decisionRows === EXPECTED_RESEARCH_ROWS[gameId];
}

function sameBaseline(snapshot: SourceSnapshot, games: ReadonlyMap<number, GameResearchCounts>): string | null {
  if (snapshot.snapshotRows !== FROZEN_SOURCE_BASELINE.snapshotRows) return 'snapshot_rows_changed';
  if (snapshot.otherClocks !== FROZEN_SOURCE_BASELINE.otherClocks) return 'observation_clock_changed';
  if (snapshot.cohortNotFinal.length > 0) return 'cohort_status_changed';
  if (snapshot.openNowFinal.length > 0) return 'open_game_became_final';
  if (snapshot.decisionRowsOutsideCohort !== HISTORICAL_DECISION_ROWS) return 'decision_rows_changed';
  if (snapshot.decisionRows !== snapshot.decisionRowsOutsideCohort + snapshot.decisionRowsOnCohort) return 'decision_rows_changed';
  let decisionSum = 0;
  let firstSum = 0;
  let continuationComplete = false;
  for (const gameId of FROZEN_FINAL_GAME_IDS) {
    const counts = counted(games.get(gameId) ?? { decisionRows: 0, firstSeenRows: 0 });
    const problem = researchProblem(gameId, counts);
    if (problem) return problem;
    if (gameId === CANARY_GAME_ID && !isComplete(gameId, counts)) return 'canary_research_mismatch';
    decisionSum += counts.decisionRows;
    firstSum += counts.firstSeenRows;
    if (gameId !== CANARY_GAME_ID && isComplete(gameId, counts)) continuationComplete = true;
  }
  if (snapshot.decisionRowsOnCohort !== decisionSum) return 'cohort_decision_rows_changed';
  if (snapshot.firstSeenRows !== firstSum) return 'first_seen_rows_changed';
  return clusterGrowthReason(snapshot.clusterBytes, continuationComplete);
}

function selectGames(input: MaterializationRequest, mode: MaterializationMode): { games: number[]; reason: string | null } {
  if (mode === 'dry-run') return { games: [], reason: null };
  if (mode === 'canary') {
    if (input.gameId == null || !FROZEN_FINAL_GAME_IDS.includes(input.gameId)) {
      return { games: [], reason: 'canary_game_not_frozen' };
    }
    return { games: [input.gameId], reason: null };
  }
  if (input.gameId != null) return { games: [], reason: 'cohort_mode_cannot_narrow_or_widen' };
  return { games: continuationGameIds(), reason: null };
}

async function rollbackQuietly(tx: RunnerTx): Promise<void> {
  try {
    await tx.rollback();
  } catch {
    // The commit outcome is already unknown or the statement failed. Keep the original stop reason.
  }
}

async function readPersistedResearch(deps: RunnerDeps, gameId: number): Promise<GameResearchCounts> {
  try {
    return await deps.readGameResearch(gameId);
  } catch {
    return { decisionRows: -1, firstSeenRows: -1, decisionRowsValid: -1, firstSeenRowsValid: -1 };
  }
}

export async function runResearchMaterialization(
  input: MaterializationRequest,
  deps: RunnerDeps
): Promise<MaterializationReport> {
  const mode = input.mode ?? 'dry-run';
  const reasons: string[] = [];
  if (input.execute === true && mode === 'dry-run') reasons.push('execute_requires_canary_or_cohort');
  const capacity = assessDashboardCapacity(input.evidence, deps.now());
  if (capacity.alternativeGate !== 'accepted') reasons.push(capacity.reason);
  const targetReason = assertDatabaseTarget(input.target);
  if (targetReason) reasons.push(targetReason);
  if (input.ingestionTriggersDisabled !== true) reasons.push('ingestion_not_confirmed_disabled');
  if (input.resumeOperationId != null && input.resumeOperationId !== '') {
    reasons.push(input.resumeOperationId === FROZEN_DELETION_OPERATION ? 'frozen_deletion_resume_refused' : 'unexpected_operation_resume');
  }
  const selected = selectGames(input, mode);
  if (selected.reason) reasons.push(selected.reason);
  if (reasons.length > 0) {
    return { mode, executed: false, status: 'refused', reasons, capacity, games: [], progress: [], effectiveTempFileLimit: null };
  }

  const baseline = await deps.readBaseline();
  const games = new Map<number, GameResearchCounts>();
  for (const gameId of FROZEN_FINAL_GAME_IDS) games.set(gameId, await deps.readGameResearch(gameId));
  const baselineReason = sameBaseline(baseline, games);
  if (baselineReason) {
    return { mode, executed: false, status: 'refused', reasons: [baselineReason], capacity, games: [], progress: [], effectiveTempFileLimit: null };
  }
  if (mode === 'dry-run' || input.execute !== true) {
    return { mode, executed: false, status: 'dry-run', reasons: [], capacity, games: selected.games, progress: [], effectiveTempFileLimit: null };
  }

  const progress = [...await deps.readProgress()];
  const progressReason = conflictingProgress(progress, games);
  if (progressReason) {
    return { mode, executed: false, status: 'refused', reasons: [progressReason], capacity, games: [], progress, effectiveTempFileLimit: null };
  }
  const recorded = new Set(progress.map((line) => line.gameId));
  const effectiveTempFileLimit = await deps.readEffectiveTempFileLimit();
  const sourceObservations = await deps.readGameSnapshotCount(CANARY_GAME_ID);
  if (sourceObservations !== VERIFIED_SOURCE_OBSERVATIONS[CANARY_GAME_ID]) {
    return { mode, executed: true, status: 'stopped', reasons: ['source_observations_changed'], capacity, games: [CANARY_GAME_ID], progress, effectiveTempFileLimit };
  }
  for (const gameId of FROZEN_FINAL_GAME_IDS) {
    if (!isComplete(gameId, games.get(gameId) ?? { decisionRows: 0, firstSeenRows: 0 }) || recorded.has(gameId)) continue;
    const counts = counted(games.get(gameId) ?? { decisionRows: 0, firstSeenRows: 0 });
    const line: ProgressLine = {
      gameId,
      statementNames: ['MATERIALIZE_CLOSING_LINES_OBSERVED_SQL', 'MATERIALIZE_FIRST_SEEN_LINES_SQL'],
      closingRows: counts.decisionRows,
      firstSeenRows: counts.firstSeenRows,
      durationMs: 0,
      committedAt: deps.now().toISOString(),
      source: 'reconciled-existing',
    };
    await deps.appendProgress(line);
    progress.push(line);
    recorded.add(gameId);
  }

  const pending = selected.games.filter((gameId) => gameId !== CANARY_GAME_ID && !isComplete(gameId, games.get(gameId) ?? { decisionRows: 0, firstSeenRows: 0 }));
  if (pending.length === 0) {
    return { mode, executed: true, status: 'completed', reasons: [], capacity, games: selected.games, progress, effectiveTempFileLimit };
  }
  const db = await deps.connect();
  let inserted = 0;
  for (const gameId of pending) {
    const clusterBytes = await deps.readClusterBytes();
    const growth = clusterGrowthReason(clusterBytes, inserted > 0 || continuationAlreadyComplete(games));
    if (growth) {
      return { mode, executed: true, status: 'stopped', reasons: [growth], capacity, games: [gameId], progress, effectiveTempFileLimit };
    }
    let tx: RunnerTx | null = null;
    const started = Date.now();
    const expected = EXPECTED_RESEARCH_ROWS[gameId];
    try {
      tx = await db.begin();
      for (const statement of sessionSettings()) await tx.query(statement);
      const closing = await tx.query(scopeObservedMaterializeSql(MATERIALIZE_CLOSING_LINES_OBSERVED_SQL, gameId), [gameId]);
      if ((closing.rowCount ?? 0) !== expected) {
        await rollbackQuietly(tx);
        tx = null;
        return { mode, executed: true, status: 'stopped', reasons: ['research_count_mismatch'], capacity, games: [gameId], progress, effectiveTempFileLimit };
      }
      const first = await tx.query(scopeObservedMaterializeSql(MATERIALIZE_FIRST_SEEN_LINES_SQL, gameId), [gameId]);
      if ((first.rowCount ?? 0) !== expected) {
        await rollbackQuietly(tx);
        tx = null;
        return { mode, executed: true, status: 'stopped', reasons: ['research_count_mismatch'], capacity, games: [gameId], progress, effectiveTempFileLimit };
      }
      let outcome: 'committed' | 'unknown';
      try {
        outcome = await tx.commit();
      } catch {
        return { mode, executed: true, status: 'commit-unknown', reasons: ['commit_outcome_unknown'], capacity, games: [gameId], progress, effectiveTempFileLimit };
      }
      if (outcome !== 'committed') {
        return { mode, executed: true, status: 'commit-unknown', reasons: ['commit_outcome_unknown'], capacity, games: [gameId], progress, effectiveTempFileLimit };
      }
      tx = null;
    } catch {
      if (tx) await rollbackQuietly(tx);
      return { mode, executed: true, status: 'stopped', reasons: ['statement_failed'], capacity, games: [gameId], progress, effectiveTempFileLimit };
    }
    const persisted = await readPersistedResearch(deps, gameId);
    if (!isComplete(gameId, persisted)) {
      return { mode, executed: true, status: 'stopped', reasons: ['persisted_research_mismatch'], capacity, games: [gameId], progress, effectiveTempFileLimit };
    }
    const line: ProgressLine = {
      gameId,
      statementNames: ['MATERIALIZE_CLOSING_LINES_OBSERVED_SQL', 'MATERIALIZE_FIRST_SEEN_LINES_SQL'],
      closingRows: expected,
      firstSeenRows: expected,
      durationMs: Date.now() - started,
      committedAt: deps.now().toISOString(),
      source: 'commit',
    };
    await deps.appendProgress(line);
    progress.push(line);
    inserted += 1;
  }
  return { mode, executed: true, status: 'completed', reasons: [], capacity, games: selected.games, progress, effectiveTempFileLimit };
}

function continuationAlreadyComplete(games: ReadonlyMap<number, GameResearchCounts>): boolean {
  return continuationGameIds().some((gameId) => isComplete(gameId, games.get(gameId) ?? { decisionRows: 0, firstSeenRows: 0 }));
}

function conflictingProgress(lines: readonly ProgressLine[], games: ReadonlyMap<number, GameResearchCounts>): string | null {
  const seen = new Map<number, ProgressLine>();
  for (const line of lines) {
    if (!FROZEN_FINAL_GAME_IDS.includes(line.gameId)) return 'conflicting_progress';
    const expected = EXPECTED_RESEARCH_ROWS[line.gameId];
    if (line.closingRows !== expected || line.firstSeenRows !== expected) return 'conflicting_progress';
    const prior = seen.get(line.gameId);
    if (prior && (prior.closingRows !== line.closingRows || prior.firstSeenRows !== line.firstSeenRows)) return 'conflicting_progress';
    seen.set(line.gameId, line);
    const counts = games.get(line.gameId) ?? { decisionRows: 0, firstSeenRows: 0 };
    if (!isComplete(line.gameId, counts)) return 'progress_without_rows';
  }
  return null;
}

export function parseMaterializationArgs(argv: readonly string[]): {
  mode: MaterializationMode;
  execute: boolean;
  gameId: number | null;
  targetKind: 'production' | 'local-disposable' | null;
  ingestionDisabled: boolean;
  evidencePath: string | null;
  progressPath: string | null;
  reasons: string[];
} {
  let mode: MaterializationMode = 'dry-run';
  let execute = false;
  let gameId: number | null = null;
  let targetKind: 'production' | 'local-disposable' | null = null;
  let ingestionDisabled = false;
  let evidencePath: string | null = null;
  let progressPath: string | null = null;
  const reasons: string[] = [];
  for (const arg of argv) {
    if (arg === '--execute') execute = true;
    else if (arg === '--mode=dry-run') mode = 'dry-run';
    else if (arg === '--mode=canary') mode = 'canary';
    else if (arg === '--mode=cohort') mode = 'cohort';
    else if (arg === '--target=production') targetKind = 'production';
    else if (arg === '--target=local') targetKind = 'local-disposable';
    else if (arg === '--ingestion-disabled') ingestionDisabled = true;
    else if (arg.startsWith('--game=')) gameId = Number(arg.slice('--game='.length));
    else if (arg.startsWith('--evidence=')) evidencePath = arg.slice('--evidence='.length);
    else if (arg.startsWith('--progress=')) progressPath = arg.slice('--progress='.length);
    else reasons.push('unknown_argument');
  }
  if (execute && mode === 'dry-run') reasons.push('execute_requires_canary_or_cohort');
  if (mode === 'canary' && (gameId == null || !Number.isSafeInteger(gameId))) reasons.push('canary_requires_game');
  if (execute && targetKind == null) reasons.push('target_required');
  if (execute && !ingestionDisabled) reasons.push('ingestion_not_confirmed_disabled');
  if (execute && !evidencePath) reasons.push('evidence_required');
  if (execute && !progressPath) reasons.push('progress_required');
  if (progressPath) {
    const pathReason = assertProgressPath(progressPath);
    if (pathReason) reasons.push(pathReason);
  }
  return { mode, execute, gameId, targetKind, ingestionDisabled, evidencePath, progressPath, reasons };
}
