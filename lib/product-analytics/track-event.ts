/**
 * Tiny product-event helper. Forwards to window.umami when present.
 * Safe no-op in SSR, local/dev without the script, and when trackers are blocked.
 */

import type { XrayExtractResult } from '@/lib/parlay-xray/extraction/result-codes';
import type { CanonicalPropType } from '@/lib/betting/market-movement';
import type { CanonicalParlaySelectionSourceContext } from '@/lib/parlay/selection';
import { shouldSuppressProductPreviewAnalytics } from '@/lib/parlay/preview-fixture';

export const PRODUCT_EVENTS = {
  MARKET_MOVEMENT_VIEWED: 'market_movement_viewed',
  MARKET_MOVEMENT_UPGRADE_CLICKED: 'market_movement_upgrade_clicked',
  HISTORICAL_GAME_VIEWED: 'historical_game_viewed',
  HISTORICAL_PLAYER_OPENED: 'historical_player_opened',
  HISTORICAL_TIMELINE_OPENED: 'historical_timeline_opened',
  PARLAY_XRAY_VIEWED: 'parlay_xray_viewed',
  PARLAY_XRAY_UPLOAD_STARTED: 'parlay_xray_upload_started',
  PARLAY_XRAY_UPLOAD_SELECTED: 'parlay_xray_upload_selected',
  PARLAY_XRAY_EXTRACT_STARTED: 'parlay_xray_extract_started',
  PARLAY_XRAY_EXTRACT_COMPLETED: 'parlay_xray_extract_completed',
  PARLAY_XRAY_EXTRACT_FAILED: 'parlay_xray_extract_failed',
  PARLAY_XRAY_OPEN_WORKSPACE: 'parlay_xray_open_workspace',
  PARLAY_WORKSPACE_ANALYSIS_STARTED: 'parlay_workspace_analysis_started',
  ONBOARDING_STARTED: 'onboarding_started',
  ONBOARDING_SKIPPED: 'onboarding_skipped',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  COACHMARK_SEEN: 'coachmark_seen',
  CHECKLIST_ITEM_COMPLETED: 'checklist_item_completed',
  TOUR_REPLAYED: 'tour_replayed',
  LANDING_CTA_CLICKED: 'landing_cta_clicked',
  PLAYER_SEARCH_USED: 'player_search_used',
  PLAYER_SEARCH_RESULT_OPENED: 'player_search_result_opened',
  PROP_OPENED: 'prop_opened',
  PROP_ADDED_TO_PARLAY: 'prop_added_to_parlay',
  PROP_CONTEXT_OPENED: 'prop_context_opened',
  SHARED_SLIP_CREATED: 'shared_slip_created',
  SHARED_SLIP_COPY_LINK: 'shared_slip_copy_link',
  SHARED_SLIP_NATIVE_SHARE: 'shared_slip_native_share',
  SHARED_SLIP_VIEWED: 'shared_slip_viewed',
  SHARED_SLIP_CTA_CLICKED: 'shared_slip_cta_clicked',
  SPORTSBOOK_HANDOFF_OPENED: 'sportsbook_handoff_opened',
  SPORTSBOOK_HANDOFF_PROVIDER_SELECTED: 'sportsbook_handoff_provider_selected',
  SPORTSBOOK_HANDOFF_OUTBOUND_CLICKED: 'sportsbook_handoff_outbound_clicked',
  WOWY_FILTER_CHANGED: 'wowy_filter_changed',
  CONTEXT_CHECK_OPENED: 'context_check_opened',
  UPGRADE_CLICKED: 'upgrade_clicked',
  CHECKOUT_STARTED: 'checkout_started',
  SIGNUP_STARTED: 'signup_started',
  SIGNUP_COMPLETED: 'signup_completed',
} as const;

export type ProductEventName = (typeof PRODUCT_EVENTS)[keyof typeof PRODUCT_EVENTS];

