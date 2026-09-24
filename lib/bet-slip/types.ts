/**
 * Sportsbook-independent bet-slip domain (prop-slip v1).
 * Selection identity is independent of book and odds; priced offers remain in CanonicalParlayOffer.
 */

import type {
  CanonicalPropType,
  PlayerPropV1Vendor,
} from '@/lib/betting/market-movement';
import type { ParlayLegSide } from '@/lib/parlay-xray/types';

export const BET_SLIP_SPORT_NBA = 'nba' as const;
export type BetSlipSport = typeof BET_SLIP_SPORT_NBA;

export const SHARED_BET_SLIP_SNAPSHOT_VERSION = 1 as const;

export const CANONICAL_BET_SLIP_SOURCES = [
  'props_explorer',
  'player_page',
  'parlay_xray',
  'shared_slip',
  'manual',
] as const;
export type CanonicalBetSlipSource = (typeof CANONICAL_BET_SLIP_SOURCES)[number];

export type CanonicalBetLegSourceMeta = {
  provider?: string | null;
  providerMarketId?: string | null;
};

/**
 * Frozen selection snapshot. Identity = selectionKey (not odds, not sportsbook).
 * selectedSportsbook / selectedOdds are historical metadata only.
 */
export type CanonicalBetLeg = {
  selectionKey: string;
  sport: BetSlipSport;
  gameId: string;
  playerId: string;
  market: CanonicalPropType;
  side: ParlayLegSide;
  line: number;
  playerName: string;
  teamAbbreviation?: string | null;
  opponentAbbreviation?: string | null;
  gameLabel?: string | null;
  selectedSportsbook?: PlayerPropV1Vendor | null;
  selectedOdds?: number | null;
  selectedAt: string;
  source?: CanonicalBetLegSourceMeta;
};

export type CanonicalBetSlip = {
  legs: CanonicalBetLeg[];
  source: CanonicalBetSlipSource;
  title?: string | null;
};

export const MARKET_MATCH_STATUSES = [
  'EXACT',
  'ODDS_CHANGED',
  'LINE_CHANGED',
  'SUSPENDED',
  'NOT_FOUND',
  'UNSUPPORTED',
] as const;
export type MarketMatchStatus = (typeof MARKET_MATCH_STATUSES)[number];

/** Future sportsbook adapter result. No deeplink/provider implementation in Phase 1F. */
export type ResolvedSportsbookLeg = {
  original: CanonicalBetLeg;
  sportsbook: PlayerPropV1Vendor;
  status: MarketMatchStatus;
  currentLine?: number | null;
  currentOdds?: number | null;
  externalMarketId?: string | null;
  deeplink?: string | null;
};

/** Public-safe shared slip (never includes DB id or created_by). */
export type PublicSharedBetSlip = {
  shareId: string;
  title: string | null;
  source: CanonicalBetSlipSource;
  snapshotVersion: number;
  legs: CanonicalBetLeg[];
  createdAt: string;
  /** App path component, e.g. `/slip/abc...` */
  path: string;
};
