/**
 * Shared Context Engine contract.
 * This is not an XRay-only model and is not a production prediction endpoint.
 *
 * AS-OF-SAFE FACTS → CONTEXT SIGNALS → RELIABILITY / AVAILABILITY → CONSUMERS
 *
 * FACT, SIGNAL, MODEL FEATURE, and INTERPRETATION are not interchangeable.
 */

import {
  WOWY_INSUFFICIENT_MIN_GAMES,
  WOWY_LOW_SUPPORT_MIN_GAMES,
  wowySupportTier,
} from '@/lib/wowy/policy';
import {
  selectObservedPregameScenario,
  type PregameAvailabilityObservation,
} from '@/lib/wowy/availability-gate';

export const CONTEXT_ENGINE_CONTRACT_ID = 'court-context-engine-c1';
export const CONTEXT_ENGINE_CONTRACT_VERSION = 'court-context-engine-c1.0';

export const CONTEXT_LAYER = {
  FACT: 'FACT',
  SIGNAL: 'SIGNAL',
  MODEL_FEATURE: 'MODEL_FEATURE',
  INTERPRETATION: 'INTERPRETATION',
} as const;

export type ContextLayer = (typeof CONTEXT_LAYER)[keyof typeof CONTEXT_LAYER];

export const SIGNAL_DEFINITION_STATUS = {
  DEFINED: 'DEFINED',
  EXPERIMENTAL: 'EXPERIMENTAL',
  BLOCKED_BY_DATA: 'BLOCKED_BY_DATA',
} as const;

export type SignalDefinitionStatus = (typeof SIGNAL_DEFINITION_STATUS)[keyof typeof SIGNAL_DEFINITION_STATUS];

export const RELIABILITY_STATE = {
  INSUFFICIENT: 'INSUFFICIENT',
  LIMITED: 'LIMITED',
  MODERATE: 'MODERATE',
  STRONG: 'STRONG',
} as const;

export type ReliabilityState = (typeof RELIABILITY_STATE)[keyof typeof RELIABILITY_STATE];

export const THRESHOLD_NOT_CERTIFIED = 'THRESHOLD_NOT_CERTIFIED';

export const FACT_CATEGORIES = {
  MINUTES: 'MINUTES',
  PRODUCTION: 'PRODUCTION',
  OPPORTUNITY: 'OPPORTUNITY',
  AVAILABILITY: 'AVAILABILITY',
  WOWY: 'WOWY',
  MATCHUP: 'MATCHUP',
  MARKET: 'MARKET',
} as const;

export type FactCategory = (typeof FACT_CATEGORIES)[keyof typeof FACT_CATEGORIES];

export type ContextFact = {
  layer: typeof CONTEXT_LAYER.FACT;
  category: FactCategory;
  key: string;
  value: string | number | boolean | null;
  observedAt: string | null;
  source: string | null;
  asOfSafe: boolean;
  liveAvailable: boolean;
  note: string;
};

export type ContextSignalId =
  | 'MINUTES_ELEVATED'
  | 'MINUTES_REDUCED'
  | 'ROLE_EXPANSION'
  | 'ROLE_CONTRACTION'
  | 'OPPORTUNITY_ELEVATED'
  | 'OPPORTUNITY_REDUCED'
  | 'TEAMMATE_OUT'
  | 'TEAMMATE_RETURNED'
  | 'WOWY_DIFFERENCE_PRESENT'
  | 'SMALL_WOWY_SAMPLE'
  | 'MATCHUP_PACE_HIGHER_THAN_BASELINE'
  | 'MATCHUP_PACE_LOWER_THAN_BASELINE'
  | 'MARKET_REPRICED_UP'
  | 'MARKET_REPRICED_DOWN';

export type ContextSignalDefinition = {
  id: ContextSignalId;
  layer: typeof CONTEXT_LAYER.SIGNAL;
  status: SignalDefinitionStatus;
  directionOnly: true;
  numericThreshold: typeof THRESHOLD_NOT_CERTIFIED | number;
  requiresFacts: readonly FactCategory[];
  note: string;
};

