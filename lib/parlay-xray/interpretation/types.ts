import type { CanonicalPropType } from '@/lib/betting/market-movement';
import type { ParlayLegSide } from '@/lib/parlay-xray/types';
import type { XRayLegContext } from '@/lib/parlay-xray/context/types';

export const INTERPRETATION_CODES = [
  'MARKET_BETTER_NUMBER_THAN_CLOSE',
  'MARKET_WORSE_NUMBER_THAN_CLOSE',
  'MARKET_SAME_AS_CLOSE',
  'MARKET_CLOSE_UNKNOWN',
  'MARKET_PARTIAL_MATCH',
  'MARKET_BOOK_UNAVAILABLE',
  'MARKET_MISSING_THREE_HOUR',
  'FORM_ABOVE_LINE_MORE_OFTEN',
  'FORM_BELOW_LINE_MORE_OFTEN',
  'FORM_EVEN_SPLIT',
  'FORM_STD_ABOVE_LINE',
  'FORM_STD_BELOW_LINE',
  'FORM_SMALL_SAMPLE',
  'FORM_ZERO_SAMPLE',
  'ROLE_MINUTES_ABOVE_BASELINE',
  'ROLE_MINUTES_BELOW_BASELINE',
  'NO_AS_OF_SAFE_WOWY',
  'NO_ARCHIVED_PROJECTION',
  'NO_HISTORICAL_AVAILABILITY',
  'STARTERS_POSTGAME_CONFIRMED',
] as const;
export type InterpretationCode = (typeof INTERPRETATION_CODES)[number];

export const MARKET_POSITIONS = [
  'BETTER_NUMBER_THAN_CLOSE',
  'SAME_AS_CLOSE',
  'WORSE_NUMBER_THAN_CLOSE',
  'UNKNOWN',
] as const;
export type MarketPositionKind = (typeof MARKET_POSITIONS)[number];

export const FORM_LINE_READS = [
  'ABOVE_MORE_OFTEN_THAN_BELOW',
  'BELOW_MORE_OFTEN_THAN_ABOVE',
  'EVEN_SPLIT',
  'LIMITED_SAMPLE',
] as const;
export type FormLineRead = (typeof FORM_LINE_READS)[number];

export const SAMPLE_BANDS = ['ZERO', 'SMALL_SAMPLE', 'PARTIAL_SAMPLE', 'WINDOW_AVAILABLE'] as const;
export type SampleBand = (typeof SAMPLE_BANDS)[number];

export const SUMMARY_STATES = [
  'SUPPORTIVE_CONTEXT',
  'MIXED_CONTEXT',
  'COUNTERSIGNALS_PRESENT',
  'LIMITED_DATA',
  'NEUTRAL_CONTEXT',
] as const;
export type InterpretationSummaryState = (typeof SUMMARY_STATES)[number];

export const EVIDENCE_CATEGORIES = ['MARKET', 'FORM', 'ROLE', 'MATCHUP', 'COVERAGE'] as const;
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

export type InterpretationEvidence = {
  code: InterpretationCode;
  category: EvidenceCategory;
  title: string;
  detail: string;
};

export type XRayLegInterpretation = {
  identity: {
    playerDisplayName: string | null;
    market: CanonicalPropType | null;
    side: ParlayLegSide | null;
    line: number | null;
    sportsbook: string | null;
    teamAbbr: string | null;
    opponentAbbr: string | null;
    gameId: string | null;
    historicalDate: string | null;
    contextCutoffAt: string | null;
  };
  marketPosition: {
    kind: MarketPositionKind;
    requestedLine: number | null;
    threeHourLine: number | null;
    threeHourOdds: number | null;
    closeLine: number | null;
    closeOdds: number | null;
    lineDeltaCloseMinusRequested: number | null;
  };
  recentForm: {
    lineRead: FormLineRead;
    sampleBand: SampleBand;
    seasonAverage: number | null;
    seasonGames: number;
    last5Average: number | null;
    last10Average: number | null;
    above: number;
    below: number;
    equal: number;
    sampleCount: number;
  };
  role: {
    priorGameMinutes: number | null;
    seasonMinutes: number | null;
    last5Minutes: number | null;
    last10Minutes: number | null;
    minutesVsSeason: 'ABOVE' | 'BELOW' | 'NEAR' | 'UNKNOWN';
  };
  matchup: {
    opponentAbbr: string | null;
    teamPace: number | null;
    opponentPace: number | null;
    opponentPointsAllowed: number | null;
    teamPoints: number | null;
  };
  supportingContext: InterpretationEvidence[];
  counterContext: InterpretationEvidence[];
  uncertainties: InterpretationEvidence[];
  whyItCouldFail: InterpretationEvidence[];
  dataAvailability: {
    wowy: 'UNAVAILABLE' | 'AVAILABLE' | 'LIMITED';
    projection: 'UNAVAILABLE' | 'AVAILABLE' | 'LIMITED';
    availability: 'UNAVAILABLE' | 'AVAILABLE' | 'LIMITED';
    market: XRayLegContext['market']['status'];
    playerForm: XRayLegContext['playerForm']['status'];
  };
  summaryState: InterpretationSummaryState;
  summarySentence: string;
};

export const SUMMARY_STATE_COPY: Record<InterpretationSummaryState, string> = {
  SUPPORTIVE_CONTEXT: 'Supportive context',
  MIXED_CONTEXT: 'Mixed context',
  COUNTERSIGNALS_PRESENT: 'Countersignals present',
  LIMITED_DATA: 'Limited data',
  NEUTRAL_CONTEXT: 'Neutral context',
};

export type XRayInterpretationParlaySummary = {
  legCount: number;
  fullContextCount: number;
  limitedCount: number;
  marketMatchCount: number;
  partialMarketCount: number;
};
