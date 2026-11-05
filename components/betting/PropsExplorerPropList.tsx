'use client';

import { Check, Plus } from 'lucide-react';
import { explorerBookDisplayName, explorerPropContextLabel } from '@/lib/betting/props-explorer-filters';
import { formatArbProfit, type PropsExplorerArb } from '@/lib/betting/props-explorer-arb';
import {
  MOVEMENT_TITLE,
  movementLabel,
  movementTextClass,
  type PropsExplorerMovement,
} from '@/lib/betting/props-explorer-movement';
import {
  BEST_PRICE_TITLE,
  FAIR_PROBABILITY_TITLE,
  type ExplorerBestPrice,
  explorerCardPlayerName,
  formatExplorerOdds,
  formatFairProbability,
} from '@/lib/betting/props-explorer-row-display';

export type PropsExplorerScanRow = {
  playerId: number;
  playerName: string | null;
  sportsbook: string | null;
  propType: string | null;
  side: string | null;
  lineValue: number | null;
  oddsAmerican: number | null;
  ev: number | null;
  fairProbability?: number | null;
  bestPrice?: ExplorerBestPrice | null;
  arb?: PropsExplorerArb | null;
  movement?: PropsExplorerMovement | null;
  snapshotAt?: string | null;
  marketContext?: 'live' | 'historical';
};

function formatObserved(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function PropsExplorerPropList<T extends PropsExplorerScanRow>({
  rows,
  getRowKey,
  isOnParlay,
  onOpen,
  onParlay,
}: {
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  isOnParlay: (row: T) => boolean;
  onOpen: (row: T) => void;
  onParlay: (row: T) => void;
}) {
  return (
    <div data-prop-list className="min-w-0 border-y border-[#DCE9EA] bg-white">
      {rows.map((row, index) => {
        const playerName = explorerCardPlayerName(row.playerName, row.playerId);
        const propLabel = explorerPropContextLabel(row.propType, row.side, row.lineValue);
        const odds = formatExplorerOdds(row.oddsAmerican);
        const onSlip = isOnParlay(row);
        const observed = formatObserved(row.snapshotAt);
        return (
          <div
            key={getRowKey(row, index)}
            data-prop-row
            className="grid min-h-[4.5rem] max-h-[5.625rem] grid-cols-[minmax(0,1fr)_auto_auto_auto_2rem] items-center gap-x-3 border-b border-[#DCE9EA] px-3 py-1.5 last:border-b-0"
          >
            <button
              type="button"
              onClick={() => onOpen(row)}
              className="col-span-4 grid h-full min-w-0 grid-cols-subgrid items-center gap-x-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1]"
              aria-label={`Open details for ${playerName}, ${propLabel}`}
            >
              <span className="min-w-0">
                <span className="type-table-data block truncate text-[#063f46]">{playerName}</span>
                <span className="type-secondary mt-0.5 block truncate capitalize">{propLabel}</span>
              </span>
              <span className="max-w-[8rem] text-right">
                <span className="type-metadata block truncate">{explorerBookDisplayName(row.sportsbook)}</span>
                {observed ? <span className="type-metadata block truncate">{observed}</span> : null}
              </span>
              <span className="whitespace-nowrap text-right" title={FAIR_PROBABILITY_TITLE}>
                <span className="type-metadata block">Fair</span>
                <span className="type-table-data block tabular-nums text-[#063f46]">
                  {formatFairProbability(row.fairProbability)}
                </span>
              </span>
              <span className="whitespace-nowrap text-right" title={BEST_PRICE_TITLE}>
                <span className="type-table-data block tabular-nums text-[#075B5C]">{odds}</span>
                {row.bestPrice && row.bestPrice.bookCount > 1 ? (
                  row.bestPrice.isBest ? (
                    <span className="type-metadata block font-medium text-[#178A45]">Best</span>
                  ) : (
                    <span className="type-metadata block tabular-nums">
                      Best {formatExplorerOdds(row.bestPrice.oddsAmerican)}
                    </span>
                  )
                ) : null}
                {row.arb ? (
                  <span className="type-metadata block font-medium text-[#178A45]">{formatArbProfit(row.arb.profit)}</span>
                ) : null}
                {movementLabel(row.movement) ? (
                  <span className={`type-metadata block ${movementTextClass(row.movement)}`} title={MOVEMENT_TITLE}>
                    {movementLabel(row.movement)}
                  </span>
                ) : null}
              </span>
            </button>
            <button
              type="button"
              aria-label={onSlip ? 'Added to parlay' : 'Add to parlay'}
              aria-pressed={onSlip}
              data-coachmark={index === 0 ? 'props-add-parlay' : undefined}
              onClick={() => onParlay(row)}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1] ${
                onSlip
                  ? 'border border-[#075B5C] bg-[#F8FBFA] text-[#075B5C]'
                  : 'bg-[#55ddb1] text-[#063f46]'
              }`}
            >
              {onSlip ? <Check className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
            </button>
          </div>
        );
      })}
    </div>
  );
}
