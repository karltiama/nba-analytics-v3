import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  oldestShortlistAgeMs,
  quickBuildAgeBucket,
  quickBuildsHandoffEvent,
  quickBuildsSearchEvent,
} from '@/lib/product-analytics/quick-builds-events';
import { trackEvent } from '@/lib/product-analytics/track-event';

const MINUTE = 60_000;

afterEach(() => {
  delete (globalThis as { umami?: unknown }).umami;
});

describe('quick build age buckets', () => {
  it('places every exact boundary in the older bucket and keeps zero', () => {
    expect(quickBuildAgeBucket(0)).toBe('under_5m');
    expect(quickBuildAgeBucket(5 * MINUTE - 1)).toBe('under_5m');
    expect(quickBuildAgeBucket(5 * MINUTE)).toBe('5_15m');
    expect(quickBuildAgeBucket(15 * MINUTE - 1)).toBe('5_15m');
    expect(quickBuildAgeBucket(15 * MINUTE)).toBe('15_30m');
    expect(quickBuildAgeBucket(30 * MINUTE - 1)).toBe('15_30m');
    expect(quickBuildAgeBucket(30 * MINUTE)).toBe('30_60m');
    expect(quickBuildAgeBucket(60 * MINUTE - 1)).toBe('30_60m');
    expect(quickBuildAgeBucket(60 * MINUTE)).toBe('1_3h');
    expect(quickBuildAgeBucket(180 * MINUTE - 1)).toBe('1_3h');
    expect(quickBuildAgeBucket(180 * MINUTE)).toBe('over_3h');
    expect(quickBuildAgeBucket(24 * 60 * MINUTE)).toBe('over_3h');
  });

  it('uses unknown for negative, non-finite, and missing ages', () => {
    expect(quickBuildAgeBucket(-1)).toBe('unknown');
    expect(quickBuildAgeBucket(Number.NaN)).toBe('unknown');
    expect(quickBuildAgeBucket(Number.POSITIVE_INFINITY)).toBe('unknown');
    expect(quickBuildAgeBucket(null)).toBe('unknown');
    expect(quickBuildAgeBucket(undefined)).toBe('unknown');
  });

  it('uses the oldest valid age in the shortlist and ignores an empty list', () => {
    expect(oldestShortlistAgeMs({ builds: [] })).toBeNull();
    expect(oldestShortlistAgeMs(null)).toBeNull();
    expect(oldestShortlistAgeMs({ builds: [{ maxAgeMs: -1 }, { maxAgeMs: Number.NaN }] })).toBeNull();
    expect(
      oldestShortlistAgeMs({
        builds: [
          { maxAgeMs: 4 * MINUTE, playerId: '11', oddsAmerican: -115 },
          { maxAgeMs: 20 * MINUTE, playerName: 'hidden', line: 0.5 },
          { maxAgeMs: Number.POSITIVE_INFINITY },
        ],
      }),
    ).toBe(20 * MINUTE);
  });

  it('reads at most the five returned builds', () => {
    const builds = [1, 2, 3, 4, 5, 999].map((minutes) => ({ maxAgeMs: minutes * MINUTE }));
    expect(oldestShortlistAgeMs({ builds })).toBe(5 * MINUTE);
  });
});

