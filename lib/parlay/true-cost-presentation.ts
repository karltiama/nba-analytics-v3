/**
 * Turns workspace / XRay legs into true-cost inputs and panel rows.
 * Price math only: no model grades, no recommendations.
 */

import { known } from '@/lib/parlay-xray/fields';
import { detectStructuralDependencies } from '@/lib/parlay-xray/structural';
import { XRAY_PROP_KIND_LABEL, type ExtractedParlayLeg, type StructuralDependency } from '@/lib/parlay-xray/types';
import { toExtractedParlayLeg } from './adapt-props-explorer-offer';
import { marketDisplayLabel, type SelectedParlayLeg } from './selection';
import {
  bestSingleBook,
  computeParlayTrueCost,
  type BestBookResult,
  type BookLegQuote,
  type TrueCostResult,
} from './true-cost';
import type { TrueCostLegKey } from './true-cost-quotes';

export type TrueCostPanelLeg = {
  id: string;
  label: string;
  bookLabel: string | null;
};

export type TrueCostView = {
  legs: TrueCostPanelLeg[];
  result: TrueCostResult;
  bestBook: BestBookResult | null;
  /** Same-game or same-player legs are on the slip: fair odds assume independence. */
  linkedLegs: boolean;
};

export const TRUE_COST_DISCLAIMER = 'Price math, not betting advice.';
export const TRUE_COST_INDEPENDENCE_NOTE =
  'Fair odds multiply each leg’s no-vig probability, which assumes the legs are independent. Same-game legs move together, so the real joint chance can differ. This panel does not measure that.';
export const HEAVY_FAVORITE_NOTE = 'Short price: adds vig for little payout.';

function sideLabel(side: string): string {
  return side === 'over' ? 'Over' : side === 'under' ? 'Under' : side;
}

export function selectedLegLabel(leg: SelectedParlayLeg): string {
  const name = leg.offer.playerDisplayName ?? 'Player';
  return `${name} ${sideLabel(leg.offer.side)} ${leg.offer.line} ${marketDisplayLabel(leg.offer.market)}`;
}

export function legKeysFromSelected(legs: SelectedParlayLeg[]): Array<TrueCostLegKey & { vendor: string }> {
  return legs.map((leg) => ({
    gameId: leg.offer.gameId,
    playerId: leg.offer.playerId,
    market: leg.offer.market,
    side: leg.offer.side,
    line: leg.offer.line,
    vendor: leg.offer.sportsbook.vendor,
  }));
}

/** Structural same-game / same-player check on workspace legs (game id stands in for the matchup). */
export function selectedLegDependencies(legs: SelectedParlayLeg[]): StructuralDependency[] {
  return detectStructuralDependencies(
    legs.map((leg) => ({ ...toExtractedParlayLeg(leg.offer), matchupLabel: known(`game:${leg.offer.gameId}`) }))
  );
}

export function hasLinkedLegs(deps: StructuralDependency[]): boolean {
  return deps.some((dep) => dep.kind === 'same_game' || dep.kind === 'same_player');
}

function singleVendor(legs: SelectedParlayLeg[]): string | null {
  const vendors = new Set(legs.map((leg) => leg.offer.sportsbook.vendor));
  return vendors.size === 1 ? [...vendors][0]! : null;
}

/**
 * Workspace view. `quotesPerLeg` is null while prices load or when they are unavailable;
 * then fair odds stay unknown (the slip carries only the chosen side).
 */
export function buildWorkspaceTrueCost(
  legs: SelectedParlayLeg[],
  quotesPerLeg: BookLegQuote[][] | null
): TrueCostView {
  const inputs = legs.map((leg, i) => {
    const sameBook = quotesPerLeg?.[i]?.find((q) => q.vendor === leg.offer.sportsbook.vendor) ?? null;
    return {
      id: leg.offer.offerIdentity,
      priceAmerican: leg.offer.oddsAmerican,
      oppositeAmerican: sameBook?.oppositeAmerican ?? null,
    };
  });
  const result = computeParlayTrueCost(inputs);

  let bestBook: BestBookResult | null = null;
  if (quotesPerLeg && quotesPerLeg.length === legs.length && legs.length > 0) {
    bestBook = bestSingleBook({
      quotesPerLeg,
      fairProbability: result.fair.status === 'known' ? result.fair.probability : null,
      currentVendor: singleVendor(legs),
      currentDecimal: result.book.status === 'known' ? result.book.decimal : null,
    });
  }

  return {
    legs: legs.map((leg) => ({
      id: leg.offer.offerIdentity,
      label: selectedLegLabel(leg),
      bookLabel: leg.offer.sportsbook.displayName,
    })),
    result,
    bestBook,
    linkedLegs: hasLinkedLegs(selectedLegDependencies(legs)),
  };
}

function xrayLegLabel(leg: ExtractedParlayLeg): string {
  const name = leg.playerDisplayName.value ?? 'Player';
  const side = leg.side.value ? sideLabel(leg.side.value) : '';
  const line = leg.line.value != null ? String(leg.line.value) : '';
  const market =
    leg.propLabel.value ?? (leg.propKind.value ? XRAY_PROP_KIND_LABEL[leg.propKind.value] : '') ?? '';
  return [name, side, line, market].filter(Boolean).join(' ');
}

/** XRay slips only show the chosen side, so fair odds stay unknown here. */
export function buildXrayTrueCost(legs: ExtractedParlayLeg[], structural: StructuralDependency[]): TrueCostView {
  const result = computeParlayTrueCost(
    legs.map((leg) => ({
      id: leg.id,
      priceAmerican: leg.oddsAmerican.status === 'known' ? leg.oddsAmerican.value : null,
      oppositeAmerican: null,
    }))
  );
  return {
    legs: legs.map((leg) => ({
      id: leg.id,
      label: xrayLegLabel(leg),
      bookLabel: leg.sportsbookText.value ?? null,
    })),
    result,
    bestBook: null,
    linkedLegs: hasLinkedLegs(structural),
  };
}

export function xrayHasKnownPrices(legs: ExtractedParlayLeg[]): boolean {
  return legs.some((leg) => leg.oddsAmerican.status === 'known' && leg.oddsAmerican.value != null);
}
