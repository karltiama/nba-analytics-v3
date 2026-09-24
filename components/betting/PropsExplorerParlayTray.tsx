'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Maximize2, Minus, X } from 'lucide-react';
import { ShareParlayControls } from '@/components/betting/ShareParlayControls';
import { SendToSportsbookControls } from '@/components/betting/SendToSportsbookControls';
import { PlayerHeadshot } from '@/components/nba/PlayerHeadshot';
import { TeamLogo } from '@/components/nba/TeamLogo';
import { canonicalBetLegFromSelectedParlayLeg } from '@/lib/bet-slip/adapt-parlay-leg';
import { mobileParlayBarCopy } from '@/lib/parlay/mobile-bar-copy';
import {
  PARLAY_WORKSPACE_HREF,
  marketDisplayLabel,
  summarizeCanonicalSelection,
  type SelectedParlayLeg,
} from '@/lib/parlay/selection';
import { handoffSheetLegFromSelected } from '@/lib/sportsbook-handoff';

function OpenWorkspaceLink({ className, children }: { className?: string; children?: string }) {
  return (
    <Link
      href={PARLAY_WORKSPACE_HREF}
      className={
        className ??
        'type-interactive flex min-h-[44px] flex-1 items-center justify-center rounded-lg border border-[#075B5C] px-3 py-2.5 text-center text-[#075B5C] hover:bg-[#55ddb1]/20'
      }
    >
      {children ?? 'Open Workspace'}
    </Link>
  );
}

