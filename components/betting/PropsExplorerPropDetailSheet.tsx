'use client';

import Link from 'next/link';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { formatProjectionGap, projectionGap } from '@/lib/betting/market-probability';
import { explorerBookDisplayName, explorerPropContextLabel } from '@/lib/betting/props-explorer-filters';
import {
  explorerCardPlayerName,
  explorerTableValueCopy,
  explorerValueToneClass,
  formatExplorerOdds,
} from '@/lib/betting/props-explorer-row-display';

export type PropsExplorerDetailRow = {
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

function formatConfidence(confidence: PropsExplorerDetailRow['confidenceTier']): string {
  if (confidence === 'high') return 'High';
  if (confidence === 'medium') return 'Medium';
  if (confidence === 'low') return 'Low';
  return '—';
}

function formatClosingTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const datePart = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timePart = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

function Fact({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="type-metadata">{label}</dt>
      <dd className={`text-right tabular-nums ${emphasize ? 'type-table-data text-[#075B5C]' : 'type-table-data text-[#063f46]'}`}>
        {value}
      </dd>
    </div>
  );
}

export function PropsExplorerPropDetailSheet({
  row,
  profileHref,
  isSaved,
  isSaving,
  saveBusy,
  isOnParlay,
  isAddingPaper,
  paperBusy,
  showAdvanced,
  onClose,
  onSave,
  onCompare,
  onPaper,
  onParlay,
  onPlayerContext,
}: {
  row: PropsExplorerDetailRow | null;
  profileHref: string;
  isSaved: boolean;
  isSaving: boolean;
  saveBusy: boolean;
  isOnParlay: boolean;
  isAddingPaper: boolean;
  paperBusy: boolean;
  showAdvanced: boolean;
  onClose: () => void;
  onSave: () => void;
  onCompare: () => void;
  onPaper: () => void;
  onParlay: () => void;
  onPlayerContext: () => void;
}) {
  const historical = row?.marketContext === 'historical';
  const paperDisabled = !row || paperBusy || row.paperBetAllowed === false || historical;
  const playerName = row ? explorerCardPlayerName(row.playerName, row.playerId) : 'Prop';
  const propLabel = row ? explorerPropContextLabel(row.propType, row.side, row.lineValue) : '';
  const gap = row ? projectionGap(row.projection, row.lineValue) : null;

  return (
    <Dialog.Root open={row != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[190] bg-[#063f46]/40" />
        <Dialog.Content
          data-prop-detail-sheet
          className="fixed z-[191] flex flex-col bg-white text-[#063f46] shadow-xl outline-none inset-x-0 bottom-0 max-h-[min(92dvh,40rem)] rounded-t-2xl border border-[#DCE9EA] lg:inset-y-0 lg:right-0 lg:left-auto lg:bottom-auto lg:h-dvh lg:max-h-none lg:w-full lg:max-w-md lg:rounded-none lg:border-y-0 lg:border-r-0"
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#DCE9EA] px-4 py-3">
            <div className="min-w-0">
              <Dialog.Title className="type-section-heading truncate text-[#063f46]">{playerName}</Dialog.Title>
              <Dialog.Description className="type-secondary mt-0.5 capitalize">{propLabel}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close prop details"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#4a6366] outline-none hover:bg-[#f7f9f7] hover:text-[#063f46] focus-visible:ring-2 focus-visible:ring-[#55ddb1]"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          {row ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <p className="type-metadata">Prop</p>
              <p className="type-table-data capitalize text-[#063f46]">{propLabel}</p>
              <dl className="mt-3 divide-y divide-[#DCE9EA] border-y border-[#DCE9EA]">
                <Fact label="Line" value={row.lineValue != null ? String(row.lineValue) : '—'} />
                <Fact label="Odds" value={formatExplorerOdds(row.oddsAmerican)} emphasize />
                <Fact label="Sportsbook" value={explorerBookDisplayName(row.sportsbook)} />
              </dl>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="type-metadata">Value</p>
                <span
                  className={`type-badge inline-flex items-center rounded-full border px-2 py-0.5 ${explorerValueToneClass(historical ? null : row.ev)}`}
                >
                  {explorerTableValueCopy(row.ev, row.marketContext)}
                </span>
              </div>
              <dl className="mt-1 divide-y divide-[#DCE9EA] border-b border-[#DCE9EA]">
                <Fact label="Confidence" value={formatConfidence(row.confidenceTier)} />
                <Fact
                  label={historical ? 'Closing Time' : 'Updated'}
                  value={formatClosingTime(row.snapshotAt)}
                />
              </dl>
              {showAdvanced ? (
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                  <div>
                    <dt className="type-metadata">Market P</dt>
                    <dd className="type-table-data tabular-nums text-[#063f46]">{formatPct(row.impliedProbability)}</dd>
                  </div>
                  <div>
                    <dt className="type-metadata">Est. P</dt>
                    <dd className="type-table-data tabular-nums text-[#063f46]">{formatPct(row.modelProbability)}</dd>
                  </div>
                  <div>
                    <dt className="type-metadata">Est. EV</dt>
                    <dd className="type-table-data tabular-nums text-[#063f46]">{formatPct(row.ev)}</dd>
                  </div>
                  <div>
                    <dt className="type-metadata">Proj</dt>
                    <dd className="type-table-data tabular-nums text-[#063f46]">
                      {row.projection != null && Number.isFinite(row.projection) ? row.projection.toFixed(1) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="type-metadata">Gap</dt>
                    <dd className="type-table-data tabular-nums text-[#063f46]">
                      {gap != null ? formatProjectionGap(gap) : '—'}
                    </dd>
                  </div>
                </dl>
              ) : null}
              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  aria-label={isOnParlay ? 'Added to parlay' : 'Add to parlay'}
                  aria-pressed={isOnParlay}
                  onClick={onParlay}
                  className={`type-interactive inline-flex min-h-11 items-center justify-center rounded-xl px-3 outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1] ${
                    isOnParlay
                      ? 'border border-[#075B5C] bg-[#F8FBFA] text-[#075B5C]'
                      : 'bg-[#55ddb1] text-[#063f46]'
                  }`}
                >
                  {isOnParlay ? 'Added' : 'Add to Parlay'}
                </button>
                <button
                  type="button"
                  onClick={onCompare}
                  data-coachmark="props-compare"
                  className="type-interactive inline-flex min-h-11 items-center justify-center rounded-xl border border-[#DCE9EA] bg-white px-3 text-[#063f46] outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1]"
                >
                  Compare Sportsbooks
                </button>
                <button
                  type="button"
                  disabled={saveBusy}
                  onClick={onSave}
                  className="type-interactive inline-flex min-h-11 items-center justify-center rounded-xl border border-[#DCE9EA] bg-white px-3 text-[#063f46] outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1] disabled:opacity-40"
                >
                  {isSaving ? '…' : isSaved ? 'Saved' : 'Save Prop'}
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
                  className="type-interactive inline-flex min-h-11 items-center justify-center rounded-xl border border-[#DCE9EA] bg-white px-3 text-[#063f46] outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1] disabled:opacity-40"
                >
                  {isAddingPaper ? '…' : 'Add to Paper'}
                </button>
                <Link
                  href={profileHref}
                  className="type-interactive inline-flex min-h-11 items-center justify-center rounded-xl border border-[#DCE9EA] bg-white px-3 text-[#075B5C] outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1]"
                >
                  View Player Profile
                </Link>
                <button
                  type="button"
                  onClick={onPlayerContext}
                  className="type-interactive inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-[#075B5C] outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1]"
                >
                  Player context
                </button>
              </div>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
