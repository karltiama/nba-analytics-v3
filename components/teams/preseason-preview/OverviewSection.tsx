import { BarChart3 } from 'lucide-react';
import { PreviewCard, PreviewSectionHeading } from './PreviewCard';
import { WhatChangedSection } from './WhatChangedSection';
import { ProjectedRotationSection } from './ProjectedRotationSection';
import type {
  PreviewProjectedRotation,
  PreviewRosterChange,
  PreviewSnapshotField,
} from '@/lib/teams/preseason-preview/types';

export function OverviewSection({
  bigPicture,
  snapshotFields,
  snapshotUnavailableReason,
  priorSeasonLabel,
  keyQuestions,
  additions,
  departures,
  draftPicks,
  projectedRotation,
}: {
  bigPicture: string[];
  snapshotFields: PreviewSnapshotField[];
  snapshotUnavailableReason: string | null;
  priorSeasonLabel: string;
  keyQuestions: { headline: string; detail: string }[];
  additions: PreviewRosterChange[];
  departures: PreviewRosterChange[];
  draftPicks: PreviewRosterChange[];
  projectedRotation: PreviewProjectedRotation | null;
}) {
  return (
    <div
      id="overview"
      className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.85fr)_minmax(14rem,0.7fr)] gap-4 scroll-mt-24"
    >
      <PreviewCard className="lg:col-span-1">
        <PreviewSectionHeading title="The Big Picture" icon={BarChart3} />
        <div className="space-y-3">
          {bigPicture.map((p) => (
            <p key={p.slice(0, 48)} className="text-sm leading-relaxed text-[#4a6366]">
              {p}
            </p>
          ))}
        </div>
        <WhatChangedSection
          additions={additions}
          departures={departures}
          draftPicks={draftPicks}
          variant="embedded"
        />
      </PreviewCard>

      <PreviewCard>
        <PreviewSectionHeading
          title="Team Snapshot"
          subtitle={`Prior season · ${priorSeasonLabel}`}
        />
        {snapshotFields.length > 0 ? (
          <dl className="grid grid-cols-1 gap-2.5">
            {snapshotFields.map((f) => (
              <div
                key={f.label}
                className="flex items-baseline justify-between gap-3 border-b border-[#DCE9EA] last:border-0 pb-2 last:pb-0"
              >
                <dt className="text-xs text-[#4a6366]">{f.label}</dt>
                <dd className="text-sm font-semibold font-mono text-[#063f46] tabular-nums">
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-[#4a6366]">
            {snapshotUnavailableReason ??
              'Previous season metrics are not available yet.'}
          </p>
        )}
        <ProjectedRotationSection
          rotation={projectedRotation}
          variant="embedded"
        />
      </PreviewCard>

      {keyQuestions.length > 0 ? (
        <PreviewCard id="preseason-questions" className="scroll-mt-24">
          <PreviewSectionHeading
            title="Key Questions"
            subtitle="Context entering the season"
          />
          <ol className="space-y-4">
            {keyQuestions.map((q, i) => (
              <li key={q.headline} className="flex gap-3">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#55ddb1]/20 text-sm font-bold text-[#075B5C]"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#063f46] leading-snug">
                    {q.headline}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[#4a6366]">
                    {q.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </PreviewCard>
      ) : null}
    </div>
  );
}
