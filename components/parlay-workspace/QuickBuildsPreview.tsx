'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Info } from 'lucide-react';
import type { QuickBuildHandoffLeg, QuickBuildHandoffResult } from '@/lib/parlay/adapt-quick-build';
import type { PlayerPropV1Vendor } from '@/lib/betting/market-movement';
import {
  QUICK_BUILD_AGE_AT_SEARCH_NOTE,
  QUICK_BUILD_BOOK_OPTIONS,
  QUICK_BUILD_BREAK_EVEN_COPY,
  QUICK_BUILD_COMBINED_ODDS_COPY,
  QUICK_BUILD_PAYOUT_OPTIONS,
  QUICK_BUILD_PRESET_EXPLANATION,
  QUICK_BUILD_RESEARCH_SNAPSHOT_COPY,
  acceptPreviewResult,
  lowerPayoutEmptySuggestion,
  beginPreviewRequest,
  fetchQuickBuilds,
  invalidatePreview,
  type PreviewModel,
  type QuickBuildPreviewCard,
  type QuickBuildPreviewView,
} from '@/lib/quick-builds/preview';
import type { QuickBuildPresetName } from '@/lib/quick-builds/types';

export type WorkspaceMode = 'mine' | 'quick';

export function WorkspaceModeSwitch({
  mode,
  onMode,
}: {
  mode: WorkspaceMode;
  onMode: (mode: WorkspaceMode) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Workspace mode">
      <ModeButton active={mode === 'mine'} onClick={() => onMode('mine')}>
        My Parlay
      </ModeButton>
      <ModeButton active={mode === 'quick'} onClick={() => onMode('quick')}>
        Quick Builds
      </ModeButton>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={
        active
          ? 'type-interactive inline-flex min-h-11 items-center justify-center rounded-lg border border-[#075B5C] bg-[#075B5C] px-4 text-white'
          : 'type-interactive inline-flex min-h-11 items-center justify-center rounded-lg border border-[#DCE9EA] bg-white px-4 text-[#063f46] hover:bg-[#f7f9f7]'
      }
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export const QUICK_BUILD_REPLACE_TITLE = 'Replace My Parlay?';
export const QUICK_BUILD_REPLACE_COPY =
  'Your current ticket will be replaced with this two-leg Research Snapshot. The legs already on My Parlay will be removed.';
export const QUICK_BUILD_TIPPED_COPY =
  'This build includes a game that has already tipped, so it was not added.';
export const QUICK_BUILD_UNAVAILABLE_TITLE = 'Build unavailable for Workspace';
export const QUICK_BUILD_UNAVAILABLE_COPY =
  'One or more selections cannot be transferred into My Parlay.';
export const QUICK_BUILD_REJECTED_COPY = QUICK_BUILD_UNAVAILABLE_COPY;

export function QuickBuildsPreview({
  model,
  onModelChange,
  onUseBuild,
}: {
  model: PreviewModel;
  onModelChange: Dispatch<SetStateAction<PreviewModel>>;
  onUseBuild?: (legs: [QuickBuildHandoffLeg, QuickBuildHandoffLeg], confirmed: boolean) => QuickBuildHandoffResult;
}) {
  const modelRef = useRef(model);
  const abortRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<[QuickBuildHandoffLeg, QuickBuildHandoffLeg] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  function commit(next: SetStateAction<PreviewModel>) {
    const resolved = typeof next === 'function' ? next(modelRef.current) : next;
    modelRef.current = resolved;
    onModelChange(resolved);
  }

  function changeFilters(patch: { sportsbook?: PlayerPropV1Vendor; preset?: QuickBuildPresetName }) {
    abortRef.current?.abort();
    abortRef.current = null;
    commit((current) => invalidatePreview(current, patch));
  }

  function find() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const next = beginPreviewRequest(modelRef.current);
    const captured = { requestId: next.requestId, sportsbook: next.state.sportsbook, preset: next.state.preset };
    commit(next.state);
    void fetchQuickBuilds({
      sportsbook: captured.sportsbook,
      preset: captured.preset,
      signal: controller.signal,
    }).then((result) => {
      commit((current) => acceptPreviewResult(current, captured, result));
    });
  }

  function applyBuild(legs: [QuickBuildHandoffLeg, QuickBuildHandoffLeg], confirmed: boolean) {
    if (!onUseBuild) return;
    const result = onUseBuild(legs, confirmed);
    if (result.status === 'needs_confirmation') {
      setPending(legs);
      return;
    }
    setPending(null);
    dialogRef.current?.close();
    if (result.status === 'tipped') setNotice(QUICK_BUILD_TIPPED_COPY);
    else if (result.status === 'rejected') setNotice(QUICK_BUILD_REJECTED_COPY);
    else setNotice(null);
  }

  function cancelReplace() {
    setPending(null);
    dialogRef.current?.close();
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pending && !dialog.open) dialog.showModal();
  }, [pending]);

  return (
    <section className="space-y-4" aria-label="Quick Builds">
      <div className="rounded-2xl border border-[#DCE9EA] bg-white p-4 shadow-sm">
        <h2 className="type-section-heading text-[#063f46]">Find possible parlay combinations</h2>
        <p className="type-body mt-1 text-cc-secondary">
          Find possible parlay combinations without manually researching every player. Use This Build replaces your current ticket with that Research Snapshot.
        </p>
        <fieldset className="mt-4">
          <legend className="type-metadata">Sportsbook</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK_BUILD_BOOK_OPTIONS.map((book) => (
              <ChoiceButton
                key={book.vendor}
                pressed={model.sportsbook === book.vendor}
                onClick={() => changeFilters({ sportsbook: book.vendor })}
              >
                {book.label}
              </ChoiceButton>
            ))}
          </div>
        </fieldset>
        <fieldset className="mt-4">
          <legend className="type-metadata">Target combined odds</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK_BUILD_PAYOUT_OPTIONS.map((option) => (
              <ChoiceButton
                key={option.preset}
                pressed={model.preset === option.preset}
                onClick={() => changeFilters({ preset: option.preset })}
              >
                {`${option.label} (${option.rangeLabel})`}
              </ChoiceButton>
            ))}
          </div>
          <p className="type-secondary mt-2">{QUICK_BUILD_PRESET_EXPLANATION}</p>
        </fieldset>
        <button
          type="button"
          className="type-interactive mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-[#075B5C] bg-[#075B5C] px-4 text-white hover:opacity-90 disabled:opacity-70"
          onClick={find}
          disabled={model.phase === 'loading'}
          aria-busy={model.phase === 'loading'}
        >
          Find Quick Builds
        </button>
      </div>
      {notice ? (
        <p className="type-body rounded-2xl border border-amber-200 bg-[#fff8ee] px-4 py-3 text-[#9a3412]" role="alert">
          {notice}
        </p>
      ) : null}
      <QuickBuildsStatus model={model} onUseBuild={(legs) => applyBuild(legs, false)} />
      <QuickBuildReplaceDialog
        dialogRef={dialogRef}
        pending={pending != null}
        onCancel={cancelReplace}
        onConfirm={() => {
          if (pending) applyBuild(pending, true);
        }}
      />
    </section>
  );
}

function ChoiceButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={
        pressed
          ? 'type-interactive inline-flex min-h-11 items-center justify-center rounded-lg border border-[#075B5C] bg-[#55ddb1]/30 px-3 text-[#063f46]'
          : 'type-interactive inline-flex min-h-11 items-center justify-center rounded-lg border border-[#DCE9EA] bg-white px-3 text-[#4a6366] hover:bg-[#f7f9f7]'
      }
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function QuickBuildsStatus({
  model,
  onUseBuild,
}: {
  model: PreviewModel;
  onUseBuild?: (legs: [QuickBuildHandoffLeg, QuickBuildHandoffLeg]) => void;
}) {
  if (model.phase === 'idle') {
    return (
      <p className="type-secondary" role="status">
        Choose a sportsbook and a payout target, then find Quick Builds. Nothing is requested until you do.
      </p>
    );
  }
  if (model.phase === 'loading') {
    return (
      <p className="type-secondary" role="status">
        Finding Quick Builds…
      </p>
    );
  }
  if (model.phase === 'error') {
    return (
      <p className="type-body text-red-700" role="alert">
        {model.message}
      </p>
    );
  }
  if (!model.view) return null;
  return (
    <QuickBuildsResults
      view={model.view}
      emptySuggestion={lowerPayoutEmptySuggestion(model.preset, model.view.emptyReason)}
      onUseBuild={onUseBuild}
    />
  );
}

export function QuickBuildsResults({
  view,
  emptySuggestion = null,
  onUseBuild,
}: {
  view: QuickBuildPreviewView;
  emptySuggestion?: string | null;
  onUseBuild?: (legs: [QuickBuildHandoffLeg, QuickBuildHandoffLeg]) => void;
}) {
  return (
    <div className="space-y-3">
      <Disclosure view={view} />
      {view.emptyMessage ? (
        <p className="type-body rounded-2xl border border-[#DCE9EA] bg-white p-4 text-[#063f46]" role="status" data-empty-reason={view.emptyReason ?? undefined}>
          {view.emptyMessage}
          {emptySuggestion ? ` ${emptySuggestion}` : null}
        </p>
      ) : (
        <div className="grid gap-3">
          {view.builds.map((build) => (
            <BuildCard key={build.id} build={build} sportsbookLabel={view.sportsbookLabel} onUseBuild={onUseBuild} />
          ))}
        </div>
      )}
    </div>
  );
}

function Disclosure({ view }: { view: QuickBuildPreviewView }) {
  return (
    <aside className="rounded-2xl border border-[#DCE9EA] bg-[#f7f9f7] p-4">
      <p className="type-metadata flex items-center gap-2 text-[#063f46]">
        <Info className="h-4 w-4 shrink-0" aria-hidden />
        Research Snapshot
      </p>
      <p className="type-secondary mt-2">Search generated {view.generatedAtLabel}. Observation times below are the original times the prices were collected.</p>
      <ul className="type-secondary mt-2 space-y-1">
        <li>{QUICK_BUILD_RESEARCH_SNAPSHOT_COPY}</li>
        <li>{QUICK_BUILD_COMBINED_ODDS_COPY}</li>
        <li>{QUICK_BUILD_BREAK_EVEN_COPY}</li>
        {view.researchLimitation ? <li>{view.researchLimitation}</li> : null}
      </ul>
    </aside>
  );
}

