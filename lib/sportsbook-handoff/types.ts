/**
 * Sportsbook handoff domain — separate from odds-ingestion vendor types.
 * Phase 3 ships homepage-level destinations only.
 */

import type { CanonicalBetLeg, CanonicalBetSlip } from '@/lib/bet-slip/types';

export const SPORTSBOOK_HANDOFF_PROVIDERS = [
  'draftkings',
  'fanduel',
  'caesars',
  'fanatics',
  'betmgm',
] as const;

export type SportsbookHandoffProvider = (typeof SPORTSBOOK_HANDOFF_PROVIDERS)[number];

export const HANDOFF_CAPABILITY_STATUSES = [
  'confirmed',
  'unverified',
  'unavailable',
  'partner_only',
] as const;
export type HandoffCapabilityStatus = (typeof HANDOFF_CAPABILITY_STATUSES)[number];

export type SportsbookHandoffLevel =
  | 'sportsbook'
  | 'event'
  | 'market'
  | 'selection'
  | 'betslip';

export type SportsbookHandoffCapability = {
  sportsbook: SportsbookHandoffProvider;
  openSportsbook: HandoffCapabilityStatus;
  openEvent: HandoffCapabilityStatus;
  openMarket: HandoffCapabilityStatus;
  preloadSingleSelection: HandoffCapabilityStatus;
  preloadMultipleSelections: HandoffCapabilityStatus;
  preloadSameGameParlay: HandoffCapabilityStatus;
  requiresAffiliateRelationship: boolean;
  notes?: readonly string[];
};

export type SportsbookHandoffDestination = {
  sportsbook: SportsbookHandoffProvider;
  url: string;
  level: SportsbookHandoffLevel;
  verified: boolean;
};

/** Placeholder for future event-level handoff (unused in Phase 3). */
export type SportsbookEventHandoffInput = {
  gameId: string;
  /** Provider-native event id if/when available — never invent. */
  externalEventId?: string | null;
};

/** Placeholder for future selection-level handoff (unused in Phase 3). */
export type SportsbookSelectionHandoffInput = {
  leg: CanonicalBetLeg;
  externalMarketId?: string | null;
  externalSelectionId?: string | null;
};

export type ResolveSportsbookHandoffInput = {
  sportsbook: SportsbookHandoffProvider;
  slip?: CanonicalBetSlip | null;
  event?: SportsbookEventHandoffInput | null;
  selection?: SportsbookSelectionHandoffInput | null;
};

export type ResolveSportsbookHandoffResult = SportsbookHandoffDestination & {
  /** Deepest level requested by the call site (informational). */
  requestedLevel: SportsbookHandoffLevel;
};

export type SportsbookSlipResolutionStatus =
  | 'unavailable'
  | 'resolved';

/**
 * Future live market resolution result.
 * Phase 3 must not populate MarketMatchStatus from historical data.
 */
export type SportsbookSlipResolution = {
  status: SportsbookSlipResolutionStatus;
  sportsbook: SportsbookHandoffProvider;
  liveResolutionAvailable: boolean;
  message: string;
};

export const HANDOFF_PROVIDER_DISPLAY: Record<SportsbookHandoffProvider, string> = {
  draftkings: 'DraftKings',
  fanduel: 'FanDuel',
  caesars: 'Caesars',
  fanatics: 'Fanatics',
  betmgm: 'BetMGM',
};

/** Pinned provider-owned HTTPS destinations (Phase 3 homepage only). */
export const HANDOFF_SPORTSBOOK_HOME_URLS: Record<SportsbookHandoffProvider, string> = {
  draftkings: 'https://sportsbook.draftkings.com/',
  fanduel: 'https://sportsbook.fanduel.com/',
  caesars: 'https://sportsbook.caesars.com/',
  fanatics: 'https://betfanatics.com/sportsbook',
  betmgm: 'https://www.betmgm.com/en/sports',
};
