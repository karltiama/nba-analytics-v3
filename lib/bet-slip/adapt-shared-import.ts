/**
 * Import shared CanonicalBetLeg[] into the parlay selection store.
 *
 * Historical book/odds are preserved as metadata only — never presented as
 * a newly resolved live sportsbook offer. Snapshot kind is `shared_snapshot`,
 * which keeps Workspace analysis UNAVAILABLE (fail closed).
 *
 * Legs missing selectedSportsbook cannot form a wagerIdentity and are rejected.
 */

import {
  displayVendor,
  isPlayerPropV1Vendor,
} from '@/lib/betting/market-movement';
import {
  PARLAY_OFFER_SOURCE_SHARED_SLIP,
  PARLAY_SNAPSHOT_SHARED,
  canonicalOfferIdentity,
  canonicalWagerIdentity,
  type CanonicalParlayOffer,
} from '@/lib/parlay/adapt-props-explorer-offer';
import { replaceParlaySelectionLegs } from '@/lib/parlay/selection-store';
import type { SelectedParlayLeg } from '@/lib/parlay/selection';
import { canonicalSelectionKey } from './selection-key';
import type { CanonicalBetLeg } from './types';

export type ImportSharedSlipResult =
  | { ok: true; legs: SelectedParlayLeg[] }
  | {
      ok: false;
      code: 'EMPTY' | 'MISSING_SPORTSBOOK' | 'INVALID_LEG';
      message: string;
    };

export function selectedParlayLegFromSharedBetLeg(leg: CanonicalBetLeg): SelectedParlayLeg | null {
  const book = leg.selectedSportsbook;
  if (!book || !isPlayerPropV1Vendor(book)) return null;

  const expectedKey = canonicalSelectionKey({
    gameId: leg.gameId,
    playerId: leg.playerId,
    market: leg.market,
    side: leg.side,
    line: leg.line,
  });
  if (leg.selectionKey !== expectedKey) return null;

  const wagerIdentity = canonicalWagerIdentity({
    playerId: leg.playerId,
    gameId: leg.gameId,
    market: leg.market,
    side: leg.side,
    line: leg.line,
    sportsbookVendor: book,
  });

  const offer: CanonicalParlayOffer = {
    source: PARLAY_OFFER_SOURCE_SHARED_SLIP,
    sourceProvenance: 'shared_slip_import',
    playerId: leg.playerId,
    playerDisplayName: leg.playerName || null,
    gameId: leg.gameId,
    market: leg.market,
    side: leg.side,
    line: leg.line,
    sportsbook: { vendor: book, displayName: displayVendor(book) },
    oddsAmerican: leg.selectedOdds ?? null,
    snapshotKind: PARLAY_SNAPSHOT_SHARED,
    snapshotAt: leg.selectedAt,
    wagerIdentity,
    offerIdentity: canonicalOfferIdentity({
      source: PARLAY_OFFER_SOURCE_SHARED_SLIP,
      snapshotKind: PARLAY_SNAPSHOT_SHARED,
      playerId: leg.playerId,
      gameId: leg.gameId,
      market: leg.market,
      side: leg.side,
      line: leg.line,
      sportsbookVendor: book,
    }),
  };

  return {
    offer,
    gameLabel: leg.gameLabel ?? null,
  };
}

export function importSharedBetLegsToStore(legs: CanonicalBetLeg[]): ImportSharedSlipResult {
  if (!legs.length) {
    return { ok: false, code: 'EMPTY', message: 'This shared slip has no legs.' };
  }

  const next: SelectedParlayLeg[] = [];
  for (const leg of legs) {
    if (!leg.selectedSportsbook) {
      return {
        ok: false,
        code: 'MISSING_SPORTSBOOK',
        message:
          'This shared slip is missing sportsbook metadata and cannot be loaded into your parlay tray. Open Props Explorer to rebuild it.',
      };
    }
    const mapped = selectedParlayLegFromSharedBetLeg(leg);
    if (!mapped) {
      return {
        ok: false,
        code: 'INVALID_LEG',
        message: 'This shared slip could not be loaded safely.',
      };
    }
    next.push(mapped);
  }

  const stored = replaceParlaySelectionLegs(next);
  return { ok: true, legs: stored };
}
