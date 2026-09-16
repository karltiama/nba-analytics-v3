import type { CanonicalPropType } from '@/lib/betting/market-movement';
import type { FormLineRead, MarketPositionKind, XRayLegInterpretation } from './types';

export const PARLAY_SUMMARY_STATES = [
  'WELL_COVERED',
  'MIXED_CONTEXT',
  'DEPENDENCY_CONCENTRATION',
  'LIMITED_DATA',
  'MULTIPLE_COUNTERSIGNALS',
] as const;
export type ParlaySummaryState = (typeof PARLAY_SUMMARY_STATES)[number];

export const PARLAY_DEPENDENCY_KINDS = [
  'SHARED_PLAYER',
  'SHARED_GAME',
  'SHARED_TEAM',
  'SHARED_OPPONENT',
  'SHARED_GAME_ENVIRONMENT',
  'SHARED_ROLE_ASSUMPTION',
  'DUPLICATE_LEG',
  'NEAR_DUPLICATE_LEG',
  'OPPOSITE_SIDE_SAME_MARKET',
  'LOGICAL_CONFLICT',
] as const;
export type ParlayDependencyKind = (typeof PARLAY_DEPENDENCY_KINDS)[number];

export const PARLAY_REVIEW_FLAGS = [
  'NEEDS_IDENTITY_CONFIRMATION',
  'PARTIAL_MARKET_MATCH',
  'LIMITED_SAMPLE',
  'MISSING_CONTEXT',
  'COUNTERSIGNALS_PRESENT',
] as const;
export type ParlayReviewFlag = (typeof PARLAY_REVIEW_FLAGS)[number];

export const PARLAY_EVIDENCE_CODES = [
  'PARLAY_SHARED_PLAYER',
  'PARLAY_SHARED_GAME',
  'PARLAY_SHARED_TEAM',
  'PARLAY_SHARED_ROLE',
  'PARLAY_LOGICAL_CONFLICT',
  'PARLAY_DUPLICATE_LEG',
  'PARLAY_NEAR_DUPLICATE',
  'PARLAY_OPPOSITE_SIDE',
  'PARLAY_SHARED_GAP_WOWY',
  'PARLAY_SHARED_GAP_PROJECTION',
  'PARLAY_SHARED_GAP_AVAILABILITY',
  'PARLAY_FORM_COUNTERSIGNALS',
  'PARLAY_MARKET_WORSE_COUNT',
  'PARLAY_PARTIAL_MARKET',
  'PARLAY_LIMITED_SAMPLE',
  'PARLAY_CANONICAL_COVERAGE',
  'PARLAY_FORM_WINDOW_COVERAGE',
  'PARLAY_MARKET_BETTER_OR_SAME',
] as const;
export type ParlayEvidenceCode = (typeof PARLAY_EVIDENCE_CODES)[number];

export const PARLAY_SUMMARY_STATE_COPY: Record<ParlaySummaryState, string> = {
  WELL_COVERED: 'Well covered',
  MIXED_CONTEXT: 'Mixed context',
  DEPENDENCY_CONCENTRATION: 'Dependency concentration',
  LIMITED_DATA: 'Limited data',
  MULTIPLE_COUNTERSIGNALS: 'Multiple countersignals',
};

export type ParlayEvidence = {
  code: ParlayEvidenceCode;
  title: string;
  detail: string;
  legIndexes: number[];
};

export type ParlayDependencyGroup = {
  kind: ParlayDependencyKind;
  key: string;
  label: string;
  detail: string;
  legIndexes: number[];
  playerDisplayName: string | null;
  gameId: string | null;
  teamAbbr: string | null;
  markets: Array<CanonicalPropType | null>;
};

export type ParlayLegReview = {
  legIndex: number;
  playerDisplayName: string | null;
  market: CanonicalPropType | null;
  flags: ParlayReviewFlag[];
};

export type ParlayContextCoverage = {
  legCount: number;
  identityResolvedCount: number;
  identityNeedsConfirmationCount: number;
  marketMatchCount: number;
  exactBookCount: number;
  partialMarketCount: number;
  recentFormCount: number;
  formWindowCount: number;
  availabilityCount: number;
  projectionCount: number;
  wowyCount: number;
};

export type ParlayMarketPositionCounts = {
  betterThanClose: number;
  sameAsClose: number;
  worseThanClose: number;
  unknown: number;
};

export type ParlayFormCounts = {
  aboveMoreOften: number;
  belowMoreOften: number;
  evenSplit: number;
  limitedSample: number;
};

export type ParlayDataQuality = {
  canonical: { have: number; of: number };
  historicalMarket: { exact: number; partial: number; of: number };
  recentForm: { have: number; of: number };
  role: { have: number; of: number };
  wowy: { have: number; of: number };
  projection: { have: number; of: number };
  availability: { have: number; of: number };
};

export type XRayParlayInterpretation = {
  legCount: number;
  contextCoverage: ParlayContextCoverage;
  dependencyGroups: ParlayDependencyGroup[];
  sharedAssumptions: ParlayEvidence[];
  supportingContext: ParlayEvidence[];
  crossLegUncertainties: ParlayEvidence[];
  whyThisParlayCouldFail: ParlayEvidence[];
  reviewNeeded: ParlayLegReview[];
  marketPositionCounts: ParlayMarketPositionCounts;
  formCounts: ParlayFormCounts;
  dataQuality: ParlayDataQuality;
  summaryState: ParlaySummaryState;
  summarySentence: string;
};

export type ParlayInterpretationInput = XRayLegInterpretation;
