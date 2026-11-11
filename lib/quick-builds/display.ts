/**
 * Display labels for an already ranked shortlist.
 * Names come from analytics.players. Prices and eligibility are not recomputed.
 * Team and opponent stay empty: the prop snapshot does not record a team,
 * and a current roster is not a verified team for this game.
 */

import type { QuickBuild, QuickBuildGameInput, QuickBuildLeg } from './types';

export const QUICK_BUILD_PLAYERS_SQL = `
SELECT player_id::text AS player_id,
       full_name
  FROM analytics.players
 WHERE player_id = ANY($1::text[])
`;

export const QUICK_BUILD_DISPLAY_GAPS = [
  'MISSING_PLAYER',
  'INVALID_PLAYER_NAME',
  'AMBIGUOUS_PLAYER',
  'MISSING_GAME_START',
] as const;

export type QuickBuildDisplayGap = (typeof QUICK_BUILD_DISPLAY_GAPS)[number];

export type QuickBuildLegDisplay = {
  playerName: string | null;
  gameStartTime: string | null;
  gameStatus: string | null;
  teamAbbreviation: null;
  opponentAbbreviation: null;
  homeAway: null;
  displayReady: boolean;
  unavailableReason: QuickBuildDisplayGap | null;
};

export type QuickBuildDisplayedLeg = QuickBuildLeg & {
  display: QuickBuildLegDisplay;
};

export type QuickBuildDisplayed =
  | (Omit<Extract<QuickBuild, { legs: [QuickBuildLeg, QuickBuildLeg] }>, 'legs'> & {
      legs: [QuickBuildDisplayedLeg, QuickBuildDisplayedLeg];
    })
  | (Omit<Extract<QuickBuild, { legs: [QuickBuildLeg, QuickBuildLeg, QuickBuildLeg] }>, 'legs'> & {
      legs: [QuickBuildDisplayedLeg, QuickBuildDisplayedLeg, QuickBuildDisplayedLeg];
    });

export type PlayerNameRow = {
  playerId: string;
  fullName: string | null;
};

/** A numeric id stored in full_name is the transform fallback, not a display name. */
export function usablePlayerName(playerId: string, fullName: string | null | undefined): string | null {
  if (typeof fullName !== 'string') return null;
  const name = fullName.trim().replace(/\s+/g, ' ');
  if (name === '' || name === playerId || /^\d+$/.test(name)) return null;
  return name;
}

function nameFor(playerId: string, rows: PlayerNameRow[]): { playerName: string | null; reason: QuickBuildDisplayGap | null } {
  const mine = rows.filter((row) => row.playerId === playerId);
  const distinct = [
    ...new Set(
      mine
        .map((row) => (typeof row.fullName === 'string' ? row.fullName.trim().replace(/\s+/g, ' ') : ''))
        .filter((name) => name !== '')
    ),
  ];
  if (distinct.length > 1) return { playerName: null, reason: 'AMBIGUOUS_PLAYER' };
  if (distinct.length === 0) {
    return { playerName: null, reason: mine.length === 0 ? 'MISSING_PLAYER' : 'INVALID_PLAYER_NAME' };
  }
  const playerName = usablePlayerName(playerId, distinct[0]);
  if (playerName == null) return { playerName: null, reason: 'INVALID_PLAYER_NAME' };
  return { playerName, reason: null };
}

function gameFor(gameId: string, games: QuickBuildGameInput[]): { gameStartTime: string | null; gameStatus: string | null } {
  const game = games.find((row) => row.gameId === gameId);
  if (game == null) return { gameStartTime: null, gameStatus: null };
  const startMs = Date.parse(game.startTime);
  if (!Number.isFinite(startMs)) return { gameStartTime: null, gameStatus: game.status ?? null };
  return { gameStartTime: new Date(startMs).toISOString(), gameStatus: game.status ?? null };
}

function displayFor(leg: QuickBuildLeg, games: QuickBuildGameInput[], players: PlayerNameRow[]): QuickBuildLegDisplay {
  const name = nameFor(leg.playerId, players);
  const game = gameFor(leg.gameId, games);
  const unavailableReason = name.reason ?? (game.gameStartTime == null ? 'MISSING_GAME_START' : null);
  return {
    playerName: name.playerName,
    gameStartTime: game.gameStartTime,
    gameStatus: game.gameStatus,
    teamAbbreviation: null,
    opponentAbbreviation: null,
    homeAway: null,
    displayReady: unavailableReason == null,
    unavailableReason,
  };
}

export function attachQuickBuildDisplay(input: {
  builds: QuickBuild[];
  games: QuickBuildGameInput[];
  playerRows: PlayerNameRow[];
}): QuickBuildDisplayed[] {
  return input.builds.map((build) => {
    const legs = build.legs.map((leg) => ({
      ...leg,
      display: displayFor(leg, input.games, input.playerRows),
    }));
    if (legs.length === 3) {
      return { ...build, legs: [legs[0]!, legs[1]!, legs[2]!] } as QuickBuildDisplayed;
    }
    return { ...build, legs: [legs[0]!, legs[1]!] } as QuickBuildDisplayed;
  });
}
