'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import { mobileParlayBarCopy } from '@/lib/parlay/mobile-bar-copy';
import {
  PARLAY_WORKSPACE_HREF,
  marketDisplayLabel,
  summarizeCanonicalSelection,
  type SelectedParlayLeg,
} from '@/lib/parlay/selection';

function OpenWorkspaceLink({ className, children }: { className?: string; children?: string }) {
  return (
    <Link
      href={PARLAY_WORKSPACE_HREF}
      className={
        className ??
        'mx-2.5 mb-2.5 text-center text-xs font-semibold rounded-lg border border-[#075B5C] text-[#075B5C] hover:bg-[#55ddb1]/20 px-3 py-2.5 min-h-[44px] flex items-center justify-center'
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
  const sideLine = `${leg.offer.side === 'over' ? 'Over' : 'Under'} ${leg.offer.line}`;
  return (
    <li className="rounded-lg border border-[#DCE9EA] bg-[#F8FBFA] px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[#063f46] truncate">{player}</p>
          <p className="text-[11px] text-[#4a6366] mt-0.5">
            {sideLine} {market}
          </p>
          <p className="text-[11px] text-[#4a6366] truncate">{leg.offer.sportsbook.displayName}</p>
          {leg.gameLabel ? (
            <p className="text-[10px] text-[#8aa0a3] truncate">{leg.gameLabel}</p>
          ) : null}
          {samePlayer || sameGame ? (
            <p className="text-[10px] text-[#075B5C] mt-1">
              {[samePlayer ? 'Same player' : null, sameGame ? 'Same game' : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="p-1.5 rounded-lg text-[#4a6366] hover:text-[#063f46] hover:bg-white shrink-0 min-h-[32px] min-w-[32px] flex items-center justify-center"
          aria-label={`Remove ${player} ${sideLine} ${market} from parlay`}
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
}: {
  legs: SelectedParlayLeg[];
  onRemove: (offerIdentity: string) => void;
  onClear: () => void;
  onDismiss?: () => void;
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
          <h2 className="text-sm font-semibold text-[#063f46]">Selected parlay</h2>
          <p className="text-[11px] text-[#4a6366] mt-0.5">{preview.summary}</p>
          {preview.labels.length ? (
            <p className="text-[10px] text-[#075B5C] mt-1">{preview.labels.join(' · ')}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onDismiss ? (
            <button
              type="button"
              className="px-2 py-1 text-[11px] font-medium rounded-lg border border-[#DCE9EA] bg-white text-[#063f46] hover:bg-[#f7f9f7] min-h-[32px]"
              onClick={onDismiss}
            >
              Done
            </button>
          ) : null}
          <button
            type="button"
            className="px-2 py-1 text-[11px] font-medium rounded-lg border border-[#DCE9EA] bg-white text-[#063f46] hover:bg-[#f7f9f7] min-h-[32px]"
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
      <OpenWorkspaceLink />
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
  if (legs.length === 0) return null;

  return (
    <>
      <div className="hidden lg:block">
        <aside
          className="fixed bottom-4 right-4 xl:right-[calc(24rem+2.5rem)] z-40 w-96 max-w-[calc(100vw-2rem)] max-h-[min(28rem,50vh)] flex flex-col bg-white border border-[#DCE9EA] rounded-2xl shadow-sm overflow-hidden"
          aria-label="Selected parlay"
        >
          <TrayBody legs={legs} onRemove={onRemove} onClear={onClear} />
        </aside>
      </div>

      <div className="lg:hidden">
        <Link
          href={PARLAY_WORKSPACE_HREF}
          className="fixed inset-x-4 z-40 flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-[#DCE9EA] bg-white px-4 py-3 shadow-sm bottom-[max(1rem,env(safe-area-inset-bottom))]"
          aria-label={`${mobileParlayBarCopy(legs)}. Review Parlay`}
        >
          <span className="type-secondary min-w-0 truncate text-[#063f46]">{mobileParlayBarCopy(legs)}</span>
          <span className="type-interactive shrink-0 text-[#075B5C]">Review Parlay</span>
        </Link>
      </div>
    </>
  );
}
