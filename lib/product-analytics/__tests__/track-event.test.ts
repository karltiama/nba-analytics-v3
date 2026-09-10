import { afterEach, describe, expect, it, vi } from 'vitest';
import { sanitizeEventProperties, trackEvent } from '../track-event';
import { umamiScriptConfig } from '../umami';

afterEach(() => {
  vi.unstubAllGlobals();
  const g = globalThis as typeof globalThis & { umami?: unknown };
  delete g.umami;
});

describe('umamiScriptConfig', () => {
  it('is disabled when env is unset (local/dev default)', () => {
    expect(umamiScriptConfig({})).toBeNull();
    expect(umamiScriptConfig({ NEXT_PUBLIC_UMAMI_WEBSITE_ID: 'abc' })).toBeNull();
  });

  it('returns src + website id when both are set', () => {
    expect(
      umamiScriptConfig({
        NEXT_PUBLIC_UMAMI_WEBSITE_ID: 'site-1',
        NEXT_PUBLIC_UMAMI_SRC: 'https://cloud.umami.is/script.js',
      })
    ).toEqual({
      websiteId: 'site-1',
      src: 'https://cloud.umami.is/script.js',
    });
  });
});

describe('sanitizeEventProperties', () => {
  it('keeps primitives and drops nested / undefined / NaN', () => {
    expect(
      sanitizeEventProperties({
        game_id: '18447937',
        consensus_book_count: 4,
        ok: true,
        skip: undefined,
        also: null,
        nested: { odds: -110 },
        bad: Number.NaN,
      })
    ).toEqual({
      game_id: '18447937',
      consensus_book_count: 4,
      ok: true,
    });
  });
});

describe('trackEvent', () => {
  it('forwards name and properties when umami.track exists', () => {
    const track = vi.fn();
    (globalThis as typeof globalThis & { umami: { track: typeof track } }).umami = { track };
    trackEvent('market_movement_viewed', {
      game_id: '18447937',
      prop_type: 'points',
      detail: 'full',
      movement_status: 'ok',
      consensus_book_count: 4,
    });
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('market_movement_viewed', {
      game_id: '18447937',
      prop_type: 'points',
      detail: 'full',
      movement_status: 'ok',
      consensus_book_count: 4,
    });
  });

  it('is a silent no-op when the provider is missing', () => {
    expect(() =>
      trackEvent('market_movement_upgrade_clicked', { surface: 'market_movement' })
    ).not.toThrow();
  });

  it('does not throw when the provider throws', () => {
    (globalThis as typeof globalThis & { umami: { track: () => void } }).umami = {
      track: () => {
        throw new Error('blocked');
      },
    };
    expect(() =>
      trackEvent('market_movement_upgrade_clicked', { surface: 'market_movement' })
    ).not.toThrow();
  });
});
