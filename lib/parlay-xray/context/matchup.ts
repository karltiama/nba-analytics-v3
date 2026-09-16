import { isUsablePriorRow } from './cutoff';
import { formStatus, windowStat } from './stats';
import type { XRayMatchupContext, XrayPriorTeamStat } from './types';

function teamRows(
  rows: XrayPriorTeamStat[],
  teamId: string | null,
  cutoffAt: string,
  targetGameId: string | null,
  season: string | null
): XrayPriorTeamStat[] {
  if (!teamId) return [];
  return rows
    .filter(
      (row) =>
        row.teamId === teamId &&
        (!season || row.season === season) &&
        isUsablePriorRow({
          gameId: row.gameId,
          startTime: row.startTime,
          cutoffAt,
          targetGameId,
        })
    )
    .slice()
    .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
}

function numericWindow(rows: XrayPriorTeamStat[], key: 'pace' | 'pointsAllowed' | 'teamPoints') {
  const values: number[] = [];
  for (const row of rows) {
    const value = row[key];
    if (value != null && Number.isFinite(value)) values.push(value);
  }
  return windowStat(values);
}

export function assembleMatchup(args: {
  teamStats: XrayPriorTeamStat[];
  cutoffAt: string | null;
  targetGameId: string | null;
  season: string | null;
  playerTeamId: string | null;
  opponentTeamId: string | null;
  opponentAbbr: string | null;
}): XRayMatchupContext {
  const emptyWindows = { gameCount: 0, average: null };
  if (!args.cutoffAt) {
    return {
      status: 'UNAVAILABLE',
      reason: 'MISSING_CONTEXT_CUTOFF',
      opponentAbbr: args.opponentAbbr,
      opponentTeamId: args.opponentTeamId,
      playerTeamId: args.playerTeamId,
      teamPace: emptyWindows,
      opponentPace: emptyWindows,
      opponentPointsAllowed: emptyWindows,
      teamPoints: emptyWindows,
    };
  }
  if (!args.opponentAbbr && !args.opponentTeamId) {
    return {
      status: 'UNAVAILABLE',
      reason: 'OPPONENT_UNRESOLVED',
      opponentAbbr: null,
      opponentTeamId: null,
      playerTeamId: args.playerTeamId,
      teamPace: emptyWindows,
      opponentPace: emptyWindows,
      opponentPointsAllowed: emptyWindows,
      teamPoints: emptyWindows,
    };
  }

  const teamRowsForPlayer = teamRows(
    args.teamStats,
    args.playerTeamId,
    args.cutoffAt,
    args.targetGameId,
    args.season
  );
  const oppRows = teamRows(
    args.teamStats,
    args.opponentTeamId,
    args.cutoffAt,
    args.targetGameId,
    args.season
  );
  const sample = Math.max(teamRowsForPlayer.length, oppRows.length);
  const status = !args.playerTeamId && !args.opponentTeamId
    ? 'LIMITED'
    : sample === 0
      ? 'LIMITED'
      : formStatus(sample);

  return {
    status,
    reason:
      sample === 0
        ? 'MISSING_TEAM_STATS'
        : status === 'LIMITED'
          ? 'SMALL_PRIOR_SAMPLE'
          : null,
    opponentAbbr: args.opponentAbbr,
    opponentTeamId: args.opponentTeamId,
    playerTeamId: args.playerTeamId,
    teamPace: numericWindow(teamRowsForPlayer, 'pace'),
    opponentPace: numericWindow(oppRows, 'pace'),
    opponentPointsAllowed: numericWindow(oppRows, 'pointsAllowed'),
    teamPoints: numericWindow(teamRowsForPlayer, 'teamPoints'),
  };
}