describe('quick build search event', () => {
  it('emits one success event for five builds using the oldest age', () => {
    const body = {
      builds: [1, 2, 3, 4, 6].map((minutes) => ({ maxAgeMs: minutes * MINUTE })),
    };
    const event = quickBuildsSearchEvent({
      accepted: true,
      sportsbook: 'draftkings',
      preset: 'balanced',
      kind: 'ok',
      buildCount: 5,
      emptyReason: null,
      ageMs: oldestShortlistAgeMs(body),
    });
    expect(event).toEqual({
      sportsbook: 'draftkings',
      preset: 'balanced',
      result: 'success',
      build_count: 5,
      age_bucket: '5_15m',
    });
    expect(event).not.toHaveProperty('empty_reason');
  });

  it('emits one empty event with unknown age and the normalized reason', () => {
    expect(
      quickBuildsSearchEvent({
        accepted: true,
        sportsbook: 'caesars',
        preset: 'higher_hit_chance',
        kind: 'empty',
        buildCount: 4,
        emptyReason: 'NO_PAIRS_IN_BAND',
        ageMs: 20 * MINUTE,
      }),
    ).toEqual({
      sportsbook: 'caesars',
      preset: 'higher_hit_chance',
      result: 'empty',
      build_count: 0,
      empty_reason: 'NO_PAIRS_IN_BAND',
      age_bucket: 'unknown',
    });
  });

  it('emits one error event for each accepted terminal failure', () => {
    for (const kind of ['unauthorized', 'invalid', 'limit', 'server', 'network', 'malformed'] as const) {
      expect(
        quickBuildsSearchEvent({
          accepted: true,
          sportsbook: 'betmgm',
          preset: 'higher_payout',
          kind,
          buildCount: 2,
          emptyReason: 'NO_PAIRS_IN_BAND',
          ageMs: 0,
        }),
      ).toEqual({
        sportsbook: 'betmgm',
        preset: 'higher_payout',
        result: 'error',
        build_count: 0,
        age_bucket: 'unknown',
      });
    }
  });

  it('does not emit for a click that is still pending, aborted, or stale', () => {
    expect(
      quickBuildsSearchEvent({
        accepted: false,
        sportsbook: 'draftkings',
        preset: 'balanced',
        kind: 'ok',
        buildCount: 1,
        emptyReason: null,
        ageMs: 0,
      }),
    ).toBeNull();
    expect(
      quickBuildsSearchEvent({
        accepted: true,
        sportsbook: 'draftkings',
        preset: 'balanced',
        kind: 'aborted',
        buildCount: 0,
        emptyReason: null,
        ageMs: 0,
      }),
    ).toBeNull();
  });

  it('keeps the sportsbook and preset from the accepted search', () => {
    expect(
      quickBuildsSearchEvent({
        accepted: true,
        sportsbook: 'fanduel',
        preset: 'higher_payout',
        kind: 'ok',
        buildCount: 1,
        emptyReason: null,
        ageMs: null,
      }),
    ).toMatchObject({ sportsbook: 'fanduel', preset: 'higher_payout', age_bucket: 'unknown' });
  });

  it('drops an unknown book, preset, empty reason, or build count', () => {
    expect(
      quickBuildsSearchEvent({
        accepted: true,
        sportsbook: 'DraftKings',
        preset: 'balanced',
        kind: 'ok',
        buildCount: 1,
        emptyReason: null,
        ageMs: 0,
      }),
    ).toBeNull();
    expect(
      quickBuildsSearchEvent({
        accepted: true,
        sportsbook: 'draftkings',
        preset: 'lower_payout',
        kind: 'empty',
        buildCount: 0,
        emptyReason: 'NO_PAIRS_IN_BAND',
        ageMs: null,
      }),
    ).toBeNull();
    expect(
      quickBuildsSearchEvent({
        accepted: true,
        sportsbook: 'draftkings',
        preset: 'balanced',
        kind: 'empty',
        buildCount: 0,
        emptyReason: 'market is closed',
        ageMs: null,
      }),
    ).toBeNull();
    expect(
      quickBuildsSearchEvent({
        accepted: true,
        sportsbook: 'draftkings',
        preset: 'balanced',
        kind: 'ok',
        buildCount: 0,
        emptyReason: null,
        ageMs: 0,
      }),
    ).toBeNull();
  });
});

describe('quick build handoff event', () => {
  it('emits only after replacement and keeps the search attribution', () => {
    expect(
      quickBuildsHandoffEvent({ status: 'replaced', sportsbook: 'fanduel', preset: 'higher_hit_chance' }),
    ).toEqual({
      sportsbook: 'fanduel',
      preset: 'higher_hit_chance',
      result: 'successful_handoff',
    });
    for (const status of ['needs_confirmation', 'canceled', 'rejected', 'tipped'] as const) {
      expect(quickBuildsHandoffEvent({ status, sportsbook: 'fanduel', preset: 'higher_hit_chance' })).toBeNull();
    }
  });
});

describe('quick build event privacy', () => {
  it('forwards only the approved properties', () => {
    const search = quickBuildsSearchEvent({
      accepted: true,
      sportsbook: 'draftkings',
      preset: 'balanced',
      kind: 'empty',
      buildCount: 0,
      emptyReason: 'NO_SUCCESSFUL_PULL',
      ageMs: null,
    });
    const handoff = quickBuildsHandoffEvent({
      status: 'replaced',
      sportsbook: 'draftkings',
      preset: 'balanced',
    });
    expect(Object.keys(search ?? {}).sort()).toEqual([
      'age_bucket',
      'build_count',
      'empty_reason',
      'preset',
      'result',
      'sportsbook',
    ]);
    expect(Object.keys(handoff ?? {}).sort()).toEqual(['preset', 'result', 'sportsbook']);
    const serialized = JSON.stringify({ search, handoff });
    expect(serialized).not.toMatch(/player|gameId|pullRun|odds|line|@|email/i);
    const track = vi.fn();
    (globalThis as typeof globalThis & { umami: { track: typeof track } }).umami = { track };
    trackEvent('quick_builds_search_completed', search ?? undefined);
    trackEvent('quick_builds_handoff_completed', handoff ?? undefined);
    expect(track).toHaveBeenCalledTimes(2);
    expect(track.mock.calls[0]?.[1]).toEqual(search);
    expect(track.mock.calls[1]?.[1]).toEqual(handoff);
  });
});
