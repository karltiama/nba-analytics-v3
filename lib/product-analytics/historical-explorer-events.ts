/**
 * Historical Explorer v2 product events. IDs and capability flags only.
 * Do not send player names, user identity, box arrays, PBP, or odds.
 */

import {
  PRODUCT_EVENTS,
  type HistoricalGameViewedProperties,
  type HistoricalPlayerOpenedProperties,
  type HistoricalTimelineOpenedProperties,
} from '@/lib/product-analytics/track-event';

export const HISTORICAL_GAME_VIEWED = PRODUCT_EVENTS.HISTORICAL_GAME_VIEWED;
export const HISTORICAL_PLAYER_OPENED = PRODUCT_EVENTS.HISTORICAL_PLAYER_OPENED;
export const HISTORICAL_TIMELINE_OPENED = PRODUCT_EVENTS.HISTORICAL_TIMELINE_OPENED;

export type HistoricalGameViewedEvent = {
  name: typeof HISTORICAL_GAME_VIEWED;
  key: string;
  properties: HistoricalGameViewedProperties;
};

export type HistoricalTimelineOpenedEvent = {
  name: typeof HISTORICAL_TIMELINE_OPENED;
  key: string;
  properties: HistoricalTimelineOpenedProperties;
};

export function historicalGameViewKey(gameId: string): string {
  return `historical_game_viewed|${gameId}`;
}

export function historicalTimelineOpenKey(gameId: string): string {
  return `historical_timeline_opened|${gameId}`;
}

export function buildHistoricalGameViewed(input: {
  gameId: string;
  season: string;
  startersAvailable: boolean;
  advancedAvailable: boolean;
  roleProfileAvailable: boolean;
  timelineAvailable: boolean;
}): HistoricalGameViewedEvent {
  const gameId = String(input.gameId);
  return {
    name: HISTORICAL_GAME_VIEWED,
    key: historicalGameViewKey(gameId),
    properties: {
      game_id: gameId,
      season: String(input.season),
      starters_available: input.startersAvailable,
      advanced_available: input.advancedAvailable,
      role_profile_available: input.roleProfileAvailable,
      timeline_available: input.timelineAvailable,
    },
  };
}

export function historicalGameViewedIfChanged(
  previousKey: string | null,
  input: Parameters<typeof buildHistoricalGameViewed>[0]
): HistoricalGameViewedEvent | null {
  const next = buildHistoricalGameViewed(input);
  if (previousKey === next.key) return null;
  return next;
}

export function historicalPlayerOpenedProperties(input: {
  gameId: string;
  season: string;
}): HistoricalPlayerOpenedProperties {
  return {
    game_id: String(input.gameId),
    season: String(input.season),
    surface: 'season_role',
  };
}

export function buildHistoricalTimelineOpened(input: {
  gameId: string;
  mode?: HistoricalTimelineOpenedProperties['mode'];
}): HistoricalTimelineOpenedEvent {
  const gameId = String(input.gameId);
  return {
    name: HISTORICAL_TIMELINE_OPENED,
    key: historicalTimelineOpenKey(gameId),
    properties: {
      game_id: gameId,
      mode: input.mode === 'full' ? 'full' : 'key',
    },
  };
}

export function historicalTimelineOpenedIfChanged(
  previousKey: string | null,
  input: Parameters<typeof buildHistoricalTimelineOpened>[0]
): HistoricalTimelineOpenedEvent | null {
  const next = buildHistoricalTimelineOpened(input);
  if (previousKey === next.key) return null;
  return next;
}
