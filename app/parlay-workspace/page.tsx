import { Suspense } from 'react';
import { ParlayWorkspaceEntry } from './ParlayWorkspaceEntry';
import { isWorkspaceCurrentAnalysisEnabled } from '@/lib/parlay/workspace-current-analysis-flag';
import { isXrayExtractionLive } from '@/lib/parlay-xray/extraction/config';

// Reads the current-props analysis flag per request.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Parlay Workspace · Court Context',
  description: 'Review selected props together with Court Context analysis in Parlay Workspace.',
};

export default function ParlayWorkspacePage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-xl px-4 py-12 text-sm text-[#4a6366]">Loading workspace…</main>}>
      <ParlayWorkspaceEntry
        currentAnalysisEnabled={isWorkspaceCurrentAnalysisEnabled(process.env)}
        xrayImportAvailable={isXrayExtractionLive()}
      />
    </Suspense>
  );
}
