'use client';

import { ScanSearch } from 'lucide-react';
import { ANALYSIS_STAGE_COPY, EXTRACTION_STAGE_COPY, REPLAY_STAGE_COPY, UPLOAD_ERROR_COPY } from '@/lib/parlay-xray/copy';
import { extractionCounts } from '@/lib/parlay-xray/fields';
import {
  analysisStageFor,
  canConfirmLegs,
  liveCombinedOdds,
  liveStructuralNotes,
  selectAnalysisPresentation,
  type XrayState,
} from '@/lib/parlay-xray/session';
import { detectStructuralDependencies } from '@/lib/parlay-xray/structural';
import type { LegEdits } from '@/lib/parlay-xray/session';
import { ExtractedLegsPanel } from './ExtractedLegsPanel';
import { UploadDropzone } from './UploadDropzone';
import { XrayAnalysisPanel } from './XrayAnalysisPanel';
import { XrayResultsPanel } from './XrayResultsPanel';
import type { UploadErrorCode, UploadedScreenshot } from '@/lib/parlay-xray/types';

type ParlayXrayViewProps = {
  state: XrayState;
  onSelected: (file: UploadedScreenshot) => void;
  onRejected: (code: Extract<UploadErrorCode, 'unsupported_file' | 'file_too_large'>) => void;
  onRemove: () => void;
  onExtract: () => void;
  onToggleEditing: () => void;
  onEditLeg: (legId: string, edits: LegEdits) => void;
  onAcceptLeg: (legId: string) => void;
  onConfirm: () => void;
  onUploadStarted: () => void;
  showDesignPreviewLink: boolean;
};

