/**
 * 13G.1 ingestion observability model.
 * Pure classifiers + family catalog. No AWS, no BDL, no DB.
 *
 * Config state is separate from health. Frozen + no run is expected, not stale.
 */

import type { HealthStatus } from './health-status';
import type { IngestIdentityAccounting } from '@/lib/identity/ingest-identity-gate';

export type FeedConfigState =
  | 'ACTIVE'
  | 'FROZEN'
  | 'NOT_DEPLOYED'
  | 'MANUAL_ONLY'
  | 'BLOCKED_BY_SUBSCRIPTION';

export type FreshnessState = 'FRESH' | 'STALE' | 'UNAVAILABLE' | 'FROZEN' | 'BLOCKED';

export type ReadinessGrade = 'HEALTHY' | 'FROZEN' | 'BLOCKED' | 'PARTIAL' | 'UNHEALTHY';

export type AwsScheduleObserved = 'ENABLED' | 'DISABLED' | 'UNKNOWN';

export type MissedRunStatus =
  | 'NOT_EXPECTED'
  | 'OK'
  | 'MISSED'
  | 'CONFIG_MISMATCH'
  | 'CADENCE_UNSET'
  | 'UNKNOWN';

export type ExecutionCorrelation =
  | 'FROZEN'
  | 'BLOCKED'
  | 'HEALTHY'
  | 'PARTIAL'
  | 'MISSED'
  | 'AWS_UNKNOWN'
  | 'UNKNOWN';

export type ReservedConcurrencyState = 'APPLIED' | 'UNAPPLIED' | 'UNKNOWN' | 'NOT_APPLICABLE';

export const SCHEDULE_2026_EXPECTED_RS = 1230;
export const SCHEDULE_2026_PROVIDER_PUBLISHED = 1200;
export const SCHEDULE_2026_UNPUBLISHED = 30;

/** Per-feed SLA hours used only when the feed is ACTIVE. Frozen feeds ignore these. */
export const FEED_SLA_HOURS = {
  schedule_nightly_bdl: 30,
  injuries: 36,
  game_odds: 24,
  player_props_controller: 12,
  player_props_worker: 12,
  bbref_boxscore: 30,
  advanced_postgame: 36,
  starters_lineups: 36,
  plays: 36,
  season_averages_role: 168,
  game_flow: 36,
  market_movement_capture: 12,
  game_status_sync: 1,
} as const;

export type IngestionFamilyId = keyof typeof FEED_SLA_HOURS;

export type IngestionFamilyCatalogEntry = {
  id: IngestionFamilyId;
  label: string;
  defaultConfig: Exclude<FeedConfigState, 'ACTIVE' | 'BLOCKED_BY_SUBSCRIPTION'>;
  goatRequired: boolean;
  deployedLambda: boolean;
  freshnessSource: string;
  pullRunTable: string | null;
};

