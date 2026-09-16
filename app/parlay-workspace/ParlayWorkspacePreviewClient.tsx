'use client';

import { useMemo, useState } from 'react';
import { ParlayWorkspaceView } from '@/components/parlay-workspace/ParlayWorkspaceView';
import {
  buildWorkspaceHistoricalPreviewLegs,
  PROPS_HISTORICAL_PREVIEW_HREF,
} from '@/lib/parlay/preview-fixture';
import { removeSelectedLeg, type SelectedParlayLeg } from '@/lib/parlay/selection';
import {
  evaluateWorkspaceAnalysisEligibility,
  runWorkspaceHistoricalAnalysis,
  selectionFingerprint,
} from '@/lib/parlay/workspace-analysis';
import type { WorkspaceAnalysisRecord } from '@/lib/parlay/selection-store';

export function ParlayWorkspacePreviewClient() {
  const [legs, setLegs] = useState<SelectedParlayLeg[]>(() => buildWorkspaceHistoricalPreviewLegs());
  const [analysis, setAnalysis] = useState<WorkspaceAnalysisRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showingResults, setShowingResults] = useState(false);
  const eligibility = useMemo(() => evaluateWorkspaceAnalysisEligibility(legs), [legs]);
  const analysisCurrent = Boolean(analysis && analysis.fingerprint === selectionFingerprint(legs));

  async function onAnalyze() {
    if (eligibility.status !== 'READY') return;
    setBusy(true);
    setError(null);
    try {
      const { buildX3fReplayContext, buildX3fReplayDeps } = await import('@/lib/parlay-xray/e2e/fixture');
      const result = runWorkspaceHistoricalAnalysis(legs, buildX3fReplayContext(), buildX3fReplayDeps());
      setAnalysis({ fingerprint: selectionFingerprint(legs), result });
      setShowingResults(true);
    } catch {
      setError('Historical analysis could not run for this selection.');
      setShowingResults(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ParlayWorkspaceView
      legs={legs}
      explorerHref={PROPS_HISTORICAL_PREVIEW_HREF}
      onRemove={(id) => setLegs((current) => removeSelectedLeg(current, id))}
      onClear={() => {
        setLegs([]);
        setAnalysis(null);
        setShowingResults(false);
      }}
      eligibility={eligibility}
      analysis={analysisCurrent ? analysis : null}
      analysisBusy={busy}
      analysisError={error}
      showingResults={showingResults && analysisCurrent}
      onAnalyze={onAnalyze}
      onShowReview={() => setShowingResults(false)}
      previewLabel="Historical Preview"
    />
  );
}
