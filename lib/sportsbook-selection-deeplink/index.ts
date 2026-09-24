/**
 * Phase 4A spike — Level-3 selection deeplink boundary.
 * Removable: production handoff must not import this module by default.
 */

export type {
  GameMatchContext,
  ResolveSelectionInput,
  SportsbookSelectionDeeplinkProvider,
  SportsbookSelectionResolution,
  SportsbookSelectionResolutionStatus,
} from './types';

export {
  EVENT_COMMENCE_TOLERANCE_MS,
  SPORTSBOOK_SELECTION_RESOLUTION_STATUSES,
} from './types';

export {
  isOddsApiPlayerPropMarketSupported,
  mapCanonicalPropToOddsApiMarket,
  ODDS_API_PLAYER_PROP_MARKETS,
} from './market-map';
export type { OddsApiPlayerPropMarket } from './market-map';

export {
  matchProviderEvent,
  normalizeTeamAbbreviation,
  parseGameLabelToMatchContext,
  resolveGameMatchContext,
  teamNameToAbbreviation,
  ODDS_API_TEAM_NAME_TO_ABBR,
} from './event-match';
export type { EventMatchResult, ProviderEventCandidate } from './event-match';

export { matchNormalizedSelection } from './match-selection';
export type {
  NormalizedMarketSnapshot,
  NormalizedOutcome,
  SelectionMatchQuery,
  SelectionMatchResult,
} from './match-selection';

export { DEFAULT_SPIKE_CACHE_TTL_MS, TtlCache } from './cache';

export { OddsApiSelectionDeeplinkAdapter } from './odds-api/adapter';
export type { OddsApiSelectionAdapterOptions } from './odds-api/adapter';

export { createOddsApiClientFromEnv, OddsApiClient } from './odds-api/client';
export { oddsApiBookmakerKey, HANDOFF_TO_ODDS_API_BOOKMAKER } from './odds-api/bookmaker-map';

/** True when the Level-3 prototype UI may render (dev flag only). */
export function isOddsApiHandoffSpikeEnabled(
  env: { NEXT_PUBLIC_ODDS_API_HANDOFF_SPIKE?: string; NODE_ENV?: string } = process.env
): boolean {
  if (env.NEXT_PUBLIC_ODDS_API_HANDOFF_SPIKE === '1') return true;
  return false;
}

export {
  CERT_MARKETS,
  classifyDeeplinkCoverageState,
  classifyTimeToTipBucket,
  runLevel3Certification,
} from './certification';
export type {
  DeeplinkCoverageState,
  Level3CertificationReport,
  TimeToTipBucket,
} from './certification';
