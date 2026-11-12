'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ShareParlayControls } from '@/components/betting/ShareParlayControls';
import { PostToFeedControls } from '@/components/feed/PostToFeedControls';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { workspaceSourceLabel, type SelectedParlayLeg } from '@/lib/parlay/selection';
import type { WorkspaceAnalysisEligibility } from '@/lib/parlay/workspace-analysis';
import type { WorkspaceAnalysisRecord } from '@/lib/parlay/selection-store';
import {
  workspaceCombinedOdds,
  workspaceFormTable,
  workspaceImpliedProbabilityLabel,
  workspaceOddsLabel,
  workspaceProjectionTable,
  workspaceRelationships,
  workspaceShowsProjection,
  workspaceSportsbookLabel,
} from '@/lib/parlay/workspace-presentation';
import { isPublicXrayExtractionReady } from '@/lib/onboarding/contract';
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
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceLegList } from './WorkspaceLegList';
import { WorkspaceParlayRead } from './WorkspaceParlayRead';
import { WorkspaceTicketRail } from './WorkspaceTicketRail';

const PRIMARY_ACTION =
  'type-interactive inline-flex min-h-10 items-center justify-center rounded-lg border border-[#075B5C] bg-[#075B5C] px-3 text-white hover:opacity-90 disabled:opacity-40';
