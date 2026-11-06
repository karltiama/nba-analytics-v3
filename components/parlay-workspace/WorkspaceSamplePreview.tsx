'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { buildWorkspaceHistoricalPreviewLegs, WORKSPACE_HISTORICAL_PREVIEW_HREF } from '@/lib/parlay/preview-fixture';
import { X3F_DATE_LABEL, X3F_SLATE_LABEL } from '@/lib/parlay-xray/e2e/ground-truth';
import { marketDisplayLabel, type SelectedParlayLeg } from '@/lib/parlay/selection';
import { runWorkspaceHistoricalAnalysis } from '@/lib/parlay/workspace-analysis';
import {
  workspaceCombinedOdds,
  workspaceKeySignals,
  workspaceMainRisks,
  workspaceOddsLabel,
  type WorkspaceSignal,
  type WorkspaceSignalTone,
} from '@/lib/parlay/workspace-presentation';
import { cn } from '@/lib/utils';

const TONE_CLASS: Record<WorkspaceSignalTone, string> = {
  support: 'border-[#bfe8d2] bg-[#f3fbf7]',
  watch: 'border-[#f0e0c8] bg-[#fff8ee]',
  concern: 'border-[#f6d5d5] bg-[#fff7f7]',
  info: 'border-[#DCE9EA] bg-[#f4f7f8]',
};

type Sample = {
  legs: SelectedParlayLeg[];
  summary: string;
  signals: WorkspaceSignal[];
  risks: Array<{ title: string; detail: string }>;
};

/**
 * Read-only sample analysis for the empty Workspace.
 * Runs the certified historical fixture locally (no provider calls) and never writes the live selection store.
 */
export function WorkspaceSamplePreview() {
  const [sample, setSample] = useState<Sample | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const legs = buildWorkspaceHistoricalPreviewLegs();
        const { buildX3fReplayContext, buildX3fReplayDeps } = await import('@/lib/parlay-xray/e2e/fixture');
        const result = runWorkspaceHistoricalAnalysis(legs, buildX3fReplayContext(), buildX3fReplayDeps());
        const parlay = result.parlayInterpretation;
        if (cancelled) return;
        setSample({
          legs,
          summary: parlay.summarySentence,
          signals: workspaceKeySignals(parlay, result.interpretations, result.contexts),
          risks: workspaceMainRisks(parlay).slice(0, 2),
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return null;

  const combined = sample ? workspaceCombinedOdds(sample.legs) : null;

  return (
    <section
      className="relative min-w-0 rounded-2xl border border-[#DCE9EA] bg-white p-4 shadow-sm sm:p-5"
      aria-labelledby="workspace-sample-heading"
      data-workspace-sample
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="workspace-sample-heading" className="type-section-heading text-[#063f46]">
            What an analysis looks like
          </h2>
          <p className="type-metadata mt-0.5">
            Sample · {X3F_SLATE_LABEL} · {X3F_DATE_LABEL} · historical example
          </p>
        </div>
        <Link
          href={WORKSPACE_HISTORICAL_PREVIEW_HREF}
          className="type-interactive inline-flex min-h-11 items-center justify-center rounded-lg border border-[#075B5C] bg-[#075B5C] px-4 text-white hover:opacity-90"
        >
          Open the full sample
        </Link>
      </div>

      {!sample ? (
        <div className="mt-4 space-y-2" role="status" aria-label="Loading sample analysis">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-11 animate-pulse rounded-xl bg-[#EEF4F4]" />
          ))}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="type-body text-[#063f46]">{sample.summary}</p>

          <div>
            <p className="type-metadata mb-1.5">
              {sample.legs.length} legs{combined != null ? ` · ${workspaceOddsLabel(combined)}` : ''}
            </p>
            <ul className="divide-y divide-[#eef3f3] rounded-xl border border-[#eef3f3]">
              {sample.legs.map((leg) => (
                <li key={leg.offer.offerIdentity} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="type-card-data truncate text-[#063f46]">
                      {leg.offer.playerDisplayName ?? `Player ${leg.offer.playerId}`}
                    </p>
                    <p className="type-secondary truncate">
                      {leg.offer.side === 'over' ? 'Over' : 'Under'} {leg.offer.line} {marketDisplayLabel(leg.offer.market)}
                    </p>
                  </div>
                  <span className="type-card-data shrink-0 text-[#063f46]">{workspaceOddsLabel(leg.offer.oddsAmerican)}</span>
                </li>
              ))}
            </ul>
          </div>

          {sample.signals.length > 0 ? (
            <div>
              <p className="type-metadata mb-1.5">Key signals</p>
              <ul className="grid grid-cols-2 gap-2">
                {sample.signals.map((signal) => (
                  <li key={signal.id} className={cn('min-w-0 rounded-xl border px-2.5 py-2', TONE_CLASS[signal.tone])}>
                    <p className="type-metadata truncate text-[#063f46]">{signal.label}</p>
                    <p className="type-card-data truncate text-[#063f46]">{signal.value}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {sample.risks.length > 0 ? (
            <div>
              <p className="type-metadata mb-1.5">Why this could fail</p>
              <ol className="space-y-1.5">
                {sample.risks.map((risk, index) => (
                  <li key={risk.title + risk.detail} className="flex gap-2">
                    <span className="type-metadata">{index + 1}</span>
                    <span className="min-w-0">
                      <span className="type-secondary text-[#063f46]">{risk.title}. </span>
                      <span className="type-metadata line-clamp-2">{risk.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
