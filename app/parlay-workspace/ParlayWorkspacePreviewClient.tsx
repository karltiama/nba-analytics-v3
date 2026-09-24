'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ParlayWorkspaceView } from '@/components/parlay-workspace/ParlayWorkspaceView';
import {
  buildWorkspaceHistoricalPreviewLegs,
  PROPS_HISTORICAL_PREVIEW_HREF,
} from '@/lib/parlay/preview-fixture';
import { removeSelectedLeg, type SelectedParlayLeg } from '@/lib/parlay/selection';
import type { PreviewScenario } from '@/lib/preview/scenario';
import { workspaceLegsForScenario, workspacePreviewExplorerHref } from '@/lib/preview/workspace-legs';
import {
  evaluateWorkspaceAnalysisEligibility,
  runWorkspaceHistoricalAnalysis,
  selectionFingerprint,
} from '@/lib/parlay/workspace-analysis';
import type { WorkspaceAnalysisRecord } from '@/lib/parlay/selection-store';

export function ParlayWorkspacePreviewClient({ scenario }: { scenario?: PreviewScenario } = {}) {
  const [legs, setLegs] = useState<SelectedParlayLeg[]>(() =>
    scenario ? workspaceLegsForScenario(scenario) : buildWorkspaceHistoricalPreviewLegs()
  );
  const [analysis, setAnalysis] = useState<WorkspaceAnalysisRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    scenario === 'error' ? 'Preview analysis could not run for this selection.' : null
  );
  const [reviewMode, setReviewMode] = useState(false);
  const inFlightFingerprint = useRef<string | null>(null);
  const eligibility = useMemo(() => evaluateWorkspaceAnalysisEligibility(legs), [legs]);
  const fingerprint = useMemo(() => selectionFingerprint(legs), [legs]);
  const analysisCurrent = Boolean(analysis && analysis.fingerprint === fingerprint);

  async function runAnalyze() {
    if (scenario === 'error') {
      setBusy(true);
      setError('Preview analysis could not run for this selection.');
      setBusy(false);
      return;
    }
    if (eligibility.status !== 'READY') return;
    if (inFlightFingerprint.current === fingerprint) return;
    inFlightFingerprint.current = fingerprint;
    setBusy(true);
    setError(null);
    try {
      const { buildX3fReplayContext, buildX3fReplayDeps } = await import('@/lib/parlay-xray/e2e/fixture');
      const result = runWorkspaceHistoricalAnalysis(legs, buildX3fReplayContext(), buildX3fReplayDeps());
      setAnalysis({ fingerprint, result });
      setReviewMode(false);
    } catch {
      setError('Historical analysis could not run for this selection.');
    } finally {
      if (inFlightFingerprint.current === fingerprint) inFlightFingerprint.current = null;
      setBusy(false);
    }
  }

  useEffect(() => {
    setReviewMode(false);
  }, [fingerprint]);

  useEffect(() => {
    if (scenario === 'error') return;
    if (reviewMode) return;
    if (eligibility.status !== 'READY') return;
    if (analysisCurrent || busy) return;
    void runAnalyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, eligibility.status, analysisCurrent, reviewMode, busy, scenario]);

  return (
    <ParlayWorkspaceView
      legs={legs}
      explorerHref={scenario ? workspacePreviewExplorerHref(scenario) : PROPS_HISTORICAL_PREVIEW_HREF}
      onRemove={(id) => setLegs((current) => removeSelectedLeg(current, id))}
      onClear={() => {
        setLegs([]);
        setAnalysis(null);
        setReviewMode(false);
      }}
      eligibility={eligibility}
      analysis={analysisCurrent ? analysis : null}
      analysisBusy={busy}
      analysisError={error}
      showingResults={analysisCurrent && !reviewMode}
      onAnalyze={() => void runAnalyze()}
      onShowReview={() => setReviewMode(true)}
      previewLabel={scenario ? null : 'Historical Preview'}
    />
  );
}