export type MarketMovementViewedProperties = {
  game_id: string;
  prop_type: string;
  detail: 'summary' | 'full';
  movement_status: 'ok' | 'empty' | 'unsupported_prop';
  consensus_book_count: number;
};

export type MarketMovementUpgradeClickedProperties = {
  surface: 'market_movement';
};

export type HistoricalGameViewedProperties = {
  game_id: string;
  season: string;
  starters_available: boolean;
  advanced_available: boolean;
  role_profile_available: boolean;
  timeline_available: boolean;
};

export type HistoricalPlayerOpenedProperties = {
  game_id: string;
  season: string;
  surface: 'season_role';
};

export type HistoricalTimelineOpenedProperties = {
  game_id: string;
  mode: 'key' | 'full';
};

export type ParlayXraySurfaceProperties = {
  surface: 'parlay_xray';
};

export type ClosedPropMarket = CanonicalPropType | 'other';

export type ParlayXrayExtractProperties = {
  surface: 'parlay_xray';
  result_category: XrayExtractResult | 'UNKNOWN';
};

export type LandingCtaLocation = 'hero' | 'header' | 'feature_section';

export type LandingCtaAction =
  | 'explore_court_context'
  | 'open_dashboard'
  | 'explore_props'
  | 'open_wowy'
  | 'open_parlay_xray'
  | 'sign_in'
  | 'sign_up';

export type LandingCtaClickedProperties = {
  surface: 'landing';
  location: LandingCtaLocation;
  action: LandingCtaAction;
};

export type PlayerSearchSurface = 'props_explorer' | 'wowy';

export type SearchResultCountBucket = '0' | '1_5' | '6_plus';

export type PlayerSearchUsedProperties = {
  surface: PlayerSearchSurface;
  result_count_bucket: SearchResultCountBucket;
};

export type PlayerSearchResultOpenedProperties = {
  surface: PlayerSearchSurface;
};

export type PropExplorerEventProperties = {
  surface: 'props_explorer';
  market: ClosedPropMarket;
};

export type PropContextOpenedProperties = {
  surface: 'props_explorer';
  context_type: 'player_panel';
  market: ClosedPropMarket;
};

export type SharedSlipSurface = 'props_explorer' | 'parlay_workspace' | 'shared_slip';

export type SharedSlipCreatedProperties = {
  surface: SharedSlipSurface;
  leg_count: number;
  reused: boolean;
};

export type SharedSlipCopyLinkProperties = {
  surface: SharedSlipSurface;
};

export type SharedSlipNativeShareProperties = {
  surface: SharedSlipSurface;
};

export type SharedSlipViewedProperties = {
  surface: 'shared_slip';
  leg_count: number;
};

export type SharedSlipCtaClickedProperties = {
  surface: 'shared_slip';
  action: 'add_to_court_context' | 'open_props_explorer' | 'share' | 'sign_in';
};

export type SportsbookHandoffSurface = 'props_explorer' | 'parlay_workspace' | 'shared_slip';

export type SportsbookHandoffOpenedProperties = {
  surface: SportsbookHandoffSurface;
  leg_count: number;
  live_resolution_available: boolean;
};

export type SportsbookHandoffProviderSelectedProperties = {
  surface: SportsbookHandoffSurface;
  provider: string;
  leg_count: number;
  live_resolution_available: boolean;
};

export type SportsbookHandoffOutboundClickedProperties = {
  surface: SportsbookHandoffSurface;
  provider: string;
  handoff_level: string;
  leg_count: number;
  live_resolution_available: boolean;
};

export type WowyFilterChangedProperties =
  | { surface: 'wowy'; filter: 'season'; value: '2023' | '2024' | '2025' }
  | { surface: 'wowy'; filter: 'team_stint' }
  | { surface: 'wowy'; filter: 'season_type'; value: 'regular' | 'playoffs' }
  | { surface: 'wowy'; filter: 'teammate'; value: 'selected' | 'cleared' }
  | { surface: 'wowy'; filter: 'stat_view'; value: 'per_game' | 'per_minute' }
  | { surface: 'wowy'; filter: 'result_split'; value: 'with' | 'without' };

