import { classifyWowyAppearance } from './appearance';
import { etCalendarDate, isPostseasonGame } from './calendar';
import { isOnOrAfterCutoff } from './cutoff';
import type {
  WowyAppearanceRef,
  WowyBucket,
  WowyClassifiedGame,
  WowyExcludeReason,
  WowyLoadedGame,
  WowyMembershipEvidence,
  WowyPairQuery,
  WowySeasonType,
  WowyStatKey,
  WowyTeammateParticipation,
} from './types';

function appearanceRef(log: {
  minutes: string | number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  tpm: number | null;
  fga?: number | null;
  fta?: number | null;
}): WowyAppearanceRef {
  const classified = classifyWowyAppearance({
    minutes: log.minutes,
    points: log.points,
    rebounds: log.rebounds,
    assists: log.assists,
    three_pointers_made: log.tpm,
    field_goals_attempted: log.fga ?? null,
    free_throws_attempted: log.fta ?? null,
  });
  return {
    class: classified.class,
    minutes: classified.minutes,
    minutesToken: classified.minutesToken,
    reason: classified.reason,
  };
}

function numOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function subjectStats(game: WowyLoadedGame, minutes: number | null): Record<WowyStatKey, number | null> {
  return {
    minutes,
    pts: numOrNull(game.subjectPts),
    reb: numOrNull(game.subjectReb),
    ast: numOrNull(game.subjectAst),
    tpm: numOrNull(game.subjectTpm),
    fga: numOrNull(game.subjectFga),
    tpa: numOrNull(game.subjectTpa),
    fta: numOrNull(game.subjectFta),
  };
}

function isCompleteFinalGame(game: WowyLoadedGame): boolean {
  return (
    game.status === 'Final' &&
    typeof game.startTime === 'string' &&
    game.startTime.length > 0 &&
    Number.isFinite(Date.parse(game.startTime)) &&
    game.homeScore != null &&
    game.awayScore != null
  );
}

function inDateRange(basketballDateEt: string, query: WowyPairQuery): boolean {
  if (query.dateFrom && basketballDateEt < query.dateFrom) return false;
  if (query.dateTo && basketballDateEt > query.dateTo) return false;
  return true;
}

function seasonTypeFor(season: string, startTime: string): WowySeasonType {
  return isPostseasonGame(season, startTime) ? 'playoffs' : 'regular';
}

function classifyTeammate(game: WowyLoadedGame): {
  participation: WowyTeammateParticipation;
  appearance: WowyAppearanceRef | null;
  membership: WowyMembershipEvidence;
  excludeReason: WowyExcludeReason | null;
} {
  if (!game.teammateRowPresent) {
    return {
      participation: 'unknown',
      appearance: null,
      membership: {
        kind: 'teammate_row_missing',
        subjectTeamId: game.subjectTeamId,
        teammateTeamId: null,
        note: 'Missing teammate game-log row is unknown membership/participation. Absence is not inferred. Roster stints are not used to manufacture DNP.',
      },
      excludeReason: 'teammate_unknown_membership',
    };
  }

  if (!game.teammateTeamId) {
    return {
      participation: 'unknown',
      appearance: null,
      membership: {
        kind: 'teammate_row_missing',
        subjectTeamId: game.subjectTeamId,
        teammateTeamId: null,
        note: 'Teammate row present without team_id; team membership is ambiguous.',
      },
      excludeReason: 'ambiguous_team_membership',
    };
  }

  if (game.teammateTeamId !== game.subjectTeamId) {
    return {
      participation: 'unknown',
      appearance: appearanceRef({
        minutes: game.teammateMinutes,
        points: game.teammatePts,
        rebounds: game.teammateReb,
        assists: game.teammateAst,
        tpm: game.teammateTpm,
        fga: game.teammateFga,
        fta: game.teammateFta,
      }),
      membership: {
        kind: 'different_team_game_log',
        subjectTeamId: game.subjectTeamId,
        teammateTeamId: game.teammateTeamId,
        note: 'Same game, different team_id. Not a same-team pair for this night. Game-log team_id is night-of box membership, not a verified trade date.',
      },
      excludeReason: 'teammate_different_team',
    };
  }

  const appearance = appearanceRef({
    minutes: game.teammateMinutes,
    points: game.teammatePts,
    rebounds: game.teammateReb,
    assists: game.teammateAst,
    tpm: game.teammateTpm,
    fga: game.teammateFga,
    fta: game.teammateFta,
  });

  const membership: WowyMembershipEvidence = {
    kind: 'same_team_game_log',
    subjectTeamId: game.subjectTeamId,
    teammateTeamId: game.teammateTeamId,
    note: 'Both players have analytics.player_game_logs rows on the same team_id for this game_id.',
  };

  if (appearance.class === 'malformed') {
    return {
      participation: 'unknown',
      appearance,
      membership,
      excludeReason: 'malformed_teammate_minutes',
    };
  }
  if (appearance.class === 'dnp') {
    return {
      participation: 'verified_dnp',
      appearance,
      membership,
      excludeReason: null,
    };
  }
  return {
    participation: 'played',
    appearance,
    membership,
    excludeReason: null,
  };
}

