/**
 * Prospective shadow-evaluation protocol (STEP 14M.C1).
 * Extends frozen PTS C / REB C r1. Does not enable live scoring.
 */

import { PRODUCTION_CONTROL, frozenCandidateForMarket } from '@/lib/model-lab/lifecycle-registry';
import { assertNoFutureRowsInCapturedFeatures, assertPredictionPrecedesCutoff } from '@/lib/model-lab/walk-forward';
import { CONTEXT_ENGINE_CONTRACT_VERSION, type ContextEngineSnapshot } from '@/lib/context-engine/contract';
import {
  SHADOW_MINUTES_BEFORE_TIP,
  SHADOW_PRIMARY_WINDOW_DAYS,
  type ShadowTarget,
} from '@/lib/betting/player-projection-shadow-protocol';

export const PROSPECTIVE_PROTOCOL_ID = 'context-engine-prospective-shadow-c1';
export const PROSPECTIVE_PROTOCOL_VERSION = 'context-engine-prospective-shadow-c1.0';
export const PROSPECTIVE_PROTOCOL_EXTENDS = 'player-projection-shadow-pts-reb-c-r1.1-timing';

export const SHADOW_INFRASTRUCTURE_READINESS = 'PARTIAL' as const;
export const SHADOW_SCORING_STATUS = 'DISABLED' as const;
export const INJURY_COLLECTION_STATUS = 'DISABLED' as const;
export const PROVIDER_ENTITLEMENT = 'BLOCKED_BY_ENTITLEMENT' as const;

export const PRIMARY_METRICS = ['mae', 'rmse', 'bias', 'n', 'coverage', 'prediction_availability', 'delta_vs_control'] as const;
export type PrimaryMetric = (typeof PRIMARY_METRICS)[number];

export const SHADOW_COHORT_IDS = {
  ALL_ELIGIBLE_PTS_C: 'ALL_ELIGIBLE_PTS_C',
  ALL_ELIGIBLE_REB_C: 'ALL_ELIGIBLE_REB_C',
  AVAILABILITY_KNOWN: 'AVAILABILITY_KNOWN',
  TEAMMATE_OUT_QUALIFIED: 'TEAMMATE_OUT_QUALIFIED',
  WOWY_QUALIFIED: 'WOWY_QUALIFIED',
} as const;

export type ShadowCohortId = (typeof SHADOW_COHORT_IDS)[keyof typeof SHADOW_COHORT_IDS];

export const SHADOW_COHORTS: Record<
  ShadowCohortId,
  { id: ShadowCohortId; market: 'points' | 'rebounds' | 'either'; comparableToFullBaseline: false | true; note: string }
> = {
  ALL_ELIGIBLE_PTS_C: {
    id: 'ALL_ELIGIBLE_PTS_C',
    market: 'points',
    comparableToFullBaseline: true,
    note: 'All eligible PTS C predictions vs production 70/30 on the same player-games.',
  },
  ALL_ELIGIBLE_REB_C: {
    id: 'ALL_ELIGIBLE_REB_C',
    market: 'rebounds',
    comparableToFullBaseline: true,
    note: 'All eligible REB C predictions vs production 70/30 on the same player-games.',
  },
  AVAILABILITY_KNOWN: {
    id: 'AVAILABILITY_KNOWN',
    market: 'either',
    comparableToFullBaseline: false,
    note: 'Subset with as-of-safe availability known before cutoff. Do not compare as if it were the full population.',
  },
  TEAMMATE_OUT_QUALIFIED: {
    id: 'TEAMMATE_OUT_QUALIFIED',
    market: 'either',
    comparableToFullBaseline: false,
    note: 'Qualified teammate-Out subset. Separate cohort; not the full baseline population.',
  },
  WOWY_QUALIFIED: {
    id: 'WOWY_QUALIFIED',
    market: 'either',
    comparableToFullBaseline: false,
    note: 'WOWY-qualified subset. Compare Candidate C vs Candidate C + WOWY on the same examples only.',
  },
};

export type ProspectiveMarket = ShadowTarget;

