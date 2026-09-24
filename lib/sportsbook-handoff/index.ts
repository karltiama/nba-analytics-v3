export {
  HANDOFF_CAPABILITY_STATUSES,
  HANDOFF_PROVIDER_DISPLAY,
  HANDOFF_SPORTSBOOK_HOME_URLS,
  SPORTSBOOK_HANDOFF_PROVIDERS,
} from './types';
export type {
  HandoffCapabilityStatus,
  ResolveSportsbookHandoffInput,
  ResolveSportsbookHandoffResult,
  SportsbookEventHandoffInput,
  SportsbookHandoffCapability,
  SportsbookHandoffDestination,
  SportsbookHandoffLevel,
  SportsbookHandoffProvider,
  SportsbookSelectionHandoffInput,
  SportsbookSlipResolution,
  SportsbookSlipResolutionStatus,
} from './types';

export {
  SPORTSBOOK_HANDOFF_CAPABILITIES,
  getHandoffCapability,
  isSportsbookHandoffProvider,
  listHandoffProviders,
} from './capabilities';

export {
  HANDOFF_ALLOWED_HOSTS,
  assertHandoffDestinationUrl,
  getVerifiedSportsbookHomeUrl,
} from './allowlist';
export type { AssertHandoffUrlResult, HandoffAllowedHost } from './allowlist';

export {
  getSportsbookHandoffAdapter,
  listSportsbookHandoffAdapters,
} from './adapters';
export type { SportsbookHandoffAdapter } from './adapters';

export { openSportsbookLabel, resolveSportsbookHandoff } from './resolve-handoff';

export {
  UnavailableLiveSportsbookResolver,
  isLiveSportsbookResolutionAvailable,
  unavailableLiveSportsbookResolver,
} from './live-resolver';
export type { LiveSportsbookResolver } from './live-resolver';

export {
  handoffSheetLegFromCanonical,
  handoffSheetLegFromSelected,
} from './present';
export type { HandoffSheetLeg } from './present';