function BuildCard({
  build,
  sportsbookLabel,
  onUseBuild,
}: {
  build: QuickBuildPreviewCard;
  sportsbookLabel: string;
  onUseBuild?: (legs: [QuickBuildHandoffLeg, QuickBuildHandoffLeg]) => void;
}) {
  return (
    <article className="rounded-2xl border border-[#DCE9EA] bg-white p-4 shadow-sm" data-quick-build={build.id}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="type-section-heading text-[#063f46]">Build {build.number}</h3>
        <p className="type-metadata">
          {sportsbookLabel} · Two-leg · Research Snapshot
        </p>
      </header>
      {build.displayReady ? null : (
        <p className="type-body mt-3 rounded-xl border border-amber-200 bg-[#fff8ee] px-3 py-2 text-[#9a3412]" role="status">
          Display data is unavailable, so this result is not a ticket.
        </p>
      )}
      <ol className="mt-3 space-y-3">
        {build.legs.map((leg, index) => (
          <li key={`${build.id}-${index}`} className="rounded-xl border border-[#DCE9EA] bg-[#f7f9f7] p-3">
            <p className="type-card-data text-[#063f46]">{leg.playerName ?? leg.unavailable}</p>
            <p className="type-body mt-1 text-[#063f46]">
              {leg.marketLabel} {leg.sideLabel} {leg.lineLabel}
              <span className="type-metadata"> · {leg.oddsLabel}</span>
            </p>
            <p className="type-metadata mt-1">
              {leg.gameStartLabel ? `Game start ${leg.gameStartLabel}` : 'Game start unavailable'}
              {leg.gameStatus ? ` · Snapshot game status: ${leg.gameStatus}` : ''}
            </p>
            <p className="type-metadata mt-1">Price observed {leg.observedLabel}</p>
            {leg.noVigLabel ? <p className="type-metadata mt-1">{leg.noVigLabel}. Not a predicted chance of winning.</p> : null}
          </li>
        ))}
      </ol>
      {build.displayReady ? (
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="type-metadata">Calculated combined odds</dt>
            <dd className="type-card-data text-[#063f46]">{build.combinedOddsLabel}</dd>
          </div>
          <div>
            <dt className="type-metadata">Break-even probability</dt>
            <dd className="type-card-data text-[#063f46]">{build.breakEvenLabel}</dd>
          </div>
        </dl>
      ) : null}
      {build.displayReady && !build.handoff ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-[#fff8ee] px-3 py-2" role="status">
          <p className="type-section-heading text-[#9a3412]">{QUICK_BUILD_UNAVAILABLE_TITLE}</p>
          <p className="type-body mt-1 text-[#9a3412]">{QUICK_BUILD_UNAVAILABLE_COPY}</p>
        </div>
      ) : null}
      {build.handoff ? (
        <button
          type="button"
          className="type-interactive mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-[#075B5C] bg-[#075B5C] px-4 text-white hover:opacity-90"
          onClick={() => onUseBuild?.(build.handoff as [QuickBuildHandoffLeg, QuickBuildHandoffLeg])}
        >
          Use This Build
        </button>
      ) : null}
      <p className="type-metadata mt-3">
        Age at search: {build.oldestAgeLabel}. {QUICK_BUILD_AGE_AT_SEARCH_NOTE} Oldest observed {build.oldestObservedLabel}. Newest observed {build.newestObservedLabel}.
      </p>
      {build.warning ? (
        <p className="type-body mt-3 text-[#9a3412]" role="status">
          {build.warning}
        </p>
      ) : null}
    </article>
  );
}

export function QuickBuildReplaceDialog({
  dialogRef,
  pending,
  onCancel,
  onConfirm,
}: {
  dialogRef?: { current: HTMLDialogElement | null };
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!pending) return null;
  return (
    <dialog
      ref={dialogRef as never}
      aria-labelledby="quick-build-replace-title"
      className="fixed left-1/2 top-1/2 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[#DCE9EA] bg-white p-4 shadow-sm backdrop:bg-black/40"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="quick-build-replace-title" className="type-section-heading text-[#063f46]">
        {QUICK_BUILD_REPLACE_TITLE}
      </h2>
      <p className="type-body mt-2 text-cc-secondary">{QUICK_BUILD_REPLACE_COPY}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="type-interactive inline-flex min-h-11 items-center justify-center rounded-lg border border-[#DCE9EA] bg-white px-4 text-[#063f46]"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="type-interactive inline-flex min-h-11 items-center justify-center rounded-lg border border-[#075B5C] bg-[#075B5C] px-4 text-white"
          onClick={onConfirm}
        >
          Replace My Parlay
        </button>
      </div>
    </dialog>
  );
}
