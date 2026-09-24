/**
 * Production Level-3 promotion gates (assessment only — no auto-promote).
 */

import type { Level3ProviderReady, PerBookSummary } from './types';

export type GateEvidence = {
  liveOddsObserved: boolean;
  exactResolutionVerified: boolean;
  outcomeLinkReturned: boolean;
  allowlistPasses: boolean;
  multipleGames: boolean;
  multipleProbeRuns: boolean;
  fallbackRemainsFunctional: boolean;
  noUrlSynthesisRequired: boolean;
};

export function assessLevel3ProviderReady(evidence: GateEvidence): {
  ready: Level3ProviderReady;
  notes: string[];
} {
  const notes: string[] = [];
  const checks: Array<[keyof GateEvidence, string]> = [
    ['liveOddsObserved', 'live odds observed'],
    ['exactResolutionVerified', 'exact canonical resolution verified'],
    ['outcomeLinkReturned', 'outcome.link returned by provider'],
    ['allowlistPasses', 'URL allowlist passes'],
    ['multipleGames', 'behavior across multiple games'],
    ['multipleProbeRuns', 'behavior across more than one probe/run'],
    ['fallbackRemainsFunctional', 'Phase 3 homepage fallback remains'],
    ['noUrlSynthesisRequired', 'no manual sportsbook URL synthesis'],
  ];

  let failed = 0;
  let insufficient = 0;
  for (const [key, label] of checks) {
    if (!evidence[key]) {
      notes.push(`FAIL: ${label}`);
      if (key === 'multipleGames' || key === 'multipleProbeRuns') insufficient += 1;
      else failed += 1;
    } else {
      notes.push(`PASS: ${label}`);
    }
  }

  if (failed === 0 && insufficient === 0) return { ready: 'YES', notes };
  if (failed === 0 && insufficient > 0) return { ready: 'INSUFFICIENT_SAMPLE', notes };
  return { ready: 'NO', notes };
}

export function gateEvidenceFromBookSummary(
  book: Pick<
    PerBookSummary,
    | 'bookPresentEvents'
    | 'outcomesWithLink'
    | 'outcomesAllowlisted'
    | 'exactResolverSuccess'
    | 'deeplinkResolverSuccess'
    | 'eventsObserved'
  >,
  extras: {
    multipleProbeRuns: boolean;
    fallbackRemainsFunctional?: boolean;
    noUrlSynthesisRequired?: boolean;
  }
): GateEvidence {
  return {
    liveOddsObserved: book.bookPresentEvents > 0 && book.outcomesWithLink + book.exactResolverSuccess >= 0
      ? book.bookPresentEvents > 0
      : false,
    exactResolutionVerified: book.exactResolverSuccess > 0,
    outcomeLinkReturned: book.outcomesWithLink > 0,
    allowlistPasses: book.outcomesWithLink > 0 && book.outcomesAllowlisted > 0,
    multipleGames: book.bookPresentEvents >= 2,
    multipleProbeRuns: extras.multipleProbeRuns,
    fallbackRemainsFunctional: extras.fallbackRemainsFunctional !== false,
    noUrlSynthesisRequired: extras.noUrlSynthesisRequired !== false,
  };
}

/** Refine: liveOddsObserved should mean outcomes actually present, not just book shell. */
export function gateEvidenceFromBookSummaryStrict(
  book: PerBookSummary,
  extras: {
    multipleProbeRuns: boolean;
    fallbackRemainsFunctional?: boolean;
    noUrlSynthesisRequired?: boolean;
  }
): GateEvidence {
  return {
    liveOddsObserved: book.outcomeCount > 0,
    exactResolutionVerified: book.exactResolverSuccess > 0,
    outcomeLinkReturned: book.outcomesWithLink > 0,
    allowlistPasses:
      book.outcomesWithLink > 0 && book.outcomesAllowlisted === book.outcomesWithLink
        ? true
        : book.outcomesAllowlisted > 0 && book.outcomesWithLink > 0,
    multipleGames: book.propMarketPresentEvents >= 2,
    multipleProbeRuns: extras.multipleProbeRuns,
    fallbackRemainsFunctional: extras.fallbackRemainsFunctional !== false,
    noUrlSynthesisRequired: extras.noUrlSynthesisRequired !== false,
  };
}
