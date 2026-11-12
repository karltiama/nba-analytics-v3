'use client';

import Link from 'next/link';
import { Plus, X } from 'lucide-react';
import { PlayerHeadshot } from '@/components/nba/PlayerHeadshot';
import { TeamLogo } from '@/components/nba/TeamLogo';
import { shouldShowXrayOcrProvenance } from '@/lib/parlay/adapt-xray-confirmed';
import { marketDisplayLabel, snapshotDisplayLabel, type SelectedParlayLeg } from '@/lib/parlay/selection';
import {
  workspaceLegChips,
  workspaceLegStatus,
  workspaceLegStatusLabel,
  workspaceOddsLabel,
  workspaceProjectionDeltaLabel,
  workspaceReviewFlags,
  type WorkspaceLegStatus,
} from '@/lib/parlay/workspace-presentation';
import type { WorkspaceAnalysisRecord } from '@/lib/parlay/selection-store';
import { formatAvg } from '@/lib/parlay-xray/interpretation/display';
import { formatEtTimestamp } from '@/lib/quick-builds/preview';
import { cn } from '@/lib/utils';

type AnalysisResult = WorkspaceAnalysisRecord['result'];
type Interpretation = AnalysisResult['interpretations'][number];
type LegContext = AnalysisResult['contexts'][number];

const STATUS_CLASS: Record<WorkspaceLegStatus, string> = {
  supported: 'border-[#bfe8d2] bg-[#e7f8ef] text-[#0f6b45]',
  mixed: 'border-[#DCE9EA] bg-[#f4f6f6] text-[#4a6366]',
  needs_review: 'border-[#f0e0c8] bg-[#fff8ee] text-[#9a3412]',
};

