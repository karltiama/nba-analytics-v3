'use client';

import { AlignJustify, BarChart3, Link2, type LucideIcon } from 'lucide-react';
import type { WorkspaceAnalysisRecord } from '@/lib/parlay/selection-store';
import {
  countWorkspaceStatuses,
  workspaceKeySignals,
  workspaceMainRisks,
  workspaceRelationships,
  type WorkspaceSignal,
  type WorkspaceSignalTone,
} from '@/lib/parlay/workspace-presentation';
import { cn } from '@/lib/utils';

type AnalysisResult = WorkspaceAnalysisRecord['result'];

const TONE_CLASS: Record<WorkspaceSignalTone, string> = {
  support: 'border-[#bfe8d2] bg-[#f3fbf7]',
  watch: 'border-[#f0e0c8] bg-[#fff8ee]',
  concern: 'border-[#f6d5d5] bg-[#fff7f7]',
  info: 'border-[#DCE9EA] bg-[#f4f7f8]',
};

const SIGNAL_VALUE_CLASS: Record<WorkspaceSignalTone, string> = {
  support: 'text-[#0f6b45]',
  watch: 'text-[#063f46]',
  concern: 'text-[#9a3412]',
  info: 'text-[#063f46]',
};

const SIGNAL_ICON_CLASS: Record<WorkspaceSignalTone, string> = {
  support: 'text-[#16a34a]',
  watch: 'text-[#c2410c]',
  concern: 'text-[#9a3412]',
  info: 'text-[#075B5C]',
};

const SIGNAL_ICONS: Record<WorkspaceSignal['id'], LucideIcon> = {
  projection: BarChart3,
  role: Link2,
  relationships: Link2,
  coverage: AlignJustify,
};

/**
 * One section for everything parlay-level: summary, evidence alignment, key signals,
 * shared groups, and failure notes. Before analysis it is a single placeholder.
 */
export function WorkspaceParlayRead({
  result,
  legCount,
  pending,
  onOpenRelationships,
}: {
  /** Null until analysis for the current legs is available. */
  result: AnalysisResult | null;
  legCount: number;
  /** True while analysis is running or about to run for an eligible slip. */
  pending: boolean;
  onOpenRelationships: () => void;
}) {
  const parlay = result?.parlayInterpretation ?? null;
  const interpretations = result?.interpretations ?? [];
  const counts = countWorkspaceStatuses(interpretations);
  const signals = parlay && result ? workspaceKeySignals(parlay, interpretations, result.contexts) : [];
  const risks = parlay ? workspaceMainRisks(parlay) : [];
  const relationships = parlay ? workspaceRelationships(parlay, 3) : [];
  const relationshipTotal = parlay ? parlay.dependencyGroups.length : 0;

  return (
    <section
      className="rounded-2xl border border-[#DCE9EA] bg-white p-3 shadow-sm sm:p-4"
      aria-labelledby="workspace-read-heading"
      data-coachmark="workspace-analyze"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="workspace-read-heading" className="type-section-heading text-[#063f46]">
          How the legs fit together
        </h2>
        {result ? <p className="type-metadata">{result.historicalReplay.dateLabel}</p> : null}
      </div>

      {!parlay ? (
        pending ? (
          <div className="mt-3 space-y-2" role="status" aria-label="Loading Court Context analysis">
            <p className="type-secondary">Court Context analysis will appear for this slip shortly.</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl bg-[#EEF4F4]" />
              ))}
            </div>
          </div>
        ) : (
          <p className="type-secondary mt-2">Evidence alignment appears when Court Context analysis is available.</p>
        )
      ) : (
        <div className="mt-2 space-y-4">
          <div>
            <p className="type-body text-[#063f46]">{parlay.summarySentence}</p>
            <p className="type-secondary mt-1">
              Evidence alignment: {counts.supported} of {legCount} {legCount === 1 ? 'leg' : 'legs'} supported ·{' '}
              {counts.mixed} mixed · {counts.needs_review} needs review
            </p>
          </div>

          {signals.length > 0 ? (
            <div aria-label="Key signals">
              <h3 className="type-metadata mb-1.5">Key signals</h3>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {signals.map((signal) => {
                  const Icon = SIGNAL_ICONS[signal.id];
                  return (
                    <li
                      key={signal.id}
                      title={signal.warnings[0] ?? undefined}
                      className={cn('min-w-0 rounded-xl border px-2.5 py-2.5', TONE_CLASS[signal.tone])}
                    >
                      <Icon className={cn('mb-1.5 h-3.5 w-3.5', SIGNAL_ICON_CLASS[signal.tone])} aria-hidden />
                      <p className="type-metadata truncate text-[#063f46]">{signal.label}</p>
                      <p className={cn('type-card-data truncate leading-tight', SIGNAL_VALUE_CLASS[signal.tone])}>
                        {signal.value}
                      </p>
                      <p className="type-metadata mt-0.5 line-clamp-2 text-cc-secondary">{signal.detail}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-4 border-t border-[#DCE9EA] pt-3 md:grid-cols-2">
            <div>
              <h3 className="type-metadata mb-1.5">Shared groups</h3>
              {relationships.length === 0 ? (
                <p className="type-secondary">No shared player, game, or team groups on this slip.</p>
              ) : (
                <ul className="space-y-2">
                  {relationships.map((group) => (
                    <li key={group.key}>
                      <p className="type-secondary text-[#063f46]">{group.label}</p>
                      <p className="type-metadata line-clamp-2">
                        {group.kind} · {group.detail}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {relationshipTotal > 0 ? (
                <button
                  type="button"
                  className="type-interactive mt-2 text-[#075B5C] hover:underline"
                  onClick={onOpenRelationships}
                >
                  View full shared context →
                </button>
              ) : null}
            </div>
            <div>
              <h3 className="type-metadata mb-1.5">Why this could fail</h3>
              {risks.length === 0 ? (
                <p className="type-secondary">No cross-leg failure notes from certified packet fields.</p>
              ) : (
                <ol className="space-y-2">
                  {risks.map((risk, index) => (
                    <li key={risk.title + risk.detail} className="flex gap-2">
                      <span className="type-metadata">{index + 1}</span>
                      <span className="min-w-0">
                        <span className="type-secondary text-[#063f46]">{risk.title}. </span>
                        <span className="type-metadata line-clamp-2">{risk.detail}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
