/**
 * As-of helpers for 2026–27 context collection.
 * Collector wiring lives behind existing freeze flags. These functions do not
 * enable schedules or call providers by themselves.
 */

export const CONTEXT_COLLECTION_SPEC_VERSION = 'context-collection-asof-r1';

export const COLLECTION_HEALTH = [
  'ok',
  'degraded_failed_latest',
  'incomplete_latest',
  'frozen',
  'not_started',
] as const;
export type CollectionHealth = (typeof COLLECTION_HEALTH)[number];

export const REPORT_MEMBERSHIP = [
  'in_report',
  'removed_from_report',
  'not_in_report',
  'unknown',
] as const;
export type ReportMembership = (typeof REPORT_MEMBERSHIP)[number];

export const FRESHNESS_CLASS = ['fresh', 'stale', 'unknown'] as const;
export type FreshnessClass = (typeof FRESHNESS_CLASS)[number];

export const GAME_LINK_PROVENANCE = [
  'none',
  'scheduled_slate_join',
  'provider_game_id',
  'inferred_team_date',
] as const;
export type GameLinkProvenance = (typeof GAME_LINK_PROVENANCE)[number];

export type InjuryObservation = {
  playerId: string;
  providerStatus: string | null;
  description: string | null;
  returnDateRaw: string | null;
  teamId: string | null;
  /** When our system observed the payload. */
  observedAt: string;
  /** Provider publication time when present. Never inferred from observedAt. */
  sourcePublishedAt: string | null;
  pullRunId: number;
  reportMembership: ReportMembership;
  gameId: string | null;
  gameLinkProvenance: GameLinkProvenance;
};

export type InjuryPullRun = {
  pullRunId: number;
  observedAt: string;
  status: 'success' | 'error' | 'started';
  complete: boolean;
  completenessReason: string;
  memberPlayerIds: string[];
};

export type InjuryAsOf = {
  playerId: string;
  providerStatus: string | null;
  reportMembership: ReportMembership;
  collectionHealth: CollectionHealth;
  freshnessClass: FreshnessClass;
  observedAt: string | null;
  sourcePublishedAt: string | null;
  observationAgeMs: number | null;
  gameId: string | null;
  gameLinkProvenance: GameLinkProvenance;
  lastSuccessfulPullRunId: number | null;
  latestPullFailed: boolean;
};

export const LINEUP_SOURCE_KIND = [
  'heuristic_projected',
  'provider_projected',
  'provider_post_tip_confirmed',
] as const;
export type LineupSourceKind = (typeof LINEUP_SOURCE_KIND)[number];

export const LINEUP_SNAPSHOT_COMPLETENESS = ['complete_starters', 'partial', 'empty', 'failed'] as const;
export type LineupSnapshotCompleteness = (typeof LINEUP_SNAPSHOT_COMPLETENESS)[number];

export type LineupPlayerSlot = {
  playerId: string;
  role: 'projected_starter' | 'confirmed_starter' | 'listed_bench' | 'inactive' | 'unknown';
};

export type LineupSnapshot = {
  snapshotId: string;
  gameId: string;
  teamId: string;
  sourceKind: LineupSourceKind;
  observedAt: string;
  sourcePublishedAt: string | null;
  players: LineupPlayerSlot[];
  expectedStarters: number;
};

export type LineupSnapshotIdentity = {
  snapshotId: string;
  gameId: string;
  teamId: string;
  sourceKind: LineupSourceKind;
  completeness: LineupSnapshotCompleteness;
  starterCount: number;
  playerCount: number;
};

export type PredictionSnapshotInput = {
  playerId: string;
  gameId: string;
  scheduledTipoff: string;
  intendedCutoffAt: string;
  generatedAt: string;
  modelVersion: string;
  featureSpecVersion: string;
  featureValues?: Record<string, number | null>;
  featureRef?: string | null;
  predictions: Record<string, number | null>;
};

export type PredictionSnapshot = PredictionSnapshotInput & {
  late: boolean;
  /** Always the real generation clock. Never rewritten to intendedCutoffAt. */
  actualGeneratedAt: string;
  freshness: {
    generatedAfterCutoff: boolean;
    minutesLate: number | null;
  };
};

export function observationAgeMs(observedAt: string | null, asOf: string): number | null {
  if (!observedAt) return null;
  const a = Date.parse(observedAt);
  const b = Date.parse(asOf);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return b - a;
}

export function classifyFreshness(ageMs: number | null, freshWithinMs: number): FreshnessClass {
  if (ageMs == null || !Number.isFinite(ageMs) || ageMs < 0) return 'unknown';
  return ageMs <= freshWithinMs ? 'fresh' : 'stale';
}

/**
 * Failed/incomplete latest pull keeps the last successful observation.
 * Does not invent Available/healthy and does not drop previous evidence.
 */
