import type { CanonicalParlayLegResolution } from '@/lib/parlay-xray/resolution/types';
import type { ParlayLegSide } from '@/lib/parlay-xray/types';
import {
  PLAYER_PROP_COMPARISON_KIND,
  PLAYER_PROP_REFERENCE_KIND,
  type CanonicalPropType,
  type PlayerPropV1Vendor,
} from '@/lib/betting/market-movement';

export const REPLAY_MATCH_STATUSES = ['MATCHED', 'PARTIAL_MATCH', 'NEEDS_CONFIRMATION', 'NO_MATCH'] as const;
export type ReplayMatchStatus = (typeof REPLAY_MATCH_STATUSES)[number];

export const LINE_MATCH_QUALITIES = [
  'EXACT_LINE_MATCH',
  'MARKET_MATCH_DIFFERENT_LINE',
  'NO_MARKET_MATCH',
] as const;
export type LineMatchQuality = (typeof LINE_MATCH_QUALITIES)[number];

export type HistoricalParlayLegReplayInput = {
  historicalDate: string;
  playerId: string | null;
  playerDisplayName: string | null;
  entityId: string | null;
  gameId: string | null;
  market: CanonicalPropType | null;
  marketUnsupported: boolean;
  side: ParlayLegSide | null;
  line: number | null;
  sportsbookVendor: string | null;
  playerResolved: boolean;
  gameResolved: boolean;
};

export type HistoricalSnapshot = {
  kind: typeof PLAYER_PROP_REFERENCE_KIND | typeof PLAYER_PROP_COMPARISON_KIND;
  label: '3-Hour Pre-Tip' | 'Decision Close';
  available: boolean;
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  timestamp: string | null;
};

export type HistoricalBookCandidate = {
  vendor: PlayerPropV1Vendor;
  referenceLine: number | null;
  comparisonLine: number | null;
  lineExact: boolean;
};

export type HistoricalMatchExactness = {
  playerExact: boolean;
  gameExact: boolean;
  marketExact: boolean;
  lineExact: boolean;
  bookExact: boolean;
  snapshotAvailable: {
    threeHourPreTip: boolean;
    decisionClose: boolean;
  };
};

export type HistoricalMovementRow = {
  game_id: string;
  player_id: string;
  prop_type: string;
  vendor: string;
  reference_kind: string;
  reference_line: string | number | null;
  reference_over_odds: number | null;
  reference_under_odds: number | null;
  reference_timestamp: string | Date | null;
  comparison_kind: string;
  comparison_line: string | number | null;
  comparison_over_odds: number | null;
  comparison_under_odds: number | null;
  comparison_timestamp: string | Date | null;
};

export type HistoricalParlayLegMatch = {
  input: HistoricalParlayLegReplayInput;
  status: ReplayMatchStatus;
  reason: string | null;
  lineQuality: LineMatchQuality;
  exactness: HistoricalMatchExactness;
  matchedVendor: PlayerPropV1Vendor | null;
  availableBooks: HistoricalBookCandidate[];
  reference: HistoricalSnapshot;
  comparison: HistoricalSnapshot;
  requestedLine: number | null;
  requestedSide: ParlayLegSide | null;
};

export function replayInputFromResolution(
  resolution: CanonicalParlayLegResolution,
  historicalDate: string
): HistoricalParlayLegReplayInput {
  return {
    historicalDate,
    playerId: resolution.playerResolution.value?.playerId ?? null,
    playerDisplayName: resolution.playerResolution.value?.displayName ?? null,
    entityId: resolution.playerResolution.value?.entityId ?? null,
    gameId: resolution.gameResolution.value?.gameId ?? null,
    market: resolution.marketResolution.value?.propType ?? null,
    marketUnsupported: resolution.marketResolution.unsupported,
    side: resolution.sideResolution.value,
    line: resolution.lineResolution.value,
    sportsbookVendor: resolution.sportsbookResolution.value?.vendor ?? null,
    playerResolved: resolution.playerResolution.status === 'RESOLVED',
    gameResolved: resolution.gameResolution.status === 'RESOLVED',
  };
}
