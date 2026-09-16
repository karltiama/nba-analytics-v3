/**
 * Tiny product-event helper. Forwards to window.umami when present.
 * Safe no-op in SSR, local/dev without the script, and when trackers are blocked.
 */

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

export type ParlayXrayExtractProperties = {
  surface: 'parlay_xray';
  result_category: string;
};

export type ParlayXrayOpenWorkspaceProperties = {
  surface: 'parlay_xray';
  action: 'open_workspace';
};

export type ParlayWorkspaceAnalysisStartedProperties = {
  surface: 'parlay_workspace';
  source: 'xray' | 'props_explorer' | 'mixed';
  action: 'analysis_started';
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

export function trackEvent<Name extends ProductEventName>(
  name: Name,
  properties?: ProductEventProperties[Name]
): void {
  try {
    const umami = readUmami();
    if (!umami) return;
    umami.track(name, sanitizeEventProperties(properties as Record<string, unknown> | undefined));
  } catch {
    // Tracking must never break product UI or navigation.
  }
}
