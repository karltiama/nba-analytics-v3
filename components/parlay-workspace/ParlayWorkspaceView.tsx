'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlignJustify, BarChart3, Link2, X, type LucideIcon } from 'lucide-react';
import { ShareParlayControls } from '@/components/betting/ShareParlayControls';
import { PostToFeedControls } from '@/components/feed/PostToFeedControls';
import { PlayerHeadshot } from '@/components/nba/PlayerHeadshot';
import { TeamLogo } from '@/components/nba/TeamLogo';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { shouldShowXrayOcrProvenance } from '@/lib/parlay/adapt-xray-confirmed';
import {
  marketDisplayLabel,
  snapshotDisplayLabel,
  summarizeCanonicalSelection,
  workspaceSourceLabel,
  type SelectedParlayLeg,
} from '@/lib/parlay/selection';
import type { WorkspaceAnalysisEligibility } from '@/lib/parlay/workspace-analysis';
import type { WorkspaceAnalysisRecord } from '@/lib/parlay/selection-store';
import {
  countWorkspaceStatuses,
  workspaceCombinedOdds,
  workspaceFormTable,
  workspaceImpliedProbabilityLabel,
  workspaceKeySignals,
  workspaceLegChips,
  workspaceLegStatus,
  workspaceLegStatusLabel,
  workspaceMainRisks,
  workspaceOddsLabel,
  workspaceProjectionDeltaLabel,
  workspaceProjectionTable,
  workspaceRelationships,
  workspaceReviewFlags,
  workspaceShowsProjection,
  workspaceSportsbookLabel,
  type WorkspaceLegStatus,
  type WorkspaceSignal,
  type WorkspaceSignalTone,
} from '@/lib/parlay/workspace-presentation';
import { formatAvg } from '@/lib/parlay-xray/interpretation/display';
import { formatEtTimestamp } from '@/lib/quick-builds/preview';
import { isPublicXrayExtractionReady } from '@/lib/onboarding/contract';
import { cn } from '@/lib/utils';
import { WorkspaceTrueCost } from '@/components/parlay/WorkspaceTrueCost';
import { ResearchSnapshotFormPanel } from '@/components/parlay-workspace/ResearchSnapshotFormPanel';
import {
  FULL_COURT_CONTEXT_UNAVAILABLE_HEADING,
  RESEARCH_SNAPSHOT_WORKSPACE_NOTE,
} from '@/lib/parlay/research-snapshot-form';
import { LegContextBody, WorkspaceDrawer } from './WorkspaceDrawer';
import { handoffQuickBuildSelection, type QuickBuildHandoffLegs } from '@/lib/parlay/adapt-quick-build';
import { initialPreviewModel, type PreviewModel } from '@/lib/quick-builds/preview';
import { QuickBuildsPreview, WorkspaceModeSwitch, type WorkspaceMode } from './QuickBuildsPreview';
import { WorkspaceSamplePreview } from './WorkspaceSamplePreview';

const TONE_CLASS: Record<WorkspaceSignalTone, string> = {
  support: 'border-[#bfe8d2] bg-[#f3fbf7]',
  watch: 'border-[#f0e0c8] bg-[#fff8ee]',
  concern: 'border-[#f6d5d5] bg-[#fff7f7]',
  info: 'border-[#DCE9EA] bg-[#f4f7f8]',
};

