'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { formatProjectionGap, projectionGap } from '@/lib/betting/market-probability';
import { playerResearchHref } from '@/lib/betting/research-journey';
import {
  explorerCardPlayerName,
  explorerCardValueLabel,
  explorerValueToneClass,
  formatExplorerOdds,
} from '@/lib/betting/props-explorer-row-display';

export type PropsExplorerCardRow = {
  gameId: number;
  playerId: number;
  playerName: string | null;
  sportsbook: string | null;
  propType: string | null;
  side: string | null;
  lineValue: number | null;
  oddsAmerican: number | null;
  impliedProbability: number | null;
  snapshotAt: string;
  modelProbability: number | null;
  ev: number | null;
  projection: number | null;
  confidenceTier?: 'high' | 'medium' | 'low' | null;
  marketContext?: 'live' | 'historical';
  paperBetAllowed?: boolean;
};

function formatPct(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(1)}%`;
}

function formatConfidence(confidence: PropsExplorerCardRow['confidenceTier']): string {
  if (confidence === 'high') return 'High';
  if (confidence === 'medium') return 'Medium';
  if (confidence === 'low') return 'Low';
  return '—';
}

function marketLabel(propType: string | null): string {
  return (propType ?? '—').replace(/_/g, ' ');
}

export function PropsExplorerPropCard({
  row,
  date,
  isSaved,
  isSaving,
  saveBusy,
  isOnParlay,
  isAddingPaper,
  paperBusy,
  showAdvanced,
  onOpenContext,
  onSave,
  onCompare,
  onPaper,
  onParlay,
}: {
  row: PropsExplorerCardRow;
  date: string;
  isSaved: boolean;
  isSaving: boolean;
  saveBusy: boolean;
  isOnParlay: boolean;
  isAddingPaper: boolean;
  paperBusy: boolean;
  showAdvanced: boolean;
  onOpenContext: () => void;
  onSave: () => void;
  onCompare: () => void;
  onPaper: () => void;
  onParlay: () => void;
}) {
  const playerName = explorerCardPlayerName(row.playerName, row.playerId);
  const odds = formatExplorerOdds(row.oddsAmerican);
  const line = row.lineValue ?? '—';
  const side = row.side ?? '—';
  const book = row.sportsbook ?? '—';
  const historical = row.marketContext === 'historical';
  const paperDisabled = paperBusy || row.paperBetAllowed === false || historical;
  const gap = projectionGap(row.projection, row.lineValue);

  return (
    <article
      data-prop-card
      className="min-w-0 rounded-2xl border border-[#DCE9EA] bg-white p-3 shadow-sm"
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onOpenContext}
          title={playerName}
          className="type-card-data min-h-11 min-w-0 flex-1 truncate text-left text-[#075B5C]"
        >
          {playerName}
        </button>
        <Link
          href={playerResearchHref({
            playerId: row.playerId,
            date,
            gameId: row.gameId,
            propType: row.propType,
            side: row.side,
            sportsbook: row.sportsbook,
            lineValue: row.lineValue,
          })}
          aria-label="Open full profile"
          className="type-interactive inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-cc-secondary"
          onClick={(event) => event.stopPropagation()}
        >
          Profile
          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
        </Link>
      </div>

      <p className="type-card-data mt-1 text-[#063f46] capitalize">
        {marketLabel(row.propType)}
        <span className="mx-1 text-cc-secondary">·</span>
        <span className="capitalize">{side}</span> {line}
      </p>

      <div className="mt-1 flex items-baseline justify-between gap-3">
        <p className="type-secondary min-w-0 truncate">{book}</p>
        <p data-prop-odds={odds} className="type-card-data shrink-0 whitespace-nowrap tabular-nums text-[#063f46]">
          {odds}
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className={`type-badge inline-flex max-w-full items-center whitespace-nowrap rounded-full border px-2 py-0.5 ${explorerValueToneClass(historical ? null : row.ev)}`}
          title={
            historical
              ? 'Historical closing line — estimated EV is not computed'
              : row.ev != null && Number.isFinite(row.ev)
                ? `Estimated EV (market-anchored): ${(row.ev * 100).toFixed(1)}%`
                : 'No estimated EV available'
          }
        >
          {explorerCardValueLabel(row.ev, row.marketContext)}
        </span>
        <p className="type-secondary">Confidence {formatConfidence(row.confidenceTier)}</p>
      </div>

      {showAdvanced ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
          <div>
            <dt className="type-metadata">Market P</dt>
            <dd className="type-secondary tabular-nums">{formatPct(row.impliedProbability)}</dd>
          </div>
          <div>
            <dt className="type-metadata">Est. P</dt>
            <dd className="type-secondary tabular-nums">{formatPct(row.modelProbability)}</dd>
          </div>
          <div>
            <dt className="type-metadata">Est. EV</dt>
            <dd className="type-secondary tabular-nums">{formatPct(row.ev)}</dd>
          </div>
          <div>
            <dt className="type-metadata">Proj</dt>
            <dd className="type-secondary tabular-nums">
              {row.projection != null && Number.isFinite(row.projection) ? row.projection.toFixed(1) : '—'}
            </dd>
          </div>
          <div>
            <dt className="type-metadata">Gap</dt>
            <dd className="type-secondary tabular-nums">{gap != null ? formatProjectionGap(gap) : '—'}</dd>
          </div>
        </dl>
      ) : null}

      <p className="type-metadata mt-3">
        {historical ? 'Closed' : 'Updated'} {new Date(row.snapshotAt).toLocaleString()}
      </p>

      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          aria-label={isOnParlay ? 'Added to parlay' : 'Add to Parlay'}
          aria-pressed={isOnParlay}
          onClick={onParlay}
          data-coachmark="props-add-parlay"
          className={`type-interactive inline-flex min-h-11 items-center justify-center rounded-xl px-3 ${
            isOnParlay
              ? 'border border-[#075B5C] bg-[#F8FBFA] text-[#075B5C]'
              : 'bg-[#55ddb1] text-[#063f46]'
          }`}
        >
          {isOnParlay ? 'Added' : 'Parlay'}
        </button>
        <button
          type="button"
          onClick={onCompare}
          data-coachmark="props-compare"
          className="type-interactive inline-flex min-h-11 items-center justify-center rounded-xl border border-[#DCE9EA] bg-white px-3 text-[#063f46]"
        >
          Compare books
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={saveBusy}
            onClick={onSave}
            className="type-interactive inline-flex min-h-11 items-center justify-center rounded-xl border border-[#DCE9EA] bg-white px-3 text-cc-secondary disabled:opacity-40"
          >
            {isSaving ? '…' : isSaved ? 'Saved' : 'Save'}
          </button>
          <button
            type="button"
            disabled={paperDisabled}
            onClick={onPaper}
            title={
              paperDisabled && !isAddingPaper
                ? 'Paper bets cannot be placed on completed historical games'
                : 'Add to paper bets'
            }
            className="type-interactive inline-flex min-h-11 items-center justify-center rounded-xl border border-[#DCE9EA] bg-white px-3 text-cc-secondary disabled:opacity-40"
          >
            {isAddingPaper ? '…' : 'Paper'}
          </button>
        </div>
      </div>
    </article>
  );
}
