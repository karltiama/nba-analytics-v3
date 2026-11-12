/**
 * Display labels for an already ranked shortlist.
 * Names come from analytics.players. Prices and eligibility are not recomputed.
 * The player's team and opponent stay empty: the prop snapshot does not record a
 * team, and a current roster is not a verified team for this game.
 * The scheduled game's away and home abbreviations are the matchup. Game status
 * is the normalized label. A tip clock or ISO string in the provider status is
 * not the status, and it is not substituted for the start time. The NBA
 * headshot id comes from the nba provider id. When that id is missing, a unique
 * exact name on the latest NBA roster snapshot supplies the CDN id. The prop
 * player id is never used as a headshot id, and the roster row is not a team.
 */

import { quickBuildStatusLabel } from './slate-status';
import type { QuickBuild, QuickBuildGameInput, QuickBuildLeg } from './types';

export const QUICK_BUILD_PLAYERS_SQL = `
SELECT p.player_id::text AS player_id,
       p.full_name,
       COALESCE(nba.provider_player_id, roster.nba_player_id) AS nba_player_id
  FROM analytics.players p
  LEFT JOIN analytics.player_provider_ids nba
    ON nba.player_entity_id = p.player_entity_id
   AND nba.provider = 'nba'
  LEFT JOIN (
    SELECT lower(btrim(player_name)) AS name_key,
           min(nba_player_id) AS nba_player_id
      FROM raw.nba_roster_snapshots
     WHERE snapshot_date = (SELECT max(snapshot_date) FROM raw.nba_roster_snapshots)
     GROUP BY lower(btrim(player_name))
    HAVING count(DISTINCT nba_player_id) = 1
  ) roster
    ON roster.name_key = lower(btrim(p.full_name))
 WHERE p.player_id = ANY($1::text[])
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
  /** Scheduled game only. Null unless both abbreviations are present. */
  scheduledAwayAbbreviation: string | null;
  scheduledHomeAbbreviation: string | null;
  /** NBA CDN id. Null when the provider id is missing or ambiguous. */
  nbaPlayerId: string | null;
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
    })
  | (Omit<Extract<QuickBuild, { legs: [QuickBuildLeg, QuickBuildLeg, QuickBuildLeg, QuickBuildLeg] }>, 'legs'> & {
      legs: [QuickBuildDisplayedLeg, QuickBuildDisplayedLeg, QuickBuildDisplayedLeg, QuickBuildDisplayedLeg];
    })
  | (Omit<
      Extract<QuickBuild, { legs: [QuickBuildLeg, QuickBuildLeg, QuickBuildLeg, QuickBuildLeg, QuickBuildLeg] }>,
      'legs'
    > & {
      legs: [
        QuickBuildDisplayedLeg,
        QuickBuildDisplayedLeg,
        QuickBuildDisplayedLeg,
        QuickBuildDisplayedLeg,
        QuickBuildDisplayedLeg,
      ];
    });

export type PlayerNameRow = {
  playerId: string;
  fullName: string | null;
  nbaPlayerId?: string | null;
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

function cleanAbbreviation(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toUpperCase();
  return /^[A-Z]{2,4}$/.test(text) ? text : null;
}

function cleanNbaPlayerId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return /^\d{1,10}$/.test(text) ? text : null;
}

function nbaPlayerIdFor(playerId: string, rows: PlayerNameRow[]): string | null {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.playerId !== playerId) continue;
    const id = cleanNbaPlayerId(row.nbaPlayerId);
    if (id) ids.add(id);
  }
  if (ids.size !== 1) return null;
  return [...ids][0] ?? null;
}

function gameFor(
  gameId: string,
  games: QuickBuildGameInput[]
): {
  gameStartTime: string | null;
  gameStatus: string | null;
  scheduledAwayAbbreviation: string | null;
  scheduledHomeAbbreviation: string | null;
} {
  const game = games.find((row) => row.gameId === gameId);
  const away = cleanAbbreviation(game?.awayAbbreviation);
  const home = cleanAbbreviation(game?.homeAbbreviation);
  const matchup = away && home ? { scheduledAwayAbbreviation: away, scheduledHomeAbbreviation: home } : { scheduledAwayAbbreviation: null, scheduledHomeAbbreviation: null };
  const gameStatus = game == null ? null : displayGameStatus(game.status);
  if (game == null) return { gameStartTime: null, gameStatus, ...matchup };
  const startMs = Date.parse(game.startTime);
  if (!Number.isFinite(startMs)) return { gameStartTime: null, gameStatus, ...matchup };
  return { gameStartTime: new Date(startMs).toISOString(), gameStatus, ...matchup };
}

/** The start time stays on startTime. Final/OT is Final. A blank status stays empty. */
function displayGameStatus(status: string | null | undefined): string | null {
  return quickBuildStatusLabel(status);
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
    scheduledAwayAbbreviation: game.scheduledAwayAbbreviation,
    scheduledHomeAbbreviation: game.scheduledHomeAbbreviation,
    nbaPlayerId: nbaPlayerIdFor(leg.playerId, players),
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
    if (legs.length === 5) {
      return { ...build, legs: [legs[0]!, legs[1]!, legs[2]!, legs[3]!, legs[4]!] } as QuickBuildDisplayed;
    }
    if (legs.length === 4) {
      return { ...build, legs: [legs[0]!, legs[1]!, legs[2]!, legs[3]!] } as QuickBuildDisplayed;
    }
    if (legs.length === 3) {
      return { ...build, legs: [legs[0]!, legs[1]!, legs[2]!] } as QuickBuildDisplayed;
    }
    return { ...build, legs: [legs[0]!, legs[1]!] } as QuickBuildDisplayed;
  });
}
