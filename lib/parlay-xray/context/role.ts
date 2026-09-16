import {
  formStatus,
  playedLogs,
  playedMinutes,
  seasonToDateLogs,
  selectPriorLogs,
  windowStat,
} from './stats';
import type { XRayRoleContext, XrayPriorPlayerLog } from './types';

export function assembleRole(args: {
  logs: XrayPriorPlayerLog[];
  playerId: string | null;
  cutoffAt: string | null;
  targetGameId: string | null;
  season: string | null;
}): XRayRoleContext {
  const startersPregame = {
    status: 'UNAVAILABLE' as const,
    reason: 'STARTERS_POSTGAME_CONFIRMED',
  };
  const empty: XRayRoleContext = {
    status: 'UNAVAILABLE',
    reason: 'NO_PRIOR_GAMES',
    priorGameMinutes: null,
    seasonToDateMinutes: { gameCount: 0, average: null },
    last5Minutes: { gameCount: 0, average: null },
    last10Minutes: { gameCount: 0, average: null },
    gamesPlayed: 0,
    startersPregame,
  };
  if (!args.cutoffAt) return { ...empty, reason: 'MISSING_CONTEXT_CUTOFF' };
  if (!args.playerId) return { ...empty, reason: 'PLAYER_UNRESOLVED' };

  const priors = playedLogs(
    selectPriorLogs(args.logs, {
      playerId: args.playerId,
      cutoffAt: args.cutoffAt,
      targetGameId: args.targetGameId,
    })
  );
  const minutes = priors
    .map((log) => playedMinutes(log))
    .filter((value): value is number => value != null);
  if (minutes.length === 0) return empty;

  const stdMinutes = seasonToDateLogs(priors, args.season)
    .map((log) => playedMinutes(log))
    .filter((value): value is number => value != null);

  return {
    status: formStatus(minutes.length),
    reason: formStatus(minutes.length) === 'LIMITED' ? 'SMALL_PRIOR_SAMPLE' : null,
    priorGameMinutes: minutes[0] ?? null,
    seasonToDateMinutes: windowStat(stdMinutes),
    last5Minutes: windowStat(minutes.slice(0, 5)),
    last10Minutes: windowStat(minutes.slice(0, 10)),
    gamesPlayed: minutes.length,
    startersPregame,
  };
}
