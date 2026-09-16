import { formatEtYmd } from '@/lib/providers/owls-insight/mapping';
import type {
  GameFieldResolution,
  GameResolutionCandidate,
  XrayGameRecord,
  XrayResolutionContext,
  XrayTeamRecord,
} from './types';
import { parseMatchupAbbrs, resolveTeamAbbr } from './team';

function ymdFromUnknown(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const iso = Date.parse(trimmed);
  if (Number.isFinite(iso)) return formatEtYmd(new Date(iso).toISOString());
  return null;
}

export function contextualSlateDate(
  context: XrayResolutionContext | undefined,
  legGameDate: string | null | undefined
): string | null {
  return (
    ymdFromUnknown(context?.eventDate) ??
    ymdFromUnknown(context?.slateDate) ??
    ymdFromUnknown(context?.asOfDate) ??
    ymdFromUnknown(legGameDate)
  );
}

function gameYmd(game: XrayGameRecord): string | null {
  return formatEtYmd(game.startTime) ?? ymdFromUnknown(game.startTime.slice(0, 10));
}

function sameMatchup(game: XrayGameRecord, a: string, b: string): boolean {
  const home = game.homeTeamAbbr.toUpperCase();
  const away = game.awayTeamAbbr.toUpperCase();
  return (home === a && away === b) || (home === b && away === a);
}

function candidateOf(game: XrayGameRecord): GameResolutionCandidate {
  return {
    gameId: game.gameId,
    startTime: game.startTime,
    homeTeamAbbr: game.homeTeamAbbr,
    awayTeamAbbr: game.awayTeamAbbr,
  };
}

export function resolveGameIdentity(input: {
  games: XrayGameRecord[];
  teams: XrayTeamRecord[];
  context?: XrayResolutionContext;
  gameDate: string | null | undefined;
  teamAbbr: string | null | undefined;
  opponentAbbr: string | null | undefined;
  matchupLabel: string | null | undefined;
}): GameFieldResolution {
  const date = contextualSlateDate(input.context, input.gameDate);
  const matchup = parseMatchupAbbrs(input.matchupLabel, input.teams);
  const team = resolveTeamAbbr(input.teamAbbr, input.teams);
  const opp = resolveTeamAbbr(input.opponentAbbr, input.teams);
  const left = team?.abbreviation ?? matchup?.left ?? null;
  const right = opp?.abbreviation ?? matchup?.right ?? null;

  if (!date) {
    return {
      status: 'UNRESOLVED',
      value: null,
      extracted: input.gameDate ?? input.matchupLabel ?? null,
      reason: 'MISSING_DATE',
      candidates: [],
    };
  }
  if (!left || !right) {
    return {
      status: 'UNRESOLVED',
      value: null,
      extracted: input.matchupLabel ?? null,
      reason: 'MISSING_MATCHUP',
      candidates: [],
    };
  }

  const hits = input.games.filter((g) => gameYmd(g) === date && sameMatchup(g, left, right));
  if (hits.length === 1) {
    const game = hits[0]!;
    return {
      status: 'RESOLVED',
      value: {
        gameId: game.gameId,
        startTime: game.startTime,
        homeTeamAbbr: game.homeTeamAbbr,
        awayTeamAbbr: game.awayTeamAbbr,
      },
      extracted: date,
      reason: null,
      candidates: [candidateOf(game)],
    };
  }
  if (hits.length > 1) {
    return {
      status: 'NEEDS_CONFIRMATION',
      value: null,
      extracted: date,
      reason: 'AMBIGUOUS_GAME',
      candidates: hits.map(candidateOf),
    };
  }
  return {
    status: 'UNRESOLVED',
    value: null,
    extracted: date,
    reason: 'NO_GAME',
    candidates: [],
  };
}