export function classifyWowyGame(
  game: WowyLoadedGame,
  query: WowyPairQuery,
  opts: { identityOk?: boolean } = {}
): WowyClassifiedGame {
  const startTime = game.startTime ?? '';
  const basketballDateEt = startTime ? etCalendarDate(startTime) : null;
  const seasonType = startTime && game.season ? seasonTypeFor(game.season, startTime) : 'regular';

  const subjectAppearance = appearanceRef({
    minutes: game.subjectMinutes,
    points: game.subjectPts,
    rebounds: game.subjectReb,
    assists: game.subjectAst,
    tpm: game.subjectTpm,
    fga: game.subjectFga,
    fta: game.subjectFta,
  });

  const placeholder: WowyClassifiedGame = {
    gameId: game.gameId,
    startTime,
    basketballDateEt: basketballDateEt ?? game.gameDate ?? '',
    season: game.season,
    seasonType,
    teamId: game.subjectTeamId,
    opponentTeamId: game.opponentTeamId,
    opponentAbbr: game.opponentAbbr,
    subject: {
      ...subjectAppearance,
      stats: subjectStats(game, subjectAppearance.minutes),
    },
    teammate: {
      participation: 'unknown',
      appearance: null,
      membership: {
        kind: 'subject_row_only',
        subjectTeamId: game.subjectTeamId,
        teammateTeamId: game.teammateTeamId,
        note: 'Not classified.',
      },
    },
    bucket: 'excluded',
    excludeReason: 'incomplete_game',
  };

  const exclude = (reason: WowyExcludeReason, extras?: Partial<WowyClassifiedGame>): WowyClassifiedGame => ({
    ...placeholder,
    ...extras,
    bucket: 'excluded',
    excludeReason: reason,
  });

  if (opts.identityOk === false) {
    return exclude('ambiguous_identity');
  }
  if (!isCompleteFinalGame(game) || !basketballDateEt) {
    return exclude('incomplete_game');
  }
  if (query.teamId && game.subjectTeamId !== query.teamId) {
    return exclude('ambiguous_team_membership', {
      teammate: {
        participation: 'unknown',
        appearance: null,
        membership: {
          kind: 'subject_row_only',
          subjectTeamId: game.subjectTeamId,
          teammateTeamId: null,
          note: 'Subject team_id does not match the selected stint. Distinct team stints are kept separate.',
        },
      },
    });
  }
  if (query.seasonType !== 'all' && seasonType !== query.seasonType) {
    return exclude('season_type_mismatch', { startTime, basketballDateEt, seasonType });
  }
  if (!inDateRange(basketballDateEt, query)) {
    return exclude('outside_date_range', { startTime, basketballDateEt, seasonType });
  }
  if (query.cutoffStartTime && isOnOrAfterCutoff(startTime, query.cutoffStartTime)) {
    return exclude('on_or_after_cutoff', { startTime, basketballDateEt, seasonType });
  }
  if (subjectAppearance.class === 'malformed') {
    return exclude('subject_malformed_minutes', { startTime, basketballDateEt, seasonType });
  }
  if (subjectAppearance.class !== 'played') {
    return exclude('subject_did_not_play', { startTime, basketballDateEt, seasonType });
  }

  const teammate = classifyTeammate(game);
  if (teammate.excludeReason) {
    return exclude(teammate.excludeReason, {
      startTime,
      basketballDateEt,
      seasonType,
      teammate,
    });
  }

  const bucket: WowyBucket = teammate.participation === 'played' ? 'with' : 'without';
  return {
    ...placeholder,
    startTime,
    basketballDateEt,
    seasonType,
    teammate,
    bucket,
    excludeReason: null,
  };
}

export function classifyWowyGames(
  games: WowyLoadedGame[],
  query: WowyPairQuery,
  opts: { identityOk?: boolean } = {}
): WowyClassifiedGame[] {
  return games.map((game) => classifyWowyGame(game, query, opts));
}

export { appearanceRef };