export type ProspectivePredictionRecord = {
  protocolId: typeof PROSPECTIVE_PROTOCOL_ID;
  protocolVersion: typeof PROSPECTIVE_PROTOCOL_VERSION;
  predictionId: string;
  generatedAt: string;
  contextCutoff: string;
  gameId: string;
  scheduledTip: string;
  playerCanonicalId: string;
  teamId: string;
  opponentTeamId: string;
  market: ProspectiveMarket;
  sportsbookLine: number | null;
  modelVersion: string;
  featureVersion: string;
  controlId: typeof PRODUCTION_CONTROL.id;
  controlPrediction: number | null;
  candidateId: 'pts_c' | 'reb_c';
  candidatePrediction: number | null;
  capturedFeatureValues: Record<string, number | null>;
  capturedFeatureEventTimestamps: string[];
  candidateContextFieldsAvailable: string[];
  missingContextFields: string[];
  dataFreshness: Record<string, unknown>;
  eligibilityFlags: {
    eligible: boolean;
    reason: string | null;
    onTime: boolean;
  };
  experimentCohortFlags: Record<ShadowCohortId, boolean>;
  contextEngineContractVersion: typeof CONTEXT_ENGINE_CONTRACT_VERSION;
  contextEngineSnapshot: ContextEngineSnapshot | null;
  outcomeForbidden: true;
};

export type ProspectiveOutcomeRecord = {
  predictionId: string;
  joinedAt: string;
  actual: number | null;
  outcomeClass: 'played' | 'dnp' | 'postponed' | 'cancelled' | 'unresolved';
  audit: {
    source: string;
    note: string;
  };
};

export const LOCKED_DURING_ACTIVE_COHORT = [
  'model weights',
  'model artifact',
  'feature version',
  'signal definitions',
  'qualification rules',
] as const;

export const SAMPLE_SIZE_POLICY = {
  nTarget: 'POWER_ANALYSIS_REQUIRED_BEFORE_ACTIVATION',
  calendarDurationDays: SHADOW_PRIMARY_WINDOW_DAYS,
  calendarDurationSource: 'Existing certified shadow protocol primary window (60 calendar days from first regular-season tipoff). Reused, not invented in C1.',
  doNotChooseNFromFutureResults: true,
} as const;

export const FUTURE_ACTIVATION_SEQUENCE = [
  'verify provider subscription/key',
  'injury endpoint canary',
  'fresh stats/box-score canary',
  'verify identity mappings',
  'verify timestamps/freshness',
  'apply required deployment changes',
  'activate injury collection',
  'observe collection only',
  'verify completeness/freshness',
  'activate frozen shadow predictions',
  'observe predictions before tip',
  'join outcomes after final',
  'accumulate untouched sample',
  'evaluate control vs frozen candidate',
  'separately evaluate WOWY-qualified cohort',
] as const;

export const INJURY_COLLECTOR_AUDIT = {
  codeReadiness: 'READY_NOT_ACTIVATED',
  storageTarget: 'raw.injury_pull_runs, raw.player_injuries, raw.injury_pull_membership (membership schema unapplied), analytics.player_injury_status_history',
  schedule: 'injuries-snapshot-schedule cron(0 13,18,22 * * ? *) currently DISABLED',
  freshnessAssumptions: 'collection-asof default freshWithinMs = 36 hours; stale/post-tip observations are not pregame evidence',
  requiredBdlEntitlement: 'GET /nba/v1/player_injuries',
  requiredDeploymentChanges: [
    'successful injuries canary HTTP 200',
    'apply injury statements of MIGRATION_context_collection_snapshots.sql',
    'injuries_execution_enabled=true overlay without disabling game_status_sync',
    'COLLECTION_SCHEMA_MODE=required after SQL',
  ],
  providerStatus: PROVIDER_ENTITLEMENT,
  lastKnownProbe: '2026-09-16T12:06:56.221Z HTTP 401',
  activated: false,
} as const;

export const FRESH_BOX_SCORE_REQUIREMENT = {
  requiredForOutcomeJoin: true,
  impliedByInjuryEntitlement: false,
  note: 'When provider access returns, fresh box-score/stats access must be verified separately from injury entitlement.',
} as const;

