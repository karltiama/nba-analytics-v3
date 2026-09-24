/**
 * Display helpers for Send to Sportsbook sheet (no outbound URL logic).
 */

import type { CanonicalBetLeg } from '@/lib/bet-slip/types';
import { displayVendor } from '@/lib/betting/market-movement';
import { marketDisplayLabel, type SelectedParlayLeg } from '@/lib/parlay/selection';

export type HandoffSheetLeg = {
  key: string;
  playerName: string;
  sideLineMarket: string;
  originallySelectedLabel: string | null;
  gameLabel: string | null;
};

function formatOdds(odds: number | null | undefined): string {
  if (odds == null || !Number.isFinite(odds)) return '';
  return odds > 0 ? `+${odds}` : String(odds);
}

export function handoffSheetLegFromSelected(leg: SelectedParlayLeg): HandoffSheetLeg {
  const player = leg.offer.playerDisplayName ?? `Player ${leg.offer.playerId}`;
  const side = leg.offer.side === 'over' ? 'Over' : 'Under';
  const market = marketDisplayLabel(leg.offer.market);
  const book = leg.offer.sportsbook.displayName;
  const odds = formatOdds(leg.offer.oddsAmerican);
  return {
    key: leg.offer.offerIdentity,
    playerName: player,
    sideLineMarket: `${side} ${leg.offer.line} ${market}`,
    originallySelectedLabel: odds ? `${book} · ${odds}` : book,
    gameLabel: leg.gameLabel,
  };
}

export function handoffSheetLegFromCanonical(leg: CanonicalBetLeg): HandoffSheetLeg {
  const side = leg.side === 'over' ? 'Over' : 'Under';
  const market = marketDisplayLabel(leg.market);
  const book = leg.selectedSportsbook ? displayVendor(leg.selectedSportsbook) : null;
  const odds = formatOdds(leg.selectedOdds);
  let originallySelectedLabel: string | null = null;
  if (book && odds) originallySelectedLabel = `${book} · ${odds}`;
  else if (book) originallySelectedLabel = book;
  else if (odds) originallySelectedLabel = odds;

  return {
    key: `${leg.selectionKey}|${leg.selectedAt}`,
    playerName: leg.playerName?.trim() || `Player ${leg.playerId}`,
    sideLineMarket: `${side} ${leg.line} ${market}`,
    originallySelectedLabel,
    gameLabel: leg.gameLabel ?? null,
  };
}
