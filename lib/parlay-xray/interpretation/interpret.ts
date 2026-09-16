import type { CanonicalPropType } from '@/lib/betting/market-movement';
import type { ParlayLegSide } from '@/lib/parlay-xray/types';
import type { XRayLegContext } from '@/lib/parlay-xray/context/types';
import type {
  FormLineRead,
  InterpretationCode,
  InterpretationEvidence,
  InterpretationSummaryState,
  MarketPositionKind,
  SampleBand,
  XRayInterpretationParlaySummary,
  XRayLegInterpretation,
} from './types';

const LINE_EPS = 1e-9;
const MINUTES_MATERIAL = 5;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function lineLess(a: number, b: number): boolean {
  return a < b - LINE_EPS;
}

function lineEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < LINE_EPS;
}

function marketWord(market: CanonicalPropType | null): string {
  switch (market) {
    case 'points':
      return 'points';
    case 'rebounds':
      return 'rebounds';
    case 'assists':
      return 'assists';
    case 'threes':
      return 'threes';
    case 'points_rebounds':
      return 'points+rebounds';
    case 'points_assists':
      return 'points+assists';
    case 'rebounds_assists':
      return 'rebounds+assists';
    case 'points_rebounds_assists':
      return 'PRA';
    default:
      return 'this market';
  }
}