export const CONTEXT_SIGNAL_DEFINITIONS: readonly ContextSignalDefinition[] = [
  {
    id: 'MINUTES_ELEVATED',
    layer: CONTEXT_LAYER.SIGNAL,
    status: SIGNAL_DEFINITION_STATUS.EXPERIMENTAL,
    directionOnly: true,
    numericThreshold: THRESHOLD_NOT_CERTIFIED,
    requiresFacts: [FACT_CATEGORIES.MINUTES],
    note: 'Conceptual recent-minutes-above-season-baseline. No new numeric cut in this step.',
  },
  {
    id: 'MINUTES_REDUCED',
    layer: CONTEXT_LAYER.SIGNAL,
    status: SIGNAL_DEFINITION_STATUS.EXPERIMENTAL,
    directionOnly: true,
    numericThreshold: THRESHOLD_NOT_CERTIFIED,
    requiresFacts: [FACT_CATEGORIES.MINUTES],
    note: 'Conceptual recent-minutes-below-season-baseline. No new numeric cut in this step.',
  },
  {
    id: 'ROLE_EXPANSION',
    layer: CONTEXT_LAYER.SIGNAL,
    status: SIGNAL_DEFINITION_STATUS.EXPERIMENTAL,
    directionOnly: true,
    numericThreshold: THRESHOLD_NOT_CERTIFIED,
    requiresFacts: [FACT_CATEGORIES.MINUTES, FACT_CATEGORIES.OPPORTUNITY],
    note: 'Candidate interpretation of expanded role. Not a model feature.',
  },
  {
    id: 'ROLE_CONTRACTION',
    layer: CONTEXT_LAYER.SIGNAL,
    status: SIGNAL_DEFINITION_STATUS.EXPERIMENTAL,
    directionOnly: true,
    numericThreshold: THRESHOLD_NOT_CERTIFIED,
    requiresFacts: [FACT_CATEGORIES.MINUTES, FACT_CATEGORIES.OPPORTUNITY],
    note: 'Candidate interpretation of contracted role. Not a model feature.',
  },
  {
    id: 'OPPORTUNITY_ELEVATED',
    layer: CONTEXT_LAYER.SIGNAL,
    status: SIGNAL_DEFINITION_STATUS.EXPERIMENTAL,
    directionOnly: true,
    numericThreshold: THRESHOLD_NOT_CERTIFIED,
    requiresFacts: [FACT_CATEGORIES.OPPORTUNITY],
    note: 'Uses already-certified Model C opportunity fields when present. No new threshold.',
  },
  {
    id: 'OPPORTUNITY_REDUCED',
    layer: CONTEXT_LAYER.SIGNAL,
    status: SIGNAL_DEFINITION_STATUS.EXPERIMENTAL,
    directionOnly: true,
    numericThreshold: THRESHOLD_NOT_CERTIFIED,
    requiresFacts: [FACT_CATEGORIES.OPPORTUNITY],
    note: 'Uses already-certified Model C opportunity fields when present. No new threshold.',
  },
  {
    id: 'TEAMMATE_OUT',
    layer: CONTEXT_LAYER.SIGNAL,
    status: SIGNAL_DEFINITION_STATUS.DEFINED,
    directionOnly: true,
    numericThreshold: THRESHOLD_NOT_CERTIFIED,
    requiresFacts: [FACT_CATEGORIES.AVAILABILITY],
    note: 'Requires an as-of-safe explicit Out observation before cutoff. Missing is not healthy.',
  },
  {
    id: 'TEAMMATE_RETURNED',
    layer: CONTEXT_LAYER.SIGNAL,
    status: SIGNAL_DEFINITION_STATUS.BLOCKED_BY_DATA,
    directionOnly: true,
    numericThreshold: THRESHOLD_NOT_CERTIFIED,
    requiresFacts: [FACT_CATEGORIES.AVAILABILITY],
    note: 'Available/returned vocabulary is not certified in current injury tape.',
  },
  {
    id: 'WOWY_DIFFERENCE_PRESENT',
    layer: CONTEXT_LAYER.SIGNAL,
    status: SIGNAL_DEFINITION_STATUS.DEFINED,
    directionOnly: true,
    numericThreshold: THRESHOLD_NOT_CERTIFIED,
    requiresFacts: [FACT_CATEGORIES.WOWY],
    note: 'Numeric WITH/WITHOUT difference exists. Not a projection adjustment.',
  },
  {
    id: 'SMALL_WOWY_SAMPLE',
    layer: CONTEXT_LAYER.SIGNAL,
    status: SIGNAL_DEFINITION_STATUS.DEFINED,
    directionOnly: true,
    numericThreshold: WOWY_LOW_SUPPORT_MIN_GAMES,
    requiresFacts: [FACT_CATEGORIES.WOWY],
    note: 'Uses already-certified game-level WOWY sample floors (2 insufficient / 8 low-support).',
  },
  {
    id: 'MATCHUP_PACE_HIGHER_THAN_BASELINE',
    layer: CONTEXT_LAYER.SIGNAL,
    status: SIGNAL_DEFINITION_STATUS.EXPERIMENTAL,
    directionOnly: true,
    numericThreshold: THRESHOLD_NOT_CERTIFIED,
    requiresFacts: [FACT_CATEGORIES.MATCHUP],
    note: 'Schedule/team/opponent context from Model D remains research-only and not promoted.',
  },
  {
    id: 'MATCHUP_PACE_LOWER_THAN_BASELINE',
    layer: CONTEXT_LAYER.SIGNAL,
    status: SIGNAL_DEFINITION_STATUS.EXPERIMENTAL,
    directionOnly: true,
    numericThreshold: THRESHOLD_NOT_CERTIFIED,
    requiresFacts: [FACT_CATEGORIES.MATCHUP],
    note: 'Schedule/team/opponent context from Model D remains research-only and not promoted.',
  },
  {
    id: 'MARKET_REPRICED_UP',
    layer: CONTEXT_LAYER.SIGNAL,
    status: SIGNAL_DEFINITION_STATUS.BLOCKED_BY_DATA,
    directionOnly: true,
    numericThreshold: THRESHOLD_NOT_CERTIFIED,
    requiresFacts: [FACT_CATEGORIES.MARKET],
    note: 'Line-movement snapshots are not certified as live Context Engine inputs in this step.',
  },
  {
    id: 'MARKET_REPRICED_DOWN',
    layer: CONTEXT_LAYER.SIGNAL,
    status: SIGNAL_DEFINITION_STATUS.BLOCKED_BY_DATA,
    directionOnly: true,
    numericThreshold: THRESHOLD_NOT_CERTIFIED,
    requiresFacts: [FACT_CATEGORIES.MARKET],
    note: 'Line-movement snapshots are not certified as live Context Engine inputs in this step.',
  },
];