export function ParlayXrayView({
  state,
  onSelected,
  onRejected,
  onRemove,
  onExtract,
  onToggleEditing,
  onEditLeg,
  onAcceptLeg,
  onConfirm,
  onUploadStarted,
  showDesignPreviewLink,
}: ParlayXrayViewProps) {
  const counts = extractionCounts(state.parlay.legs);
  const presentation = selectAnalysisPresentation(state);
  const structural = detectStructuralDependencies(state.parlay.legs);
  const combined = liveCombinedOdds(state.parlay.legs);
  const error = state.uploadErrorCode ? UPLOAD_ERROR_COPY[state.uploadErrorCode] : null;
  const extractionCopy = EXTRACTION_STAGE_COPY[state.parlay.extractionStatus];
  const analysisCopy = state.replayStage
    ? REPLAY_STAGE_COPY[state.replayStage]
    : ANALYSIS_STAGE_COPY[analysisStageFor(state)];
  const extracting = state.parlay.extractionStatus === 'pending';
  const hasFile = Boolean(state.parlay.uploadedImage);
  const historicalReplay = state.historicalReplay;
  const hasInterpretations = Boolean(state.interpretations && state.interpretations.length > 0);
  const replayPending = Boolean(
    historicalReplay &&
      state.replayStage &&
      state.replayStage !== 'ready' &&
      !hasInterpretations
  );
  const quotaLabel =
    state.quota != null
      ? `${state.quota.remaining} of ${state.quota.limit} XRay analyses remaining today`
      : null;

  return (
    <main className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 overflow-x-hidden">
      {historicalReplay ? (
        <p
          className="rounded-xl border border-[#cfeee3] bg-[#f3fbf7] px-4 py-3 text-sm text-[#063f46]"
          role="status"
        >
          Historical Replay — {historicalReplay.dateLabel}
          {historicalReplay.gameId ? ` · game ${historicalReplay.gameId}` : ''}. Certified as-of cutoff{' '}
          {historicalReplay.cutoffAt}. This is not current-season intelligence.
        </p>
      ) : state.designPreview ? (
        <p
          className="rounded-xl border border-amber-200 bg-[#fff8ee] px-4 py-3 text-sm text-[#9a3412]"
          role="status"
        >
          Design preview — fictional layout data. This is not a read of an uploaded screenshot.
        </p>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <header className="lg:col-span-3 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8aa0a3]">Parlay XRay</p>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight text-[#063f46] leading-[0.95]">
            See beyond the bet slip.
          </h1>
          <p className="text-sm sm:text-base text-[#4a6366] max-w-md">
            Upload a parlay screenshot and Court Context will help you review each leg — the context, risk, sample
            quality, and uncertainty behind the slip. This is not a win call.
          </p>
          <p className="inline-flex items-center gap-2 rounded-full bg-[#55ddb1] px-3 py-1.5 text-xs font-semibold text-[#063f46]">
            <ScanSearch className="h-3.5 w-3.5" aria-hidden />
            More than the trend.
          </p>
        </header>

        <section className="lg:col-span-5 bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-5">
          <h2 className="text-base font-bold text-[#063f46]">Upload your parlay</h2>
          <p className="text-sm text-[#4a6366] mt-1 mb-4">
            Drag and drop a screenshot of your bet slip, or choose a file. The image stays on this device in this step.
          </p>
          <UploadDropzone
            screenshot={state.parlay.uploadedImage}
            error={error}
            statusHint={historicalReplay ? 'Historical replay fixture — not a live slip' : undefined}
            thumbnailHint={historicalReplay ? 'Historical replay' : undefined}
            onSelected={onSelected}
            onRejected={onRejected}
            onRemove={onRemove}
            onUploadStarted={onUploadStarted}
          />
          {hasFile && !state.designPreview && !historicalReplay ? (
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={onExtract}
                disabled={extracting}
                className="inline-flex items-center justify-center rounded-xl bg-[#063f46] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#075B5C] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1]/70"
              >
                {extracting ? 'Reading screenshot…' : 'Extract screenshot'}
              </button>
              <p className="text-xs text-[#4a6366]">
                Extraction starts only when you click this button. Review legs before any analysis.
              </p>
            </div>
          ) : null}
          {quotaLabel ? <p className="mt-3 text-xs text-[#4a6366]">{quotaLabel}</p> : null}
          {state.extractNotice ? (
            <p className="mt-3 text-sm text-[#9a3412]" role="status">
              {state.extractNotice}
            </p>
          ) : null}
          <StageList
            hasFile={Boolean(state.parlay.uploadedImage)}
            extractionCopy={extractionCopy}
            analysisCopy={analysisCopy}
            pendingExtraction={state.parlay.extractionStatus === 'pending'}
            pendingAnalysis={state.parlay.analysisStatus === 'pending'}
            confirmed={state.confirmed}
            hasInterpretations={hasInterpretations}
            historicalReplay={Boolean(historicalReplay)}
          />
        </section>

        <div className="lg:col-span-4">
          <ExtractedLegsPanel
            legs={state.parlay.legs}
            editing={state.editing}
            extractionStatusLabel={extractionCopy}
            canConfirm={canConfirmLegs(state)}
            confirmed={state.confirmed}
            confirmLabel={
              historicalReplay
                ? state.confirmed
                  ? 'Replay confirmed'
                  : 'Confirm historical replay'
                : undefined
            }
            confirmHint={
              historicalReplay
                ? 'Confirm is the boundary between what XRay read and analyzing these confirmed legs. This will not run as live analysis.'
                : undefined
            }
            onToggleEditing={onToggleEditing}
            onEditLeg={onEditLeg}
            onAcceptLeg={onAcceptLeg}
            onConfirm={onConfirm}
          />
        </div>
      </div>

      {state.replayError ? (
        <p className="rounded-xl border border-amber-200 bg-[#fff8ee] px-4 py-3 text-sm text-[#9a3412]" role="alert">
          {state.replayError}
        </p>
      ) : null}

      {hasInterpretations && state.interpretations ? (
        <XrayResultsPanel
          interpretations={state.interpretations}
          historicalReplay={historicalReplay}
          legs={state.parlay.legs}
        />
      ) : replayPending ? (
        <section className="rounded-2xl border border-[#DCE9EA] bg-white p-5" role="status">
          <h2 className="text-base font-bold text-[#063f46]">Historical replay</h2>
          <p className="text-sm text-[#4a6366] mt-2">{analysisCopy}</p>
          {state.replayError ? <p className="text-sm text-[#9a3412] mt-2">{state.replayError}</p> : null}
        </section>
      ) : historicalReplay ? (
        <section className="rounded-2xl border border-[#DCE9EA] bg-white p-5" role="status">
          <h2 className="text-base font-bold text-[#063f46]">Waiting for confirmation</h2>
          <p className="text-sm text-[#4a6366] mt-2">
            Review what XRay read, correct any OCR mistakes, then confirm. Analysis will use the confirmed legs
            with the labeled historical cutoff — not live current-season context.
          </p>
        </section>
      ) : (
        <XrayAnalysisPanel
          analysis={presentation.analysis}
          legs={state.parlay.legs}
          combinedOdds={combined}
          structural={structural}
          analysisStageCopy={analysisCopy}
          designPreview={state.designPreview}
          showExplorerPlacement={state.designPreview}
        />
      )}

      {showDesignPreviewLink ? (
        <p className="text-xs text-[#8aa0a3]">
          Local layout review:{' '}
          <a className="underline text-[#075B5C]" href="/parlay-xray?preview=1">
            full designed result
          </a>
          {' · '}
          <a className="underline text-[#075B5C]" href="/parlay-xray?preview=partial">
            partial extraction
          </a>
          {' · '}
          <a className="underline text-[#075B5C]" href="/parlay-xray?preview=analysis">
            historical analysis
          </a>
          {' · '}
          <a className="underline text-[#075B5C]" href="/parlay-xray?preview=replay">
            historical confirm flow
          </a>
        </p>
      ) : null}

      <p className="sr-only">
        {counts.detected} legs detected, {counts.needsConfirmation} need confirmation. {liveStructuralNotes(state.parlay.legs).length} structural notes.
      </p>
    </main>
  );
}

function StageList({
  hasFile,
  extractionCopy,
  analysisCopy,
  pendingExtraction,
  pendingAnalysis,
  confirmed,
  hasInterpretations,
  historicalReplay,
}: {
  hasFile: boolean;
  extractionCopy: string;
  analysisCopy: string;
  pendingExtraction: boolean;
  pendingAnalysis: boolean;
  confirmed: boolean;
  hasInterpretations: boolean;
  historicalReplay: boolean;
}) {
  return (
    <ol className="mt-5 space-y-2 text-xs text-[#4a6366]">
      <li>
        <span className="font-semibold text-[#063f46]">Upload.</span>{' '}
        {hasFile ? 'Screenshot selected.' : 'Waiting for a screenshot.'}
      </li>
      <li>
        <span className="font-semibold text-[#063f46]">Extract.</span>{' '}
        {pendingExtraction ? 'Reading the screenshot…' : extractionCopy}
      </li>
      <li>
        <span className="font-semibold text-[#063f46]">Review.</span>{' '}
        {hasFile ? 'Edit or accept what XRay read before confirming.' : 'Waiting for extracted legs.'}
      </li>
      <li>
        <span className="font-semibold text-[#063f46]">Confirm.</span>{' '}
        {confirmed
          ? historicalReplay
            ? 'Historical replay confirmed. Analysis uses these confirmed legs.'
            : 'Legs locked. Live analysis is not connected yet.'
          : 'Confirm is required before analysis.'}
      </li>
      <li>
        <span className="font-semibold text-[#063f46]">Results.</span>{' '}
        {pendingAnalysis ? analysisCopy : hasInterpretations ? analysisCopy : analysisCopy}
      </li>
    </ol>
  );
}
