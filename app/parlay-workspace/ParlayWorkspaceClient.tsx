'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ParlayWorkspaceView } from '@/components/parlay-workspace/ParlayWorkspaceView';
import { selectionSourceContext } from '@/lib/parlay/selection';
import { replaceParlaySelectionLegs } from '@/lib/parlay/selection-store';
import { useParlaySelection } from '@/lib/parlay/use-parlay-selection';
import {
  evaluateWorkspaceAnalysisEligibility,
  runWorkspaceHistoricalAnalysis,
  selectionFingerprint,
} from '@/lib/parlay/workspace-analysis';
import { completeChecklistItem } from '@/lib/onboarding/progress';
import { shouldSuppressProductPreviewAnalytics } from '@/lib/parlay/preview-fixture';
import { PARLAY_WORKSPACE_ANALYSIS_STARTED } from '@/lib/product-analytics/parlay-xray-events';
import { trackEvent } from '@/lib/product-analytics/track-event';

function previewFlagFromWindow(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URLSearchParams(window.location.search).get('preview');
  } catch {
    return null;
  }
}

export function ParlayWorkspaceClient({
  currentAnalysisEnabled = false,
  xrayImportAvailable,
}: {
  currentAnalysisEnabled?: boolean;
  xrayImportAvailable?: boolean;
}) {
  const { legs, analysis, explorerReturnHref, removeLeg, clear, setAnalysis, editedAfterXrayImport } =
    useParlaySelection();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightFingerprint = useRef<string | null>(null);
  // Auto-analysis does not retry a slip that just failed; "Try again" clears this.
  const failedFingerprint = useRef<string | null>(null);
  const eligibility = useMemo(
    () => evaluateWorkspaceAnalysisEligibility(legs, { currentAnalysisEnabled }),
    [legs, currentAnalysisEnabled]
  );
  const fingerprint = useMemo(() => selectionFingerprint(legs), [legs]);
  const analysisCurrent = Boolean(analysis && analysis.fingerprint === fingerprint);

  async function runAnalyze() {
    if (eligibility.status !== 'READY') return;
    if (inFlightFingerprint.current === fingerprint) return;
    inFlightFingerprint.current = fingerprint;
    setBusy(true);
    setError(null);
    try {
      if (!shouldSuppressProductPreviewAnalytics(previewFlagFromWindow())) {
        trackEvent(PARLAY_WORKSPACE_ANALYSIS_STARTED, {
          surface: 'parlay_workspace',
          source: selectionSourceContext(legs),
          action: 'analysis_started',
        });
      }
      let result;
      if (eligibility.mode === 'current') {
        // Today's props: context from the DB as of now. No projections, no fixture.
        const { runWorkspaceCurrentAnalysis } = await import('@/lib/parlay/workspace-current-analysis-client');
        result = await runWorkspaceCurrentAnalysis(legs);
      } else {
        const { buildX3fReplayContext, buildX3fReplayDeps } = await import('@/lib/parlay-xray/e2e/fixture');
        result = runWorkspaceHistoricalAnalysis(legs, buildX3fReplayContext(), buildX3fReplayDeps());
      }
      setAnalysis({ fingerprint, result });
      completeChecklistItem('workspace_analyzed');
    } catch {
      failedFingerprint.current = fingerprint;
      setError(
        eligibility.status === 'READY' && eligibility.mode === 'current'
          ? 'Court Context could not load current context for this selection.'
          : 'Historical analysis could not run for this selection.'
      );
    } finally {
      if (inFlightFingerprint.current === fingerprint) inFlightFingerprint.current = null;
      setBusy(false);
    }
  }

  useEffect(() => {
    if (failedFingerprint.current === fingerprint) return;
    if (eligibility.status !== 'READY') return;
    if (analysisCurrent || busy) return;
    void runAnalyze();
    // Intentionally keyed to slip identity + eligibility, not runAnalyze identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, eligibility.status, analysisCurrent, busy]);

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
      showingResults={analysisCurrent}
      onAnalyze={() => {
        failedFingerprint.current = null;
        void runAnalyze();
      }}
      editedAfterXrayImport={editedAfterXrayImport}
      xrayImportAvailable={xrayImportAvailable}
      onReplaceQuickBuild={(next) => {
        replaceParlaySelectionLegs(next);
      }}
    />
  );
}
