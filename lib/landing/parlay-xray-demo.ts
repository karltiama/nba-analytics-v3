/**
 * Static marketing demo for the landing Parlay XRay preview.
 * Reuses the design-preview fixture so the UI matches /parlay-xray?preview=1.
 * Illustration only — not a live screenshot read or current-season analysis.
 */

import { ANALYSIS_STAGE_COPY, EXTRACTION_STAGE_COPY } from '@/lib/parlay-xray/copy';
import { buildFullPreviewFixture } from '@/lib/parlay-xray/dev-fixture';
import { liveCombinedOdds } from '@/lib/parlay-xray/session';
import { detectStructuralDependencies } from '@/lib/parlay-xray/structural';
import type { StructuralDependency, XRayAnalysis, XRayParlay } from '@/lib/parlay-xray/types';

export type LandingParlayXrayDemo = {
  parlay: XRayParlay;
  analysis: XRayAnalysis;
  combinedOdds: number | null;
  structural: StructuralDependency[];
  extractionStatusLabel: string;
  analysisStageCopy: string;
};

export function getLandingParlayXrayDemo(): LandingParlayXrayDemo {
  const { parlay, analysis } = buildFullPreviewFixture();
  return {
    parlay,
    analysis,
    combinedOdds: liveCombinedOdds(parlay.legs),
    structural: detectStructuralDependencies(parlay.legs),
    extractionStatusLabel: EXTRACTION_STAGE_COPY[parlay.extractionStatus],
    analysisStageCopy:
      'Illustration only — same layout as Parlay XRay design preview, not a live screenshot read.',
  };
}

/** Stage copy matching the confirmed design-preview flow on /parlay-xray. */
export const LANDING_XRAY_STAGE_STEPS = [
  { label: 'Upload.', detail: 'Screenshot selected.' },
  { label: 'Review.', detail: EXTRACTION_STAGE_COPY.complete },
  { label: 'Confirm.', detail: 'Confirmed. Current-season Court Context analysis is not enabled yet.' },
  { label: 'Workspace.', detail: 'Parlay Workspace is where you examine the slip as a whole.' },
] as const;

export const LANDING_XRAY_ANALYSIS_FALLBACK = ANALYSIS_STAGE_COPY.ready;
