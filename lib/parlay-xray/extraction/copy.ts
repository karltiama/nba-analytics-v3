import type { XrayExtractResult } from './result-codes';

/** User-facing copy. Never mention OpenAI, keys, billing, or internal quota tables. */
export const XRAY_EXTRACT_MESSAGE: Record<XrayExtractResult, string> = {
  SUCCESS: 'Legs extracted. Review them before analysis.',
  PARTIAL: 'Some legs still need confirmation before analysis can run.',
  NO_LEGS_FOUND: 'No parlay legs were recognizable in that screenshot.',
  NEEDS_CONFIRMATION: 'Some legs still need confirmation before analysis can run.',
  UNREADABLE_IMAGE: 'We couldn’t read that screenshot. Try a clearer, well-lit image of the full slip.',
  RATE_LIMITED: 'Please wait a moment before analyzing another screenshot.',
  USER_QUOTA_EXCEEDED: "You've used today's XRay analyses. Try again tomorrow.",
  GLOBAL_QUOTA_EXCEEDED: 'Parlay XRay is temporarily at capacity. Try again later.',
  EXTRACTION_DISABLED: 'Screenshot analysis is temporarily unavailable.',
  AUTH_REQUIRED: 'Sign in to analyze a screenshot.',
  PROVIDER_UNAVAILABLE: 'Screenshot analysis is temporarily unavailable. Try again later.',
  INTERNAL_ERROR: 'Screenshot analysis could not finish. Try again later.',
  IN_FLIGHT: 'An analysis is already in progress. Wait for it to finish.',
};

/** Used when document_type is NOT_BET_SLIP or UNCERTAIN. Do not expose provider internals. */
export const XRAY_NON_SLIP_MESSAGE =
  "This image doesn't clearly appear to be a betting slip.";

export function quotaRemainingLabel(used: number, limit: number): string {
  const remaining = Math.max(0, limit - used);
  return `${remaining} of ${limit} XRay analyses remaining today`;
}
