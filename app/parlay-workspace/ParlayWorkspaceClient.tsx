'use client';

import { useMemo, useState } from 'react';
import { ParlayWorkspaceView } from '@/components/parlay-workspace/ParlayWorkspaceView';
import { selectionSourceContext } from '@/lib/parlay/selection';
import { useParlaySelection } from '@/lib/parlay/use-parlay-selection';
import {
  evaluateWorkspaceAnalysisEligibility,
  runWorkspaceHistoricalAnalysis,
  selectionFingerprint,
} from '@/lib/parlay/workspace-analysis';
import { PARLAY_WORKSPACE_ANALYSIS_STARTED } from '@/lib/product-analytics/parlay-xray-events';
import { trackEvent } from '@/lib/product-analytics/track-event';

export function ParlayWorkspaceClient() {
  const { legs, analysis, explorerReturnHref, removeLeg, clear, setAnalysis, editedAfterXrayImport } =
    useParlaySelection();
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
      trackEvent(PARLAY_WORKSPACE_ANALYSIS_STARTED, {
        surface: 'parlay_workspace',
        source: selectionSourceContext(legs),
        action: 'analysis_started',
      });
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
      explorerHref={explorerReturnHref}
      onRemove={removeLeg}
      onClear={clear}
      eligibility={eligibility}
      analysis={analysisCurrent ? analysis : null}
      analysisBusy={busy}
      analysisError={error}
      showingResults={showingResults && analysisCurrent}
      onAnalyze={onAnalyze}
      onShowReview={() => setShowingResults(false)}
      editedAfterXrayImport={editedAfterXrayImport}
    />
  );
}