function LegRow({
  leg,
  samePlayer,
  sameGame,
  onRemove,
}: {
  leg: SelectedParlayLeg;
  samePlayer: boolean;
  sameGame: boolean;
  onRemove: (offerIdentity: string) => void;
}) {
  const player = leg.offer.playerDisplayName ?? `Player ${leg.offer.playerId}`;
  const market = marketDisplayLabel(leg.offer.market);
  const sideLabel = leg.offer.side === 'over' ? 'Over' : 'Under';
  const lineLabel = String(leg.offer.line);
  const awayAbbr = leg.awayAbbr?.trim() || null;
  const homeAbbr = leg.homeAbbr?.trim() || null;
  return (
    <li className="rounded-lg border border-[#DCE9EA] bg-[#F8FBFA] px-2.5 py-2">
      <div className="flex items-stretch gap-2.5">
        <PlayerHeadshot
          nbaPlayerId={leg.nbaPlayerId}
          name={player}
          className="relative w-14 min-h-[3.75rem] shrink-0 self-stretch overflow-hidden rounded-xl border border-[#DCE9EA] bg-[#E8F0F1]"
        />
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
          <div className="min-w-0 space-y-0.5">
            <p className="type-card-data truncate leading-5 text-[#063f46]">{player}</p>
            {awayAbbr && homeAbbr ? (
              <p className="type-metadata flex min-w-0 items-center gap-1 leading-4">
                <TeamLogo team={awayAbbr} size="xs" decorative />
                <span className="truncate font-medium text-[#063f46]">{awayAbbr}</span>
                <span>@</span>
                <TeamLogo team={homeAbbr} size="xs" decorative />
                <span className="truncate font-medium text-[#063f46]">{homeAbbr}</span>
              </p>
            ) : leg.gameLabel ? (
              <p className="type-metadata truncate leading-4">{leg.gameLabel}</p>
            ) : null}
            {samePlayer || sameGame ? (
              <p className="type-metadata leading-4">
                {[samePlayer ? 'Same player' : null, sameGame ? 'Same game' : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            ) : null}
          </div>
          <div className="min-w-0 text-right">
            <p className="type-card-data leading-5 text-[#063f46]">
              <span className="font-semibold">{sideLabel}</span>{' '}
              <span className="tabular-nums">{lineLabel}</span>
            </p>
            <p className="type-secondary truncate leading-5">{market}</p>
            <p className="type-metadata truncate leading-4">{leg.offer.sportsbook.displayName}</p>
          </div>
        </div>
        <button
          type="button"
          className="self-start p-1.5 rounded-lg text-[#4a6366] hover:text-[#063f46] hover:bg-white shrink-0 min-h-[32px] min-w-[32px] flex items-center justify-center"
          aria-label={`Remove ${player} ${sideLabel} ${lineLabel} ${market} from parlay`}
          onClick={() => onRemove(leg.offer.offerIdentity)}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </li>
  );
}

function TrayBody({
  legs,
  onRemove,
  onClear,
  onDismiss,
  onMinimize,
}: {
  legs: SelectedParlayLeg[];
  onRemove: (offerIdentity: string) => void;
  onClear: () => void;
  onDismiss?: () => void;
  onMinimize?: () => void;
}) {
  const preview = summarizeCanonicalSelection(legs);
  const playerCounts = new Map<string, number>();
  const gameCounts = new Map<string, number>();
  for (const leg of legs) {
    playerCounts.set(leg.offer.playerId, (playerCounts.get(leg.offer.playerId) ?? 0) + 1);
    gameCounts.set(leg.offer.gameId, (gameCounts.get(leg.offer.gameId) ?? 0) + 1);
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="px-3 py-2.5 border-b border-[#DCE9EA] bg-[#F8FBFA] flex items-start justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <h2 className="type-section-heading text-[#063f46]">Selected parlay</h2>
          <p className="type-secondary mt-0.5">{preview.summary}</p>
          {preview.labels.length ? (
            <p className="type-metadata mt-1">{preview.labels.join(' · ')}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onMinimize ? (
            <button
              type="button"
              className="p-1.5 rounded-lg border border-[#DCE9EA] bg-white text-[#4a6366] hover:text-[#063f46] hover:bg-[#f7f9f7] min-h-[32px] min-w-[32px] flex items-center justify-center"
              aria-label="Minimize selected parlay"
              onClick={onMinimize}
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              className="type-interactive min-h-[32px] rounded-lg border border-[#DCE9EA] bg-white px-2 py-1 text-[#063f46] hover:bg-[#f7f9f7]"
              onClick={onDismiss}
            >
              Done
            </button>
          ) : null}
          <button
            type="button"
            className="type-interactive min-h-[32px] rounded-lg border border-[#DCE9EA] bg-white px-2 py-1 text-[#063f46] hover:bg-[#f7f9f7]"
            aria-label="Clear parlay"
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      </div>
      <ul className="p-2.5 space-y-2 overflow-y-auto flex-1 min-h-0">
        {legs.map((leg) => (
          <LegRow
            key={leg.offer.offerIdentity}
            leg={leg}
            samePlayer={(playerCounts.get(leg.offer.playerId) ?? 0) >= 2}
            sameGame={(gameCounts.get(leg.offer.gameId) ?? 0) >= 2}
            onRemove={onRemove}
          />
        ))}
      </ul>
      <div className="mx-2.5 mb-2.5 flex flex-col gap-2">
        <div className="flex gap-2">
          <OpenWorkspaceLink />
          <ShareParlayControls
            legs={legs}
            source="props_explorer"
            surface="props_explorer"
            className="type-interactive flex min-h-[44px] flex-1 items-center justify-center rounded-lg border border-[#075B5C] bg-[#075B5C] px-3 py-2.5 text-center text-white hover:opacity-90 disabled:opacity-40"
          />
        </div>
        <SendToSportsbookControls
          legs={legs.map(handoffSheetLegFromSelected)}
          spikeLegs={legs.map((leg) => canonicalBetLegFromSelectedParlayLeg(leg))}
          surface="props_explorer"
          className="type-interactive flex min-h-[44px] w-full items-center justify-center rounded-lg border border-[#075B5C] px-3 py-2.5 text-center text-[#075B5C] hover:bg-[#55ddb1]/20 disabled:opacity-40"
        />
      </div>
    </div>
  );
}

export function PropsExplorerParlayTray({
  legs,
  onRemove,
  onClear,
}: {
  legs: SelectedParlayLeg[];
  onRemove: (offerIdentity: string) => void;
  onClear: () => void;
}) {
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    if (legs.length === 0) setMinimized(false);
  }, [legs.length]);

  if (legs.length === 0) return null;

  const legCountLabel = `${legs.length} leg${legs.length === 1 ? '' : 's'}`;

  return (
    <>
      <div className="hidden lg:block">
        {minimized ? (
          <button
            type="button"
            className="fixed bottom-4 right-4 xl:right-[calc(24rem+2.5rem)] z-40 flex items-center gap-2 rounded-2xl border border-[#DCE9EA] bg-white px-3 py-2.5 shadow-sm text-[#063f46] hover:bg-[#F8FBFA]"
            aria-label={`Expand selected parlay, ${legCountLabel}`}
            onClick={() => setMinimized(false)}
          >
            <span className="type-secondary">{legCountLabel}</span>
            <Maximize2 className="w-3.5 h-3.5 shrink-0 text-[#4a6366]" aria-hidden />
          </button>
        ) : (
          <aside
            className="fixed bottom-4 right-4 xl:right-[calc(24rem+2.5rem)] z-40 w-96 max-w-[calc(100vw-2rem)] max-h-[min(28rem,50vh)] flex flex-col bg-white border border-[#DCE9EA] rounded-2xl shadow-sm overflow-hidden"
            aria-label="Selected parlay"
          >
            <TrayBody
              legs={legs}
              onRemove={onRemove}
              onClear={onClear}
              onMinimize={() => setMinimized(true)}
            />
          </aside>
        )}
      </div>

      <div className="lg:hidden">
        <div className="fixed inset-x-4 z-40 flex min-h-11 items-center gap-2 bottom-[max(1rem,env(safe-area-inset-bottom))]">
          <Link
            href={PARLAY_WORKSPACE_HREF}
            className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 rounded-2xl border border-[#DCE9EA] bg-white px-4 py-3 shadow-sm"
            aria-label={`${mobileParlayBarCopy(legs)}. Review Parlay`}
          >
            <span className="type-secondary min-w-0 truncate text-[#063f46]">
              {mobileParlayBarCopy(legs)}
            </span>
            <span className="type-interactive shrink-0 text-[#075B5C]">Review Parlay</span>
          </Link>
          <ShareParlayControls
            legs={legs}
            source="props_explorer"
            surface="props_explorer"
            className="type-interactive flex min-h-11 shrink-0 items-center justify-center rounded-2xl border border-[#075B5C] bg-[#075B5C] px-4 text-white shadow-sm hover:opacity-90 disabled:opacity-40"
          />
        </div>
      </div>
    </>
  );
}
