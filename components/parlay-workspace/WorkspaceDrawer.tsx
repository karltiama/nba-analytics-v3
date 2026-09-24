'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { formatAmericanOdds } from '@/lib/betting/market-movement-format';
import { formatAvg, formatLineSnapshot, formatMarketLabel } from '@/lib/parlay-xray/interpretation/display';
import type { XRayLegContext } from '@/lib/parlay-xray/context/types';
import type { XRayLegInterpretation } from '@/lib/parlay-xray/interpretation/types';
import { formatXrayPropLine } from '@/lib/parlay-xray/extraction/line-value';
import { workspaceProjectionDeltaLabel } from '@/lib/parlay/workspace-presentation';

export function WorkspaceDrawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="fixed inset-y-0 right-0 left-auto z-50 m-0 h-dvh max-h-none w-full max-w-[34rem] rounded-none border-y-0 border-r-0 border-l border-[#DCE9EA] bg-white p-0 text-[#063f46] shadow-lg backdrop:bg-[#063f46]/40"
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      onClose={onClose}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-[#DCE9EA] px-4 py-3">
          <h2 id={titleId} className="type-section-heading text-[#063f46]">
            {title}
          </h2>
          <button
            type="button"
            className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg text-[#4a6366] hover:bg-[#f7f9f7] hover:text-[#063f46]"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </dialog>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="type-metadata">{label}</p>
      <p className="type-card-data text-[#063f46]">{value}</p>
    </div>
  );
}

function Check({ label, ok }: { label: string; ok: boolean }) {
  return (
    <li className="type-secondary flex items-center justify-between gap-3 border-b border-[#DCE9EA] py-1.5 last:border-b-0">
      <span>{label}</span>
      <span className={ok ? 'text-[#0f6b45]' : 'text-[#9a3412]'}>{ok ? 'Available' : 'Unavailable'}</span>
    </li>
  );
}

export function LegContextBody({
  interp,
  context,
}: {
  interp: XRayLegInterpretation;
  context: XRayLegContext | undefined;
}) {
  const side = interp.identity.side === 'under' ? 'Under' : interp.identity.side === 'over' ? 'Over' : '—';
  const market = `${formatMarketLabel(interp.identity.market)} ${side} ${formatXrayPropLine(interp.identity.line)}`;

  return (
    <div className="space-y-4">
      <div>
        <p className="type-card-data text-[#063f46]">{interp.identity.playerDisplayName ?? 'Unknown player'}</p>
        <p className="type-secondary">{market}</p>
        <p className="type-body mt-2 text-cc-secondary">{interp.summarySentence}</p>
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-xl border border-[#DCE9EA] bg-[#f7f9f7] p-3">
        <Fact label="Projection" value={formatAvg(context?.projection.projectedStat ?? null)} />
        <Fact label="Line" value={formatXrayPropLine(interp.identity.line)} />
        <Fact label="Difference" value={workspaceProjectionDeltaLabel(context)} />
      </div>

      <section>
        <h3 className="type-secondary text-[#063f46]">Role and usage</h3>
        <dl className="mt-2 grid grid-cols-2 gap-2">
          <Fact label="Season minutes" value={formatAvg(interp.role.seasonMinutes)} />
          <Fact label="Last 5 minutes" value={formatAvg(interp.role.last5Minutes)} />
          <Fact label="Last game" value={formatAvg(interp.role.priorGameMinutes)} />
          <Fact label="Last 10 minutes" value={formatAvg(interp.role.last10Minutes)} />
        </dl>
      </section>

      <section>
        <h3 className="type-secondary text-[#063f46]">Recent form</h3>
        <p className="type-secondary mt-1">
          L5 {formatAvg(interp.recentForm.last5Average)} · L10 {formatAvg(interp.recentForm.last10Average)} · Season{' '}
          {formatAvg(interp.recentForm.seasonAverage)}
        </p>
        <p className="type-metadata mt-1">
          {interp.recentForm.above} above · {interp.recentForm.below} below the line
        </p>
      </section>

      <section>
        <h3 className="type-secondary text-[#063f46]">Matchup</h3>
        <dl className="mt-2 grid grid-cols-2 gap-2">
          <Fact label="Opponent pace" value={formatAvg(interp.matchup.opponentPace)} />
          <Fact label="Team pace" value={formatAvg(interp.matchup.teamPace)} />
          <Fact label="Opp. points allowed" value={formatAvg(interp.matchup.opponentPointsAllowed)} />
          <Fact label="Team points" value={formatAvg(interp.matchup.teamPoints)} />
        </dl>
      </section>

      <section>
        <h3 className="type-secondary text-[#063f46]">Market</h3>
        <p className="type-secondary mt-1">
          3-hour {formatLineSnapshot(interp.marketPosition.threeHourLine, interp.marketPosition.threeHourOdds)}
          <span> · </span>
          Decision close {formatLineSnapshot(interp.marketPosition.closeLine, interp.marketPosition.closeOdds)}
        </p>
        {interp.marketPosition.threeHourOdds != null && interp.marketPosition.closeOdds != null ? (
          <p className="type-metadata mt-1">
            Price {formatAmericanOdds(interp.marketPosition.threeHourOdds)} to {formatAmericanOdds(interp.marketPosition.closeOdds)}
          </p>
        ) : (
          <p className="type-metadata mt-1">Market history unavailable</p>
        )}
      </section>

      <section>
        <h3 className="type-secondary text-[#063f46]">Evidence</h3>
        <ul className="mt-2 space-y-2">
          {[...interp.supportingContext, ...interp.counterContext, ...interp.whyItCouldFail].length === 0 ? (
            <li className="type-secondary">None identified from certified available sources.</li>
          ) : (
            [...interp.supportingContext, ...interp.counterContext, ...interp.whyItCouldFail].map((item) => (
              <li key={item.code + item.detail} className="rounded-lg border border-[#DCE9EA] bg-[#f7f9f7] px-3 py-2">
                <p className="type-secondary text-[#063f46]">{item.title}</p>
                <p className="type-metadata mt-0.5">{item.detail}</p>
              </li>
            ))
          )}
        </ul>
      </section>

      <section>
        <h3 className="type-secondary text-[#063f46]">Data coverage</h3>
        <ul className="mt-1">
          <Check label="Projection" ok={interp.dataAvailability.projection === 'AVAILABLE'} />
          <Check label="Recent form" ok={interp.dataAvailability.playerForm === 'AVAILABLE'} />
          <Check label="WOWY" ok={interp.dataAvailability.wowy === 'AVAILABLE'} />
          <Check label="Availability" ok={interp.dataAvailability.availability === 'AVAILABLE'} />
          <Check label="Market history" ok={interp.dataAvailability.market === 'AVAILABLE'} />
        </ul>
      </section>
    </div>
  );
}
