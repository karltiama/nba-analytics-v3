import { formatAmericanOdds } from '@/lib/betting/market-movement-format';
import type { CanonicalPropType } from '@/lib/betting/market-movement';
import { XRAY_PROP_KIND_LABEL, type XrayPropKind } from '@/lib/parlay-xray/types';
import type {
  FormLineRead,
  InterpretationSummaryState,
  MarketPositionKind,
  SampleBand,
  XRayLegInterpretation,
} from './types';
import { SUMMARY_STATE_COPY } from './types';
import type { ParlayDependencyKind, ParlayReviewFlag } from './parlay-types';

const BOOK_LABELS: Record<string, string> = {
  draftkings: 'DraftKings',
  fanduel: 'FanDuel',
  betmgm: 'BetMGM',
  caesars: 'Caesars',
  fanatics: 'Fanatics',
};

export function formatSportsbookLabel(book: string | null): string {
  if (!book) return 'Unknown sportsbook';
  return BOOK_LABELS[book.toLowerCase()] ?? book;
}

export function formatMarketLabel(market: CanonicalPropType | null): string {
  if (!market) return 'Unknown market';
  if (market in XRAY_PROP_KIND_LABEL) return XRAY_PROP_KIND_LABEL[market as XrayPropKind];
  return market.split('_').join(' ');
}

export function formatAvg(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return (Math.round(value * 10) / 10).toFixed(1);
}

export function formatLineSnapshot(line: number | null, odds: number | null): string {
  if (line == null) return 'Unavailable';
  const oddsLabel = odds == null ? '' : ` (${formatAmericanOdds(odds)})`;
  return `${line}${oddsLabel}`;
}

export function marketPositionLabel(kind: MarketPositionKind): string {
  switch (kind) {
    case 'BETTER_NUMBER_THAN_CLOSE':
      return 'Better number than close';
    case 'SAME_AS_CLOSE':
      return 'Same as Decision Close';
    case 'WORSE_NUMBER_THAN_CLOSE':
      return 'Worse number than close';
    default:
      return 'Close unavailable';
  }
}

export function formLineReadLabel(read: FormLineRead): string {
  switch (read) {
    case 'ABOVE_MORE_OFTEN_THAN_BELOW':
      return 'Above more often';
    case 'BELOW_MORE_OFTEN_THAN_ABOVE':
      return 'Below more often';
    case 'EVEN_SPLIT':
      return 'Even split';
    default:
      return 'Limited sample';
  }
}

export function sampleBandLabel(band: SampleBand): string {
  switch (band) {
    case 'ZERO':
      return 'No prior games';
    case 'SMALL_SAMPLE':
      return 'Small sample';
    case 'PARTIAL_SAMPLE':
      return 'Partial sample';
    default:
      return 'Recent window';
  }
}

export function coverageLabel(status: XRayLegInterpretation['dataAvailability']['market']): string {
  if (status === 'AVAILABLE') return 'Matched';
  if (status === 'LIMITED') return 'Partial';
  if (status === 'NEEDS_CONFIRMATION') return 'Needs confirmation';
  return 'Unavailable';
}

export function roleMinutesLabel(kind: XRayLegInterpretation['role']['minutesVsSeason']): string {
  if (kind === 'ABOVE') return 'Above season MPG';
  if (kind === 'BELOW') return 'Below season MPG';
  if (kind === 'NEAR') return 'Near season MPG';
  return 'Minutes incomplete';
}

export function matchupCoverageLabel(interp: XRayLegInterpretation): string {
  return interp.matchup.opponentPace != null || interp.matchup.teamPace != null ? 'Available' : 'Unavailable';
}

export function dataCoverageLabel(interp: XRayLegInterpretation): string {
  const missing = [
    interp.dataAvailability.wowy !== 'AVAILABLE',
    interp.dataAvailability.projection !== 'AVAILABLE',
    interp.dataAvailability.availability !== 'AVAILABLE',
  ].filter(Boolean).length;
  if (missing === 0) return 'Complete';
  if (missing === 3) return 'Gaps present';
  return 'Partial gaps';
}

export function summaryStateLabel(state: InterpretationSummaryState): string {
  return SUMMARY_STATE_COPY[state];
}

export function unitForMarket(market: CanonicalPropType | null): string {
  switch (market) {
    case 'points':
      return 'PPG';
    case 'rebounds':
      return 'RPG';
    case 'assists':
      return 'APG';
    case 'threes':
      return '3PM';
    default:
      return 'per game';
  }
}

export function parlayReviewFlagLabel(flag: ParlayReviewFlag): string {
  switch (flag) {
    case 'NEEDS_IDENTITY_CONFIRMATION':
      return 'Needs identity confirmation';
    case 'PARTIAL_MARKET_MATCH':
      return 'Partial market match';
    case 'LIMITED_SAMPLE':
      return 'Limited sample';
    case 'MISSING_CONTEXT':
      return 'Missing context';
    case 'COUNTERSIGNALS_PRESENT':
      return 'Countersignals present';
  }
}

export function parlayDependencyKindLabel(kind: ParlayDependencyKind): string {
  switch (kind) {
    case 'SHARED_PLAYER':
      return 'Same player';
    case 'SHARED_GAME':
      return 'Same game';
    case 'SHARED_TEAM':
      return 'Same team';
    case 'SHARED_OPPONENT':
      return 'Same opponent';
    case 'SHARED_GAME_ENVIRONMENT':
      return 'Shared game environment';
    case 'SHARED_ROLE_ASSUMPTION':
      return 'Shared role context';
    case 'DUPLICATE_LEG':
      return 'Duplicate leg';
    case 'NEAR_DUPLICATE_LEG':
      return 'Near-duplicate leg';
    case 'OPPOSITE_SIDE_SAME_MARKET':
      return 'Opposite side, same market';
    case 'LOGICAL_CONFLICT':
      return 'Logical conflict';
  }
}