export const INGESTION_FAMILY_CATALOG: IngestionFamilyCatalogEntry[] = [
  {
    id: 'schedule_nightly_bdl',
    label: 'Schedule / nightly BDL',
    defaultConfig: 'FROZEN',
    goatRequired: false,
    deployedLambda: true,
    freshnessSource: 'analytics.games latest 2026 row updated_at / start_time',
    pullRunTable: null,
  },
  {
    id: 'injuries',
    label: 'Injuries',
    defaultConfig: 'FROZEN',
    goatRequired: true,
    deployedLambda: true,
    freshnessSource: 'analytics.player_injury_status_current.snapshot_at',
    pullRunTable: 'raw.injury_pull_runs',
  },
  {
    id: 'game_odds',
    label: 'Game odds',
    defaultConfig: 'FROZEN',
    goatRequired: true,
    deployedLambda: true,
    freshnessSource: 'analytics.game_odds_current.updated_at (fallback latest history observed_at)',
    pullRunTable: 'raw.odds_pull_runs',
  },
  {
    id: 'player_props_controller',
    label: 'Player props controller',
    defaultConfig: 'FROZEN',
    goatRequired: true,
    deployedLambda: true,
    freshnessSource: 'raw.player_prop_pull_runs.completed_at status=success',
    pullRunTable: 'raw.player_prop_pull_runs',
  },
  {
    id: 'player_props_worker',
    label: 'Player props worker',
    defaultConfig: 'FROZEN',
    goatRequired: true,
    deployedLambda: true,
    freshnessSource: 'analytics.player_props_current.snapshot_at / player_prop_current.snapshot_at',
    pullRunTable: 'raw.player_prop_game_runs',
  },
  {
    id: 'bbref_boxscore',
    label: 'BBRef boxscore',
    defaultConfig: 'FROZEN',
    goatRequired: false,
    deployedLambda: true,
    freshnessSource: 'bbref_player_game_stats latest game_date / updated_at',
    pullRunTable: null,
  },
  {
    id: 'advanced_postgame',
    label: 'Advanced postgame',
    defaultConfig: 'MANUAL_ONLY',
    goatRequired: true,
    deployedLambda: false,
    freshnessSource: 'analytics.player_game_advanced.updated_at for Final games',
    pullRunTable: null,
  },
  {
    id: 'starters_lineups',
    label: 'Starters / lineups',
    defaultConfig: 'MANUAL_ONLY',
    goatRequired: true,
    deployedLambda: false,
    freshnessSource: 'analytics.game_starters.updated_at',
    pullRunTable: null,
  },
  {
    id: 'plays',
    label: 'Plays',
    defaultConfig: 'MANUAL_ONLY',
    goatRequired: true,
    deployedLambda: false,
    freshnessSource: 'canonical S3 plays object / analytics.game_flow certification timestamp',
    pullRunTable: null,
  },
  {
    id: 'season_averages_role',
    label: 'Season Averages / Role Profile',
    defaultConfig: 'MANUAL_ONLY',
    goatRequired: true,
    deployedLambda: false,
    freshnessSource: 'analytics.player_role_profile.updated_at',
    pullRunTable: null,
  },
  {
    id: 'game_flow',
    label: 'game_flow',
    defaultConfig: 'MANUAL_ONLY',
    goatRequired: false,
    deployedLambda: false,
    freshnessSource: 'analytics.game_flow.updated_at (when present)',
    pullRunTable: null,
  },
  {
    id: 'market_movement_capture',
    label: 'Market Movement reference capture',
    defaultConfig: 'NOT_DEPLOYED',
    goatRequired: true,
    deployedLambda: false,
    freshnessSource: 'future: first/3h/current/close observation timestamps (13E not started)',
    pullRunTable: null,
  },
  {
    id: 'game_status_sync',
    label: 'Frequent game status sync',
    defaultConfig: 'FROZEN',
    goatRequired: false,
    deployedLambda: false,
    freshnessSource: 'analytics.games season 2026 updated_at + Lambda last invocation',
    pullRunTable: null,
  },
];

export type FreshnessClassification = {
  state: FreshnessState;
  health: HealthStatus;
  reason: string;
};

export function classifyFeedFreshness(input: {
  config: FeedConfigState;
  lastSuccessAt: Date | null;
  now: Date;
  slaHours: number;
}): FreshnessClassification {
  if (input.config === 'FROZEN' || input.config === 'MANUAL_ONLY' || input.config === 'NOT_DEPLOYED') {
    return {
      state: 'FROZEN',
      health: 'FROZEN_EXPECTED',
      reason: `${input.config}: no live freshness SLA`,
    };
  }
  if (input.config === 'BLOCKED_BY_SUBSCRIPTION') {
    return {
      state: 'BLOCKED',
      health: 'BLOCKED',
      reason: 'known external subscription prevents execution',
    };
  }
  if (!input.lastSuccessAt) {
    return {
      state: 'UNAVAILABLE',
      health: 'UNKNOWN',
      reason: 'no successful observation',
    };
  }
  const ageHours = (input.now.getTime() - input.lastSuccessAt.getTime()) / (60 * 60 * 1000);
  if (ageHours > input.slaHours) {
    return {
      state: 'STALE',
      health: 'STALE',
      reason: `last success ${ageHours.toFixed(1)}h ago (SLA ${input.slaHours}h)`,
    };
  }
  return {
    state: 'FRESH',
    health: 'HEALTHY',
    reason: 'within SLA',
  };
}