export const SHADOW_INFRASTRUCTURE_AUDIT = {
  readiness: SHADOW_INFRASTRUCTURE_READINESS,
  scoring: SHADOW_SCORING_STATUS,
  reusable: [
    'lib/betting/player-projection-shadow-protocol.ts',
    'lib/betting/player-projection-shadow-scoring.ts',
    'lib/betting/player-projection-shadow-store.ts',
    'lib/betting/player-projection-shadow-worker.ts',
    'analytics.prediction_snapshots + prediction_settlements (unapplied in target DB)',
    'frozen C hashes in reports/modeling/shadow-pts-reb-c-r1/manifest.json',
  ],
  missingForC1: [
    'production 70/30 control field (existing pred_a is played-only Track A, not production)',
    'per-market prediction identity including market in the logical key',
    'experiment cohort flags',
    'frozen Context Engine snapshot at prediction time',
    'sportsbook line / missing context field lists',
  ],
  remainingBeforeActivation: [
    'provider entitlement canary HTTP 200 for injuries',
    'separate fresh box-score/stats canary',
    'apply proposed C1 prediction schema (do not apply in this step)',
    'apply required deployment/SQL for collection',
    'activate injury collection and observe completeness',
    'then activate frozen shadow predictions',
  ],
} as const;

export function predictionId(parts: {
  playerCanonicalId: string;
  gameId: string;
  market: ProspectiveMarket;
  modelVersion: string;
  contextCutoff: string;
}): string {
  return `${parts.playerCanonicalId}|${parts.gameId}|${parts.market}|${parts.modelVersion}|${parts.contextCutoff}`;
}

export function emptyCohortFlags(): Record<ShadowCohortId, boolean> {
  return {
    ALL_ELIGIBLE_PTS_C: false,
    ALL_ELIGIBLE_REB_C: false,
    AVAILABILITY_KNOWN: false,
    TEAMMATE_OUT_QUALIFIED: false,
    WOWY_QUALIFIED: false,
  };
}

export function assignCohortFlags(args: {
  market: ProspectiveMarket;
  eligible: boolean;
  availabilityKnown: boolean;
  teammateOutQualified: boolean;
  wowyQualified: boolean;
}): Record<ShadowCohortId, boolean> {
  return {
    ALL_ELIGIBLE_PTS_C: args.eligible && args.market === 'points',
    ALL_ELIGIBLE_REB_C: args.eligible && args.market === 'rebounds',
    AVAILABILITY_KNOWN: args.eligible && args.availabilityKnown,
    TEAMMATE_OUT_QUALIFIED: args.eligible && args.teammateOutQualified,
    WOWY_QUALIFIED: args.eligible && args.wowyQualified,
  };
}

export function createProspectivePrediction(args: {
  generatedAt: string;
  contextCutoff: string;
  gameId: string;
  scheduledTip: string;
  playerCanonicalId: string;
  teamId: string;
  opponentTeamId: string;
  market: ProspectiveMarket;
  sportsbookLine?: number | null;
  modelVersion: string;
  featureVersion: string;
  controlPrediction: number | null;
  candidatePrediction: number | null;
  capturedFeatureValues: Record<string, number | null>;
  capturedFeatureEventTimestamps: string[];
  candidateContextFieldsAvailable: string[];
  missingContextFields: string[];
  dataFreshness: Record<string, unknown>;
  eligible: boolean;
  eligibilityReason?: string | null;
  availabilityKnown?: boolean;
  teammateOutQualified?: boolean;
  wowyQualified?: boolean;
  contextEngineSnapshot?: ContextEngineSnapshot | null;
}): ProspectivePredictionRecord {
  assertPredictionPrecedesCutoff(args.generatedAt, args.contextCutoff);
  assertNoFutureRowsInCapturedFeatures(args.capturedFeatureEventTimestamps, args.contextCutoff);
  const scheduled = Date.parse(args.scheduledTip);
  const cutoff = Date.parse(args.contextCutoff);
  if (Number.isFinite(scheduled) && Number.isFinite(cutoff) && cutoff > scheduled) {
    throw new Error('Context cutoff must not be after scheduled tip.');
  }
  const candidate = frozenCandidateForMarket(args.market);
  const onTime = Date.parse(args.generatedAt) <= Date.parse(args.contextCutoff);
  const record: ProspectivePredictionRecord = {
    protocolId: PROSPECTIVE_PROTOCOL_ID,
    protocolVersion: PROSPECTIVE_PROTOCOL_VERSION,
    predictionId: predictionId({
      playerCanonicalId: args.playerCanonicalId,
      gameId: args.gameId,
      market: args.market,
      modelVersion: args.modelVersion,
      contextCutoff: args.contextCutoff,
    }),
    generatedAt: args.generatedAt,
    contextCutoff: args.contextCutoff,
    gameId: args.gameId,
    scheduledTip: args.scheduledTip,
    playerCanonicalId: args.playerCanonicalId,
    teamId: args.teamId,
    opponentTeamId: args.opponentTeamId,
    market: args.market,
    sportsbookLine: args.sportsbookLine ?? null,
    modelVersion: args.modelVersion,
    featureVersion: args.featureVersion,
    controlId: PRODUCTION_CONTROL.id,
    controlPrediction: args.controlPrediction,
    candidateId: candidate.id,
    candidatePrediction: args.candidatePrediction,
    capturedFeatureValues: { ...args.capturedFeatureValues },
    capturedFeatureEventTimestamps: [...args.capturedFeatureEventTimestamps],
    candidateContextFieldsAvailable: [...args.candidateContextFieldsAvailable],
    missingContextFields: [...args.missingContextFields],
    dataFreshness: { ...args.dataFreshness },
    eligibilityFlags: {
      eligible: args.eligible,
      reason: args.eligibilityReason ?? null,
      onTime,
    },
    experimentCohortFlags: assignCohortFlags({
      market: args.market,
      eligible: args.eligible,
      availabilityKnown: args.availabilityKnown ?? false,
      teammateOutQualified: args.teammateOutQualified ?? false,
      wowyQualified: args.wowyQualified ?? false,
    }),
    contextEngineContractVersion: CONTEXT_ENGINE_CONTRACT_VERSION,
    contextEngineSnapshot: args.contextEngineSnapshot ?? null,
    outcomeForbidden: true,
  };
  return Object.freeze(record);
}

