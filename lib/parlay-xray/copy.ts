import type { AnalysisStatus, ContextReadLabel, ExtractionStatus, UploadErrorCode, XrayLegOutlook } from './types';

export const UPLOAD_ERROR_COPY: Record<UploadErrorCode, string> = {
  unsupported_file: 'That file type isn’t supported. Use a PNG, JPG, or WebP screenshot.',
  file_too_large: 'That screenshot is too large. Please use a file under 10 MB.',
  unreadable_screenshot: 'We couldn’t read that screenshot. Try a clearer, well-lit image of the full slip.',
  no_recognizable_legs: 'No parlay legs were recognizable in that screenshot.',
  partial_extraction: 'Some legs still need confirmation before you continue.',
  analysis_unavailable: 'Court Context analysis is not available on this page. Confirm legs, then review them in Workspace.',
};

export const EXTRACTION_STAGE_COPY: Record<ExtractionStatus, string> = {
  idle: 'Waiting for a screenshot.',
  unavailable: 'Screenshot reading is temporarily unavailable.',
  pending: 'Reading your screenshot…',
  partial: 'Some legs still need confirmation.',
  complete: 'Legs extracted. Review them before you confirm.',
  failed: 'Extraction could not finish. The screenshot was not applied as a parlay.',
  no_legs: 'No recognizable legs were found.',
};

export const ANALYSIS_STAGE_COPY: Record<AnalysisStatus, string> = {
  idle: 'Confirm legs to review them in Workspace.',
  unavailable: 'Workspace review is unavailable until legs are extracted and confirmed.',
  pending: 'Resolving confirmed legs…',
  ready: 'Confirmed legs are ready for Workspace.',
  failed: 'These confirmed legs could not be handed to Workspace.',
  insufficient_data: 'There is not enough confirmed context to continue.',
};

export const CONTEXT_READ_COPY: Record<ContextReadLabel, string> = {
  strong_support: 'Strong support',
  mixed_evidence: 'Mixed evidence',
  limited_sample: 'Limited sample',
  elevated_risk: 'Elevated risk',
  data_unavailable: 'Data unavailable',
};

export const LEG_OUTLOOK_COPY: Record<XrayLegOutlook, string> = {
  favorable_context: 'Favorable context',
  mixed: 'Mixed',
  elevated_risk: 'Elevated risk',
  limited_data: 'Limited data',
  unavailable: 'Unavailable',
};

export const LINE_WHOLE_NUMBER_HINT =
  'Confirm the line. Player props are usually X.5.';

export function isXrayDesignPreviewEnabled(
  flag: string | null | undefined,
  env: string | undefined = process.env.NODE_ENV
): boolean {
  if (flag === 'replay') return true;
  if (env === 'production') return false;
  return flag === '1' || flag === 'partial' || flag === 'analysis';
}

export const REPLAY_STAGE_COPY: Record<NonNullable<import('./session').XrayReplayStage>, string> = {
  resolving: 'Resolving confirmed legs…',
  matching: 'Matching historical market rows…',
  assembling_context: 'Loading historical context as of the certified cutoff…',
  interpreting: 'Preparing Workspace handoff…',
  ready: 'Confirmed. Review this parlay in Workspace.',
  failed: 'Historical replay could not be assembled. Confirmed legs were not dropped.',
};
