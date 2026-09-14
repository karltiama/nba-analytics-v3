import { asRecord, pickNumber, pickString } from './normalize';
import type { MappedHistoryTarget } from './closing-odds-backfill';
import {
  OWLS_PAGE_LIMITS,
  OWLS_PATHS,
  OWLS_PUBLIC_BETTING_ARCHIVE_SCHEMA,
  OWLS_PUBLIC_BETTING_BACKFILL_CAPS,
} from './contract';

export const PUBLIC_BETTING_HISTORY_TARGET: MappedHistoryTarget = {
  endpoint: 'history_public_betting',
  path: OWLS_PATHS.historyPublicBetting,
  schema: OWLS_PUBLIC_BETTING_ARCHIVE_SCHEMA,
  maxProjectedRequests: OWLS_PUBLIC_BETTING_BACKFILL_CAPS.maxProjectedRequests,
  maxPagesPerGame: OWLS_PUBLIC_BETTING_BACKFILL_CAPS.maxPagesPerGame,
  maxConcurrency: OWLS_PUBLIC_BETTING_BACKFILL_CAPS.maxConcurrency,
  pageLimit: OWLS_PAGE_LIMITS.historyPublicBetting.max,
};

export const PUBLIC_BETTING_CAPTURE_TIMING = 'TIMING_UNKNOWN' as const;

export const PUBLIC_BETTING_MONEY_SHARE_PRESENT = false;

/** Missing percentages stay null. Never coerce absent values to 0. Provider 0 stays 0. */
export function pickPercent(record: Record<string, unknown>, keys: string[]): number | null {
  const n = pickNumber(record, keys);
  if (n == null || !Number.isFinite(n)) return null;
  return n;
}

export function classifyPublicMarket(value: unknown): 'MONEYLINE' | 'SPREAD' | 'TOTAL' | 'OTHER' | 'UNKNOWN' {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!raw) return 'UNKNOWN';
  if (raw === 'h2h' || raw.includes('moneyline') || raw === 'ml') return 'MONEYLINE';
  if (raw.includes('spread') || raw.includes('handicap')) return 'SPREAD';
  if (raw.includes('total') || raw === 'ou') return 'TOTAL';
  return 'OTHER';
}

export type TicketMoneyResearch = {
  market: ReturnType<typeof classifyPublicMarket>;
  side: string | null;
  betPct: number | null;
  moneyPct: number | null;
  ticketMoneyGap: number | null;
  absoluteTicketMoneyGap: number | null;
};

/** Descriptive only. Not a sharp/smart-money signal. Live public-betting rows do not expose money share. */
export function researchTicketMoney(raw: unknown): TicketMoneyResearch {
  const rec = asRecord(raw) ?? {};
  const betPct = pickPercent(rec, [
    'betPercent',
    'betPct',
    'betShare',
    'ticketsPercent',
    'ticketPercent',
    'betPercentage',
  ]);
  const moneyPct = pickPercent(rec, [
    'moneyPercent',
    'moneyPct',
    'moneyShare',
    'handlePercent',
    'moneyPercentage',
  ]);
  return {
    market: classifyPublicMarket(rec.market ?? rec.marketType ?? rec.type),
    side: pickString(rec, ['side', 'outcome', 'selection']),
    betPct,
    moneyPct,
    ticketMoneyGap: betPct != null && moneyPct != null ? moneyPct - betPct : null,
    absoluteTicketMoneyGap: betPct != null && moneyPct != null ? Math.abs(moneyPct - betPct) : null,
  };
}

export type PublicBettingLiveSides = {
  eventId: string | null;
  gameDate: string | null;
  hasMoneylineObject: boolean;
  hasSpreadObject: boolean;
  hasTotalObject: boolean;
  spreadHomePct: number | null;
  spreadAwayPct: number | null;
  totalOverPct: number | null;
  totalUnderPct: number | null;
  moneylineHomePct: number | null;
  moneylineAwayPct: number | null;
  hasMoneyShareField: boolean;
  allZeroSnapshot: boolean;
  majoritySpreadSide: 'home' | 'away' | 'tie' | null;
  majorityTotalSide: 'over' | 'under' | 'tie' | null;
};

