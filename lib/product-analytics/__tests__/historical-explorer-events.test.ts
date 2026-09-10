import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HISTORICAL_GAME_VIEWED,
  HISTORICAL_PLAYER_OPENED,
  HISTORICAL_TIMELINE_OPENED,
  buildHistoricalGameViewed,
  historicalGameViewedIfChanged,
  historicalPlayerOpenedProperties,
  historicalTimelineOpenedIfChanged,
} from '../historical-explorer-events';
import { trackEvent } from '../track-event';

const VIEW_INPUT = {
  gameId: '18447937',
  season: '2025',
  startersAvailable: true,
  advancedAvailable: true,
  roleProfileAvailable: true,
  timelineAvailable: true,
};

const FORBIDDEN = /name|email|user|odds|injury|player_name|pbp|box/i;

describe('historical_game_viewed', () => {
  it('fires once per historical game', () => {
    const first = historicalGameViewedIfChanged(null, VIEW_INPUT);
    expect(first?.name).toBe(HISTORICAL_GAME_VIEWED);
    expect(first?.properties).toEqual({
      game_id: '18447937',
      season: '2025',
      starters_available: true,
      advanced_available: true,
      role_profile_available: true,
      timeline_available: true,
    });
    expect(historicalGameViewedIfChanged(first!.key, VIEW_INPUT)).toBeNull();
  });

  it('does not duplicate on rerender of the same game', () => {
    const first = historicalGameViewedIfChanged(null, VIEW_INPUT)!;
    expect(historicalGameViewedIfChanged(first.key, { ...VIEW_INPUT })).toBeNull();
  });

  it('fires again for a different game', () => {
    const a = historicalGameViewedIfChanged(null, VIEW_INPUT)!;
    const b = historicalGameViewedIfChanged(a.key, { ...VIEW_INPUT, gameId: '15905067', season: '2023' });
    expect(b?.properties.game_id).toBe('15905067');
    expect(b?.properties.season).toBe('2023');
  });

  it('does not include names or payloads', () => {
    const keys = Object.keys(buildHistoricalGameViewed(VIEW_INPUT).properties);
    expect(keys.join(',')).not.toMatch(FORBIDDEN);
  });
});

describe('historical_player_opened', () => {
  it('is Context-only and has no player identity', () => {
    const props = historicalPlayerOpenedProperties({ gameId: '15905067', season: '2023' });
    expect(props).toEqual({
      game_id: '15905067',
      season: '2023',
      surface: 'season_role',
    });
    expect(JSON.stringify(props)).not.toMatch(/Tatum|player_id/i);
  });
});

describe('historical_timeline_opened', () => {
  it('fires once per game at the interaction boundary', () => {
    const first = historicalTimelineOpenedIfChanged(null, { gameId: '18447937', mode: 'key' });
    expect(first?.name).toBe(HISTORICAL_TIMELINE_OPENED);
    expect(first?.properties).toEqual({ game_id: '18447937', mode: 'key' });
    expect(historicalTimelineOpenedIfChanged(first!.key, { gameId: '18447937', mode: 'full' })).toBeNull();
  });
});

describe('trackEvent historical events', () => {
  afterEach(() => {
    const g = globalThis as typeof globalThis & { umami?: unknown };
    delete g.umami;
  });

  it('forwards viewed properties when umami is present', () => {
    const track = vi.fn();
    (globalThis as typeof globalThis & { umami: { track: typeof track } }).umami = { track };
    const viewed = buildHistoricalGameViewed(VIEW_INPUT);
    trackEvent(viewed.name, viewed.properties);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(HISTORICAL_GAME_VIEWED, viewed.properties);
  });

  it('is harmless when umami is blocked', () => {
    expect(() =>
      trackEvent(HISTORICAL_PLAYER_OPENED, historicalPlayerOpenedProperties(VIEW_INPUT))
    ).not.toThrow();
    (globalThis as typeof globalThis & { umami: { track: () => void } }).umami = {
      track: () => {
        throw new Error('blocked');
      },
    };
    expect(() =>
      trackEvent(HISTORICAL_TIMELINE_OPENED, { game_id: '18447937', mode: 'key' })
    ).not.toThrow();
  });
});
