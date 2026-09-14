import { STOP_CONDITION_DEFAULTS } from './contract';
import { coverageCounts } from './normalize';
import type { NormalizedOwlsPropRow, ValidationReport } from './types';

export type StopInputs = {
  gamesRequested: number;
  gamesMatched: number;
  gamesAmbiguous: number;
  playerMatchRate: number;
  corePropsPresent: number;
  pricesPresent: boolean;
  consecutive429: number;
  consecutive503: number;
  archiveFailures: number;
  paginationAnomaly: boolean;
  historyShallowerThanDocumented?: boolean;
};

export type StopEvaluation = {
  stop: boolean;
  reasons: string[];
  requireApprovalForBulk: boolean;
};

export function evaluateStopConditions(
  input: StopInputs,
  defaults = STOP_CONDITION_DEFAULTS
): StopEvaluation {
  const reasons: string[] = [];
  const eventMatchRate = input.gamesRequested > 0 ? input.gamesMatched / input.gamesRequested : 0;
  if (input.gamesRequested > 0 && eventMatchRate < defaults.minEventMatchRate) {
    reasons.push(`event match rate ${eventMatchRate.toFixed(3)} < ${defaults.minEventMatchRate}`);
  }
  if (input.gamesAmbiguous > 0) {
    reasons.push(`${input.gamesAmbiguous} ambiguous game(s) — never auto-chosen`);
  }
  if (input.playerMatchRate < defaults.minPlayerMatchRate) {
    reasons.push(`player match rate ${input.playerMatchRate.toFixed(3)} < ${defaults.minPlayerMatchRate}`);
  }
  if (input.corePropsPresent < defaults.minCorePropTypes) {
    reasons.push(`core prop types present ${input.corePropsPresent} < ${defaults.minCorePropTypes}`);
  }
  if (defaults.requirePrices && !input.pricesPresent) {
    reasons.push('prices are absent');
  }
  if (input.consecutive429 >= defaults.maxConsecutive429) {
    reasons.push(`repeated 429s (${input.consecutive429})`);
  }
  if (input.consecutive503 >= defaults.maxConsecutive503) {
    reasons.push(`repeated 503s (${input.consecutive503})`);
  }
  if (input.archiveFailures > 0) {
    reasons.push(`archive verification failures: ${input.archiveFailures}`);
  }
  if (input.paginationAnomaly) {
    reasons.push('pagination behavior differs from documented limit/offset exhaustion');
  }
  if (input.historyShallowerThanDocumented) {
    reasons.push('history is shallower than documented (NBA player props from 2022-23)');
  }
  return {
    stop: reasons.length > 0,
    reasons,
    requireApprovalForBulk: true,
  };
}

export function buildValidationReport(args: {
  runId: string;
  phase: number;
  gamesRequested: number;
  gamesReturned: number;
  gamesMatched: number;
  gamesAmbiguous: number;
  gamesUnmatched: number;
  rows: NormalizedOwlsPropRow[];
  apiRequests: number;
  retries: number;
  status429: number;
  status503: number;
  s3Objects: number;
  checksumFailures: number;
  archiveFailures: number;
  stopReasons: string[];
}): ValidationReport {
  const players = new Map<string, NormalizedOwlsPropRow['player_match']>();
  for (const row of args.rows) {
    const key = row.provider_player_id ?? row.provider_player_name ?? 'unknown';
    if (!players.has(key)) players.set(key, row.player_match);
  }
  const playerStatuses = [...players.values()];
  const books = [...new Set(args.rows.map((r) => r.book).filter((x): x is string => Boolean(x)))].sort();
  const propTypes = [...new Set(args.rows.map((r) => r.prop_type).filter((x): x is string => Boolean(x)))].sort();
  const coverage = coverageCounts(args.rows);
  return {
    run_id: args.runId,
    phase: args.phase,
    games_requested: args.gamesRequested,
    games_returned: args.gamesReturned,
    games_matched: args.gamesMatched,
    games_ambiguous: args.gamesAmbiguous,
    games_unmatched: args.gamesUnmatched,
    players_returned: players.size,
    players_matched: playerStatuses.filter((s) => s === 'MATCHED').length,
    players_ambiguous: playerStatuses.filter((s) => s === 'AMBIGUOUS').length,
    players_unmatched: playerStatuses.filter((s) => s === 'UNMATCHED').length,
    prop_rows: args.rows.length,
    books,
    prop_types: propTypes,
    coverage,
    opening_availability: args.rows.filter((r) => r.opening_line != null).length,
    closing_availability: args.rows.filter((r) => r.closing_line != null).length,
    price_availability: args.rows.filter((r) => r.american_odds != null || r.decimal_odds != null).length,
    api_requests: args.apiRequests,
    retries: args.retries,
    status_429: args.status429,
    status_503: args.status503,
    s3_objects: args.s3Objects,
    checksum_failures: args.checksumFailures,
    archive_failures: args.archiveFailures,
    stop_reasons: args.stopReasons,
  };
}
