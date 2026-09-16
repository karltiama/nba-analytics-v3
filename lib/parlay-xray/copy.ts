import type { AnalysisStatus, ContextReadLabel, ExtractionStatus, UploadErrorCode, XrayLegOutlook } from './types';

export const UPLOAD_ERROR_COPY: Record<UploadErrorCode, string> = {
  unsupported_file: 'That file type isn’t supported. Use a PNG, JPG, or WebP screenshot.',
  file_too_large: 'That screenshot is too large. Please use a file under 10 MB.',
  unreadable_screenshot: 'We couldn’t read that screenshot. Try a clearer, well-lit image of the full slip.',
  no_recognizable_legs: 'No parlay legs were recognizable in that screenshot.',
  partial_extraction: 'Some legs still need confirmation before analysis can run.',
  analysis_unavailable: 'Analysis isn’t available yet. Context scoring for this slip has not been connected.',
};

export const EXTRACTION_STAGE_COPY: Record<ExtractionStatus, string> = {
  idle: 'Waiting for a screenshot.',
  unavailable: 'Screenshot analysis is temporarily unavailable.',
  pending: 'Reading the screenshot…',
  partial: 'Some legs still need confirmation.',
  complete: 'Legs extracted. Review them before analysis.',
  failed: 'Extraction could not finish. The screenshot was not applied as a parlay.',
  no_legs: 'No recognizable legs were found.',
};

export const ANALYSIS_STAGE_COPY: Record<AnalysisStatus, string> = {
  idle: 'Analysis has not started.',
  unavailable: 'Analysis is unavailable until legs are extracted and confirmed.',
  pending: 'Building the XRay read…',
  ready: 'XRay analysis',
  failed: 'Analysis could not be completed for this slip.',
  insufficient_data: 'There is not enough confirmed context to analyze this slip.',
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
  if (env === 'production') return false;
  return flag === '1' || flag === 'partial' || flag === 'analysis';
}
