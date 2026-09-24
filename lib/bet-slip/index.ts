/** Client-safe bet-slip domain exports (no DB). */

export {
  BET_SLIP_SPORT_NBA,
  CANONICAL_BET_SLIP_SOURCES,
  MARKET_MATCH_STATUSES,
  SHARED_BET_SLIP_SNAPSHOT_VERSION,
} from './types';
export type {
  BetSlipSport,
  CanonicalBetLeg,
  CanonicalBetLegSourceMeta,
  CanonicalBetSlip,
  CanonicalBetSlipSource,
  MarketMatchStatus,
  PublicSharedBetSlip,
  ResolvedSportsbookLeg,
} from './types';

export {
  canonicalSelectionKey,
  coerceSelectionLine,
  hasCanonicalSelection,
  sameCanonicalSelection,
  selectionLineToken,
} from './selection-key';
export type { SelectionKeyInput } from './selection-key';

export {
  betSlipSourceFromParlayOfferSource,
  canonicalBetLegFromParlayOffer,
  canonicalBetLegFromSelectedParlayLeg,
  canonicalBetSlipFromSelectedLegs,
} from './adapt-parlay-leg';

export {
  importSharedBetLegsToStore,
  selectedParlayLegFromSharedBetLeg,
} from './adapt-shared-import';
export type { ImportSharedSlipResult } from './adapt-shared-import';

export {
  shareLegFingerprintToken,
  shareSlipFingerprint,
} from './share-fingerprint';

export {
  absoluteShareUrl,
  displayShareHostPath,
  ensureSharedSlipFromSelection,
  legsToSharePayload,
} from './share-client';
export type { EnsureSharedSlipResult } from './share-client';

export {
  clearCachedSharedSlip,
  getCachedSharedSlip,
  peekCachedSharedSlip,
  setCachedSharedSlip,
} from './share-session';
export type { CachedSharedSlip } from './share-session';

export {
  buildSharedSlipMetaDescription,
  buildSharedSlipMetaTitle,
  formatSharedLine,
  formatSharedOdds,
  sharedLegHeadline,
} from './shared-slip-present';