export type ReliabilityDimensions = {
  sampleCount: number | null;
  recency: string | null;
  freshness: string | null;
  sourceAvailability: 'available' | 'missing' | 'stale' | 'blocked';
  historicalCoverage: string | null;
  stability: typeof THRESHOLD_NOT_CERTIFIED;
  qualificationStatus: 'qualified' | 'unqualified' | 'unknown';
};

export type ReliabilityAssessment = {
  state: ReliabilityState;
  dimensions: ReliabilityDimensions;
  stateThreshold: typeof THRESHOLD_NOT_CERTIFIED | 'wowy_support_policy_v1';
  opaqueConfidencePercentForbidden: true;
};

export type ModelFeatureEligibility = {
  layer: typeof CONTEXT_LAYER.MODEL_FEATURE;
  featureName: string;
  eligible: boolean;
  reason: string;
};

export type InterpretationCopy = {
  layer: typeof CONTEXT_LAYER.INTERPRETATION;
  consumer: 'xray' | 'props_explorer' | 'player_page' | 'game_page' | 'context_check' | 'model_lab';
  text: string;
};

export type ContextEngineSnapshot = {
  contractId: typeof CONTEXT_ENGINE_CONTRACT_ID;
  contractVersion: typeof CONTEXT_ENGINE_CONTRACT_VERSION;
  facts: ContextFact[];
  signals: Array<{
    definition: ContextSignalDefinition;
    present: boolean;
    reliability: ReliabilityAssessment;
  }>;
  modelFeatureEligibility: ModelFeatureEligibility[];
  interpretations: InterpretationCopy[];
  productionCertified: false;
};

export function signalDefinition(id: ContextSignalId): ContextSignalDefinition {
  const found = CONTEXT_SIGNAL_DEFINITIONS.find((row) => row.id === id);
  if (!found) throw new Error(`Unknown Context Engine signal ${id}`);
  return found;
}

export function assertLayerSeparation(value: {
  layer: ContextLayer;
  usedAs?: ContextLayer;
}): void {
  if (value.usedAs && value.usedAs !== value.layer) {
    throw new Error(`Layer violation: ${value.layer} cannot be used as ${value.usedAs}.`);
  }
}

export function reliabilityFromWowySample(withGames: number, withoutGames: number): ReliabilityAssessment {
  const tier = wowySupportTier(withGames, withoutGames);
  const state: ReliabilityState =
    tier === 'insufficient'
      ? RELIABILITY_STATE.INSUFFICIENT
      : tier === 'low_support'
        ? RELIABILITY_STATE.LIMITED
        : RELIABILITY_STATE.MODERATE;
  return {
    state,
    dimensions: {
      sampleCount: withGames + withoutGames,
      recency: null,
      freshness: null,
      sourceAvailability: 'available',
      historicalCoverage: `with=${withGames} without=${withoutGames}`,
      stability: THRESHOLD_NOT_CERTIFIED,
      qualificationStatus: tier === 'insufficient' ? 'unqualified' : 'qualified',
    },
    stateThreshold: 'wowy_support_policy_v1',
    opaqueConfidencePercentForbidden: true,
  };
}

export type AvailabilityFact = {
  playerId: string;
  gameId: string | null;
  source: string;
  observedAt: string;
  status: string | null;
  freshness: 'fresh' | 'stale' | 'unknown';
  knownBeforeCutoff: boolean;
};