function nestedHasMoneyShare(record: Record<string, unknown> | null): boolean {
  if (!record) return false;
  return [
    'moneyPct',
    'moneyPercent',
    'moneyShare',
    'handlePercent',
    'homeMoneyPct',
    'awayMoneyPct',
    'overMoneyPct',
    'underMoneyPct',
  ].some((k) => record[k] != null && record[k] !== '');
}

export function readLivePublicBettingRow(raw: unknown): PublicBettingLiveSides {
  const rec = asRecord(raw) ?? {};
  const spread = asRecord(rec.spread);
  const total = asRecord(rec.total);
  const moneyline = asRecord(rec.moneyline);
  const spreadHomePct = spread ? pickPercent(spread, ['homePct']) : null;
  const spreadAwayPct = spread ? pickPercent(spread, ['awayPct']) : null;
  const totalOverPct = total ? pickPercent(total, ['overPct']) : null;
  const totalUnderPct = total ? pickPercent(total, ['underPct']) : null;
  const moneylineHomePct = moneyline ? pickPercent(moneyline, ['homePct']) : null;
  const moneylineAwayPct = moneyline ? pickPercent(moneyline, ['awayPct']) : null;
  const numeric = [
    spreadHomePct,
    spreadAwayPct,
    totalOverPct,
    totalUnderPct,
    moneylineHomePct,
    moneylineAwayPct,
  ].filter((n): n is number => n != null);
  const hasMoneyShareField =
    nestedHasMoneyShare(rec) ||
    nestedHasMoneyShare(spread) ||
    nestedHasMoneyShare(total) ||
    nestedHasMoneyShare(moneyline);
  let majoritySpreadSide: PublicBettingLiveSides['majoritySpreadSide'] = null;
  if (spreadHomePct != null && spreadAwayPct != null) {
    majoritySpreadSide = spreadHomePct === spreadAwayPct ? 'tie' : spreadHomePct > spreadAwayPct ? 'home' : 'away';
  }
  let majorityTotalSide: PublicBettingLiveSides['majorityTotalSide'] = null;
  if (totalOverPct != null && totalUnderPct != null) {
    majorityTotalSide = totalOverPct === totalUnderPct ? 'tie' : totalOverPct > totalUnderPct ? 'over' : 'under';
  }
  return {
    eventId: pickString(rec, ['eventId']),
    gameDate: pickString(rec, ['gameDate']),
    hasMoneylineObject: moneyline != null,
    hasSpreadObject: spread != null,
    hasTotalObject: total != null,
    spreadHomePct,
    spreadAwayPct,
    totalOverPct,
    totalUnderPct,
    moneylineHomePct,
    moneylineAwayPct,
    hasMoneyShareField,
    allZeroSnapshot: numeric.length > 0 && numeric.every((n) => n === 0),
    majoritySpreadSide,
    majorityTotalSide,
  };
}

export function timestampKeysPresent(record: Record<string, unknown>): string[] {
  return [
    'timestamp',
    'capturedAt',
    'captured_at',
    'asOf',
    'as_of',
    'closeTime',
    'closedAt',
    'snapshotAt',
    'updatedAt',
    'gameDate',
  ].filter((k) => record[k] != null && record[k] !== '');
}

export function captureTimingClass(
  row: Record<string, unknown> | null
): 'PRETIP_TIMESTAMPED' | 'CLOSING_CONTEXT' | 'DATE_ONLY' | 'TIMING_UNKNOWN' {
  if (!row) return 'TIMING_UNKNOWN';
  const captureKeys = timestampKeysPresent(row).filter((k) => k !== 'gameDate');
  if (captureKeys.length > 0) return 'PRETIP_TIMESTAMPED';
  // gameDate is Owls midnight-UTC game identity, not a public-betting capture time.
  return 'TIMING_UNKNOWN';
}
