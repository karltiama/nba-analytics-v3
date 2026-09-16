import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatAmericanOdds } from '@/lib/betting/market-movement-format';
import { PlayerHeadshot } from '@/components/nba/PlayerHeadshot';
import { MatchupLine } from '@/components/parlay-xray/MatchupLine';
import {
  coverageLabel,
  dataCoverageLabel,
  formatAvg,
  formatLineSnapshot,
  formatMarketLabel,
  formatSportsbookLabel,
  formLineReadLabel,
  marketPositionLabel,
  matchupCoverageLabel,
  roleMinutesLabel,
  sampleBandLabel,
  unitForMarket,
} from '@/lib/parlay-xray/interpretation/display';
import { interpretXrayParlay } from '@/lib/parlay-xray/interpretation/parlay';
import { SUMMARY_STATE_COPY } from '@/lib/parlay-xray/interpretation/types';
import type { InterpretationEvidence, XRayLegInterpretation } from '@/lib/parlay-xray/interpretation/types';
import type { XrayHistoricalReplay } from '@/lib/parlay-xray/session';
import { formatXrayPropLine } from '@/lib/parlay-xray/extraction/line-value';
import type { ExtractedParlayLeg } from '@/lib/parlay-xray/types';
import { cn } from '@/lib/utils';
import { XrayParlaySummary } from './XrayParlaySummary';

type XrayResultsPanelProps = {
  interpretations: XRayLegInterpretation[];
  historicalReplay: XrayHistoricalReplay | null;
  legs: ExtractedParlayLeg[];
};

export function XrayResultsPanel({ interpretations, historicalReplay, legs }: XrayResultsPanelProps) {
  const parlay = interpretXrayParlay(interpretations);

  return (
    <section className="space-y-6" aria-labelledby="xray-results-heading">
      <XrayParlaySummary parlay={parlay} interpretations={interpretations} />

      <div className="space-y-6">
        <h3 className="text-lg font-bold text-[#063f46]">Leg context</h3>
        {interpretations.map((interp, index) => (
          <LegInterpretationCard
            key={`${interp.identity.playerDisplayName ?? 'leg'}-${interp.identity.line ?? index}-${index}`}
            id={`xray-leg-${index}`}
            interp={interp}
            leg={matchingLeg(legs, interp)}
            historicalReplay={historicalReplay}
          />
        ))}
      </div>
    </section>
  );
}

function matchingLeg(legs: ExtractedParlayLeg[], interp: XRayLegInterpretation): ExtractedParlayLeg | undefined {
  return legs.find(
    (leg) =>
      leg.playerDisplayName.value === interp.identity.playerDisplayName &&
      leg.line.value === interp.identity.line &&
      (interp.identity.market == null || leg.propKind.value === interp.identity.market)
  );
}

