import { AlertTriangle, BarChart3, FileText, GitBranch, ShieldAlert, TrendingUp } from 'lucide-react';
import { formatAmericanOdds } from '@/lib/betting/market-movement-format';
import { formatCombinedOddsLabel } from '@/lib/parlay-xray/combined-odds';
import { LEG_OUTLOOK_COPY } from '@/lib/parlay-xray/copy';
import { formatXrayPropLine } from '@/lib/parlay-xray/extraction/line-value';
import { XRAY_PROP_KIND_LABEL } from '@/lib/parlay-xray/types';
import type {
  ExtractedParlayLeg,
  StructuralDependency,
  XRayAnalysis,
  XRayInsightCard,
  XrayLegOutlook,
} from '@/lib/parlay-xray/types';
import { PlayerHeadshot } from '@/components/nba/PlayerHeadshot';
import { MatchupLine } from '@/components/parlay-xray/MatchupLine';
import { cn } from '@/lib/utils';

type XrayAnalysisPanelProps = {
  analysis: XRayAnalysis | null;
  legs: ExtractedParlayLeg[];
  combinedOdds: number | null;
  structural: StructuralDependency[];
  analysisStageCopy: string;
  designPreview: boolean;
  showExplorerPlacement: boolean;
};

export function XrayAnalysisPanel({
  analysis,
  legs,
  combinedOdds,
  structural,
  analysisStageCopy,
  designPreview,
  showExplorerPlacement,
}: XrayAnalysisPanelProps) {
  const visible = analysis?.status === 'ready';

  return (
    <section className="space-y-6" aria-labelledby="xray-analysis-heading">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8aa0a3]">XRay analysis</p>
          <h2 id="xray-analysis-heading" className="text-2xl font-black tracking-tight text-[#063f46]">
            A complete breakdown of this parlay
          </h2>
          <p className="text-sm text-[#4a6366] mt-1">{analysisStageCopy}</p>
        </div>
      </div>

      {visible && analysis ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">
          <InsightCard card={analysis.overallRead} tone="mint" icon={BarChart3} />
          <InsightCard card={analysis.strongestLeg} tone="green" icon={TrendingUp} />
          <InsightCard card={analysis.riskiestLeg} tone="rose" icon={ShieldAlert} />
          <InsightCard card={analysis.correlation} tone="amber" icon={GitBranch} />
          <InsightCard card={analysis.marketMovement} tone="slate" icon={TrendingUp} />
          <InsightCard card={analysis.keyContext} tone="teal" icon={FileText} />
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[#DCE9EA] bg-white px-5 py-8">
          <p className="text-sm font-semibold text-[#063f46]">Analysis unavailable</p>
          <p className="text-sm text-[#4a6366] mt-1 max-w-2xl">
            XRay does not invent a read from an unread screenshot. Confirm legs, then examine the parlay in Workspace.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <LegByLegList analysis={visible ? analysis : null} legs={legs} />
        <ParlaySummaryCard
          analysis={visible ? analysis : null}
          legs={legs}
          combinedOdds={combinedOdds}
          structural={structural}
          designPreview={designPreview}
          showExplorerPlacement={showExplorerPlacement}
        />
      </div>
    </section>
  );
}

function InsightCard({
  card,
  tone,
  icon: Icon,
}: {
  card: XRayInsightCard;
  tone: 'mint' | 'green' | 'rose' | 'amber' | 'slate' | 'teal';
  icon: typeof BarChart3;
}) {
  const tones: Record<typeof tone, string> = {
    mint: 'bg-[#f3fbf7] border-[#cfeee3]',
    green: 'bg-[#f3faf4] border-[#d7edd9]',
    rose: 'bg-[#fff6f4] border-[#f3d7d2]',
    amber: 'bg-[#fff8ee] border-[#f0e0c8]',
    slate: 'bg-[#f6f8f8] border-[#DCE9EA]',
    teal: 'bg-[#f3fafa] border-[#d4e8e8]',
  };
  const unavailable = card.status !== 'ready';
  return (
    <article className={cn('rounded-2xl border p-4 min-h-[132px]', tones[tone])}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#4a6366]">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {card.title}
      </div>
      <p className="mt-2 text-sm font-bold text-[#063f46]">
        {unavailable ? 'Unavailable' : card.headline ?? 'Unavailable'}
      </p>
      <p className="mt-1 text-xs text-[#4a6366] leading-relaxed">
        {unavailable ? card.detail ?? 'No matched record yet.' : card.detail ?? ''}
      </p>
    </article>
  );
}

function LegByLegList({
  analysis,
  legs,
}: {
  analysis: XRayAnalysis | null;
  legs: ExtractedParlayLeg[];
}) {
  const byId = new Map(analysis?.legAnalyses.map((row) => [row.legId, row]) ?? []);

  return (
    <section className="lg:col-span-2 bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-5">
      <h3 className="text-base font-bold text-[#063f46]">Leg-by-leg analysis</h3>
      <p className="text-xs text-[#4a6366] mt-1 mb-4">
        Context for each leg. This is not a bet / don&apos;t-bet signal.
      </p>
      {legs.length === 0 ? (
        <p className="text-sm text-[#4a6366]">No legs to analyze yet.</p>
      ) : (
        <>
          <div className="hidden md:grid grid-cols-[minmax(0,1.4fr)_0.7fr_0.7fr_0.5fr_0.9fr_minmax(0,1.6fr)] gap-2 text-[11px] font-semibold uppercase tracking-wide text-[#8aa0a3] px-2 pb-2">
            <span>Player / game</span>
            <span>Prop</span>
            <span>Line</span>
            <span>Odds</span>
            <span>Context</span>
            <span>Analysis</span>
          </div>
          <ul className="space-y-3">
            {legs.map((leg) => {
              const row = byId.get(leg.id);
              const outlook: XrayLegOutlook = row?.outlook ?? 'unavailable';
              return (
                <li
                  key={leg.id}
                  className="rounded-xl border border-[#DCE9EA] bg-[#f7f9f7] p-3 md:grid md:grid-cols-[minmax(0,1.4fr)_0.7fr_0.7fr_0.5fr_0.9fr_minmax(0,1.6fr)] md:gap-2 md:items-center"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <PlayerHeadshot
                      nbaPlayerId={leg.nbaPlayerId.status === 'known' ? leg.nbaPlayerId.value : null}
                      name={leg.playerDisplayName.value ?? 'Player'}
                      className="relative w-9 h-11 rounded-lg overflow-hidden bg-[#E8F0F1] border border-[#DCE9EA] shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#063f46] truncate">
                        {leg.playerDisplayName.value ?? 'Unknown player'}
                      </p>
                      <MatchupLine leg={leg} />
                    </div>
                  </div>
                  <p className="text-sm text-[#063f46] mt-2 md:mt-0">
                    <span className="md:hidden text-xs text-[#8aa0a3] mr-2">Prop</span>
                    {leg.propLabel.value ??
                      (leg.propKind.value ? XRAY_PROP_KIND_LABEL[leg.propKind.value] : 'Unavailable')}
                  </p>
                  <p className="text-sm text-[#063f46]">
                    <span className="md:hidden text-xs text-[#8aa0a3] mr-2">Line</span>
                    {leg.side.value ? (leg.side.value === 'over' ? 'Over' : 'Under') : '—'}{' '}
                    {formatXrayPropLine(leg.line.value)}
                  </p>
                  <p className="text-sm tabular-nums text-[#063f46]">
                    <span className="md:hidden text-xs text-[#8aa0a3] mr-2">Odds</span>
                    {formatAmericanOdds(leg.oddsAmerican.status === 'known' ? leg.oddsAmerican.value : null)}
                  </p>
                  <OutlookBadge outlook={outlook} />
                  <p className="text-xs text-[#4a6366] mt-2 md:mt-0">
                    {row?.analysisText ?? 'Unavailable until a real analysis is attached.'}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function OutlookBadge({ outlook }: { outlook: XrayLegOutlook }) {
  const styles: Record<XrayLegOutlook, string> = {
    favorable_context: 'bg-[#e7f8ef] text-[#0f6b45] border-[#bfe8d2]',
    mixed: 'bg-[#f4f6f6] text-[#4a6366] border-[#DCE9EA]',
    elevated_risk: 'bg-[#fff1eb] text-[#9a3412] border-[#f3d2c4]',
    limited_data: 'bg-[#f4f6f6] text-[#4a6366] border-[#DCE9EA]',
    unavailable: 'bg-white text-[#8aa0a3] border-[#DCE9EA]',
  };
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        styles[outlook]
      )}
    >
      {LEG_OUTLOOK_COPY[outlook]}
    </span>
  );
}

function ParlaySummaryCard({
  analysis,
  legs,
  combinedOdds,
  structural,
  designPreview,
  showExplorerPlacement,
}: {
  analysis: XRayAnalysis | null;
  legs: ExtractedParlayLeg[];
  combinedOdds: number | null;
  structural: StructuralDependency[];
  designPreview: boolean;
  showExplorerPlacement: boolean;
}) {
  const combinedLabel = formatCombinedOddsLabel(combinedOdds);
  const reasons =
    analysis?.failureReasons?.length
      ? analysis.failureReasons
      : structural.map((dep, i) => ({
          id: `structural-${i}`,
          text: dep.label,
          source: 'structural' as const,
        }));

  return (
    <aside className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-5 space-y-4">
      <h3 className="text-base font-bold text-[#063f46]">Parlay summary</h3>
      <dl className="grid grid-cols-3 gap-2">
        <SummaryStat label="Combined odds" value={combinedLabel ?? 'Unavailable'} />
        <SummaryStat
          label="Evidence"
          value={analysis?.overallRead.headline ?? 'Unavailable'}
        />
        <SummaryStat
          label="Legs"
          value={
            analysis?.summary.favorableContextCount != null
              ? `${analysis.summary.favorableContextCount} / ${legs.length}`
              : legs.length > 0
                ? String(legs.length)
                : 'Unavailable'
          }
          hint={
            analysis?.summary.favorableContextCount != null
              ? 'with favorable context'
              : legs.length > 0
                ? 'on this slip'
                : undefined
          }
        />
      </dl>
      <p className="text-sm text-[#4a6366]">
        {analysis?.summary.majorRisk ??
          (structural[0]?.label ?? 'Major risk is unavailable until analysis is attached.')}
      </p>

      <div className="rounded-xl border border-amber-200 bg-[#fff8ee] p-3">
        <p className="text-sm font-semibold text-[#063f46] flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[#b45309]" aria-hidden />
          Why this parlay could fail
        </p>
        <p className="text-[11px] text-[#4a6366] mt-1">
          Structural and data-quality notes from this slip. Not a prediction.
        </p>
        {reasons.length ? (
          <ul className="mt-2 space-y-1.5 text-sm text-[#4a6366] list-disc pl-4">
            {reasons.map((reason) => (
              <li key={reason.id}>{reason.text}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[#4a6366]">
            No structural overlaps are visible from the current confirmed legs.
          </p>
        )}
      </div>

      {showExplorerPlacement && designPreview ? (
        <p>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="w-full rounded-lg bg-[#063f46]/40 text-white text-sm font-semibold py-2.5 cursor-not-allowed"
          >
            Open in Parlay Explorer (coming later)
          </button>
        </p>
      ) : null}
    </aside>
  );
}

function SummaryStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-[#f7f9f7] border border-[#DCE9EA] px-2 py-3 text-center">
      <dt className="text-[10px] uppercase tracking-wide text-[#8aa0a3]">{label}</dt>
      <dd className="text-sm font-bold text-[#063f46] tabular-nums mt-1">{value}</dd>
      {hint ? <p className="text-[10px] text-[#8aa0a3] mt-0.5">{hint}</p> : null}
    </div>
  );
}