export function WorkspaceLegList({
  legs,
  interpretations,
  contexts,
  parlay,
  showProjection,
  researchSnapshotTicket,
  explorerHref,
  onRemove,
  onClear,
  onOpenContext,
}: {
  legs: SelectedParlayLeg[];
  interpretations: Interpretation[];
  contexts: LegContext[];
  parlay: AnalysisResult['parlayInterpretation'] | null;
  showProjection: boolean;
  researchSnapshotTicket: boolean;
  explorerHref: string;
  onRemove: (offerIdentity: string) => void;
  onClear: () => void;
  onOpenContext: (index: number) => void;
}) {
  const playerCounts = new Map<string, number>();
  const gameCounts = new Map<string, number>();
  for (const leg of legs) {
    playerCounts.set(leg.offer.playerId, (playerCounts.get(leg.offer.playerId) ?? 0) + 1);
    gameCounts.set(leg.offer.gameId, (gameCounts.get(leg.offer.gameId) ?? 0) + 1);
  }

  return (
    <section
      className="@container min-w-0 rounded-2xl border border-[#DCE9EA] bg-white p-3 shadow-sm sm:p-4"
      aria-label="Selected parlay legs"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="type-section-heading text-[#063f46]">
          Your Parlay Legs <span className="text-cc-secondary">· {legs.length}</span>
        </h2>
        <div className="flex items-center gap-1">
          <Link
            href={explorerHref}
            className="type-interactive inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#075B5C] px-3 text-[#075B5C] hover:bg-[#55ddb1]/20"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add More Props
          </Link>
          <button
            type="button"
            className="type-interactive inline-flex min-h-9 items-center rounded-lg px-3 text-cc-secondary hover:bg-[#f7f9f7] hover:text-[#063f46]"
            aria-label="Clear parlay"
            onClick={onClear}
          >
            Clear Parlay
          </button>
        </div>
      </div>
      <ul className="space-y-2">
        {legs.map((leg, index) => {
          const interp = interpretations[index];
          const context = contexts[index];
          const status = interp ? workspaceLegStatus(interp) : null;
          const chips = interp
            ? workspaceLegChips(interp)
            : ([
                (playerCounts.get(leg.offer.playerId) ?? 0) >= 2 ? 'Same player' : null,
                (gameCounts.get(leg.offer.gameId) ?? 0) >= 2 ? 'Same game' : null,
                snapshotDisplayLabel(leg.offer.snapshotKind),
              ]
                .filter(Boolean)
                .slice(0, 3) as string[]);
          const review = parlay ? workspaceReviewFlags(parlay, index) : [];
          const shownChips = review.length > 0 && status === 'needs_review' ? review.slice(0, 3) : chips;
          const player = leg.offer.playerDisplayName ?? `Player ${leg.offer.playerId}`;
          const sideLabel = leg.offer.side === 'over' ? 'Over' : 'Under';
          const stats: Array<{ label: string; value: string }> = [];
          if (!researchSnapshotTicket) {
            stats.push(
              showProjection
                ? { label: 'Projection', value: formatAvg(context?.projection.projectedStat ?? null) }
                : { label: 'Season avg', value: formatAvg(interp?.recentForm.seasonAverage ?? null) }
            );
          }
          stats.push({ label: 'Line', value: String(leg.offer.line) });
          stats.push(
            interp && showProjection
              ? { label: 'Difference', value: workspaceProjectionDeltaLabel(context) }
              : { label: 'Odds', value: workspaceOddsLabel(leg.offer.oddsAmerican) }
          );
          if (interp) stats.push({ label: 'L5', value: formatAvg(interp.recentForm.last5Average) });

          return (
            <li
              key={leg.offer.offerIdentity}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 rounded-xl border border-[#DCE9EA] p-2.5 @2xl:grid-cols-[auto_minmax(10rem,16rem)_minmax(0,1fr)_auto] @2xl:items-center"
            >
              <div className="relative shrink-0 @2xl:row-span-2">
                <PlayerHeadshot
                  nbaPlayerId={leg.nbaPlayerId}
                  name={player}
                  className="relative h-14 w-14 overflow-hidden rounded-full border border-[#DCE9EA] bg-[#E8F0F1] @2xl:h-16 @2xl:w-16"
                />
                <span
                  className="type-metadata absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-[#DCE9EA] bg-white text-[#063f46]"
                  aria-hidden
                >
                  {index + 1}
                </span>
              </div>

              <div className="min-w-0">
                <h3 className="type-card-data truncate leading-5 text-[#063f46]">{player}</h3>
                <p className="type-secondary truncate leading-5">
                  {sideLabel} {leg.offer.line} {marketDisplayLabel(leg.offer.market)}
                </p>
                {leg.awayAbbr && leg.homeAbbr ? (
                  <p className="type-metadata flex min-w-0 flex-wrap items-center gap-1 leading-4">
                    <TeamLogo team={leg.awayAbbr} size="xs" decorative />
                    <span>{leg.awayAbbr}</span>
                    <span>@</span>
                    <TeamLogo team={leg.homeAbbr} size="xs" decorative />
                    <span>{leg.homeAbbr}</span>
                  </p>
                ) : (
                  <p className="type-metadata break-words leading-4">{leg.gameLabel ?? 'Matchup unavailable'}</p>
                )}
                {leg.offer.snapshotKind === 'research_snapshot' ? <SnapshotGameFacts leg={leg} /> : null}
              </div>

              <div className="flex shrink-0 items-center justify-end gap-1.5 @2xl:col-start-4 @2xl:row-start-1">
                {status ? (
                  <span className={cn('type-badge rounded-full border px-2 py-0.5', STATUS_CLASS[status])}>
                    {workspaceLegStatusLabel(status)}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg text-[#4a6366] hover:bg-[#f7f9f7] hover:text-[#063f46]"
                  aria-label={`Remove ${player} ${sideLabel} ${leg.offer.line} ${marketDisplayLabel(leg.offer.market)} from parlay`}
                  onClick={() => onRemove(leg.offer.offerIdentity)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <dl className="col-span-full flex flex-wrap gap-x-5 gap-y-1 rounded-lg bg-[#f7f9f7] px-3 py-1.5 @2xl:col-span-1 @2xl:col-start-3 @2xl:row-start-1 @2xl:justify-center @2xl:bg-transparent @2xl:py-0">
                {stats.map((stat) => (
                  <div key={stat.label} className="min-w-0 @2xl:text-center">
                    <dt className="type-metadata">{stat.label}</dt>
                    <dd className="type-card-data text-[#063f46]">{stat.value}</dd>
                  </div>
                ))}
              </dl>

              <div className="col-span-full flex min-w-0 flex-col gap-1.5 @2xl:col-span-3 @2xl:col-start-2">
                {shouldShowXrayOcrProvenance(leg) ? (
                  <p className="type-metadata">
                    Screenshot read: {leg.xrayProvenance?.ocrSnippet}
                    <span> · Confirmed:</span> {leg.xrayProvenance?.confirmedPlayerName}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ul className="flex flex-wrap gap-1">
                    {shownChips.map((chip) => (
                      <li
                        key={chip}
                        className="type-badge rounded-full border border-[#DCE9EA] bg-[#f7f9f7] px-2 py-0.5 text-[#063f46]"
                      >
                        {chip}
                      </li>
                    ))}
                  </ul>
                  {researchSnapshotTicket ? null : (
                    <button
                      type="button"
                      className="type-interactive inline-flex min-h-8 items-center text-[#075B5C] hover:underline"
                      onClick={() => onOpenContext(index)}
                    >
                      View Context →
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SnapshotGameFacts({ leg }: { leg: SelectedParlayLeg }) {
  const start = leg.gameStartTime ? formatEtTimestamp(leg.gameStartTime) : null;
  return (
    <>
      <p className="type-metadata break-words leading-4">{start ? `Game start ${start}` : 'Game start unavailable'}</p>
      {leg.gameStatus ? <p className="type-metadata break-words leading-4">Game status: {leg.gameStatus}</p> : null}
    </>
  );
}
