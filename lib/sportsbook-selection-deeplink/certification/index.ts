/**
 * Phase 4B certification helpers (read-only Level-3 coverage).
 */

export { CERT_MARKETS, DEEPLINK_COVERAGE_STATES, TIME_TO_TIP_BUCKETS } from './types';
export type {
  AccessLimitation,
  BucketCounters,
  CertMarketKey,
  DeeplinkCoverageState,
  EventObservation,
  FanDuelCertificationSummary,
  Level3CertificationReport,
  Level3ProviderReady,
  LinkValidityRecord,
  MarketObservation,
  OutcomeObservation,
  PerBookSummary,
  ResolutionProbe,
  SidStabilityPair,
  TimeToTipBucket,
} from './types';

export {
  classifyTimeToTipBucket,
  hoursUntilCommence,
  isFutureTipBucket,
  listTimeToTipBuckets,
} from './time-to-tip';

export { classifyDeeplinkCoverageState } from './coverage-state';
export { maskUrlShape, validateOutcomeLink } from './link-validity';
export {
  ODDS_API_DOCUMENTED_PAID_BOOKS,
  documentedAccessLimitation,
  resolveAccessLimitation,
} from './access';
export { buildSidStabilityPair } from './sid-stability';
export {
  assessLevel3ProviderReady,
  gateEvidenceFromBookSummaryStrict,
} from './gates';
export { assertNoSecretsInReport, stripApiKeyFromUrl } from './sanitize';
export { observeBookMarket } from './observe';
export { aggregateCertificationReport } from './aggregate';
export { runLevel3Certification } from './run-certification';
export type { CertificationRunOptions } from './run-certification';
export { certMarketToCanonical } from './market-reverse';
export { formatCertificationMarkdown } from './format-markdown';
