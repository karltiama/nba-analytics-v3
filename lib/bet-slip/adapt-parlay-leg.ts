/**
 * Thin adapter: priced CanonicalParlayOffer / SelectedParlayLeg → CanonicalBetLeg.
 * Does not mutate offer types or change wagerIdentity.
 */

import {
  isPlayerPropV1Vendor,
  type PlayerPropV1Vendor,
} from '@/lib/betting/market-movement';
import type { CanonicalParlayOffer } from '@/lib/parlay/adapt-props-explorer-offer';
import type { SelectedParlayLeg } from '@/lib/parlay/selection';
import { canonicalSelectionKey } from './selection-key';
import {
  BET_SLIP_SPORT_NBA,
  type CanonicalBetLeg,
  type CanonicalBetSlip,
  type CanonicalBetSlipSource,
} from './types';

function asSelectedVendor(vendor: string): PlayerPropV1Vendor | null {
  return isPlayerPropV1Vendor(vendor) ? vendor : null;
}

export function canonicalBetLegFromParlayOffer(
  offer: CanonicalParlayOffer,
  display?: {
    gameLabel?: string | null;
    teamAbbreviation?: string | null;
    opponentAbbreviation?: string | null;
    selectedAt?: string;
  }
): CanonicalBetLeg {
  const selectionKey = canonicalSelectionKey({
    sport: BET_SLIP_SPORT_NBA,
    gameId: offer.gameId,
    playerId: offer.playerId,
    market: offer.market,
    side: offer.side,
    line: offer.line,
  });

  const selectedAt =
    display?.selectedAt?.trim() ||
    offer.snapshotAt?.trim() ||
    new Date().toISOString();

  return {
    selectionKey,
    sport: BET_SLIP_SPORT_NBA,
    gameId: offer.gameId,
    playerId: offer.playerId,
    market: offer.market,
    side: offer.side,
    line: offer.line,
    playerName: offer.playerDisplayName?.trim() || '',
    teamAbbreviation: display?.teamAbbreviation ?? null,
    opponentAbbreviation: display?.opponentAbbreviation ?? null,
    gameLabel: display?.gameLabel ?? null,
    selectedSportsbook: asSelectedVendor(offer.sportsbook.vendor),
    selectedOdds: offer.oddsAmerican,
    selectedAt,
    source: {
      provider: 'balldontlie',
      providerMarketId: null,
    },
  };
}

export function canonicalBetLegFromSelectedParlayLeg(
  leg: SelectedParlayLeg,
  display?: {
    teamAbbreviation?: string | null;
    opponentAbbreviation?: string | null;
    selectedAt?: string;
  }
): CanonicalBetLeg {
  return canonicalBetLegFromParlayOffer(leg.offer, {
    gameLabel: leg.gameLabel,
    teamAbbreviation: display?.teamAbbreviation,
    opponentAbbreviation: display?.opponentAbbreviation,
    selectedAt: display?.selectedAt,
  });
}

export function canonicalBetSlipFromSelectedLegs(
  legs: SelectedParlayLeg[],
  source: CanonicalBetSlipSource,
  title?: string | null
): CanonicalBetSlip {
  return {
    legs: legs.map((leg) => canonicalBetLegFromSelectedParlayLeg(leg)),
    source,
    title: title ?? null,
  };
}

/** Map existing parlay offer source tags onto slip sources. */
export function betSlipSourceFromParlayOfferSource(
  source: CanonicalParlayOffer['source']
): CanonicalBetSlipSource {
  if (source === 'xray') return 'parlay_xray';
  return 'props_explorer';
}
