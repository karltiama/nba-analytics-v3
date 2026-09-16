import type { CanonicalPropType } from '@/lib/betting/market-movement';
import { parseMinutes } from '@/lib/wowy/appearance';
import { isUsablePriorRow } from './cutoff';
import type { ContextSectionStatus, WindowStat, XrayPriorPlayerLog } from './types';

export function addNullable(parts: Array<number | null | undefined>): number | null {
  let sum = 0;
  for (const part of parts) {
    if (part == null || !Number.isFinite(part)) return null;
    sum += part;
  }
  return sum;
}

export function marketStatFromLog(
  log: Pick<XrayPriorPlayerLog, 'points' | 'rebounds' | 'assists' | 'threePointersMade'>,
  market: CanonicalPropType | null
): number | null {
  if (!market) return null;
  switch (market) {
    case 'points':
      return finiteOrNull(log.points);
    case 'rebounds':
      return finiteOrNull(log.rebounds);
    case 'assists':
      return finiteOrNull(log.assists);
    case 'threes':
      return finiteOrNull(log.threePointersMade);
    case 'points_rebounds':
      return addNullable([log.points, log.rebounds]);
    case 'points_assists':
      return addNullable([log.points, log.assists]);
    case 'rebounds_assists':
      return addNullable([log.rebounds, log.assists]);
    case 'points_rebounds_assists':
      return addNullable([log.points, log.rebounds, log.assists]);
    default:
      return null;
  }
}

export function finiteOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function meanRounded(values: number[]): number | null {
  if (values.length === 0) return null;
  return round1(values.reduce((sum, n) => sum + n, 0) / values.length);
}

export function windowStat(values: number[]): WindowStat {
  return { gameCount: values.length, average: meanRounded(values) };
}

export function playedMinutes(log: Pick<XrayPriorPlayerLog, 'minutes'>): number | null {
  const minutes = parseMinutes(log.minutes);
  if (minutes == null || minutes <= 0) return null;
  return minutes;
}

export function selectPriorLogs(
  logs: XrayPriorPlayerLog[],
  args: { playerId: string | null; cutoffAt: string; targetGameId: string | null }
): XrayPriorPlayerLog[] {
  if (!args.playerId) return [];
  return logs
    .filter(
      (log) =>
        log.playerId === args.playerId &&
        isUsablePriorRow({
          gameId: log.gameId,
          startTime: log.startTime,
          cutoffAt: args.cutoffAt,
          targetGameId: args.targetGameId,
        })
    )
    .slice()
    .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
}

export function playedLogs(logs: XrayPriorPlayerLog[]): XrayPriorPlayerLog[] {
  return logs.filter((log) => playedMinutes(log) != null);
}

export function seasonToDateLogs(logs: XrayPriorPlayerLog[], season: string | null): XrayPriorPlayerLog[] {
  if (!season) return logs;
  return logs.filter((log) => log.season === season);
}

export function formStatus(sampleCount: number): ContextSectionStatus {
  if (sampleCount <= 0) return 'UNAVAILABLE';
  if (sampleCount < 10) return 'LIMITED';
  return 'AVAILABLE';
}
