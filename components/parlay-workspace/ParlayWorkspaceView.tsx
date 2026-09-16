'use client';

import Link from 'next/link';
import { XrayResultsPanel } from '@/components/parlay-xray/XrayResultsPanel';
import { shouldShowXrayOcrProvenance } from '@/lib/parlay/adapt-xray-confirmed';
import {
  marketDisplayLabel,
  snapshotDisplayLabel,
  summarizeCanonicalSelection,
  workspaceSourceLabel,
  type SelectedParlayLeg,
} from '@/lib/parlay/selection';
import type { WorkspaceAnalysisEligibility } from '@/lib/parlay/workspace-analysis';
import { isPublicXrayExtractionReady } from '@/lib/onboarding/contract';

function formatOdds(odds: number | null): string {
  if (odds == null) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

function LegCard({
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
  const snapshot = snapshotDisplayLabel(leg.offer.snapshotKind);
  const badges = [
    samePlayer ? 'Same player' : null,
    sameGame ? 'Same game' : null,
  ].filter(Boolean) as string[];
  const showOcr = shouldShowXrayOcrProvenance(leg);

  return (
    <article className="rounded-2xl border border-[#DCE9EA] bg-white shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[#063f46] truncate">{player}</h2>
          <p className="text-sm text-[#063f46] mt-1">
            {sideLine} {market}
          </p>
          <p className="text-xs text-[#4a6366] mt-1">{leg.offer.sportsbook.displayName}</p>
          {leg.gameLabel ? (
            <p className="text-xs text-[#4a6366] mt-0.5">{leg.gameLabel}</p>
          ) : null}
          <p className="text-xs text-[#4a6366] mt-2">
            Odds {formatOdds(leg.offer.oddsAmerican)}
            <span className="text-[#8aa0a3]"> · </span>
            {snapshot}
          </p>
          {showOcr ? (
            <p className="text-[11px] text-[#4a6366] mt-2">
              <span className="text-[#8aa0a3]">Screenshot read:</span> {leg.xrayProvenance?.ocrSnippet}
              <span className="text-[#8aa0a3]"> · Confirmed:</span> {leg.xrayProvenance?.confirmedPlayerName}
            </p>
          ) : null}
          {badges.length ? (
            <p className="text-[11px] text-[#075B5C] mt-2">{badges.join(' · ')}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="shrink-0 min-h-[44px] min-w-[44px] px-3 text-xs font-medium rounded-lg border border-[#DCE9EA] text-[#063f46] hover:bg-[#f7f9f7]"
          aria-label={`Remove ${player} ${sideLine} ${market} from parlay`}
          onClick={() => onRemove(leg.offer.offerIdentity)}
        >
          Remove
        </button>
      </div>
    </article>
  );
}

function WorkspaceActions({
  explorerHref,
  onClear,
  eligibility,
  analysisBusy,
  showingResults,
  onAnalyze,
  onShowReview,
}: {
  explorerHref: string;
  onClear: () => void;
  eligibility: WorkspaceAnalysisEligibility;
  analysisBusy: boolean;
  showingResults: boolean;
  onAnalyze: () => void;
  onShowReview: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {showingResults ? (
        <button
          type="button"
          className="inline-flex items-center justify-center min-h-[44px] px-3 text-sm font-semibold rounded-lg border border-[#075B5C] text-[#075B5C] hover:bg-[#55ddb1]/20"
          onClick={onShowReview}
        >
          Edit Parlay
        </button>
      ) : eligibility.status === 'READY' ? (
        <button
          type="button"
          className="inline-flex items-center justify-center min-h-[44px] px-3 text-sm font-semibold rounded-lg border border-[#075B5C] bg-[#075B5C] text-white hover:opacity-90 disabled:opacity-40"
          onClick={onAnalyze}
          disabled={analysisBusy}
          aria-busy={analysisBusy}
          data-coachmark="workspace-analyze"
        >
          {analysisBusy ? 'Building Court Context analysis…' : 'Analyze with Court Context'}
        </button>
      ) : null}
      <Link
        href={explorerHref}
        className="inline-flex items-center justify-center min-h-[44px] px-3 text-sm font-semibold rounded-lg border border-[#075B5C] text-[#075B5C] hover:bg-[#55ddb1]/20"
      >
        Add More Props
      </Link>
      <button
        type="button"
        className="inline-flex items-center justify-center min-h-[44px] px-3 text-sm font-medium rounded-lg border border-[#DCE9EA] bg-white text-[#063f46] hover:bg-[#f7f9f7]"
        aria-label="Clear parlay"
        onClick={onClear}
      >
        Clear Parlay
      </button>
    </div>
  );
}

export function ParlayWorkspaceView({
  legs,
  explorerHref,
  onRemove,
  onClear,
  eligibility,
  analysis,
  analysisBusy,
  analysisError,
  showingResults,
  onAnalyze,
  onShowReview,
  editedAfterXrayImport = false,
  previewLabel = null,
}: {
  legs: SelectedParlayLeg[];
  explorerHref: string;
  onRemove: (offerIdentity: string) => void;
  onClear: () => void;
  eligibility: WorkspaceAnalysisEligibility;
  analysis: WorkspaceAnalysisRecord | null;
  analysisBusy: boolean;
  analysisError: string | null;
  showingResults: boolean;
  onAnalyze: () => void;
  onShowReview: () => void;
  editedAfterXrayImport?: boolean;
  previewLabel?: string | null;
}) {
  const structure = summarizeCanonicalSelection(legs);
  const sourceLabel = workspaceSourceLabel(legs);
  const playerCounts = new Map<string, number>();
  const gameCounts = new Map<string, number>();
  for (const leg of legs) {
    playerCounts.set(leg.offer.playerId, (playerCounts.get(leg.offer.playerId) ?? 0) + 1);
    gameCounts.set(leg.offer.gameId, (gameCounts.get(leg.offer.gameId) ?? 0) + 1);
  }

  const previewBanner = previewLabel ? (
    <p className="rounded-xl border border-[#cfeee3] bg-[#f3fbf7] px-4 py-3 text-sm text-[#063f46]" role="status">
      {previewLabel} — certified historical fixture. This is not a live or current-season parlay.
    </p>
  ) : null;

  if (legs.length === 0) {
    return (
      <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
        {previewBanner ? <div className="mb-4">{previewBanner}</div> : null}
        <header className="mb-8 max-w-xl">
          <h1 className="text-xl font-semibold text-[#063f46]" data-coachmark="workspace-intro">
            Parlay Workspace
          </h1>
          <p className="text-sm text-[#4a6366] mt-2">
            Review how your selected legs connect before making your own decision.
          </p>
        </header>
        <section className="rounded-2xl border border-[#DCE9EA] bg-white shadow-sm p-6 max-w-xl">
          <p className="text-sm font-medium text-[#063f46]">Your parlay is empty.</p>
          <p className="text-sm text-[#4a6366] mt-2">
            {isPublicXrayExtractionReady()
              ? 'Add legs from Props Explorer, or import a slip in Parlay XRay.'
              : 'Add legs from Props Explorer. Screenshot import is not available yet.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={explorerHref}
            className="inline-flex items-center justify-center min-h-[44px] px-4 text-sm font-semibold rounded-lg border border-[#075B5C] text-[#075B5C] hover:bg-[#55ddb1]/20"
          >
            Explore Props
          </Link>
          {isPublicXrayExtractionReady() ? (
          <Link
            href="/parlay-xray"
            className="inline-flex items-center justify-center min-h-[44px] px-4 text-sm font-semibold rounded-lg border border-[#DCE9EA] text-[#063f46] hover:bg-[#f7f9f7]"
          >
            Import with XRay
          </Link>
          ) : null}
          </div>
        </section>
      </main>
    );
  }

  const facts = [
    `${structure.legCount} leg${structure.legCount === 1 ? '' : 's'}`,
    structure.sameGameLegCount >= 2 ? `${structure.sameGameLegCount} same-game legs` : null,
    structure.samePlayerLegCount >= 2 ? `${structure.samePlayerLegCount} same-player legs` : null,
  ].filter(Boolean) as string[];

  const actions = (
    <WorkspaceActions
      explorerHref={explorerHref}
      onClear={onClear}
      eligibility={eligibility}
      analysisBusy={analysisBusy}
      showingResults={showingResults}
      onAnalyze={onAnalyze}
      onShowReview={onShowReview}
    />
  );

  return (
    <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
      {previewBanner ? <div className="mb-4">{previewBanner}</div> : null}
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-[#063f46]" data-coachmark="workspace-intro">
          Parlay Workspace
        </h1>
        <p className="text-sm text-[#4a6366] mt-2">
          {showingResults
            ? 'Historical Court Context analysis for the selected Decision Close offers.'
            : 'Review how your selected legs connect before making your own decision.'}
        </p>
        {sourceLabel ? (
          <p className="text-xs text-[#4a6366] mt-2" aria-label="Parlay source">
            {sourceLabel}
            {editedAfterXrayImport ? ' · Edited after import' : ''}
          </p>
        ) : null}
        <p className="text-xs text-[#075B5C] mt-2" aria-live="polite">
          {analysisBusy
            ? 'Building Court Context analysis…'
            : structure.summary || `${structure.legCount} legs selected`}
        </p>
        {showingResults && analysis ? (
          <p className="text-xs text-[#4a6366] mt-1">{analysis.result.historicalReplay.dateLabel}</p>
        ) : null}
      </header>

      <div className="flex flex-col xl:flex-row xl:items-start gap-6">
        <section className="flex-1 min-w-0 space-y-3">
          {showingResults && analysis ? (
            <XrayResultsPanel
              interpretations={analysis.result.interpretations}
              historicalReplay={analysis.result.historicalReplay}
              legs={analysis.result.confirmedLegs}
              eyebrow="Historical Analysis"
            />
          ) : (
            <>
              <div className="space-y-3" aria-label="Selected parlay legs">
                {legs.map((leg) => (
                  <LegCard
                    key={leg.offer.offerIdentity}
                    leg={leg}
                    samePlayer={(playerCounts.get(leg.offer.playerId) ?? 0) >= 2}
                    sameGame={(gameCounts.get(leg.offer.gameId) ?? 0) >= 2}
                    onRemove={onRemove}
                  />
                ))}
              </div>
              {eligibility.status === 'UNAVAILABLE' ? (
                <section className="rounded-2xl border border-amber-200 bg-[#fff8ee] p-4">
                  <h2 className="text-sm font-semibold text-[#063f46]">Historical analysis is not available</h2>
                  <ul className="mt-2 space-y-1 text-sm text-[#4a6366]">
                    {eligibility.reasons.map((reason) => (
                      <li key={reason.code}>{reason.message}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {analysisError ? (
                <p className="text-sm text-red-700" role="alert">
                  {analysisError}
                </p>
              ) : null}
            </>
          )}
          <div className="xl:hidden pt-2">{actions}</div>
        </section>

        <aside className="w-full xl:w-80 shrink-0 xl:sticky xl:top-20 space-y-4">
          <section className="rounded-2xl border border-[#DCE9EA] bg-white shadow-sm p-4">
            <h2 className="text-sm font-semibold text-[#063f46]">Parlay summary</h2>
            <ul className="mt-3 space-y-1.5 text-sm text-[#4a6366]">
              {facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
            {structure.labels.length ? (
              <p className="text-[11px] text-[#075B5C] mt-3">{structure.labels.join(' · ')}</p>
            ) : null}
          </section>
          <div className="hidden xl:block">{actions}</div>
        </aside>
      </div>
    </main>
  );
}
