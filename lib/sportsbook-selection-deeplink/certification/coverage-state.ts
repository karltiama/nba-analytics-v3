/**
 * Classify why Level 3 is/isn't available for a book×market observation.
 */

import type { DeeplinkCoverageState } from './types';

export type CoverageClassifyInput = {
  /** Bookmaker object present in the event odds response. */
  bookPresent: boolean;
  /** Requested market key present under that bookmaker. */
  marketPresent: boolean;
  outcomeCount: number;
  outcomesWithSid: number;
  outcomesWithLink: number;
  /**
   * True when at least one outcome has a link that fails Court Context allowlist.
   * Only applied when links exist.
   */
  anyLinkAllowlistFailure?: boolean;
  allLinksAllowlistFailed?: boolean;
};

/**
 * Prefer the most specific failure reason that explains missing Level 3.
 * DEEPLINK_AVAILABLE when ≥1 outcome has a usable (or at least present) link
 * and not all links failed allowlist — allowlist rejections get their own state
 * when every link fails.
 */
export function classifyDeeplinkCoverageState(
  input: CoverageClassifyInput
): DeeplinkCoverageState {
  if (!input.bookPresent) return 'BOOK_ENTIRELY_ABSENT';
  if (!input.marketPresent) return 'BOOK_RETURNED_NO_MARKET';
  if (input.outcomeCount <= 0) return 'MARKET_NOT_RETURNED';

  if (input.outcomesWithLink > 0) {
    if (input.allLinksAllowlistFailed) return 'DEEPLINK_REJECTED_ALLOWLIST';
    return 'DEEPLINK_AVAILABLE';
  }

  if (input.outcomesWithSid > 0) return 'SID_NO_LINK';
  return 'OUTCOMES_RETURNED_NO_SID';
}