const SIGNAL_VALUE_CLASS: Record<WorkspaceSignalTone, string> = {
  support: 'text-[#16a34a]',
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

const STATUS_CLASS: Record<WorkspaceLegStatus, string> = {
  supported: 'border-[#bfe8d2] bg-[#e7f8ef] text-[#0f6b45]',
  mixed: 'border-[#DCE9EA] bg-[#f4f6f6] text-[#4a6366]',
  needs_review: 'border-[#f0e0c8] bg-[#fff8ee] text-[#9a3412]',
};

function formatOdds(odds: number | null): string {
  return workspaceOddsLabel(odds);
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
  xrayImportAvailable = isPublicXrayExtractionReady(),
  workspaceMode,
  onReplaceQuickBuild,
  initialQuickModel,
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
  /** Server XRay kill switch. Defaults to the static public readiness. */
  xrayImportAvailable?: boolean;
  /** Test seam. Production leaves this unset and keeps the mode in local state. */
  workspaceMode?: WorkspaceMode;
  /** Applies a validated two-leg Research Snapshot. The view does not touch the store itself. */
  onReplaceQuickBuild?: (legs: SelectedParlayLeg[]) => void;
  /** Test seam for a preview model that must survive a mode render. */
  initialQuickModel?: PreviewModel;
}) {
  const [contextIndex, setContextIndex] = useState<number | null>(null);
  const [relationshipsOpen, setRelationshipsOpen] = useState(false);
  const [uncontrolledMode, setUncontrolledMode] = useState<WorkspaceMode>('mine');
  const [quickModel, setQuickModel] = useState<PreviewModel>(initialQuickModel ?? initialPreviewModel);
  const mode = workspaceMode ?? uncontrolledMode;
  const structure = summarizeCanonicalSelection(legs);
  const sourceLabel = workspaceSourceLabel(legs);
  const analyzed = Boolean(showingResults && analysis);
  const interpretations = analyzed && analysis ? analysis.result.interpretations : [];
  const contexts = analyzed && analysis ? analysis.result.contexts : [];
  const parlay = analyzed && analysis ? analysis.result.parlayInterpretation : null;
  const counts = countWorkspaceStatuses(interpretations);
  const signals = parlay ? workspaceKeySignals(parlay, interpretations, contexts) : [];
  const risks = parlay ? workspaceMainRisks(parlay) : [];
  const relationships = parlay ? workspaceRelationships(parlay, 3) : [];
  const allRelationships = parlay ? workspaceRelationships(parlay, parlay.dependencyGroups.length) : [];
  const formRows = analyzed ? workspaceFormTable(interpretations) : [];
  const projectionRows = analyzed ? workspaceProjectionTable(interpretations, contexts) : [];
  // Today's props never show model projections: backtests found no edge over the no-vig market.
  const showProjection =
    !legs.some((leg) => leg.offer.snapshotKind === 'live_current') && workspaceShowsProjection(interpretations);
  const totalOdds = workspaceCombinedOdds(legs);
  const implied = workspaceImpliedProbabilityLabel(totalOdds);
  const book = workspaceSportsbookLabel(legs);
  const playerCounts = new Map<string, number>();
  const gameCounts = new Map<string, number>();
  for (const leg of legs) {
    playerCounts.set(leg.offer.playerId, (playerCounts.get(leg.offer.playerId) ?? 0) + 1);
    gameCounts.set(leg.offer.gameId, (gameCounts.get(leg.offer.gameId) ?? 0) + 1);
  }

  const previewBanner = previewLabel ? (
    <p className="type-body rounded-xl border border-[#cfeee3] bg-[#f3fbf7] px-4 py-3 text-[#063f46]" role="status">
      {previewLabel} — certified historical fixture. This is not a live or current-season parlay.
    </p>
  ) : null;

  const researchSnapshot = legs.some((leg) => leg.offer.snapshotKind === 'research_snapshot');
  const researchSnapshotTicket = legs.length > 0 && legs.every((leg) => leg.offer.snapshotKind === 'research_snapshot');
  const share = researchSnapshot ? null : (
    <ShareParlayControls
      legs={legs}
      source={
        legs.every((leg) => leg.offer.source === 'xray')
          ? 'parlay_xray'
          : legs.every((leg) => leg.offer.source === 'shared_slip')
            ? 'shared_slip'
            : 'props_explorer'
      }
      surface="parlay_workspace"
      className="type-interactive inline-flex min-h-9 items-center justify-center rounded-lg border border-[#075B5C] px-3 text-[#075B5C] hover:bg-[#55ddb1]/20 disabled:opacity-40"
    />
  );

  function useQuickBuild(nextLegs: QuickBuildHandoffLegs, confirmed: boolean) {
    const result = handoffQuickBuildSelection({ current: legs, legs: nextLegs, nowMs: Date.now(), confirmed });
    if (result.status === 'replaced') {
      onReplaceQuickBuild?.(result.legs);
      if (workspaceMode === undefined) setUncontrolledMode('mine');
    }
    return result;
  }

  const quickPanel = (
    <div hidden={mode !== 'quick'} data-workspace-panel="quick">
      <QuickBuildsPreview model={quickModel} onModelChange={setQuickModel} onUseBuild={useQuickBuild} />
    </div>
  );

  if (legs.length === 0) {
    return (
      <main className="mx-auto max-w-[1800px] px-4 pb-12 pt-6 sm:px-6 lg:px-8">
        {previewBanner ? <div className="mb-4">{previewBanner}</div> : null}
        <header className="mb-6 flex flex-col gap-6 lg:flex-row lg:items-end" data-coachmark="workspace-intro">
          <div className="flex-1 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cc-secondary">
              <Link href="/dashboard" className="text-[#075B5C] hover:underline">
                Tools
              </Link>
              <span className="mx-1.5">/</span>
              Parlay Workspace
            </p>
            <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
              <span className="text-[#55ddb1]">Parlay</span>{' '}
              <span className="text-[#063f46]">Workspace</span>
            </h1>
            <p className="type-body max-w-2xl text-cc-secondary">
              Organize, review, and refine your parlay with data-driven context.
            </p>
          </div>
        </header>
        <WorkspaceModeSwitch mode={mode} onMode={setUncontrolledMode} />
        {quickPanel}
        <div hidden={mode !== 'mine'} data-workspace-panel="mine">
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-[#DCE9EA] bg-white p-6 shadow-sm">
          <p className="type-card-data text-[#063f46]">Your parlay is empty.</p>
          <p className="type-body mt-2 text-cc-secondary">
            {xrayImportAvailable
              ? 'Add legs from Props Explorer, or import a slip in Parlay XRay.'
              : 'Add legs from Props Explorer. Screenshot import is not available yet.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={explorerHref}
              className="type-interactive inline-flex min-h-11 items-center justify-center rounded-lg border border-[#075B5C] px-4 text-[#075B5C] hover:bg-[#55ddb1]/20"
            >
              Explore Props
            </Link>
            {xrayImportAvailable ? (
              <Link
                href="/parlay-xray"
                className="type-interactive inline-flex min-h-11 items-center justify-center rounded-lg border border-[#DCE9EA] px-4 text-[#063f46] hover:bg-[#f7f9f7]"
              >
                Import with XRay
              </Link>
            ) : null}
          </div>
        </section>
        {previewLabel ? null : <WorkspaceSamplePreview />}
        </div>
        </div>
      </main>
    );
  }

  const summarySentence = parlay
    ? parlay.summarySentence
    : structure.summary || `${structure.legCount} legs selected`;
  const openInterp = contextIndex != null ? interpretations[contextIndex] : undefined;

  return (
    <main className="mx-auto max-w-[1800px] px-4 pb-10 pt-4 sm:px-6 lg:px-8">
      {previewBanner ? <div className="mb-3">{previewBanner}</div> : null}
      <header className="mb-6 flex flex-col gap-6 lg:flex-row lg:items-end">
        <div className="flex-1 space-y-2" data-coachmark="workspace-intro">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cc-secondary">
            <Link href="/dashboard" className="text-[#075B5C] hover:underline">
              Tools
            </Link>
            <span className="mx-1.5">/</span>
            Parlay Workspace
          </p>
          <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
            <span className="text-[#55ddb1]">Parlay</span>{' '}
            <span className="text-[#063f46]">Workspace</span>
          </h1>
          <p className="type-body max-w-2xl text-cc-secondary">
            Organize, review, and refine your parlay with data-driven context.
          </p>
          {sourceLabel ? (
            <p className="type-metadata" aria-label="Parlay source">
              {sourceLabel}
              {editedAfterXrayImport ? ' · Edited after import' : ''}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
          {showingResults ? (
            <button
              type="button"
              className="type-interactive inline-flex min-h-9 items-center justify-center rounded-lg border border-[#075B5C] px-3 text-[#075B5C] hover:bg-[#55ddb1]/20"
              onClick={onShowReview}
            >
              Edit Parlay
            </button>
          ) : analysisBusy ? (
            <button
              type="button"
              className="type-interactive inline-flex min-h-9 items-center justify-center rounded-lg border border-[#075B5C] bg-[#075B5C] px-3 text-white opacity-90"
              disabled
              aria-busy
              data-coachmark="workspace-analyze"
            >
              Building Court Context analysis…
            </button>
          ) : eligibility.status === 'READY' ? (
            <button
              type="button"
              className="type-interactive inline-flex min-h-9 items-center justify-center rounded-lg border border-[#075B5C] bg-[#075B5C] px-3 text-white hover:opacity-90"
              onClick={onAnalyze}
              data-coachmark="workspace-analyze"
            >
              Analyze with Court Context
            </button>
          ) : null}
          <button
            type="button"
            className="type-interactive inline-flex min-h-9 items-center justify-center rounded-lg border border-[#DCE9EA] bg-white px-3 text-[#4a6366]"
            disabled
            title="Saved parlays are not available yet."
          >
            Save
          </button>
          {share}
          {previewLabel || researchSnapshot ? null : <PostToFeedControls legs={legs} />}
        </div>
      </header>
      <WorkspaceModeSwitch mode={mode} onMode={setUncontrolledMode} />
      {quickPanel}
      <div hidden={mode !== 'mine'} data-workspace-panel="mine">

      {analysisBusy ? (
        <p className="type-secondary mb-3" role="status">
          Building Court Context analysis…
        </p>
      ) : null}
      {analysisError ? (
        <p className="type-body mb-3 text-red-700" role="alert">
          {analysisError}
        </p>
      ) : null}
      {eligibility.status === 'UNAVAILABLE' && !researchSnapshotTicket ? (
        <section className="mb-3 rounded-2xl border border-amber-200 bg-[#fff8ee] px-4 py-3">
          <h2 className="type-section-heading text-[#063f46]">
            {researchSnapshot ? FULL_COURT_CONTEXT_UNAVAILABLE_HEADING : 'Historical analysis is not available'}
          </h2>
          <ul className="type-body mt-1 space-y-1 text-cc-secondary">
            {eligibility.reasons.map((reason) => (
              <li key={reason.code}>{reason.message}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className={researchSnapshotTicket ? 'mb-4' : 'mb-4 grid gap-3 lg:grid-cols-2'}>
        <section className="rounded-2xl border border-[#DCE9EA] bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <h2 className="type-section-heading text-[#063f46]">Parlay summary</h2>
            {showingResults && analysis ? (
              <p className="type-metadata">{analysis.result.historicalReplay.dateLabel}</p>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="type-card-data text-[#063f46]">
              {structure.legCount} {structure.legCount === 1 ? 'Leg' : 'Legs'}
              {book !== '—' ? ` — ${book}` : ''}
              {totalOdds != null ? ` · ${formatOdds(totalOdds)}` : ''}
            </p>
            {totalOdds == null ? (
              <p className="type-secondary">Combined odds unavailable</p>
            ) : null}
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="type-secondary min-w-0 flex-1 sm:max-w-xl">{summarySentence}</p>
            {researchSnapshotTicket ? null : (
              <div className="flex shrink-0 items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full border border-[#bfe8d2] bg-[#f3fbf7]">
                  <span className="type-card-data leading-none text-[#063f46]">
                    {analyzed ? `${counts.supported}/${structure.legCount}` : '—'}
                  </span>
                  <span className="type-metadata leading-none">Supported</span>
                </div>
                <ul className="type-secondary flex flex-col gap-0.5 sm:min-w-[7.5rem]">
                  <li>{analyzed ? counts.supported : '—'} Supported</li>
                  <li>{analyzed ? counts.mixed : '—'} Mixed</li>
                  <li>{analyzed ? counts.needs_review : '—'} Needs Review</li>
                </ul>
              </div>
            )}
          </div>
          {!analyzed && !analysisBusy && !researchSnapshotTicket ? (
            <p className="type-metadata mt-2">
              {eligibility.status === 'READY'
                ? 'Court Context analysis will appear for this slip shortly.'
                : 'Evidence alignment appears when Court Context analysis is available.'}
            </p>
          ) : null}
        </section>

        {researchSnapshotTicket ? null : (
        <section className="rounded-2xl border border-[#DCE9EA] bg-white p-4 shadow-sm" aria-label="Key signals">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#e7f8ef] text-[#0f6b45]" aria-hidden>
              <BarChart3 className="h-3.5 w-3.5" />
            </span>
            <h2 className="type-section-heading text-[#063f46]">Key signals</h2>
          </div>
          {signals.length === 0 ? (
            <p className="type-secondary mt-2">Projection, role, relationships, and data coverage appear after analysis.</p>
          ) : (
            <ul className="mt-3 grid grid-cols-4 gap-2">
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
          )}
        </section>
        )}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
        <section className="min-w-0 rounded-2xl border border-[#DCE9EA] bg-white p-3 shadow-sm sm:p-4" aria-label="Selected parlay legs">
          <h2 className="type-section-heading mb-2 px-1 text-[#063f46]">Your Parlay Legs</h2>
          <div className="space-y-2">
            {legs.map((leg, index) => {
              const interp = interpretations[index];
              const context = contexts[index];
              const status = interp ? workspaceLegStatus(interp) : null;
              const chips = interp
                ? workspaceLegChips(interp)
                : [
                    (playerCounts.get(leg.offer.playerId) ?? 0) >= 2 ? 'Same player' : null,
                    (gameCounts.get(leg.offer.gameId) ?? 0) >= 2 ? 'Same game' : null,
                    snapshotDisplayLabel(leg.offer.snapshotKind),
                  ].filter(Boolean).slice(0, 3) as string[];
              const review = parlay ? workspaceReviewFlags(parlay, index) : [];
              const player = leg.offer.playerDisplayName ?? `Player ${leg.offer.playerId}`;
              const sideLabel = leg.offer.side === 'over' ? 'Over' : 'Under';
              const showOcr = shouldShowXrayOcrProvenance(leg);
              return (
                <article
                  key={leg.offer.offerIdentity}
                  className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-stretch gap-x-2 gap-y-1.5 rounded-xl border border-[#DCE9EA] px-2.5 py-1.5 md:grid-cols-[auto_auto_minmax(10rem,16rem)_minmax(0,1fr)_auto]"
                >
                  <span
                    className="type-metadata row-span-2 flex h-5 w-5 shrink-0 items-center justify-center self-center rounded-full border border-[#DCE9EA] bg-[#f7f9f7] text-[#063f46]"
                    aria-hidden
                  >
                    {index + 1}
                  </span>
                  <PlayerHeadshot
                    nbaPlayerId={leg.nbaPlayerId}
                    name={player}
                    className="relative row-span-2 h-[4.75rem] w-[4.75rem] shrink-0 self-center overflow-hidden rounded-full border border-[#DCE9EA] bg-[#E8F0F1]"
                  />
                  <div className="min-w-0">
                    <h3 className="type-card-data truncate leading-5 text-[#063f46]">{player}</h3>
                    <p className="type-secondary truncate leading-5">
                      {sideLabel} {leg.offer.line} {marketDisplayLabel(leg.offer.market)}
                    </p>
                    {leg.awayAbbr && leg.homeAbbr ? (
                      <p className="type-metadata flex min-w-0 flex-wrap items-center gap-1 leading-4">
                        <TeamLogo team={leg.awayAbbr} size="xs" decorative />
                        <span>{leg.awayAbbr}</span>
                        <span>@</span>
                        <TeamLogo team={leg.homeAbbr} size="xs" decorative />
                        <span>{leg.homeAbbr}</span>
                      </p>
                    ) : (
                      <p className="type-metadata break-words leading-4">
                        {leg.gameLabel ?? 'Matchup unavailable'}
                      </p>
                    )}
                    {leg.offer.snapshotKind === 'research_snapshot' ? (
                      <SnapshotGameFacts leg={leg} />
                    ) : null}
                  </div>
                  <div className="hidden min-w-0 self-center md:block">
                    <div className={cn('mx-auto grid w-fit justify-items-center gap-x-8 gap-y-1 text-center lg:gap-x-10', researchSnapshotTicket ? 'grid-cols-2' : 'grid-cols-3 lg:grid-cols-4')}>
                      {researchSnapshotTicket ? null : (
                      <p className="min-w-0">
                        <span className="type-secondary block">{showProjection ? 'Projection' : 'Season avg'}</span>
                        <span className="type-card-data text-[#063f46]">
                          {showProjection
                            ? formatAvg(context?.projection.projectedStat ?? null)
                            : formatAvg(interp?.recentForm.seasonAverage ?? null)}
                        </span>
                      </p>
                      )}
                      <p className="min-w-0">
                        <span className="type-secondary block">Line</span>
                        <span className="type-card-data text-[#063f46]">{leg.offer.line}</span>
                      </p>
                      <p className="min-w-0">
                        <span className="type-secondary block">{interp && showProjection ? 'Difference' : 'Odds'}</span>
                        <span className="type-card-data text-[#063f46]">
                          {interp && showProjection ? workspaceProjectionDeltaLabel(context) : formatOdds(leg.offer.oddsAmerican)}
                        </span>
                      </p>
                      {interp ? (
                        <p className="min-w-0">
                          <span className="type-secondary block">L5</span>
                          <span className="type-card-data text-[#063f46]">
                            {formatAvg(interp.recentForm.last5Average)}
                          </span>
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-start justify-end gap-2 self-start">
                    {status ? (
                      <span className={cn('type-badge rounded-full border px-2 py-0.5', STATUS_CLASS[status])}>
                        {workspaceLegStatusLabel(status)}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg text-[#4a6366] hover:bg-[#f7f9f7] hover:text-[#063f46]"
                      aria-label={`Remove ${player} ${sideLabel} ${leg.offer.line} ${marketDisplayLabel(leg.offer.market)} from parlay`}
                      onClick={() => onRemove(leg.offer.offerIdentity)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="col-span-full flex min-w-0 flex-col gap-1.5 md:col-span-3 md:col-start-3">
                    <div className={cn('grid gap-2 md:hidden', researchSnapshotTicket ? 'grid-cols-2' : 'grid-cols-3')}>
                      {researchSnapshotTicket ? null : (
                      <p className="min-w-0">
                        <span className="type-secondary block">{showProjection ? 'Projection' : 'Season avg'}</span>
                        <span className="type-card-data text-[#063f46]">
                          {showProjection
                            ? formatAvg(context?.projection.projectedStat ?? null)
                            : formatAvg(interp?.recentForm.seasonAverage ?? null)}
                        </span>
                      </p>
                      )}
                      <p className="min-w-0">
                        <span className="type-secondary block">Line</span>
                        <span className="type-card-data text-[#063f46]">{leg.offer.line}</span>
                      </p>
                      <p className="min-w-0">
                        <span className="type-secondary block">{interp && showProjection ? 'Difference' : 'Odds'}</span>
                        <span className="type-card-data text-[#063f46]">
                          {interp && showProjection ? workspaceProjectionDeltaLabel(context) : formatOdds(leg.offer.oddsAmerican)}
                        </span>
                      </p>
                    </div>
                    {showOcr ? (
                      <p className="type-metadata">
                        Screenshot read: {leg.xrayProvenance?.ocrSnippet}
                        <span> · Confirmed:</span> {leg.xrayProvenance?.confirmedPlayerName}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <ul className="flex flex-wrap gap-1">
                        {(review.length > 0 && status === 'needs_review' ? review.slice(0, 3) : chips).map((chip) => (
                          <li
                            key={chip}
                            className="type-badge rounded-full border border-[#DCE9EA] bg-[#f7f9f7] px-2 py-0.5 text-[#063f46]"
                          >
                            {chip}
                          </li>
                        ))}
                      </ul>
                      {researchSnapshotTicket ? null : (
                      <button
                        type="button"
                        className="type-interactive text-[#075B5C]"
                        onClick={() => setContextIndex(index)}
                      >
                        View Context →
                      </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <WorkspaceTrueCost legs={legs} />
        {researchSnapshotTicket ? (
          <>
            <p className="type-body text-cc-secondary">{RESEARCH_SNAPSHOT_WORKSPACE_NOTE}</p>
            <ResearchSnapshotFormPanel legs={legs} />
          </>
        ) : null}

        {formRows.length > 0 || projectionRows.length > 0 ? (
          <section className="rounded-2xl border border-[#DCE9EA] bg-white p-3 shadow-sm sm:p-4">
            <Tabs defaultValue={formRows.length > 0 ? 'form' : 'projection'}>
              <TabsList>
                {formRows.length > 0 ? <TabsTrigger value="form">Recent form</TabsTrigger> : null}
                {projectionRows.length > 0 ? <TabsTrigger value="projection">Projected vs market</TabsTrigger> : null}
              </TabsList>
              {formRows.length > 0 ? (
                <TabsContent value="form">
                  <table className="mt-2 w-full text-left">
                    <thead>
                      <tr className="type-metadata">
                        <th className="py-1 pr-2 font-medium">Player</th>
                        <th className="py-1 pr-2 font-medium">L5</th>
                        <th className="py-1 pr-2 font-medium">L10</th>
                        <th className="py-1 font-medium">Season</th>
                      </tr>
                    </thead>
                    <tbody>
                      {formRows.map((row) => (
                        <tr key={row.player + row.market} className="border-t border-[#DCE9EA]">
                          <td className="type-table-data py-1.5 pr-2 text-[#063f46]">
                            {row.player} {row.market}
                          </td>
                          <td className="type-table-data py-1.5 pr-2">{row.last5}</td>
                          <td className="type-table-data py-1.5 pr-2">{row.last10}</td>
                          <td className="type-table-data py-1.5">{row.season}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TabsContent>
              ) : null}
              {projectionRows.length > 0 ? (
                <TabsContent value="projection">
                  <table className="mt-2 w-full text-left">
                    <thead>
                      <tr className="type-metadata">
                        <th className="py-1 pr-2 font-medium">Player</th>
                        <th className="py-1 pr-2 font-medium">Line</th>
                        <th className="py-1 pr-2 font-medium">Projection</th>
                        <th className="py-1 font-medium">Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectionRows.map((row) => (
                        <tr key={row.player + row.market} className="border-t border-[#DCE9EA]">
                          <td className="type-table-data py-1.5 pr-2 text-[#063f46]">
                            {row.player} {row.market}
                          </td>
                          <td className="type-table-data py-1.5 pr-2">{row.line}</td>
                          <td className="type-table-data py-1.5 pr-2">{row.projection}</td>
                          <td className="type-table-data py-1.5">{row.difference}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TabsContent>
              ) : null}
            </Tabs>
          </section>
        ) : null}
        </div>

        <aside className="space-y-3">
          <section className="rounded-2xl border border-[#DCE9EA] bg-white p-3 shadow-sm">
            <h2 className="type-section-heading text-[#063f46]">Workspace summary</h2>
            <dl className="mt-2 space-y-1">
              <div className="flex justify-between gap-3">
                <dt className="type-metadata">Total legs</dt>
                <dd className="type-table-data text-[#063f46]">{structure.legCount}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="type-metadata">Sportsbook</dt>
                <dd className="type-table-data text-[#063f46]">{book}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="type-metadata">Total odds</dt>
                <dd className="type-table-data text-[#063f46]">{formatOdds(totalOdds)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="type-metadata">Implied probability</dt>
                <dd className="type-table-data text-[#063f46]">{implied ?? '—'}</dd>
              </div>
            </dl>
          </section>

          {researchSnapshotTicket ? null : (
          <>
          <section className="rounded-2xl border border-[#DCE9EA] bg-white p-3 shadow-sm">
            <h2 className="type-section-heading text-[#063f46]">Parlay relationships</h2>
            <p className="type-metadata mt-1">Structural dependencies from identity and packets.</p>
            {relationships.length === 0 ? (
              <p className="type-secondary mt-2">{analyzed ? 'No shared player, game, or team groups on this slip.' : 'Shared groups appear after analysis.'}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {relationships.map((group) => (
                  <li key={group.key}>
                    <p className="type-secondary text-[#063f46]">{group.label}</p>
                    <p className="type-metadata">{group.kind}</p>
                    <p className="type-metadata line-clamp-2">{group.detail}</p>
                  </li>
                ))}
              </ul>
            )}
            {allRelationships.length > 0 ? (
              <button type="button" className="type-interactive mt-2 text-[#075B5C]" onClick={() => setRelationshipsOpen(true)}>
                View full shared context →
              </button>
            ) : null}
          </section>

          <section className="rounded-2xl border border-[#DCE9EA] bg-white p-3 shadow-sm">
            <h2 className="type-section-heading text-[#063f46]">Main risks</h2>
            {!analyzed ? (
              <p className="type-secondary mt-2">Risk notes appear after analysis.</p>
            ) : risks.length === 0 ? (
              <p className="type-secondary mt-2">No cross-leg failure notes from certified packet fields.</p>
            ) : (
              <ol className="mt-2 space-y-2">
                {risks.map((risk, index) => (
                  <li key={risk.title + risk.detail} className="flex gap-2">
                    <span className="type-metadata">{index + 1}</span>
                    <span>
                      <span className="type-secondary text-[#063f46]">{risk.title}. </span>
                      <span className="type-metadata line-clamp-2">{risk.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          </>
          )}

          <div className="flex flex-col gap-2">
            <Link
              href={explorerHref}
              className="type-interactive inline-flex min-h-9 items-center justify-center rounded-lg border border-[#075B5C] px-3 text-[#075B5C] hover:bg-[#55ddb1]/20"
            >
              Add More Props
            </Link>
            <button
              type="button"
              className="type-interactive inline-flex min-h-9 items-center justify-center rounded-lg border border-[#DCE9EA] bg-white text-[#063f46] hover:bg-[#f7f9f7]"
              aria-label="Clear parlay"
              onClick={onClear}
            >
              Clear Parlay
            </button>
          </div>
        </aside>
      </div>

      <WorkspaceDrawer
        open={contextIndex != null}
        title="Leg context"
        onClose={() => setContextIndex(null)}
      >
        {openInterp ? (
          <LegContextBody interp={openInterp} context={contextIndex != null ? contexts[contextIndex] : undefined} />
        ) : contextIndex != null ? (
          <p className="type-secondary">
            {legs[contextIndex]?.offer.playerDisplayName ?? 'This leg'} is on the slip. Run Court Context to read {showProjection ? 'projection, role, and market evidence' : 'recent form, role, and availability'}.
          </p>
        ) : null}
      </WorkspaceDrawer>

      <WorkspaceDrawer open={relationshipsOpen} title="Shared context" onClose={() => setRelationshipsOpen(false)}>
        <p className="type-metadata mb-3">Structural dependencies from identity and packets.</p>
        <ul className="space-y-3">
          {allRelationships.map((group) => (
            <li key={group.key} className="rounded-xl border border-[#DCE9EA] bg-[#f7f9f7] p-3">
              <p className="type-metadata">{group.kind}</p>
              <p className="type-card-data text-[#063f46]">{group.label}</p>
              <p className="type-secondary mt-1">{group.detail}</p>
            </li>
          ))}
        </ul>
      </WorkspaceDrawer>
      </div>
    </main>
  );
}

function SnapshotGameFacts({ leg }: { leg: SelectedParlayLeg }) {
  const start = leg.gameStartTime ? formatEtTimestamp(leg.gameStartTime) : null;
  return (
    <>
      <p className="type-metadata break-words leading-4">
        {start ? `Game start ${start}` : 'Game start unavailable'}
      </p>
      {leg.gameStatus ? <p className="type-metadata break-words leading-4">Game status: {leg.gameStatus}</p> : null}
    </>
  );
}
