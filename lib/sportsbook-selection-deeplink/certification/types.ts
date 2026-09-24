/**
 * Phase 4B Level-3 coverage certification types.
 * Reports must never include API keys or auth secrets.
 */

import type { SportsbookHandoffProvider } from '@/lib/sportsbook-handoff/types';

export const CERT_MARKETS = [
  'player_points',
  'player_rebounds',
  'player_assists',
  'player_threes',
  'player_points_rebounds_assists',
] as const;

export type CertMarketKey = (typeof CERT_MARKETS)[number];

export const TIME_TO_TIP_BUCKETS = [
  'gt_24h',
  'h_12_24',
  'h_6_12',
  'h_3_6',
  'h_1_3',
  'lt_1h',
  'started_or_past',
] as const;

export type TimeToTipBucket = (typeof TIME_TO_TIP_BUCKETS)[number];

export const DEEPLINK_COVERAGE_STATES = [
  'BOOK_ENTIRELY_ABSENT',
  'BOOK_RETURNED_NO_MARKET',
  'MARKET_NOT_RETURNED',
  'OUTCOMES_RETURNED_NO_SID',
  'SID_NO_LINK',
  'DEEPLINK_AVAILABLE',
  'DEEPLINK_REJECTED_ALLOWLIST',
] as const;

export type DeeplinkCoverageState = (typeof DEEPLINK_COVERAGE_STATES)[number];

export type AccessLimitation =
  | 'NONE_OBSERVED'
  | 'PAID_ACCESS_REQUIRED'
  | 'UNCONFIRMED'
  | 'FREE_KEY_OBSERVED';

export type Level3ProviderReady = 'YES' | 'NO' | 'INSUFFICIENT_SAMPLE';

export type LinkValidityRecord = {
  host: string | null;
  https: boolean;
  allowlisted: boolean;
  providerHostMatch: boolean | null;
  reason?: string;
  /** Masked path/query shape only — never full selection ids in bulk dumps if sensitive. */
  urlShape: string | null;
};

export type OutcomeObservation = {
  playerName: string;
  side: 'over' | 'under';
  line: number;
  oddsAmerican: number;
  selectionSid: string | null;
  hasLink: boolean;
  linkValidity: LinkValidityRecord | null;
};

export type MarketObservation = {
  sportsbook: SportsbookHandoffProvider;
  oddsApiBookmakerKey: string;
  marketKey: CertMarketKey;
  state: DeeplinkCoverageState;
  bookPresent: boolean;
  marketPresent: boolean;
  outcomeCount: number;
  outcomesWithSid: number;
  outcomesWithLink: number;
  outcomesAllowlisted: number;
  eventSid: string | null;
  marketSid: string | null;
  outcomes: OutcomeObservation[];
};

export type EventObservation = {
  providerEventId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTimeIso: string;
  timeToTipBucket: TimeToTipBucket;
  hoursToTip: number | null;
  markets: MarketObservation[];
  requestCost: number | null;
};

export type ResolutionProbe = {
  sportsbook: SportsbookHandoffProvider;
  marketKey: CertMarketKey;
  playerName: string;
  side: 'over' | 'under';
  line: number;
  status: string;
  verifiedLevel: number;
  hasDeeplink: boolean;
  hasSelectionSid: boolean;
  allowlistOk: boolean | null;
};

export type SidStabilityPair = {
  sportsbook: SportsbookHandoffProvider;
  marketKey: CertMarketKey;
  playerName: string;
  side: 'over' | 'under';
  line: number;
  sampleA: {
    eventSid: string | null;
    marketSid: string | null;
    selectionSid: string | null;
    oddsAmerican: number;
    deeplinkShape: string | null;
    at: string;
  };
  sampleB: {
    eventSid: string | null;
    marketSid: string | null;
    selectionSid: string | null;
    oddsAmerican: number;
    deeplinkShape: string | null;
    at: string;
  };
  sameSelectionSid: boolean;
  sameEventSid: boolean;
  sameMarketSid: boolean;
  sameDeeplinkShape: boolean;
  oddsChanged: boolean;
  lineChanged: boolean;
};

export type BucketCounters = {
  eventsChecked: number;
  eventsWithSportsbook: number;
  eventsWithRequestedMarket: number;
  eventsWithOutcomes: number;
  outcomesWithSid: number;
  outcomesWithLink: number;
  exactSelectableLegs: number;
};

export type PerBookSummary = {
  provider: SportsbookHandoffProvider;
  eventsObserved: number;
  bookPresentEvents: number;
  propMarketPresentEvents: number;
  outcomeCount: number;
  outcomesWithSid: number;
  outcomesWithLink: number;
  outcomesAllowlisted: number;
  exactResolverProbes: number;
  exactResolverSuccess: number;
  deeplinkResolverSuccess: number;
  maxVerifiedLevel: 0 | 1 | 2 | 3;
  accessLimitation: AccessLimitation;
  level3ProviderReady: Level3ProviderReady;
  gateNotes: string[];
  /** Percentages only when denominator > 0; null when N=0. */
  bookPresentPct: number | null;
  propMarketPresentPct: number | null;
  outcomeSidPct: number | null;
  outcomeLinkPct: number | null;
  exactResolverPct: number | null;
  byBucket: Partial<Record<TimeToTipBucket, BucketCounters>>;
  byMarket: Partial<
    Record<
      CertMarketKey,
      {
        marketReturnedEvents: number;
        outcomeCount: number;
        outcomesWithSid: number;
        outcomesWithLink: number;
      }
    >
  >;
  coverageStateCounts: Partial<Record<DeeplinkCoverageState, number>>;
};

export type FanDuelCertificationSummary = {
  gamesSampled: number;
  marketsSampled: number;
  eligibleSelections: number;
  selectionsWithOutcomeSid: number;
  selectionsWithDeeplink: number;
  allowlistPassRate: number | null;
  resolutionPassRate: number | null;
};

export type CertificationCredits = {
  startingRemaining: number | null;
  endingRemaining: number | null;
  observedCostSum: number;
  requestsRecorded: number;
};

export type Level3CertificationReport = {
  schemaVersion: 1;
  phase: 'PROP_HANDOFF_PHASE_4B_LEVEL3_CERTIFICATION';
  runTimestamp: string;
  mode: 'live' | 'fixture';
  marketsRequested: readonly CertMarketKey[];
  eventsInspected: number;
  credits: CertificationCredits;
  perBook: PerBookSummary[];
  fanDuel: FanDuelCertificationSummary | null;
  resolutionProbes: ResolutionProbe[];
  sidStability: SidStabilityPair[];
  allowlistFailures: Array<{ sportsbook: SportsbookHandoffProvider; host: string; urlShape: string }>;
  maskedLinkSamples: Array<{
    sportsbook: SportsbookHandoffProvider;
    host: string;
    urlShape: string;
  }>;
  paidTierNotes: string[];
  architectureNotes: string[];
  /** Explicitly absent — guard for tests. */
  apiKeyPresentInArtifact: false;
};