export function resolveFeedConfig(input: {
  family: IngestionFamilyCatalogEntry;
  liveIngestionEnabled: boolean;
  freezeSkipsMutations: boolean;
  goatSubscriptionActive: boolean;
}): FeedConfigState {
  if (input.family.defaultConfig === 'NOT_DEPLOYED') return 'NOT_DEPLOYED';
  if (input.family.defaultConfig === 'MANUAL_ONLY') return 'MANUAL_ONLY';
  if (input.freezeSkipsMutations || !input.liveIngestionEnabled) return 'FROZEN';
  if (input.family.goatRequired && !input.goatSubscriptionActive) {
    return 'BLOCKED_BY_SUBSCRIPTION';
  }
  return 'ACTIVE';
}

export function classifyScheduleMismatch(input: {
  liveIngestionEnabled: boolean;
  observed: AwsScheduleObserved;
}): { health: HealthStatus; reason: string } {
  if (input.observed === 'UNKNOWN') {
    return {
      health: input.liveIngestionEnabled ? 'UNKNOWN' : 'FROZEN_EXPECTED',
      reason: input.liveIngestionEnabled
        ? 'intended active; AWS schedule state not queried'
        : 'intended frozen; AWS schedule state not queried (assume DISABLED)',
    };
  }
  if (!input.liveIngestionEnabled && input.observed === 'DISABLED') {
    return { health: 'FROZEN_EXPECTED', reason: 'intended frozen + actually disabled' };
  }
  if (!input.liveIngestionEnabled && input.observed === 'ENABLED') {
    return { health: 'DEGRADED', reason: 'intended frozen + accidentally enabled' };
  }
  if (input.liveIngestionEnabled && input.observed === 'DISABLED') {
    return { health: 'FAILED', reason: 'intended active + actually disabled' };
  }
  return { health: 'HEALTHY', reason: 'intended active + actually enabled' };
}

export function classifyIdentityObservability(input: {
  unresolved: number;
  conflicts: number;
  resolved: number;
  classCCanonical: number;
}): { health: HealthStatus; reason: string; alert: boolean } {
  if (input.conflicts > 0) {
    return {
      health: 'DEGRADED',
      reason: `${input.conflicts} identity conflict observation(s)`,
      alert: true,
    };
  }
  if (input.unresolved > 0) {
    return {
      health: 'DEGRADED',
      reason: `${input.unresolved} ingest identity observation(s) in quarantine`,
      alert: true,
    };
  }
  return {
    health: 'HEALTHY',
    reason: `quarantine empty; Class C canonical=${input.classCCanonical} is not an ingest alert`,
    alert: false,
  };
}

export function classifyIdentityRunSpike(accounting: Pick<
  IngestIdentityAccounting,
  'unresolved' | 'conflicts' | 'notServingYet' | 'quarantined'
>): { health: HealthStatus; reason: string } {
  if (accounting.conflicts > 0) {
    return { health: 'DEGRADED', reason: `run conflicts=${accounting.conflicts}` };
  }
  if (accounting.unresolved > 0 || accounting.quarantined > 0) {
    return {
      health: 'DEGRADED',
      reason: `run unresolved=${accounting.unresolved} quarantined=${accounting.quarantined}`,
    };
  }
  if (accounting.notServingYet > 0) {
    return {
      health: 'DEGRADED',
      reason: `run not_serving_yet=${accounting.notServingYet} (live encounter, not Class C census)`,
    };
  }
  return { health: 'HEALTHY', reason: 'no identity skips this run' };
}

