import {
  formatMarketLabel,
  parlayDependencyKindLabel,
  parlayReviewFlagLabel,
} from '@/lib/parlay-xray/interpretation/display';
import { PARLAY_SUMMARY_STATE_COPY } from '@/lib/parlay-xray/interpretation/parlay-types';
import type { XRayParlayInterpretation } from '@/lib/parlay-xray/interpretation/parlay-types';
import type { XRayLegInterpretation } from '@/lib/parlay-xray/interpretation/types';
import { cn } from '@/lib/utils';

export function XrayParlaySummary({
  parlay,
  interpretations,
  eyebrow = 'Parlay XRay',
}: {
  parlay: XRayParlayInterpretation;
  interpretations: XRayLegInterpretation[];
  eyebrow?: string;
}) {
  const sharedGameCount = parlay.dependencyGroups.filter((g) => g.kind === 'SHARED_GAME').length;
  const cover = parlay.contextCoverage;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8aa0a3]">{eyebrow}</p>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <h2 id="xray-results-heading" className="text-2xl font-black tracking-tight text-[#063f46]">
            Parlay summary
          </h2>
          <p
            className={cn(
              'inline-flex w-fit shrink-0 items-center rounded-full border px-3 py-1 text-xs font-semibold',
              parlay.summaryState === 'WELL_COVERED'
                ? 'bg-[#e7f8ef] text-[#0f6b45] border-[#bfe8d2]'
                : parlay.summaryState === 'DEPENDENCY_CONCENTRATION' || parlay.summaryState === 'MULTIPLE_COUNTERSIGNALS'
                  ? 'bg-[#fff8ee] text-[#9a3412] border-[#f0e0c8]'
                  : 'bg-[#f4f6f6] text-[#4a6366] border-[#DCE9EA]'
            )}
          >
            {PARLAY_SUMMARY_STATE_COPY[parlay.summaryState]}
          </p>
        </div>
        <p className="text-sm text-[#4a6366] max-w-3xl">{parlay.summarySentence}</p>
      </header>

      <section aria-labelledby="xray-parlay-fail-heading" className="rounded-2xl border border-[#DCE9EA] bg-white p-5">
        <h3 id="xray-parlay-fail-heading" className="text-base font-bold text-[#063f46]">
          Why this parlay could fail
        </h3>
        <p className="text-[11px] text-[#4a6366] mt-1">
          Ways multiple legs can fail together, or where the slip is concentrated. Not a prediction.
        </p>
        {parlay.whyThisParlayCouldFail.length === 0 ? (
          <p className="mt-3 text-sm text-[#4a6366]">No cross-leg failure notes from certified packet fields.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {parlay.whyThisParlayCouldFail.map((item) => (
              <li key={item.code + item.detail} className="rounded-xl border border-[#DCE9EA] bg-[#f7f9f7] px-3 py-2">
                <p className="text-sm font-semibold text-[#063f46]">{item.title}</p>
                <p className="text-sm text-[#4a6366] mt-0.5">{item.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="xray-shared-context-heading" className="rounded-2xl border border-[#DCE9EA] bg-white p-5">
        <h3 id="xray-shared-context-heading" className="text-base font-bold text-[#063f46]">
          Shared context
        </h3>
        <p className="text-xs text-[#4a6366] mt-1">
          Structural dependencies from identity and packets. These are not measured correlations.
        </p>
        {parlay.dependencyGroups.length === 0 ? (
          <p className="mt-3 text-sm text-[#4a6366]">No shared player, game, or team groups on this slip.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {parlay.dependencyGroups.map((group) => (
              <li key={group.kind + group.key} className="rounded-xl border border-[#DCE9EA] bg-[#f7f9f7] p-3 min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-[#8aa0a3]">{parlayDependencyKindLabel(group.kind)}</p>
                <p className="text-sm font-semibold text-[#063f46] mt-1 wrap-break-word">{group.label}</p>
                <p className="text-sm text-[#4a6366] mt-1">{group.detail}</p>
                <p className="text-xs text-[#8aa0a3] mt-2">
                  {group.legIndexes.length} legs
                  {group.markets.length
                    ? ` · ${group.markets.map((m) => formatMarketLabel(m)).join(' · ')}`
                    : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {parlay.supportingContext.length > 0 ? (
        <section aria-labelledby="xray-parlay-support-heading">
          <h3 id="xray-parlay-support-heading" className="text-base font-bold text-[#063f46]">
            Supporting parlay context
          </h3>
          <ul className="mt-2 space-y-2">
            {parlay.supportingContext.map((item) => (
              <li key={item.code + item.detail} className="rounded-lg border border-[#DCE9EA] bg-[#f7f9f7] px-3 py-2">
                <p className="text-sm font-semibold text-[#063f46]">{item.title}</p>
                <p className="text-sm text-[#4a6366] mt-0.5">{item.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {parlay.reviewNeeded.length > 0 ? (
        <section aria-labelledby="xray-review-heading">
          <h3 id="xray-review-heading" className="text-base font-bold text-[#063f46]">
            Legs needing review
          </h3>
          <p className="text-xs text-[#4a6366] mt-1">Explicit packet flags. Not a strongest/weakest ranking.</p>
          <ul className="mt-2 space-y-2">
            {parlay.reviewNeeded.map((row) => {
              const leg = interpretations[row.legIndex];
              return (
                <li key={row.legIndex} className="rounded-lg border border-[#DCE9EA] bg-white px-3 py-2">
                  <a className="text-sm font-semibold text-[#075B5C] underline" href={`#xray-leg-${row.legIndex}`}>
                    {row.playerDisplayName ?? 'Unknown player'} {formatMarketLabel(row.market)}
                  </a>
                  <p className="mt-1 flex flex-wrap gap-1">
                    {row.flags.map((flag) => (
                      <span
                        key={flag}
                        className="inline-flex items-center rounded-full border border-[#DCE9EA] bg-[#f7f9f7] px-2 py-0.5 text-[11px] font-semibold text-[#4a6366]"
                      >
                        {parlayReviewFlagLabel(flag)}
                      </span>
                    ))}
                  </p>
                  {leg ? <p className="sr-only">{leg.summarySentence}</p> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {interpretations.length > 1 ? (
        <nav aria-label="Legs on this slip" className="flex flex-wrap gap-2">
          {interpretations.map((leg, index) => (
            <a
              key={index}
              href={`#xray-leg-${index}`}
              className="inline-flex max-w-full items-center rounded-full border border-[#DCE9EA] bg-white px-3 py-1 text-xs font-semibold text-[#063f46] hover:border-[#55ddb1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1]/70"
            >
              <span className="truncate">
                {leg.identity.playerDisplayName ?? 'Unknown'} · {formatMarketLabel(leg.identity.market)}
              </span>
            </a>
          ))}
        </nav>
      ) : null}

      <section aria-labelledby="xray-data-coverage-heading" className="rounded-2xl border border-[#DCE9EA] bg-white p-5">
        <h3 id="xray-data-coverage-heading" className="text-base font-bold text-[#063f46]">
          Data coverage
        </h3>
        <p className="text-xs text-[#4a6366] mt-1">
          What we could verify from certified packets. Missing WOWY, projection, or availability does not mean the rest of
          the read is broken.
        </p>
        <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <SummaryStat label="Legs" value={String(cover.legCount)} />
          <SummaryStat label="Full context" value={String(cover.recentFormCount)} />
          <SummaryStat label="Limited context" value={String(cover.legCount - cover.recentFormCount)} />
          <SummaryStat label="Market matches" value={String(cover.marketMatchCount)} />
          <SummaryStat label="Partial market" value={String(cover.partialMarketCount)} />
          <SummaryStat label="Shared-game groups" value={String(sharedGameCount)} />
        </dl>
        <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryStat label="Better than close" value={String(parlay.marketPositionCounts.betterThanClose)} />
          <SummaryStat label="Same as close" value={String(parlay.marketPositionCounts.sameAsClose)} />
          <SummaryStat label="Worse than close" value={String(parlay.marketPositionCounts.worseThanClose)} />
          <SummaryStat label="Close unknown" value={String(parlay.marketPositionCounts.unknown)} />
        </dl>
        <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          <CoverageRow label="Canonical identity" have={parlay.dataQuality.canonical.have} of={parlay.dataQuality.canonical.of} />
          <CoverageRow
            label="Market history"
            have={parlay.dataQuality.historicalMarket.exact}
            of={parlay.dataQuality.historicalMarket.of}
            hint={
              parlay.dataQuality.historicalMarket.partial > 0
                ? `${parlay.dataQuality.historicalMarket.partial} partial`
                : undefined
            }
          />
          <CoverageRow label="Recent form" have={parlay.dataQuality.recentForm.have} of={parlay.dataQuality.recentForm.of} />
          <CoverageRow label="Role context" have={parlay.dataQuality.role.have} of={parlay.dataQuality.role.of} />
          <CoverageRow label="WOWY" have={parlay.dataQuality.wowy.have} of={parlay.dataQuality.wowy.of} />
          <CoverageRow label="Projection" have={parlay.dataQuality.projection.have} of={parlay.dataQuality.projection.of} />
          <CoverageRow label="Availability" have={parlay.dataQuality.availability.have} of={parlay.dataQuality.availability.of} />
        </ul>
      </section>
    </div>
  );
}

function CoverageRow({ label, have, of, hint }: { label: string; have: number; of: number; hint?: string }) {
  return (
    <li className="rounded-xl border border-[#DCE9EA] bg-[#f7f9f7] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-[#8aa0a3]">{label}</p>
      <p className="text-sm font-bold tabular-nums text-[#063f46] mt-0.5">
        {have}/{of}
      </p>
      {hint ? <p className="text-[11px] text-[#4a6366]">{hint}</p> : null}
    </li>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white border border-[#DCE9EA] px-3 py-3 text-center">
      <dt className="text-[10px] uppercase tracking-wide text-[#8aa0a3]">{label}</dt>
      <dd className="text-sm font-bold text-[#063f46] tabular-nums mt-1">{value}</dd>
    </div>
  );
}