export type ContextCheckOpenedProperties = {
  surface: 'historical_game';
};

export type UpgradeClickedSurface =
  | 'game_briefing'
  | 'slate_briefing'
  | 'props_explorer_game_context'
  | 'props_explorer_line_shopping';

export type UpgradeClickedProperties = {
  surface: UpgradeClickedSurface;
  plan: 'founding_pro';
};

export type CheckoutStartedProperties = {
  surface: 'billing';
  plan: 'founding_pro';
};

export type SignupSurfaceProperties = {
  surface: 'signup';
};

export type ParlayXrayOpenWorkspaceProperties = {
  surface: 'parlay_xray';
  action: 'open_workspace';
};

export type ParlayWorkspaceAnalysisStartedProperties = {
  surface: 'parlay_workspace';
  source: CanonicalParlaySelectionSourceContext;
  action: 'analysis_started';
};

export type OnboardingSurfaceProperties = {
  surface: 'onboarding';
  primary_intent?: string;
  guidance_level?: string;
};

export type CoachmarkSeenProperties = {
  surface: 'onboarding';
  coachmark_id: string;
};

export type ChecklistItemCompletedProperties = {
  surface: 'onboarding';
  item_id: string;
};

export type TourReplayedProperties = {
  surface: 'onboarding';
  action: 'replay';
};