const SECONDARY_ACTION =
  'type-interactive inline-flex min-h-10 items-center justify-center rounded-lg border border-[#075B5C] bg-white px-3 text-[#075B5C] hover:bg-[#55ddb1]/20 disabled:opacity-40';

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
  /** Runs analysis again for the current legs. Offered after an error; analysis otherwise starts on its own. */
  onAnalyze: () => void;
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
  const sourceLabel = workspaceSourceLabel(legs);
  const result = showingResults && analysis ? analysis.result : null;
  const interpretations = result ? result.interpretations : [];
  const contexts = result ? result.contexts : [];
  const parlay = result ? result.parlayInterpretation : null;
  const allRelationships = parlay ? workspaceRelationships(parlay, parlay.dependencyGroups.length) : [];
  const formRows = result ? workspaceFormTable(interpretations) : [];
  const projectionRows = result ? workspaceProjectionTable(interpretations, contexts) : [];
  // Today's props never show model projections: backtests found no edge over the no-vig market.
  const showProjection =
    !legs.some((leg) => leg.offer.snapshotKind === 'live_current') && workspaceShowsProjection(interpretations);
  const totalOdds = workspaceCombinedOdds(legs);

  const previewBanner = previewLabel ? (
    <p className="type-body mb-3 rounded-xl border border-[#cfeee3] bg-[#f3fbf7] px-4 py-3 text-[#063f46]" role="status">
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
      className={PRIMARY_ACTION}
    />
  );
  const post = previewLabel || researchSnapshot ? null : <PostToFeedControls legs={legs} className={SECONDARY_ACTION} />;
  const ticketActions =
    share || post ? (
      <>
        {share}
        {post}
      </>
    ) : null;

  function useQuickBuild(nextLegs: QuickBuildHandoffLegs, confirmed: boolean) {
    const handoff = handoffQuickBuildSelection({ current: legs, legs: nextLegs, nowMs: Date.now(), confirmed });
    if (handoff.status === 'replaced') {
      onReplaceQuickBuild?.(handoff.legs);
      if (workspaceMode === undefined) setUncontrolledMode('mine');
    }
    return handoff;
  }

  const header = (
    <WorkspaceHeader
      sourceLabel={legs.length > 0 ? sourceLabel : null}
      editedAfterXrayImport={editedAfterXrayImport}
      modeSwitch={<WorkspaceModeSwitch mode={mode} onMode={setUncontrolledMode} />}
    />
  );

  const quickPanel = (
    <div hidden={mode !== 'quick'} data-workspace-panel="quick">
      <QuickBuildsPreview model={quickModel} onModelChange={setQuickModel} onUseBuild={useQuickBuild} />
    </div>
  );

  if (legs.length === 0) {
    return (
      <main className="mx-auto max-w-[1800px] px-4 pb-12 pt-4 sm:px-6 lg:px-8 lg:pt-6">
        {previewBanner}
        {header}
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
                  className="type-interactive inline-flex min-h-11 items-center justify-center rounded-lg border border-[#075B5C] bg-[#075B5C] px-4 text-white hover:opacity-90"
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
              {workspaceMode === undefined ? (
                <p className="type-secondary mt-4 border-t border-[#DCE9EA] pt-3">
                  No legs in mind?{' '}
                  <button
                    type="button"
                    className="type-interactive text-[#075B5C] hover:underline"
                    onClick={() => setUncontrolledMode('quick')}
                  >
                    Try a Quick Build →
                  </button>
                </p>
              ) : null}
            </section>
            {previewLabel ? null : <WorkspaceSamplePreview />}
          </div>
        </div>
      </main>
    );
  }

  const openInterp = contextIndex != null ? interpretations[contextIndex] : undefined;
  const pending = analysisBusy || (eligibility.status === 'READY' && !result && !analysisError);

  return (
    <main
      className={
        ticketActions
          ? 'mx-auto max-w-[1800px] px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 lg:px-8 lg:pb-10 lg:pt-6'
          : 'mx-auto max-w-[1800px] px-4 pb-10 pt-4 sm:px-6 lg:px-8 lg:pt-6'
      }
    >
      {previewBanner}
      {header}
      {quickPanel}
      <div hidden={mode !== 'mine'} data-workspace-panel="mine">
        {analysisBusy ? (
          <p className="type-secondary mb-3" role="status">
            Building Court Context analysis…
          </p>
        ) : null}
        {analysisError ? (
          <div
            className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-red-200 bg-[#fff7f7] px-4 py-3"
            role="alert"
          >
            <p className="type-body text-red-700">{analysisError}</p>
            {eligibility.status === 'READY' ? (
              <button type="button" className="type-interactive text-[#075B5C] hover:underline" onClick={onAnalyze}>
                Try again
              </button>
            ) : null}
          </div>
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

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_23rem]">
          <div className="min-w-0 space-y-4">
            <WorkspaceLegList
              legs={legs}
              interpretations={interpretations}
              contexts={contexts}
              parlay={parlay}
              showProjection={showProjection}
              researchSnapshotTicket={researchSnapshotTicket}
              explorerHref={explorerHref}
              onRemove={onRemove}
              onClear={onClear}
              onOpenContext={setContextIndex}
            />

            {researchSnapshotTicket ? (
              <>
                <p className="type-body text-cc-secondary">{RESEARCH_SNAPSHOT_WORKSPACE_NOTE}</p>
                <ResearchSnapshotFormPanel legs={legs} />
              </>
            ) : (
              <WorkspaceParlayRead
                result={result}
                legCount={legs.length}
                pending={pending}
                onOpenRelationships={() => setRelationshipsOpen(true)}
              />
            )}

            {formRows.length > 0 || projectionRows.length > 0 ? (
              <WorkspaceFormTables formRows={formRows} projectionRows={projectionRows} />
            ) : null}
          </div>

          <WorkspaceTicketRail
            legs={legs}
            book={workspaceSportsbookLabel(legs)}
            totalOddsLabel={workspaceOddsLabel(totalOdds)}
            impliedLabel={workspaceImpliedProbabilityLabel(totalOdds)}
            actions={ticketActions}
          />
        </div>

        <WorkspaceDrawer open={contextIndex != null} title="Leg context" onClose={() => setContextIndex(null)}>
          {openInterp ? (
            <LegContextBody interp={openInterp} context={contextIndex != null ? contexts[contextIndex] : undefined} />
          ) : contextIndex != null ? (
            <p className="type-secondary">
              {legs[contextIndex]?.offer.playerDisplayName ?? 'This leg'} is on the slip. Run Court Context to read{' '}
              {showProjection ? 'projection, role, and market evidence' : 'recent form, role, and availability'}.
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

/** Recent form and projection tables, collapsed by default because the leg rows already show the key numbers. */
function WorkspaceFormTables({
  formRows,
  projectionRows,
}: {
  formRows: ReturnType<typeof workspaceFormTable>;
  projectionRows: ReturnType<typeof workspaceProjectionTable>;
}) {
  return (
    <details className="group rounded-2xl border border-[#DCE9EA] bg-white shadow-sm">
      <summary className="type-interactive flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 text-[#063f46]">
        {projectionRows.length > 0 ? 'Recent form and projection tables' : 'Recent form table'}
        <span aria-hidden className="text-[#075B5C] transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="border-t border-[#DCE9EA] p-3 sm:p-4">
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
      </div>
    </details>
  );
}
