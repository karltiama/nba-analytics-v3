/**
 * Snapshot-only price read for a research-snapshot ticket.
 * Uses the selected American prices. Does not request current quotes.
 */

import { formatAmericanOdds } from '@/lib/betting/market-movement-format';
import { formatEtTimestamp } from '@/lib/quick-builds/preview';
import { marketDisplayLabel, type SelectedParlayLeg } from './selection';
import { computeParlayTrueCost, formatPercent } from './true-cost';

export const RESEARCH_SNAPSHOT_COST_COPY =
  'Calculated from previously observed sportsbook prices. These prices may have changed or become unavailable. Current sportsbook availability was not checked.';

export const RESEARCH_SNAPSHOT_BREAK_EVEN_COPY =
  'The hit rate required to break even at this calculated price. Not a predicted chance of winning.';

export function ticketUsesResearchSnapshot(legs: readonly SelectedParlayLeg[]): boolean {
  return legs.some((leg) => leg.offer.snapshotKind === 'research_snapshot');
}

/** Current-table quote lookup is only for tickets with no research-snapshot leg. */
export function shouldRequestCurrentParlayPrices(legs: readonly SelectedParlayLeg[]): boolean {
  return legs.length > 0 && !ticketUsesResearchSnapshot(legs);
}

export type ResearchSnapshotCostLeg = {
  id: string;
  label: string;
  oddsLabel: string;
  observedLabel: string;
};

export type ResearchSnapshotCost = {
  status: 'known' | 'unknown';
  legs: ResearchSnapshotCostLeg[];
  combinedOddsLabel: string | null;
  breakEvenLabel: string | null;
};

export function buildResearchSnapshotCost(legs: readonly SelectedParlayLeg[]): ResearchSnapshotCost {
  const rows = legs.map((leg) => {
    const side = leg.offer.side === 'over' ? 'Over' : 'Under';
    const observed = leg.offer.snapshotAt ? formatEtTimestamp(leg.offer.snapshotAt) : null;
    return {
      id: leg.offer.offerIdentity,
      label: `${leg.offer.playerDisplayName ?? 'Player'} ${side} ${leg.offer.line} ${marketDisplayLabel(leg.offer.market)}`,
      oddsLabel: formatAmericanOdds(leg.offer.oddsAmerican),
      observedLabel: observed ?? 'Observation time unavailable',
      priceAmerican: leg.offer.oddsAmerican,
    };
  });
  const cost = computeParlayTrueCost(rows.map((row) => ({ id: row.id, priceAmerican: row.priceAmerican, oppositeAmerican: null })));
  const book = cost.book.status === 'known' ? cost.book : null;
  return {
    status: book ? 'known' : 'unknown',
    legs: rows.map((row) => ({
      id: row.id,
      label: row.label,
      oddsLabel: row.oddsLabel,
      observedLabel: row.observedLabel,
    })),
    combinedOddsLabel: book && book.american != null ? formatAmericanOdds(book.american) : null,
    breakEvenLabel: book ? formatPercent(book.breakEvenHitRate) : null,
  };
}
