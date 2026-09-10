import { describe, expect, it, vi } from 'vitest';
import {
  mapServingRowsToPlayerMarketMovement,
  summarizePlayerMarketMovementForFree,
} from '@/lib/betting/market-movement-api';
import {
  MARKET_MOVEMENT_UPGRADE_CLICKED,
  MARKET_MOVEMENT_VIEWED,
  buildMarketMovementViewed,
  marketMovementUpgradeClickedProperties,
  marketMovementViewedIfChanged,
  viewedPropertyKeys,
} from '../market-movement-events';
import { FOUNDING_PRO_UPGRADE_HREF } from '@/components/betting/betting-shell-paths';
import { UPGRADE_COPY } from '@/lib/entitlements/types';
import { trackEvent } from '../track-event';

function servingRow(partial: Record<string, unknown> = {}) {
  return {
    game_id: '18447937',
    player_id: '101',
    player_name: 'John Collins',
    prop_type: 'points',
    vendor: 'betmgm',
    reference_kind: '3_hour_pre_tip',
    reference_line: 12.5,
    reference_over_odds: -105,
    reference_under_odds: -125,
    reference_timestamp: '2026-04-02T20:00:00.000Z',
    comparison_kind: 'decision_close',
    comparison_line: 12.5,
    comparison_over_odds: -105,
    comparison_under_odds: -125,
    comparison_timestamp: '2026-04-02T18:00:00.000Z',
    line_delta: 0,
    over_implied_probability_delta: 0,
    under_implied_probability_delta: 0,
    movement_class: 'A',
    ...partial,
  };
}

function fullMm() {
  return mapServingRowsToPlayerMarketMovement({
    gameId: '18447937',
    playerId: '101',
    propType: 'points',
    rows: [servingRow(), servingRow({ vendor: 'fanduel' })],
  });
}

const FORBIDDEN_VIEWED = /name|email|user|odds|injury|player_name|url/i;

describe('market_movement_viewed', () => {
  it('fires Pro/full once with detail=full', () => {
    const mm = fullMm();
    const first = marketMovementViewedIfChanged(null, mm);
    expect(first?.name).toBe(MARKET_MOVEMENT_VIEWED);
    expect(first?.properties).toEqual({
      game_id: '18447937',
      prop_type: 'points',
      detail: 'full',
      movement_status: 'ok',
      consensus_book_count: 2,
    });
    expect(marketMovementViewedIfChanged(first!.key, mm)).toBeNull();
  });

  it('does not duplicate on the same market identity (rerender)', () => {
    const mm = fullMm();
    const first = marketMovementViewedIfChanged(null, mm);
    expect(marketMovementViewedIfChanged(first!.key, { ...mm })).toBeNull();
  });

  it('fires again for a different game/player/prop', () => {
    const a = marketMovementViewedIfChanged(null, fullMm())!;
    const bMm = mapServingRowsToPlayerMarketMovement({
      gameId: '21681977',
      playerId: '100',
      propType: 'points',
      rows: [servingRow({ game_id: '21681977', player_id: '100', player_name: 'Jordan Clarkson' })],
    });
    const b = marketMovementViewedIfChanged(a.key, bMm);
    expect(b?.properties.game_id).toBe('21681977');
  });

  it('uses API detail=summary for Free without leaking names or odds', () => {
    const viewed = buildMarketMovementViewed(summarizePlayerMarketMovementForFree(fullMm()));
    expect(viewed.properties.detail).toBe('summary');
    expect(viewed.properties.movement_status).toBe('ok');
    expect(JSON.stringify(viewed.properties)).not.toMatch(/John Collins|Jordan|-105/);
    for (const key of Object.keys(viewed.properties)) {
      expect(FORBIDDEN_VIEWED.test(key)).toBe(false);
      expect(viewedPropertyKeys()).toContain(key);
    }
  });

  it('tracks empty and unsupported with movement_status', () => {
    const empty = mapServingRowsToPlayerMarketMovement({
      gameId: '18447937',
      playerId: '101',
      propType: 'points',
      rows: [],
    });
    expect(buildMarketMovementViewed(empty).properties).toMatchObject({
      detail: 'full',
      movement_status: 'empty',
      consensus_book_count: 0,
    });
    const unsupported = {
      ...empty,
      status: 'unsupported_prop' as const,
      reason: 'unsupported_prop' as const,
    };
    expect(buildMarketMovementViewed(unsupported).properties.movement_status).toBe('unsupported_prop');
    expect(buildMarketMovementViewed(summarizePlayerMarketMovementForFree(empty)).properties.detail).toBe(
      'summary'
    );
  });

  it('does not treat loading as a viewed status', () => {
    expect(['ok', 'empty', 'unsupported_prop']).not.toContain('loading');
  });

  it('normalizes game_id to a string and book count to an integer', () => {
    const mm = fullMm();
    (mm.market as { gameId: string | number }).gameId = 18447937;
    const viewed = buildMarketMovementViewed(mm);
    expect(viewed.properties.game_id).toBe('18447937');
    expect(Number.isInteger(viewed.properties.consensus_book_count)).toBe(true);
  });
});

describe('market_movement_upgrade_clicked', () => {
  it('fires the upgrade event and keeps /billing Founding Pro wording', () => {
    const track = vi.fn();
    (globalThis as typeof globalThis & { umami?: { track: typeof track } }).umami = { track };
    trackEvent(MARKET_MOVEMENT_UPGRADE_CLICKED, marketMovementUpgradeClickedProperties());
    expect(track).toHaveBeenCalledWith(MARKET_MOVEMENT_UPGRADE_CLICKED, { surface: 'market_movement' });
    expect(FOUNDING_PRO_UPGRADE_HREF).toBe('/billing');
    expect(UPGRADE_COPY.market_movement.title).toMatch(/3 hours before tip/);
    expect(UPGRADE_COPY.market_movement.detail).toMatch(/Founding Pro/);
    expect(MARKET_MOVEMENT_UPGRADE_CLICKED).not.toBe('market_movement_books_expanded');
    delete (globalThis as { umami?: unknown }).umami;
  });

  it('does not block the click when tracking throws', () => {
    (globalThis as typeof globalThis & { umami?: { track: () => void } }).umami = {
      track: () => {
        throw new Error('offline');
      },
    };
    expect(() =>
      trackEvent(MARKET_MOVEMENT_UPGRADE_CLICKED, marketMovementUpgradeClickedProperties())
    ).not.toThrow();
    delete (globalThis as { umami?: unknown }).umami;
  });
});