export const AVAILABILITY_HEALTH = {
  HEALTHY: 'HEALTHY',
  UNKNOWN: 'UNKNOWN',
  EXPLICIT_OUT: 'EXPLICIT_OUT',
  STALE: 'STALE',
} as const;

export type AvailabilityHealth = (typeof AVAILABILITY_HEALTH)[keyof typeof AVAILABILITY_HEALTH];

/**
 * Missing, stale, or post-cutoff observations never become healthy.
 * HEALTHY is defined only so tests can assert it is unreachable from missing data.
 */
export function classifyAvailabilityHealth(observation: AvailabilityFact | null): AvailabilityHealth {
  if (!observation) return AVAILABILITY_HEALTH.UNKNOWN;
  if (!observation.knownBeforeCutoff) return AVAILABILITY_HEALTH.UNKNOWN;
  if (observation.freshness === 'stale') return AVAILABILITY_HEALTH.STALE;
  if (observation.status === 'Out' || observation.status === 'Out For Season') {
    return AVAILABILITY_HEALTH.EXPLICIT_OUT;
  }
  return AVAILABILITY_HEALTH.UNKNOWN;
}

export function missingAvailabilityIsNotHealthy(observation: AvailabilityFact | null): boolean {
  return classifyAvailabilityHealth(observation) !== AVAILABILITY_HEALTH.HEALTHY;
}

export type WowyContextInput = {
  teammateCondition: 'out' | 'unknown' | 'missing';
  withSample: number;
  withoutSample: number;
  statDifference: number | null;
  minutesDifference: number | null;
  cutoffAt: string;
  availabilityKnownBeforeCutoff: boolean;
};

export type WowySignalQualification = {
  qualified: boolean;
  reason: string;
  reliability: ReliabilityAssessment;
  mayAdjustProjection: false;
};

export function qualifyWowySignal(input: WowyContextInput): WowySignalQualification {
  const reliability = reliabilityFromWowySample(input.withSample, input.withoutSample);
  if (!input.availabilityKnownBeforeCutoff || input.teammateCondition !== 'out') {
    return {
      qualified: false,
      reason: 'WOWY signal cannot qualify without required sample/context (as-of-safe Out before cutoff).',
      reliability: {
        ...reliability,
        dimensions: { ...reliability.dimensions, qualificationStatus: 'unqualified' },
      },
      mayAdjustProjection: false,
    };
  }
  if (input.withSample < WOWY_INSUFFICIENT_MIN_GAMES || input.withoutSample < WOWY_INSUFFICIENT_MIN_GAMES) {
    return {
      qualified: false,
      reason: `WOWY sample below certified insufficient floor (${WOWY_INSUFFICIENT_MIN_GAMES} per side).`,
      reliability,
      mayAdjustProjection: false,
    };
  }
  return {
    qualified: reliability.dimensions.qualificationStatus === 'qualified',
    reason: 'Qualified as a Context Engine WOWY signal only. Not a projection adjustment.',
    reliability,
    mayAdjustProjection: false,
  };
}

export function pregameAvailabilityOrUnknown(args: {
  teammatePlayerId: string;
  cutoffStartTime: string;
  observations: PregameAvailabilityObservation[];
}): { healthy: false; predictiveEligible: boolean; status: string | null } {
  const gate = selectObservedPregameScenario(args);
  return {
    healthy: false,
    predictiveEligible: gate.predictiveEligible,
    status: gate.usedStatus,
  };
}

export const MISSING_DATA_BEHAVIOR = {
  injuryUnavailable: 'CANDIDATE_C_WITHOUT_WOWY',
  availabilityStale: 'CANDIDATE_C_WITHOUT_WOWY',
  wowyUnqualified: 'CANDIDATE_C_WITHOUT_WOWY',
  imputeOutTeammate: false,
  treatMissingAsHealthy: false,
} as const;

export const XRAY_CONSUMER_BOUNDARY = {
  ownerOfBasketballLogic: 'context_engine',
  xrayRole: 'presentation_consumer',
  wiredInThisStep: false,
  example: {
    engine: 'MINUTES_ELEVATED sample=... reliability=...',
    xray: 'Recent minutes are above the player\'s season baseline.',
  },
} as const;

export const MODEL_LAB_RESPONSIBILITY = {
  surface: '/admin/model-lab',
  isProductionPredictionEndpoint: false,
  responsibilities: [
    'inspecting candidate facts',
    'comparing signals',
    'testing candidate model features',
    'comparing baseline vs candidate',
    'inspecting failure cases',
    'evaluating reliability/sample size',
    'replaying development datasets',
    'freezing candidate versions',
    'reviewing prospective shadow results later',
  ],
} as const;
