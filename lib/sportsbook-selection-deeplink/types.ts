/**
 * Sportsbook-independent Level-3 selection deeplink boundary (Phase 4A spike).
 * Provider-specific response shapes must not leak into these types.
 */

import type { CanonicalBetLeg } from '@/lib/bet-slip/types';
import type { SportsbookHandoffProvider } from '@/lib/sportsbook-handoff/types';

export const SPORTSBOOK_SELECTION_RESOLUTION_STATUSES = [
  'EXACT',
  'LINE_CHANGED',
  'NOT_FOUND',
  'DEEPLINK_UNAVAILABLE',
  'UNSUPPORTED_MARKET',
] as const;

export type SportsbookSelectionResolutionStatus =
  (typeof SPORTSBOOK_SELECTION_RESOLUTION_STATUSES)[number];

/**
 * Tip-time tolerance when matching Court Context games to provider events.
 * Same calendar tip slots can drift a few minutes across feeds.
 */
export const EVENT_COMMENCE_TOLERANCE_MS = 3 * 60 * 60 * 1000; // ±3 hours

/** Normalized game identity used for provider event matching (not Odds API ids). */
export type GameMatchContext = {
  homeAbbreviation: string;
  awayAbbreviation: string;
  /** ISO-8601 tip / commence time from Court Context schedule. */
  commenceTimeIso: string;
};

export type ResolveSelectionInput = {
  leg: CanonicalBetLeg;
  sportsbook: SportsbookHandoffProvider;
  /**
   * Preferred matching context. When omitted, adapter may attempt to derive
   * home/away from leg.gameLabel ("AWAY @ HOME") + team abbreviations.
   */
  game?: GameMatchContext | null;
};

export type SportsbookSelectionResolution = {
  status: SportsbookSelectionResolutionStatus;
  sportsbook: SportsbookHandoffProvider;

  currentLine?: number;
  currentOdds?: number;

  /** Sportsbook-native event id when provider exposes a SID (not Court Context gameId). */
  sportsbookEventId?: string | null;
  /** Sportsbook-native market id when provider exposes a SID. */
  sportsbookMarketId?: string | null;
  /** Sportsbook-native selection/outcome id when provider exposes a SID. */
  sportsbookSelectionId?: string | null;

  /** Provider-generated HTTPS deeplink only — never synthesized. */
  deeplink?: string | null;

  /** Deepest verified handoff level for this resolution (0=home … 3=single selection). */
  verifiedLevel: 0 | 1 | 2 | 3;

  resolvedAt: string;
  notes?: string;
};

export interface SportsbookSelectionDeeplinkProvider {
  resolveSelection(input: ResolveSelectionInput): Promise<SportsbookSelectionResolution>;
}
