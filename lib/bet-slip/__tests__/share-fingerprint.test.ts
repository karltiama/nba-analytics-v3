import { beforeEach, describe, expect, it } from 'vitest';
import { adaptPropsExplorerOffer } from '@/lib/parlay/adapt-props-explorer-offer';
import { canonicalBetLegFromParlayOffer } from '../adapt-parlay-leg';
import { shareSlipFingerprint } from '../share-fingerprint';
import {
  clearCachedSharedSlip,
  getCachedSharedSlip,
  setCachedSharedSlip,
} from '../share-session';
import { legsToSharePayload } from '../share-client';
import {
  importSharedBetLegsToStore,
  selectedParlayLegFromSharedBetLeg,
} from '../adapt-shared-import';
import { getParlaySelectionLegs, replaceParlaySelectionLegs } from '@/lib/parlay/selection-store';
import type { SelectedParlayLeg } from '@/lib/parlay/selection';
import type { CanonicalBetLeg } from '../types';
import {
  buildSharedSlipMetaDescription,
  buildSharedSlipMetaTitle,
} from '../shared-slip-present';

function offerLeg(overrides: Record<string, unknown> = {}): SelectedParlayLeg {
  const adapted = adaptPropsExplorerOffer({
    playerId: 1628369,
    playerName: 'Jayson Tatum',
    gameId: 'game-bos-mia-2026-03-17',
    propType: 'points',
    side: 'over',
    lineValue: 28.5,
    sportsbook: 'DraftKings',
    oddsAmerican: -110,
    marketContext: 'live',
    sourceTable: 'analytics.player_props_current',
    snapshotAt: '2026-03-17T18:00:00.000Z',
    ...overrides,
  });
  expect(adapted.ok).toBe(true);
  if (!adapted.ok) throw new Error(adapted.code);
  return { offer: adapted.offer, gameLabel: 'BOS @ MIA' };
}

describe('shareSlipFingerprint', () => {
  it('matches for same legs regardless of order', () => {
    const a = canonicalBetLegFromParlayOffer(offerLeg().offer);
    const b = canonicalBetLegFromParlayOffer(
      offerLeg({
        playerId: 1630595,
        playerName: 'Cade Cunningham',
        propType: 'assists',
        lineValue: 8.5,
        sportsbook: 'FanDuel',
        oddsAmerican: 105,
      }).offer
    );
    expect(shareSlipFingerprint([a, b])).toBe(shareSlipFingerprint([b, a]));
  });

  it('changes when line changes', () => {
    const a = canonicalBetLegFromParlayOffer(offerLeg().offer);
    const b = canonicalBetLegFromParlayOffer(offerLeg({ lineValue: 29.5 }).offer);
    expect(shareSlipFingerprint([a])).not.toBe(shareSlipFingerprint([b]));
  });

  it('changes when selected odds change (historical price is part of share payload)', () => {
    const a = canonicalBetLegFromParlayOffer(offerLeg({ oddsAmerican: -110 }).offer);
    const b = canonicalBetLegFromParlayOffer(offerLeg({ oddsAmerican: -105 }).offer);
    expect(a.selectionKey).toBe(b.selectionKey);
    expect(shareSlipFingerprint([a])).not.toBe(shareSlipFingerprint([b]));
  });

  it('changes when selected sportsbook changes', () => {
    const a = canonicalBetLegFromParlayOffer(offerLeg({ sportsbook: 'DraftKings' }).offer);
    const b = canonicalBetLegFromParlayOffer(offerLeg({ sportsbook: 'FanDuel' }).offer);
    expect(a.selectionKey).toBe(b.selectionKey);
    expect(shareSlipFingerprint([a])).not.toBe(shareSlipFingerprint([b]));
  });

  it('changes when a leg is added or removed', () => {
    const a = canonicalBetLegFromParlayOffer(offerLeg().offer);
    const b = canonicalBetLegFromParlayOffer(
      offerLeg({
        playerId: 1630595,
        playerName: 'Cade Cunningham',
        propType: 'assists',
        lineValue: 8.5,
      }).offer
    );
    expect(shareSlipFingerprint([a])).not.toBe(shareSlipFingerprint([a, b]));
    expect(shareSlipFingerprint([a, b])).not.toBe(shareSlipFingerprint([b]));
  });
});

describe('share session cache', () => {
  beforeEach(() => {
    clearCachedSharedSlip();
  });

  it('reuses cache for the same fingerprint only', () => {
    setCachedSharedSlip({
      fingerprint: 'fp-a',
      shareId: 'abc',
      path: '/slip/abc',
      title: null,
      createdAt: '2026-03-17T19:00:00.000Z',
    });
    expect(getCachedSharedSlip('fp-a')?.shareId).toBe('abc');
    expect(getCachedSharedSlip('fp-b')).toBeNull();
  });
});

describe('legsToSharePayload', () => {
  it('freezes CanonicalBetLeg snapshots from selected parlay legs', () => {
    const legs = [offerLeg(), offerLeg({ playerId: 203999, playerName: 'Nikola Jokic', propType: 'rebounds', lineValue: 12.5 })];
    const payload = legsToSharePayload(legs, 'props_explorer', 'Tonight');
    expect(payload.legs).toHaveLength(2);
    expect(payload.legs[0]?.line).toBe(28.5);
    expect(payload.legs[0]?.selectedOdds).toBe(-110);
    expect(payload.legs[0]?.selectedSportsbook).toBe('draftkings');
    expect(payload.title).toBe('Tonight');
    expect(payload.fingerprint).toBe(shareSlipFingerprint(payload.legs));
  });
});

describe('importSharedBetLegsToStore', () => {
  beforeEach(() => {
    replaceParlaySelectionLegs([]);
  });

  it('loads shared legs as shared_snapshot offers without inventing live markets', () => {
    const leg = canonicalBetLegFromParlayOffer(offerLeg().offer);
    const result = importSharedBetLegsToStore([leg]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.legs[0]?.offer.source).toBe('shared_slip');
    expect(result.legs[0]?.offer.sourceProvenance).toBe('shared_slip_import');
    expect(result.legs[0]?.offer.snapshotKind).toBe('shared_snapshot');
    expect(result.legs[0]?.offer.oddsAmerican).toBe(-110);
    expect(getParlaySelectionLegs()).toHaveLength(1);
  });

  it('rejects legs missing sportsbook metadata', () => {
    const leg: CanonicalBetLeg = {
      ...canonicalBetLegFromParlayOffer(offerLeg().offer),
      selectedSportsbook: null,
    };
    expect(selectedParlayLegFromSharedBetLeg(leg)).toBeNull();
    const result = importSharedBetLegsToStore([leg]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('MISSING_SPORTSBOOK');
  });
});

describe('shared slip metadata', () => {
  it('builds OG-safe title/description without private fields', () => {
    const leg = canonicalBetLegFromParlayOffer(offerLeg().offer);
    const share = {
      shareId: 'abc',
      title: null,
      source: 'props_explorer' as const,
      snapshotVersion: 1,
      legs: [leg],
      createdAt: '2026-03-17T19:00:00.000Z',
      path: '/slip/abc',
    };
    const title = buildSharedSlipMetaTitle(share);
    const description = buildSharedSlipMetaDescription(share);
    expect(title).toContain('1 Leg');
    expect(description.toLowerCase()).toContain('tatum');
    expect(JSON.stringify({ title, description })).not.toContain('created_by');
    expect(JSON.stringify({ title, description })).not.toContain('auth.users');
  });
});
