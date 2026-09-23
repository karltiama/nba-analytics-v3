import { marketDisplayLabel, type SelectedParlayLeg } from '@/lib/parlay/selection';

/** Visible bar text only. Do not send this string to analytics. */
export function mobileParlayBarCopy(legs: SelectedParlayLeg[]): string {
  if (legs.length === 1) {
    const offer = legs[0]!.offer;
    const player = offer.playerDisplayName?.trim() || `Player ${offer.playerId}`;
    const side = offer.side === 'over' ? 'Over' : 'Under';
    return `${player} · ${side} ${offer.line} ${marketDisplayLabel(offer.market)}`;
  }
  if (legs.length === 0) return '';
  return `${legs.length} legs selected`;
}