export type ProductEventProperties = {
  [PRODUCT_EVENTS.MARKET_MOVEMENT_VIEWED]: MarketMovementViewedProperties;
  [PRODUCT_EVENTS.MARKET_MOVEMENT_UPGRADE_CLICKED]: MarketMovementUpgradeClickedProperties;
  [PRODUCT_EVENTS.HISTORICAL_GAME_VIEWED]: HistoricalGameViewedProperties;
  [PRODUCT_EVENTS.HISTORICAL_PLAYER_OPENED]: HistoricalPlayerOpenedProperties;
  [PRODUCT_EVENTS.HISTORICAL_TIMELINE_OPENED]: HistoricalTimelineOpenedProperties;
  [PRODUCT_EVENTS.PARLAY_XRAY_VIEWED]: ParlayXraySurfaceProperties;
  [PRODUCT_EVENTS.PARLAY_XRAY_UPLOAD_STARTED]: ParlayXraySurfaceProperties;
  [PRODUCT_EVENTS.PARLAY_XRAY_UPLOAD_SELECTED]: ParlayXraySurfaceProperties;
  [PRODUCT_EVENTS.PARLAY_XRAY_EXTRACT_STARTED]: ParlayXraySurfaceProperties;
  [PRODUCT_EVENTS.PARLAY_XRAY_EXTRACT_COMPLETED]: ParlayXrayExtractProperties;
  [PRODUCT_EVENTS.PARLAY_XRAY_EXTRACT_FAILED]: ParlayXrayExtractProperties;
  [PRODUCT_EVENTS.PARLAY_XRAY_OPEN_WORKSPACE]: ParlayXrayOpenWorkspaceProperties;
  [PRODUCT_EVENTS.PARLAY_WORKSPACE_ANALYSIS_STARTED]: ParlayWorkspaceAnalysisStartedProperties;
  [PRODUCT_EVENTS.ONBOARDING_STARTED]: OnboardingSurfaceProperties;
  [PRODUCT_EVENTS.ONBOARDING_SKIPPED]: OnboardingSurfaceProperties;
  [PRODUCT_EVENTS.ONBOARDING_COMPLETED]: OnboardingSurfaceProperties;
  [PRODUCT_EVENTS.COACHMARK_SEEN]: CoachmarkSeenProperties;
  [PRODUCT_EVENTS.CHECKLIST_ITEM_COMPLETED]: ChecklistItemCompletedProperties;
  [PRODUCT_EVENTS.TOUR_REPLAYED]: TourReplayedProperties;
  [PRODUCT_EVENTS.LANDING_CTA_CLICKED]: LandingCtaClickedProperties;
  [PRODUCT_EVENTS.PLAYER_SEARCH_USED]: PlayerSearchUsedProperties;
  [PRODUCT_EVENTS.PLAYER_SEARCH_RESULT_OPENED]: PlayerSearchResultOpenedProperties;
  [PRODUCT_EVENTS.PROP_OPENED]: PropExplorerEventProperties;
  [PRODUCT_EVENTS.PROP_ADDED_TO_PARLAY]: PropExplorerEventProperties;
  [PRODUCT_EVENTS.PROP_CONTEXT_OPENED]: PropContextOpenedProperties;
  [PRODUCT_EVENTS.SHARED_SLIP_CREATED]: SharedSlipCreatedProperties;
  [PRODUCT_EVENTS.SHARED_SLIP_COPY_LINK]: SharedSlipCopyLinkProperties;
  [PRODUCT_EVENTS.SHARED_SLIP_NATIVE_SHARE]: SharedSlipNativeShareProperties;
  [PRODUCT_EVENTS.SHARED_SLIP_VIEWED]: SharedSlipViewedProperties;
  [PRODUCT_EVENTS.SHARED_SLIP_CTA_CLICKED]: SharedSlipCtaClickedProperties;
  [PRODUCT_EVENTS.SPORTSBOOK_HANDOFF_OPENED]: SportsbookHandoffOpenedProperties;
  [PRODUCT_EVENTS.SPORTSBOOK_HANDOFF_PROVIDER_SELECTED]: SportsbookHandoffProviderSelectedProperties;
  [PRODUCT_EVENTS.SPORTSBOOK_HANDOFF_OUTBOUND_CLICKED]: SportsbookHandoffOutboundClickedProperties;
  [PRODUCT_EVENTS.WOWY_FILTER_CHANGED]: WowyFilterChangedProperties;
  [PRODUCT_EVENTS.CONTEXT_CHECK_OPENED]: ContextCheckOpenedProperties;
  [PRODUCT_EVENTS.UPGRADE_CLICKED]: UpgradeClickedProperties;
  [PRODUCT_EVENTS.CHECKOUT_STARTED]: CheckoutStartedProperties;
  [PRODUCT_EVENTS.SIGNUP_STARTED]: SignupSurfaceProperties;
  [PRODUCT_EVENTS.SIGNUP_COMPLETED]: SignupSurfaceProperties;
};

export type AnalyticsPrimitive = string | number | boolean;

type UmamiLike = {
  track: (eventName: string, eventData?: Record<string, AnalyticsPrimitive>) => void;
};

function readUmami(): UmamiLike | null {
  const globalRef = globalThis as typeof globalThis & { umami?: { track?: unknown } };
  const track = globalRef.umami?.track;
  if (typeof track !== 'function') return null;
  return { track: track.bind(globalRef.umami) as UmamiLike['track'] };
}

/** Drop null/undefined/objects/NaN so providers only see primitives. */
export function sanitizeEventProperties(
  properties: Record<string, unknown> | null | undefined
): Record<string, AnalyticsPrimitive> | undefined {
  if (properties == null) return undefined;
  const out: Record<string, AnalyticsPrimitive> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === 'string' || typeof value === 'boolean') {
      out[key] = value;
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function previewFlagFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URLSearchParams(window.location.search).get('preview');
  } catch {
    return null;
  }
}

export function trackEvent<Name extends ProductEventName>(
  name: Name,
  properties?: ProductEventProperties[Name]
): void {
  try {
    if (shouldSuppressProductPreviewAnalytics(previewFlagFromLocation())) return;
    const umami = readUmami();
    if (!umami) return;
    umami.track(name, sanitizeEventProperties(properties as Record<string, unknown> | undefined));
  } catch {
    // Tracking must never break product UI or navigation.
  }
}