function LegInterpretationCard({
  id,
  interp,
  leg,
  historicalReplay,
}: {
  id: string;
  interp: XRayLegInterpretation;
  leg: ExtractedParlayLeg | undefined;
  historicalReplay: XrayHistoricalReplay | null;
}) {
  const side = interp.identity.side === 'under' ? 'Under' : interp.identity.side === 'over' ? 'Over' : '—';
  const unit = unitForMarket(interp.identity.market);

  return (
    <article id={id} className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm overflow-hidden min-w-0 scroll-mt-24">
      <div className="p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <PlayerHeadshot
              nbaPlayerId={leg?.nbaPlayerId.status === 'known' ? leg.nbaPlayerId.value : null}
              name={interp.identity.playerDisplayName ?? 'Player'}
              className="relative w-12 h-14 rounded-lg overflow-hidden bg-[#E8F0F1] border border-[#DCE9EA] shrink-0"
            />
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-[#063f46] truncate">
                {interp.identity.playerDisplayName ?? 'Unknown player'}
              </h3>
              <p className="text-sm text-[#063f46]">
                {formatMarketLabel(interp.identity.market)} {side} {formatXrayPropLine(interp.identity.line)}
              </p>
              <p className="text-xs text-[#4a6366] mt-0.5">
                {formatSportsbookLabel(interp.identity.sportsbook)}
                {interp.identity.gameId ? ` · game ${interp.identity.gameId}` : ''}
              </p>
              {leg ? <MatchupLine leg={leg} /> : (
                <p className="text-xs text-[#4a6366]">
                  {[interp.identity.teamAbbr, interp.identity.opponentAbbr].filter(Boolean).join(' vs ') ||
                    'Matchup unavailable'}
                </p>
              )}
            </div>
          </div>
          <SummaryBadge state={interp.summaryState} />
        </div>

        <p className="text-sm text-[#4a6366] leading-relaxed">{interp.summarySentence}</p>

        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <Indicator label="Market" value={marketPositionLabel(interp.marketPosition.kind)} />
          <Indicator label="Recent form" value={formLineReadLabel(interp.recentForm.lineRead)} />
          <Indicator label="Role" value={roleMinutesLabel(interp.role.minutesVsSeason)} />
          <Indicator label="Matchup" value={matchupCoverageLabel(interp)} />
          <Indicator label="Data coverage" value={dataCoverageLabel(interp)} />
        </ul>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ContextBlock title="Market movement">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 min-w-0">
              <SnapshotStack
                label="3-Hour Pre-Tip"
                value={formatLineSnapshot(interp.marketPosition.threeHourLine, interp.marketPosition.threeHourOdds)}
              />
              <span className="hidden sm:inline text-[#8aa0a3]" aria-hidden>
                →
              </span>
              <SnapshotStack
                label="Decision Close"
                value={formatLineSnapshot(interp.marketPosition.closeLine, interp.marketPosition.closeOdds)}
              />
            </div>
            {interp.marketPosition.threeHourOdds != null && interp.marketPosition.closeOdds != null ? (
              <p className="mt-3 text-xs text-[#4a6366]">
                The price changed from {formatAmericanOdds(interp.marketPosition.threeHourOdds)} to{' '}
                {formatAmericanOdds(interp.marketPosition.closeOdds)} while the line moved from{' '}
                {interp.marketPosition.threeHourLine ?? '—'} to {interp.marketPosition.closeLine ?? '—'}.
              </p>
            ) : null}
            <p className="mt-2 text-xs text-[#8aa0a3]">{coverageLabel(interp.dataAvailability.market)} historical market</p>
          </ContextBlock>

          <ContextBlock title="Recent form">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Stat label={`Season ${unit}`} value={`${formatAvg(interp.recentForm.seasonAverage)} · ${interp.recentForm.seasonGames} games`} />
              <Stat label={`Last 10 ${unit}`} value={formatAvg(interp.recentForm.last10Average)} />
              <Stat label={`Last 5 ${unit}`} value={formatAvg(interp.recentForm.last5Average)} />
              <Stat
                label={`vs ${formatXrayPropLine(interp.identity.line)} line`}
                value={`${interp.recentForm.above} above · ${interp.recentForm.below} below`}
              />
            </dl>
            <p className="mt-2 text-xs text-[#8aa0a3]">{sampleBandLabel(interp.recentForm.sampleBand)}</p>
          </ContextBlock>

          <ContextBlock title="Minutes">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Stat label="Season" value={formatAvg(interp.role.seasonMinutes)} />
              <Stat label="Last game" value={formatAvg(interp.role.priorGameMinutes)} />
              <Stat label="Last 5" value={formatAvg(interp.role.last5Minutes)} />
              <Stat label="Last 10" value={formatAvg(interp.role.last10Minutes)} />
            </dl>
          </ContextBlock>

          <ContextBlock title="Matchup">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Stat label="Opponent pace" value={formatAvg(interp.matchup.opponentPace)} />
              <Stat label="Team pace" value={formatAvg(interp.matchup.teamPace)} />
              <Stat label="Opponent points allowed" value={formatAvg(interp.matchup.opponentPointsAllowed)} />
              <Stat label="Team points" value={formatAvg(interp.matchup.teamPoints)} />
            </dl>
          </ContextBlock>
        </div>

        <EvidenceList heading="Supporting context" items={interp.supportingContext} empty="None identified from certified available sources." />
        <EvidenceList heading="Counter context" items={interp.counterContext} empty="None identified from certified available sources." />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <MissingCard
            title="WOWY"
            body={
              interp.dataAvailability.wowy === 'AVAILABLE'
                ? 'As-of-safe WOWY is available on this packet.'
                : 'Historical as-of-safe WOWY unavailable'
            }
          />
          <MissingCard
            title="Projection"
            body={
              interp.dataAvailability.projection === 'AVAILABLE'
                ? 'An archived pregame projection is on this packet.'
                : 'No archived pregame projection available for this replay.'
            }
          />
          <MissingCard
            title="Availability"
            body={
              interp.dataAvailability.availability === 'AVAILABLE'
                ? 'A historical pregame availability snapshot is on this packet.'
                : 'Historical pregame availability snapshot unavailable.'
            }
          />
        </div>

        <div className="rounded-xl border border-amber-200 bg-[#fff8ee] p-4">
          <h4 className="text-sm font-semibold text-[#063f46] flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[#b45309]" aria-hidden />
            Why this could fail
          </h4>
          <p className="text-[11px] text-[#4a6366] mt-1">
            Factual gaps and contrary packet fields. Not a prediction.
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-[#4a6366] list-disc pl-4">
            {interp.whyItCouldFail.map((item) => (
              <li key={item.code + item.detail}>{item.detail}</li>
            ))}
          </ul>
        </div>

        <EvidenceList heading="Data limitations" items={interp.uncertainties} empty="No certified coverage gaps on this packet." />

        {historicalReplay ? (
          <p className="text-xs text-[#8aa0a3]">
            Historical Replay · {historicalReplay.dateLabel}
            {historicalReplay.gameId ? ` · game ${historicalReplay.gameId}` : ''} · cutoff {historicalReplay.cutoffAt}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function SummaryBadge({ state }: { state: XRayLegInterpretation['summaryState'] }) {
  const styles: Record<XRayLegInterpretation['summaryState'], string> = {
    SUPPORTIVE_CONTEXT: 'bg-[#e7f8ef] text-[#0f6b45] border-[#bfe8d2]',
    MIXED_CONTEXT: 'bg-[#f4f6f6] text-[#4a6366] border-[#DCE9EA]',
    COUNTERSIGNALS_PRESENT: 'bg-[#fff8ee] text-[#9a3412] border-[#f0e0c8]',
    LIMITED_DATA: 'bg-[#f4f6f6] text-[#4a6366] border-[#DCE9EA]',
    NEUTRAL_CONTEXT: 'bg-[#f4f6f6] text-[#4a6366] border-[#DCE9EA]',
  };
  return (
    <p
      className={cn(
        'inline-flex w-fit shrink-0 items-center rounded-full border px-3 py-1 text-xs font-semibold',
        styles[state]
      )}
    >
      {SUMMARY_STATE_COPY[state]}
    </p>
  );
}

function Indicator({ label, value }: { label: string; value: string }) {
  return (
    <li className="rounded-xl border border-[#DCE9EA] bg-[#f7f9f7] px-3 py-2 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-[#8aa0a3]">{label}</p>
      <p className="text-xs font-semibold text-[#063f46] mt-0.5 wrap-break-word">{value}</p>
    </li>
  );
}

function ContextBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[#DCE9EA] bg-[#f7f9f7] p-4 min-w-0">
      <h4 className="text-sm font-semibold text-[#063f46]">{title}</h4>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SnapshotStack({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-[#8aa0a3]">{label}</p>
      <p className="text-sm font-bold text-[#063f46] tabular-nums mt-1 wrap-break-word">{value}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-[#8aa0a3]">{label}</dt>
      <dd className="text-sm font-semibold text-[#063f46] tabular-nums mt-0.5 wrap-break-word">{value}</dd>
    </div>
  );
}

function EvidenceList({
  heading,
  items,
  empty,
}: {
  heading: string;
  items: InterpretationEvidence[];
  empty: string;
}) {
  return (
    <section>
      <h4 className="text-sm font-semibold text-[#063f46]">{heading}</h4>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-[#4a6366]">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={item.code + item.detail} className="rounded-lg border border-[#DCE9EA] bg-[#f7f9f7] px-3 py-2">
              <p className="text-sm font-semibold text-[#063f46]">{item.title}</p>
              <p className="text-sm text-[#4a6366] mt-0.5">{item.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MissingCard({ title, body }: { title: string; body: string }) {
  return (
    <article className="rounded-xl border border-[#DCE9EA] bg-[#f6f8f8] p-3">
      <h4 className="text-sm font-semibold text-[#063f46]">{title}</h4>
      <p className="text-xs text-[#4a6366] mt-1 leading-relaxed">{body}</p>
    </article>
  );
}