export function assertNoOutcomeOnPrediction(record: ProspectivePredictionRecord): void {
  if ('actual' in record || 'outcome' in record) {
    throw new Error('Prospective prediction records must not include future outcome information.');
  }
}

export function joinOutcome(args: {
  prediction: ProspectivePredictionRecord;
  joinedAt: string;
  actual: number | null;
  outcomeClass: ProspectiveOutcomeRecord['outcomeClass'];
  source: string;
}): { prediction: ProspectivePredictionRecord; outcome: ProspectiveOutcomeRecord } {
  assertNoOutcomeOnPrediction(args.prediction);
  const outcome: ProspectiveOutcomeRecord = {
    predictionId: args.prediction.predictionId,
    joinedAt: args.joinedAt,
    actual: args.actual,
    outcomeClass: args.outcomeClass,
    audit: {
      source: args.source,
      note: 'Outcome is append-only. Original prediction values are not rewritten.',
    },
  };
  return { prediction: args.prediction, outcome };
}

export function rewritePredictionAfterOutcome(
  _prediction: ProspectivePredictionRecord,
  _patch: Partial<ProspectivePredictionRecord>
): never {
  throw new Error('Prediction values are immutable after outcome join. Append audit metadata instead.');
}

export function assertPtsAndRebRemainSeparate(markets: readonly ProspectiveMarket[]): void {
  const unique = new Set(markets);
  if (unique.size !== 1) {
    throw new Error('PTS and REB cohorts must be evaluated separately. Do not pool markets into one headline score.');
  }
}

export function assertSameExampleWowyComparison(args: {
  controlPredictionIds: readonly string[];
  candidatePredictionIds: readonly string[];
}): void {
  if (args.controlPredictionIds.length !== args.candidatePredictionIds.length) {
    throw new Error('WOWY evaluation must compare Candidate C vs Candidate C+WOWY on the same qualified examples.');
  }
  const control = [...args.controlPredictionIds].sort();
  const candidate = [...args.candidatePredictionIds].sort();
  for (let i = 0; i < control.length; i += 1) {
    if (control[i] !== candidate[i]) {
      throw new Error('WOWY evaluation populations differ. Same-example comparison is required.');
    }
  }
}

export function assertWowyNotComparedToFullBaseline(args: {
  wowyCohort: boolean;
  comparedAgainstFullPopulation: boolean;
}): void {
  if (args.wowyCohort && args.comparedAgainstFullPopulation) {
    throw new Error(
      'Do not compare the WOWY subset against the full baseline population as if populations are identical.'
    );
  }
}