export function resolveInjuryAsOf(args: {
  playerId: string;
  cutoffAt: string;
  runs: InjuryPullRun[];
  observations: InjuryObservation[];
  frozen?: boolean;
  freshWithinMs?: number;
}): InjuryAsOf {
  const empty = (health: CollectionHealth, latestPullFailed: boolean): InjuryAsOf => ({
    playerId: args.playerId,
    providerStatus: null,
    reportMembership: 'unknown',
    collectionHealth: health,
    freshnessClass: 'unknown',
    observedAt: null,
    sourcePublishedAt: null,
    observationAgeMs: null,
    gameId: null,
    gameLinkProvenance: 'none',
    lastSuccessfulPullRunId: null,
    latestPullFailed,
  });

  if (args.frozen) return empty('frozen', false);
  if (args.runs.length === 0) return empty('not_started', false);

  const cutoffMs = Date.parse(args.cutoffAt);
  const runsBefore = args.runs
    .filter((r) => Number.isFinite(Date.parse(r.observedAt)) && Date.parse(r.observedAt) <= cutoffMs)
    .sort((a, b) => a.pullRunId - b.pullRunId);
  if (runsBefore.length === 0) return empty('not_started', false);

  const latest = runsBefore[runsBefore.length - 1];
  const successfulComplete = [...runsBefore].reverse().find((r) => r.status === 'success' && r.complete);
  const latestFailed = latest.status === 'error' || (latest.status === 'success' && !latest.complete);
  const health: CollectionHealth = !successfulComplete
    ? latestFailed
      ? 'degraded_failed_latest'
      : 'not_started'
    : latestFailed
      ? latest.status === 'error'
        ? 'degraded_failed_latest'
        : 'incomplete_latest'
      : 'ok';

  if (!successfulComplete) {
    return {
      ...empty(health, latestFailed),
      lastSuccessfulPullRunId: null,
    };
  }

  const members = new Set(successfulComplete.memberPlayerIds.map(String));
  const obs = args.observations
    .filter(
      (o) =>
        o.playerId === args.playerId &&
        o.pullRunId === successfulComplete.pullRunId &&
        Date.parse(o.observedAt) <= cutoffMs
    )
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];

  const inMembership = members.has(args.playerId);
  const age = observationAgeMs(obs?.observedAt ?? successfulComplete.observedAt, args.cutoffAt);
  const freshWithinMs = args.freshWithinMs ?? 36 * 60 * 60 * 1000;

  if (obs) {
    return {
      playerId: args.playerId,
      providerStatus: obs.providerStatus,
      reportMembership: obs.reportMembership,
      collectionHealth: health,
      freshnessClass: classifyFreshness(age, freshWithinMs),
      observedAt: obs.observedAt,
      sourcePublishedAt: obs.sourcePublishedAt,
      observationAgeMs: age,
      gameId: obs.gameId,
      gameLinkProvenance: obs.gameLinkProvenance,
      lastSuccessfulPullRunId: successfulComplete.pullRunId,
      latestPullFailed: latestFailed,
    };
  }

  return {
    playerId: args.playerId,
    providerStatus: null,
    reportMembership: inMembership ? 'in_report' : 'not_in_report',
    collectionHealth: health,
    freshnessClass: classifyFreshness(age, freshWithinMs),
    observedAt: successfulComplete.observedAt,
    sourcePublishedAt: null,
    observationAgeMs: age,
    gameId: null,
    gameLinkProvenance: 'none',
    lastSuccessfulPullRunId: successfulComplete.pullRunId,
    latestPullFailed: latestFailed,
  };
}

export function lineupSnapshotIdentity(snapshot: LineupSnapshot): LineupSnapshotIdentity {
  const starters = snapshot.players.filter(
    (p) => p.role === 'projected_starter' || p.role === 'confirmed_starter'
  ).length;
  let completeness: LineupSnapshotCompleteness = 'empty';
  if (snapshot.players.length === 0) completeness = 'empty';
  else if (starters >= snapshot.expectedStarters) completeness = 'complete_starters';
  else completeness = 'partial';
  return {
    snapshotId: snapshot.snapshotId,
    gameId: snapshot.gameId,
    teamId: snapshot.teamId,
    sourceKind: snapshot.sourceKind,
    completeness,
    starterCount: starters,
    playerCount: snapshot.players.length,
  };
}

export function isHeuristicLineup(kind: LineupSourceKind): boolean {
  return kind === 'heuristic_projected';
}

export function isPostTipConfirmedLineup(kind: LineupSourceKind): boolean {
  return kind === 'provider_post_tip_confirmed';
}

/** BDL lineups in this repo are post-tip. They are not pregame provider knowledge. */
export function isPregameLineupKnowledge(kind: LineupSourceKind): boolean {
  return kind === 'provider_projected';
}

/**
 * Records the real generation clock. A late job stays late; cutoff is not rewritten.
 */
export function buildPredictionSnapshot(input: PredictionSnapshotInput): PredictionSnapshot {
  const generatedMs = Date.parse(input.generatedAt);
  const cutoffMs = Date.parse(input.intendedCutoffAt);
  const late = Number.isFinite(generatedMs) && Number.isFinite(cutoffMs) && generatedMs > cutoffMs;
  const minutesLate =
    late && Number.isFinite(generatedMs) && Number.isFinite(cutoffMs)
      ? (generatedMs - cutoffMs) / 60_000
      : late
        ? null
        : 0;
  return {
    ...input,
    actualGeneratedAt: input.generatedAt,
    late,
    freshness: {
      generatedAfterCutoff: late,
      minutesLate,
    },
  };
}

export function intendedCutoffFromTip(scheduledTipoff: string, minutesBefore = 60): string {
  const ms = Date.parse(scheduledTipoff);
  if (!Number.isFinite(ms)) throw new Error(`Invalid scheduledTipoff: ${scheduledTipoff}`);
  return new Date(ms - minutesBefore * 60_000).toISOString();
}