export function classifyQueueHealth(input: {
  config: FeedConfigState;
  queueDepth: number | null;
  oldestAgeSeconds: number | null;
  dlqDepth: number | null;
  reservedConcurrencyApplied: boolean | null;
  deployed?: boolean | null;
}): { health: HealthStatus; reason: string } {
  if (input.dlqDepth != null && input.dlqDepth > 0) {
    return { health: 'DEGRADED', reason: `DLQ depth ${input.dlqDepth}` };
  }
  if (input.deployed === false) {
    return { health: 'FROZEN_EXPECTED', reason: 'queue NOT_DEPLOYED' };
  }
  if (input.queueDepth == null && input.dlqDepth == null) {
    return { health: 'UNKNOWN', reason: 'queue metrics not queried' };
  }
  if (input.config === 'FROZEN' || input.config === 'NOT_DEPLOYED' || input.config === 'MANUAL_ONLY') {
    const applied =
      input.reservedConcurrencyApplied === false
        ? '; reserved concurrency configured but not applied'
        : '';
    return {
      health: 'FROZEN_EXPECTED',
      reason: `queue idle expected while ${input.config}${applied}`,
    };
  }
  if (input.config === 'BLOCKED_BY_SUBSCRIPTION') {
    return { health: 'BLOCKED', reason: 'queue not expected to drain while subscription blocked' };
  }
  if (input.queueDepth != null && input.queueDepth > 0 && (input.oldestAgeSeconds ?? 0) > 900) {
    return {
      health: 'STALE',
      reason: `queue depth ${input.queueDepth}, oldest ${input.oldestAgeSeconds}s`,
    };
  }
  return { health: 'HEALTHY', reason: 'queue empty or draining' };
}

export function classifyProviderErrors(input: {
  config: FeedConfigState;
  counts: {
    http401: number;
    http403: number;
    http429: number;
    http5xx: number;
    timeout: number;
    malformed: number;
  };
}): { health: HealthStatus; reason: string } {
  const { counts, config } = input;
  if (counts.http429 > 0) {
    return { health: 'DEGRADED', reason: `BDL 429 count=${counts.http429} (distinct from other errors)` };
  }
  if (config === 'BLOCKED_BY_SUBSCRIPTION' && (counts.http401 > 0 || counts.http403 > 0)) {
    return {
      health: 'BLOCKED',
      reason: '401/403 while subscription-blocked is not a generic system failure',
    };
  }
  if (counts.http401 > 0 || counts.http403 > 0) {
    return { health: 'FAILED', reason: 'provider auth failure while feed is not subscription-blocked' };
  }
  if (counts.http5xx > 0 || counts.timeout > 0) {
    return { health: 'DEGRADED', reason: 'provider 5xx or timeout' };
  }
  if (counts.malformed > 0) {
    return { health: 'DEGRADED', reason: 'malformed provider response' };
  }
  return { health: 'HEALTHY', reason: 'no provider errors recorded' };
}

export function classifyVolumeAnomaly(input: {
  config: FeedConfigState;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  outputCount: number;
  expectedMinOutput: number | null;
}): { health: HealthStatus; reason: string } {
  if (input.config !== 'ACTIVE') {
    return { health: 'FROZEN_EXPECTED', reason: 'volume gates apply only when ACTIVE' };
  }
  if (input.status === 'failed') {
    return { health: 'FAILED', reason: 'job failed' };
  }
  if (input.status === 'partial') {
    return { health: 'DEGRADED', reason: 'partial: skipped/quarantined rows without whole-run failure' };
  }
  if (input.expectedMinOutput != null && input.outputCount < input.expectedMinOutput) {
    return {
      health: 'DEGRADED',
      reason: `output ${input.outputCount} below expected min ${input.expectedMinOutput}`,
    };
  }
  return { health: 'HEALTHY', reason: 'output meets completeness gate' };
}