export function materialChangeRequiresNewVersion(change: (typeof LOCKED_DURING_ACTIVE_COHORT)[number]): string {
  return `Material change to ${change} during an active evaluation cohort is forbidden. Start a new experiment/version.`;
}

export type ProspectiveEvaluationReport = {
  protocolVersion: typeof PROSPECTIVE_PROTOCOL_VERSION;
  modelVersions: { control: string; ptsC: string; rebC: string };
  featureVersions: { ptsC: string; rebC: string };
  evaluationWindow: { start: string | null; end: string | null };
  totalEligiblePredictions: number;
  scoredPredictions: number;
  missingUnscoredPredictions: number;
  marketSpecific: Record<
    ProspectiveMarket,
    {
      n: number;
      baselineMae: number | null;
      candidateMae: number | null;
      delta: number | null;
      rmseBaseline: number | null;
      rmseCandidate: number | null;
      biasBaseline: number | null;
      biasCandidate: number | null;
      coverage: number | null;
      predictionAvailability: number | null;
    }
  >;
  cohorts: Record<
    ShadowCohortId,
    { n: number; baselineMae: number | null; candidateMae: number | null; delta: number | null }
  >;
  dataFreshnessCompleteness: string;
  exclusions: Array<{ reason: string; n: number }>;
  cherryPickedDateRemovalForbidden: true;
};

export function emptyProspectiveEvaluationReport(): ProspectiveEvaluationReport {
  const marketBlank = {
    n: 0,
    baselineMae: null,
    candidateMae: null,
    delta: null,
    rmseBaseline: null,
    rmseCandidate: null,
    biasBaseline: null,
    biasCandidate: null,
    coverage: null,
    predictionAvailability: null,
  };
  const cohortBlank = { n: 0, baselineMae: null, candidateMae: null, delta: null };
  return {
    protocolVersion: PROSPECTIVE_PROTOCOL_VERSION,
    modelVersions: {
      control: PRODUCTION_CONTROL.id,
      ptsC: frozenCandidateForMarket('points').modelVersion,
      rebC: frozenCandidateForMarket('rebounds').modelVersion,
    },
    featureVersions: {
      ptsC: frozenCandidateForMarket('points').featureSpecVersion,
      rebC: frozenCandidateForMarket('rebounds').featureSpecVersion,
    },
    evaluationWindow: { start: null, end: null },
    totalEligiblePredictions: 0,
    scoredPredictions: 0,
    missingUnscoredPredictions: 0,
    marketSpecific: { points: { ...marketBlank }, rebounds: { ...marketBlank } },
    cohorts: {
      ALL_ELIGIBLE_PTS_C: { ...cohortBlank },
      ALL_ELIGIBLE_REB_C: { ...cohortBlank },
      AVAILABILITY_KNOWN: { ...cohortBlank },
      TEAMMATE_OUT_QUALIFIED: { ...cohortBlank },
      WOWY_QUALIFIED: { ...cohortBlank },
    },
    dataFreshnessCompleteness: 'Not started. Injury collection disabled. Shadow scoring disabled.',
    exclusions: [],
    cherryPickedDateRemovalForbidden: true,
  };
}

export const FEATURE_CUTOFF_MINUTES_BEFORE_TIP = SHADOW_MINUTES_BEFORE_TIP;

export const PROTOCOL_MACHINE_RECORD = {
  id: PROSPECTIVE_PROTOCOL_ID,
  version: PROSPECTIVE_PROTOCOL_VERSION,
  extends: PROSPECTIVE_PROTOCOL_EXTENDS,
  liveScoring: SHADOW_SCORING_STATUS,
  injuryCollection: INJURY_COLLECTION_STATUS,
  providerEntitlement: PROVIDER_ENTITLEMENT,
  infrastructureReadiness: SHADOW_INFRASTRUCTURE_READINESS,
  control: PRODUCTION_CONTROL.id,
  candidates: ['pts_c', 'reb_c'] as const,
  marketsEvaluatedSeparately: true,
  sampleSizePolicy: SAMPLE_SIZE_POLICY,
  activationSequence: FUTURE_ACTIVATION_SEQUENCE,
  lockedDuringActiveCohort: LOCKED_DURING_ACTIVE_COHORT,
} as const;
