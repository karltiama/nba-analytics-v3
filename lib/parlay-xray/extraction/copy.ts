import type { XrayExtractResult } from './result-codes';

/** User-facing copy. Never mention OpenAI, keys, billing, or internal quota tables. */
export const XRAY_EXTRACT_MESSAGE: Record<XrayExtractResult, string> = {
  SUCCESS: 'Legs extracted. Review them before you confirm.',
  PARTIAL: 'Some legs still need confirmation before you continue.',
  NO_LEGS_FOUND: 'No parlay legs were recognizable in that screenshot.',
  NEEDS_CONFIRMATION: 'Some legs still need confirmation before you continue.',
  UNREADABLE_IMAGE: 'We couldn’t read that screenshot. Try a clearer, well-lit image of the full slip.',
  RATE_LIMITED: 'Please wait a moment before reading another screenshot.',
  USER_QUOTA_EXCEEDED: "You've used today's screenshot reads. Try again tomorrow.",
  GLOBAL_QUOTA_EXCEEDED: 'Parlay XRay is temporarily at capacity. Try again later.',
  EXTRACTION_DISABLED: 'Screenshot reading is temporarily unavailable.',
  AUTH_REQUIRED: 'Sign in to upload a screenshot.',
  PROVIDER_UNAVAILABLE: 'Screenshot reading is temporarily unavailable. Try again later.',
  INTERNAL_ERROR: 'Screenshot reading could not finish. Try again later.',
  IN_FLIGHT: 'A screenshot read is already in progress. Wait for it to finish.',
};

/** Used when document_type is NOT_BET_SLIP or UNCERTAIN. Do not expose provider internals. */
export const XRAY_NON_SLIP_MESSAGE =
  "This image doesn't clearly appear to be a betting slip.";

export function quotaRemainingLabel(used: number, limit: number): string {
  const remaining = Math.max(0, limit - used);
  return `${remaining} of ${limit} screenshot reads remaining today`;
}