export function classifyScheduleCompleteness(input: {
  localCount: number | null;
  providerPublished: number;
  expectedRs: number;
}): { health: HealthStatus; reason: string; reconciliation: string } {
  const unpublished = input.expectedRs - input.providerPublished;
  if (input.localCount == null) {
    return {
      health: 'UNKNOWN',
      reason: 'local 2026 game count unavailable',
      reconciliation: `provider ${input.providerPublished}/${input.expectedRs}; ${unpublished} unpublished (expected)`,
    };
  }
  if (input.localCount < input.providerPublished) {
    return {
      health: 'DEGRADED',
      reason: `local ${input.localCount} behind provider-published ${input.providerPublished}`,
      reconciliation: 'LOCAL_BEHIND_PROVIDER',
    };
  }
  return {
    health: 'HEALTHY',
    reason: `local ${input.localCount} matches provider-published ${input.providerPublished}; ${unpublished} unpublished remaining (not an alert)`,
    reconciliation: 'PROVIDER_NOT_YET_PUBLISHED',
  };
}

export const POSTGAME_READINESS_SIGNALS = [
  'basic_box_complete',
  'starters_certified',
  'advanced_available',
  'plays_archived',
  'game_flow_built',
  'role_current_enough',
] as const;

export const MARKET_SNAPSHOT_READINESS_SIGNALS = [
  'game_discovered',
  'first_odds_observed',
  'three_hour_prop_snapshot_captured',
  'current_board_fresh',
  'close_captured',
  'reference_missed',
] as const;

export function freshnessToReadiness(state: FreshnessState, health: HealthStatus): ReadinessGrade {
  if (state === 'FROZEN') return 'FROZEN';
  if (state === 'BLOCKED' || health === 'BLOCKED') return 'BLOCKED';
  if (health === 'FAILED') return 'UNHEALTHY';
  if (health === 'DEGRADED' || health === 'STALE') return 'PARTIAL';
  if (health === 'HEALTHY') return 'HEALTHY';
  return 'PARTIAL';
}

export function classifyMissedRun(input: {
  config: FeedConfigState;
  scheduleObserved: AwsScheduleObserved;
  intervalHours: number | null;
  graceHours: number;
  lastInvocationAt: Date | null;
  invocationQueried: boolean;
  now: Date;
}): { status: MissedRunStatus; health: HealthStatus; reason: string } {
  if (input.config !== 'ACTIVE') {
    return {
      status: 'NOT_EXPECTED',
      health: input.config === 'BLOCKED_BY_SUBSCRIPTION' ? 'BLOCKED' : 'FROZEN_EXPECTED',
      reason: `${input.config}: missed-run detection is not armed`,
    };
  }
  if (input.scheduleObserved === 'UNKNOWN') {
    return {
      status: 'UNKNOWN',
      health: 'UNKNOWN',
      reason: 'intended active; AWS schedule state unavailable',
    };
  }
  if (input.scheduleObserved === 'DISABLED') {
    return {
      status: 'CONFIG_MISMATCH',
      health: 'FAILED',
      reason: 'intended active + AWS schedule DISABLED',
    };
  }
  if (input.intervalHours == null) {
    return {
      status: 'CADENCE_UNSET',
      health: 'UNKNOWN',
      reason: 'ACTIVE but cadence is not certified; no missed-run alarm',
    };
  }
  if (!input.invocationQueried) {
    return {
      status: 'UNKNOWN',
      health: 'UNKNOWN',
      reason: 'intended active; Lambda invocation telemetry unavailable',
    };
  }
  const deadlineMs = (input.intervalHours + input.graceHours) * 60 * 60 * 1000;
  const overdue =
    input.lastInvocationAt == null ||
    input.now.getTime() - input.lastInvocationAt.getTime() > deadlineMs;
  if (overdue) {
    return {
      status: 'MISSED',
      health: 'DEGRADED',
      reason: `no invocation within ${input.intervalHours}h + ${input.graceHours}h grace`,
    };
  }
  return { status: 'OK', health: 'HEALTHY', reason: 'invocation within expected cadence + grace' };
}

