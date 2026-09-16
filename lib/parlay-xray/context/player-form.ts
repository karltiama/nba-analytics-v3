import type { CanonicalPropType } from '@/lib/betting/market-movement';
import {
  formStatus,
  marketStatFromLog,
  playedLogs,
  seasonToDateLogs,
  selectPriorLogs,
  windowStat,
} from './stats';
import type { LineRelativeHistory, XRayPlayerFormContext, XrayPriorPlayerLog } from './types';

function lineRelative(values: number[], line: number | null): LineRelativeHistory {
  if (line == null || !Number.isFinite(line)) {
    return { sampleCount: values.length, aboveRequestedLine: 0, belowRequestedLine: 0, equalRequestedLine: 0 };
  }
  let above = 0;
  let below = 0;
  let equal = 0;
  for (const value of values) {
    if (value > line) above += 1;
    else if (value < line) below += 1;
    else equal += 1;
  }
  return {
    sampleCount: values.length,
    aboveRequestedLine: above,
    belowRequestedLine: below,
    equalRequestedLine: equal,
  };
}

function valuesForMarket(logs: XrayPriorPlayerLog[], market: CanonicalPropType | null): number[] {
  const out: number[] = [];
  for (const log of logs) {
    const value = marketStatFromLog(log, market);
    if (value != null) out.push(value);
  }
  return out;
}

export function assemblePlayerForm(args: {
  logs: XrayPriorPlayerLog[];
  playerId: string | null;
  cutoffAt: string | null;
  targetGameId: string | null;
  season: string | null;
  market: CanonicalPropType | null;
  requestedLine: number | null;
}): XRayPlayerFormContext {
  const empty: XRayPlayerFormContext = {
    status: 'UNAVAILABLE',
    reason: 'NO_PRIOR_GAMES',
    market: args.market,
    seasonToDate: { gameCount: 0, average: null },
    last5: { gameCount: 0, average: null },
    last10: { gameCount: 0, average: null },
    lineRelative: { sampleCount: 0, aboveRequestedLine: 0, belowRequestedLine: 0, equalRequestedLine: 0 },
  };
  if (!args.cutoffAt) return { ...empty, reason: 'MISSING_CONTEXT_CUTOFF' };
  if (!args.playerId) return { ...empty, reason: 'PLAYER_UNRESOLVED' };
  if (!args.market) return { ...empty, reason: 'MARKET_UNRESOLVED' };

  const priors = playedLogs(
    selectPriorLogs(args.logs, {
      playerId: args.playerId,
      cutoffAt: args.cutoffAt,
      targetGameId: args.targetGameId,
    })
  );
  const stdLogs = seasonToDateLogs(priors, args.season);
  const stdValues = valuesForMarket(stdLogs, args.market);
  const recentValues = valuesForMarket(priors, args.market);
  const last5Values = recentValues.slice(0, 5);
  const last10Values = recentValues.slice(0, 10);
  const sample = stdValues.length;
  if (sample === 0 && recentValues.length === 0) {
    return empty;
  }

  return {
    status: formStatus(Math.max(sample, recentValues.length)),
    reason: formStatus(Math.max(sample, recentValues.length)) === 'LIMITED' ? 'SMALL_PRIOR_SAMPLE' : null,
    market: args.market,
    seasonToDate: windowStat(stdValues),
    last5: windowStat(last5Values),
    last10: windowStat(last10Values),
    lineRelative: lineRelative(last10Values.length > 0 ? last10Values : recentValues, args.requestedLine),
  };
}