function avgLabel(market: CanonicalPropType | null): string {
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

function sideLabel(side: ParlayLegSide | null): string {
  if (side === 'under') return 'Under';
  if (side === 'over') return 'Over';
  return 'this side';
}

function evidence(
  code: InterpretationCode,
  category: InterpretationEvidence['category'],
  title: string,
  detail: string
): InterpretationEvidence {
  return { code, category, title, detail };
}

export function marketPositionKind(
  side: ParlayLegSide | null,
  requested: number | null,
  close: number | null
): MarketPositionKind {
  if (requested == null || close == null || !Number.isFinite(requested) || !Number.isFinite(close)) {
    return 'UNKNOWN';
  }
  if (lineEqual(requested, close)) return 'SAME_AS_CLOSE';
  if (side === 'under') {
    return lineLess(close, requested) ? 'BETTER_NUMBER_THAN_CLOSE' : 'WORSE_NUMBER_THAN_CLOSE';
  }
  return lineLess(requested, close) ? 'BETTER_NUMBER_THAN_CLOSE' : 'WORSE_NUMBER_THAN_CLOSE';
}

export function sampleBandFor(count: number): SampleBand {
  if (count <= 0) return 'ZERO';
  if (count <= 4) return 'SMALL_SAMPLE';
  if (count <= 9) return 'PARTIAL_SAMPLE';
  return 'WINDOW_AVAILABLE';
}

export function formLineRead(above: number, below: number, sample: number): FormLineRead {
  if (sample < 5) return 'LIMITED_SAMPLE';
  if (above === below) return 'EVEN_SPLIT';
  return above > below ? 'ABOVE_MORE_OFTEN_THAN_BELOW' : 'BELOW_MORE_OFTEN_THAN_ABOVE';
}

function coverageStatus(
  status: XRayLegContext['wowy']['status']
): 'UNAVAILABLE' | 'AVAILABLE' | 'LIMITED' {
  if (status === 'AVAILABLE') return 'AVAILABLE';
  if (status === 'LIMITED' || status === 'NEEDS_CONFIRMATION') return 'LIMITED';
  return 'UNAVAILABLE';
}

function minutesVsSeason(prior: number | null, season: number | null): XRayLegInterpretation['role']['minutesVsSeason'] {
  if (prior == null || season == null) return 'UNKNOWN';
  const delta = prior - season;
  if (delta >= MINUTES_MATERIAL) return 'ABOVE';
  if (delta <= -MINUTES_MATERIAL) return 'BELOW';
  return 'NEAR';
}

function summaryState(
  supporting: InterpretationEvidence[],
  counter: InterpretationEvidence[],
  sample: number
): InterpretationSummaryState {
  if (sample <= 0) return 'LIMITED_DATA';
  if (sample < 5 && supporting.length === 0 && counter.length === 0) return 'LIMITED_DATA';
  if (counter.length > 0 && supporting.length === 0) return 'COUNTERSIGNALS_PRESENT';
  if (supporting.length > 0 && counter.length > 0) return 'MIXED_CONTEXT';
  if (supporting.length > 0) return 'SUPPORTIVE_CONTEXT';
  if (sample < 5) return 'LIMITED_DATA';
  return 'NEUTRAL_CONTEXT';
}

function summarySentence(
  state: InterpretationSummaryState,
  supporting: InterpretationEvidence[],
  counter: InterpretationEvidence[],
  sampleBand: SampleBand
): string {
  if (state === 'SUPPORTIVE_CONTEXT') {
    const first = supporting[0]?.detail ?? 'certified packet fields align with the captured number.';
    return `Available context is supportive. ${first}`;
  }
  if (state === 'MIXED_CONTEXT') {
    const support = supporting[0]?.detail ?? 'some certified fields support the captured number.';
    const against = counter[0]?.detail ?? 'other certified fields run against it.';
    return `Available context is mixed. ${support} ${against}`;
  }
  if (state === 'COUNTERSIGNALS_PRESENT') {
    const first = counter[0]?.detail ?? 'certified fields run against the captured number.';
    return `Countersignals are present. ${first}`;
  }
  if (state === 'LIMITED_DATA') {
    if (sampleBand === 'ZERO') {
      return 'Available context is limited: there are no prior games before this cutoff.';
    }
    return 'Available context is limited: the recent sample is too small to read as a full window.';
  }
  return 'Available context is neutral: certified fields do not lean for or against the captured number.';
}

export function interpretXrayLeg(context: XRayLegContext): XRayLegInterpretation {
  const side = context.identity.side;
  const line = context.identity.line;
  const market = context.identity.market;
  const close = context.market.closeLine;
  const requested = context.market.requestedLine ?? line;
  const position = marketPositionKind(side, requested, close);
  const rel = context.playerForm.lineRelative;
  const sample = rel.sampleCount;
  const band = sampleBandFor(sample);
  const lineRead = formLineRead(rel.aboveRequestedLine, rel.belowRequestedLine, sample);
  const word = marketWord(market);
  const unit = avgLabel(market);
  const over = side !== 'under';
  const supporting: InterpretationEvidence[] = [];
  const counter: InterpretationEvidence[] = [];
  const uncertainties: InterpretationEvidence[] = [];
  const whyItCouldFail: InterpretationEvidence[] = [];

  const delta =
    requested != null && close != null ? round1(close - requested) : null;
  const absDelta = delta == null ? null : round1(Math.abs(delta));

  if (position === 'BETTER_NUMBER_THAN_CLOSE' && requested != null && close != null && absDelta != null) {
    supporting.push(
      evidence(
        'MARKET_BETTER_NUMBER_THAN_CLOSE',
        'MARKET',
        'Captured a better number than Decision Close',
        `Your ${sideLabel(side)} ${requested} was ${absDelta} ${over ? 'below' : 'above'} the ${close} Decision Close line.`
      )
    );
  } else if (position === 'WORSE_NUMBER_THAN_CLOSE' && requested != null && close != null && absDelta != null) {
    const item = evidence(
      'MARKET_WORSE_NUMBER_THAN_CLOSE',
      'MARKET',
      'Captured a worse number than Decision Close',
      `Your ${sideLabel(side)} ${requested} was ${absDelta} ${over ? 'above' : 'below'} the ${close} Decision Close line.`
    );
    counter.push(item);
    whyItCouldFail.push(item);
  } else if (position === 'UNKNOWN' && !context.market.snapshotAvailable.decisionClose) {
    uncertainties.push(
      evidence(
        'MARKET_CLOSE_UNKNOWN',
        'MARKET',
        'Decision Close snapshot missing',
        'No Decision Close line is available, so the captured number cannot be compared with close.'
      )
    );
  }

  if (context.market.matchStatus === 'PARTIAL_MATCH' || context.market.reason === 'BOOK_UNAVAILABLE') {
    const item = evidence(
      context.market.reason === 'BOOK_UNAVAILABLE' ? 'MARKET_BOOK_UNAVAILABLE' : 'MARKET_PARTIAL_MATCH',
      'MARKET',
      context.market.reason === 'BOOK_UNAVAILABLE' ? 'Requested sportsbook was not matched' : 'Historical market match is partial',
      context.market.reason === 'BOOK_UNAVAILABLE'
        ? 'The requested sportsbook did not have an exact historical match.'
        : 'The historical market match is partial, so book or line exactness is incomplete.'
    );
    uncertainties.push(item);
    whyItCouldFail.push(item);
  }

  if (!context.market.snapshotAvailable.threeHourPreTip) {
    uncertainties.push(
      evidence(
        'MARKET_MISSING_THREE_HOUR',
        'COVERAGE',
        '3-Hour Pre-Tip snapshot missing',
        'No 3-Hour Pre-Tip snapshot is available for this replay.'
      )
    );
  }

  const std = context.playerForm.seasonToDate.average;
  if (std != null && requested != null && sampleBandFor(context.playerForm.seasonToDate.gameCount) !== 'ZERO') {
    const stdAbove = std > requested + LINE_EPS;
    const stdBelow = std < requested - LINE_EPS;
    if ((over && stdAbove) || (!over && stdBelow)) {
      supporting.push(
        evidence(
          stdAbove ? 'FORM_STD_ABOVE_LINE' : 'FORM_STD_BELOW_LINE',
          'FORM',
          over ? 'Season-to-date average is above the requested line' : 'Season-to-date average is below the requested line',
          `Season-to-date ${std} ${unit} over ${context.playerForm.seasonToDate.gameCount} prior games vs requested ${requested}.`
        )
      );
    } else if ((over && stdBelow) || (!over && stdAbove)) {
      counter.push(
        evidence(
          stdBelow ? 'FORM_STD_BELOW_LINE' : 'FORM_STD_ABOVE_LINE',
          'FORM',
          over ? 'Season-to-date average is below the requested line' : 'Season-to-date average is above the requested line',
          `Season-to-date ${std} ${unit} over ${context.playerForm.seasonToDate.gameCount} prior games vs requested ${requested}.`
        )
      );
    }
  }

  if (lineRead === 'ABOVE_MORE_OFTEN_THAN_BELOW') {
    const item = evidence(
      'FORM_ABOVE_LINE_MORE_OFTEN',
      'FORM',
      'More prior games finished above the requested line',
      `${rel.aboveRequestedLine} of the previous ${sample} games finished above ${requested}.`
    );
    if (over) supporting.push(item);
    else {
      counter.push(item);
      whyItCouldFail.push(item);
    }
  } else if (lineRead === 'BELOW_MORE_OFTEN_THAN_ABOVE') {
    const item = evidence(
      'FORM_BELOW_LINE_MORE_OFTEN',
      'FORM',
      'More prior games finished below the requested line',
      `${rel.belowRequestedLine} of the previous ${sample} games finished below ${requested}.`
    );
    if (over) {
      counter.push(item);
      whyItCouldFail.push(item);
    } else supporting.push(item);
  } else if (lineRead === 'EVEN_SPLIT') {
    uncertainties.push(
      evidence(
        'FORM_EVEN_SPLIT',
        'FORM',
        'Prior games were split around the requested line',
        `${rel.aboveRequestedLine} above and ${rel.belowRequestedLine} below ${requested} in the previous ${sample} games.`
      )
    );
  }

  if (band === 'ZERO') {
    const item = evidence(
      'FORM_ZERO_SAMPLE',
      'FORM',
      'No prior games before cutoff',
      'There are no prior games before this cutoff, so recent form is unavailable.'
    );
    uncertainties.push(item);
    whyItCouldFail.push(item);
  } else if (band === 'SMALL_SAMPLE') {
    const item = evidence(
      'FORM_SMALL_SAMPLE',
      'FORM',
      'Small recent sample',
      `Only ${sample} prior game${sample === 1 ? '' : 's'} are available before this cutoff.`
    );
    uncertainties.push(item);
    whyItCouldFail.push(item);
  } else if (over && rel.belowRequestedLine > 0 && sample >= 5 && lineRead !== 'BELOW_MORE_OFTEN_THAN_ABOVE') {
    whyItCouldFail.push(
      evidence(
        'FORM_BELOW_LINE_MORE_OFTEN',
        'FORM',
        'Some prior games finished below the requested line',
        `He was below ${requested} ${word} in ${rel.belowRequestedLine} of his previous ${sample} games.`
      )
    );
  } else if (!over && rel.aboveRequestedLine > 0 && sample >= 5 && lineRead !== 'ABOVE_MORE_OFTEN_THAN_BELOW') {
    whyItCouldFail.push(
      evidence(
        'FORM_ABOVE_LINE_MORE_OFTEN',
        'FORM',
        'Some prior games finished above the requested line',
        `He was above ${requested} ${word} in ${rel.aboveRequestedLine} of his previous ${sample} games.`
      )
    );
  }

  const vsSeason = minutesVsSeason(context.role.priorGameMinutes, context.role.seasonToDateMinutes.average);
  if (vsSeason === 'BELOW' && over) {
    const item = evidence(
      'ROLE_MINUTES_BELOW_BASELINE',
      'ROLE',
      'Recent minutes were below the season average',
      `Last game ${context.role.priorGameMinutes} minutes vs ${context.role.seasonToDateMinutes.average} season-to-date.`
    );
    counter.push(item);
    whyItCouldFail.push(item);
  } else if (vsSeason === 'ABOVE' && !over) {
    const item = evidence(
      'ROLE_MINUTES_ABOVE_BASELINE',
      'ROLE',
      'Recent minutes were above the season average',
      `Last game ${context.role.priorGameMinutes} minutes vs ${context.role.seasonToDateMinutes.average} season-to-date.`
    );
    counter.push(item);
    whyItCouldFail.push(item);
  }

  if (context.wowy.status !== 'AVAILABLE') {
    uncertainties.push(
      evidence(
        'NO_AS_OF_SAFE_WOWY',
        'COVERAGE',
        'Historical as-of-safe WOWY unavailable',
        'No as-of-safe WOWY source is available for this historical cutoff.'
      )
    );
  }
  if (context.projection.status !== 'AVAILABLE') {
    uncertainties.push(
      evidence(
        'NO_ARCHIVED_PROJECTION',
        'COVERAGE',
        'No archived pregame projection',
        'No archived pregame projection is available for this replay.'
      )
    );
  }
  if (context.availability.status !== 'AVAILABLE') {
    const item = evidence(
      'NO_HISTORICAL_AVAILABILITY',
      'COVERAGE',
      'Historical pregame availability snapshot unavailable',
      'No historical availability snapshot is available, so lineup-driven role changes are not represented.'
    );
    uncertainties.push(item);
    whyItCouldFail.push(item);
  }
  if (context.role.startersPregame.status !== 'AVAILABLE') {
    uncertainties.push(
      evidence(
        'STARTERS_POSTGAME_CONFIRMED',
        'COVERAGE',
        'Pregame starters unavailable',
        'Certified starters for this game are not treated as pregame knowledge.'
      )
    );
  }

  const state = summaryState(supporting, counter, sample);

  return {
    identity: {
      playerDisplayName: context.identity.playerDisplayName,
      market,
      side,
      line,
      sportsbook: context.identity.sportsbook,
      teamAbbr: context.identity.teamAbbr,
      opponentAbbr: context.identity.opponentAbbr,
      gameId: context.identity.gameId,
      historicalDate: context.identity.historicalDate,
      contextCutoffAt: context.identity.contextCutoffAt,
    },
    marketPosition: {
      kind: position,
      requestedLine: requested,
      threeHourLine: context.market.threeHourLine,
      threeHourOdds: context.market.threeHourOdds,
      closeLine: close,
      closeOdds: context.market.closeOdds,
      lineDeltaCloseMinusRequested: delta,
    },
    recentForm: {
      lineRead,
      sampleBand: band,
      seasonAverage: std,
      seasonGames: context.playerForm.seasonToDate.gameCount,
      last5Average: context.playerForm.last5.average,
      last10Average: context.playerForm.last10.average,
      above: rel.aboveRequestedLine,
      below: rel.belowRequestedLine,
      equal: rel.equalRequestedLine,
      sampleCount: sample,
    },
    role: {
      priorGameMinutes: context.role.priorGameMinutes,
      seasonMinutes: context.role.seasonToDateMinutes.average,
      last5Minutes: context.role.last5Minutes.average,
      last10Minutes: context.role.last10Minutes.average,
      minutesVsSeason: vsSeason,
    },
    matchup: {
      opponentAbbr: context.matchup.opponentAbbr,
      teamPace: context.matchup.teamPace.average,
      opponentPace: context.matchup.opponentPace.average,
      opponentPointsAllowed: context.matchup.opponentPointsAllowed.average,
      teamPoints: context.matchup.teamPoints.average,
    },
    supportingContext: supporting,
    counterContext: counter,
    uncertainties,
    whyItCouldFail,
    dataAvailability: {
      wowy: coverageStatus(context.wowy.status),
      projection: coverageStatus(context.projection.status),
      availability: coverageStatus(context.availability.status),
      market: context.market.status,
      playerForm: context.playerForm.status,
    },
    summaryState: state,
    summarySentence: summarySentence(state, supporting, counter, band),
  };
}

export function summarizeInterpretations(rows: XRayLegInterpretation[]): XRayInterpretationParlaySummary {
  return {
    legCount: rows.length,
    fullContextCount: rows.filter((row) => row.dataAvailability.playerForm === 'AVAILABLE').length,
    limitedCount: rows.filter((row) => row.summaryState === 'LIMITED_DATA').length,
    marketMatchCount: rows.filter((row) => row.dataAvailability.market === 'AVAILABLE').length,
    partialMarketCount: rows.filter((row) => row.dataAvailability.market === 'LIMITED').length,
  };
}