export function correlateExecutionAndFreshness(input: {
  config: FeedConfigState;
  missedRun: MissedRunStatus;
  freshness: FreshnessState;
  lastInvocationAt: Date | null;
  invocationQueried: boolean;
  volumeHealth?: HealthStatus;
}): { grade: ExecutionCorrelation; health: HealthStatus; reason: string } {
  if (input.config === 'FROZEN' || input.config === 'MANUAL_ONLY' || input.config === 'NOT_DEPLOYED') {
    return { grade: 'FROZEN', health: 'FROZEN_EXPECTED', reason: `${input.config}: execution not expected` };
  }
  if (input.config === 'BLOCKED_BY_SUBSCRIPTION') {
    return { grade: 'BLOCKED', health: 'BLOCKED', reason: 'subscription/entitlement blocked' };
  }
  if (input.missedRun === 'CONFIG_MISMATCH') {
    return { grade: 'MISSED', health: 'FAILED', reason: 'schedule disabled while intended active' };
  }
  if (input.missedRun === 'MISSED') {
    return { grade: 'MISSED', health: 'DEGRADED', reason: 'Lambda did not run within cadence + grace' };
  }
  if (input.volumeHealth === 'DEGRADED' || input.volumeHealth === 'FAILED') {
    return {
      grade: 'PARTIAL',
      health: input.volumeHealth,
      reason: 'job ran or succeeded with a volume anomaly',
    };
  }
  if (input.lastInvocationAt && input.freshness === 'FRESH') {
    return { grade: 'HEALTHY', health: 'HEALTHY', reason: 'Lambda ran + data fresh' };
  }
  if (input.lastInvocationAt && (input.freshness === 'STALE' || input.freshness === 'UNAVAILABLE')) {
    return {
      grade: 'PARTIAL',
      health: 'DEGRADED',
      reason: 'Lambda ran + data did not advance',
    };
  }
  if (!input.invocationQueried && input.freshness === 'FRESH') {
    return {
      grade: 'AWS_UNKNOWN',
      health: 'HEALTHY',
      reason: 'data fresh; AWS invocation unknown',
    };
  }
  if (!input.invocationQueried) {
    return {
      grade: 'AWS_UNKNOWN',
      health: 'UNKNOWN',
      reason: 'AWS invocation unknown',
    };
  }
  if (input.freshness === 'FRESH') {
    return { grade: 'HEALTHY', health: 'HEALTHY', reason: 'data fresh' };
  }
  return { grade: 'UNKNOWN', health: 'UNKNOWN', reason: 'execution/freshness not jointly determined' };
}

export function rollupScheduleObserved(
  states: Array<'ENABLED' | 'DISABLED' | 'NOT_FOUND' | 'UNKNOWN'>
): AwsScheduleObserved {
  if (states.some((state) => state === 'ENABLED')) return 'ENABLED';
  const known = states.filter((state) => state === 'DISABLED' || state === 'NOT_FOUND');
  if (known.length > 0 && known.every((state) => state === 'DISABLED' || state === 'NOT_FOUND') && states.some((state) => state === 'DISABLED')) {
    return 'DISABLED';
  }
  return 'UNKNOWN';
}

export function classifyReservedConcurrency(applied: boolean | null): {
  state: ReservedConcurrencyState;
  reason: string;
} {
  if (applied === true) return { state: 'APPLIED', reason: 'reserved concurrency is set on the function' };
  if (applied === false) {
    return {
      state: 'UNAPPLIED',
      reason: 'RESERVED_CONCURRENCY_UNAPPLIED (quota 10; desired 4 not applied)',
    };
  }
  return { state: 'UNKNOWN', reason: 'reserved concurrency not queried' };
}
