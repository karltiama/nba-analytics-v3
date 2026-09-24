/**
 * Deterministic Court Context game → provider event matching.
 * Does not assume Court Context gameId equals provider event id.
 */

import { EVENT_COMMENCE_TOLERANCE_MS, type GameMatchContext } from './types';

export type ProviderEventCandidate = {
  /** Provider-internal event id (not sportsbook-native). */
  providerEventId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTimeIso: string;
};

export type EventMatchResult =
  | { status: 'matched'; event: ProviderEventCandidate }
  | { status: 'ambiguous'; candidates: ProviderEventCandidate[] }
  | { status: 'not_found' };

/** Odds API full team name → Court Context / bbref-style abbreviation. */
export const ODDS_API_TEAM_NAME_TO_ABBR: Record<string, string> = {
  'Atlanta Hawks': 'ATL',
  'Boston Celtics': 'BOS',
  'Brooklyn Nets': 'BRK',
  'Charlotte Hornets': 'CHO',
  'Chicago Bulls': 'CHI',
  'Cleveland Cavaliers': 'CLE',
  'Dallas Mavericks': 'DAL',
  'Denver Nuggets': 'DEN',
  'Detroit Pistons': 'DET',
  'Golden State Warriors': 'GSW',
  'Houston Rockets': 'HOU',
  'Indiana Pacers': 'IND',
  'Los Angeles Clippers': 'LAC',
  'LA Clippers': 'LAC',
  'Los Angeles Lakers': 'LAL',
  'Memphis Grizzlies': 'MEM',
  'Miami Heat': 'MIA',
  'Milwaukee Bucks': 'MIL',
  'Minnesota Timberwolves': 'MIN',
  'New Orleans Pelicans': 'NOP',
  'New York Knicks': 'NYK',
  'Oklahoma City Thunder': 'OKC',
  'Orlando Magic': 'ORL',
  'Philadelphia 76ers': 'PHI',
  'Phoenix Suns': 'PHO',
  'Portland Trail Blazers': 'POR',
  'Sacramento Kings': 'SAC',
  'San Antonio Spurs': 'SAS',
  'Toronto Raptors': 'TOR',
  'Utah Jazz': 'UTA',
  'Washington Wizards': 'WAS',
};

/** Common alias → canonical schedule abbreviation used in matching. */
const ABBR_ALIASES: Record<string, string> = {
  BKN: 'BRK',
  CHA: 'CHO',
  PHX: 'PHO',
};

export function normalizeTeamAbbreviation(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim().toUpperCase() ?? '';
  if (!trimmed) return null;
  return ABBR_ALIASES[trimmed] ?? trimmed;
}

export function teamNameToAbbreviation(teamName: string): string | null {
  return normalizeTeamAbbreviation(ODDS_API_TEAM_NAME_TO_ABBR[teamName] ?? null);
}

/**
 * Parse "AWAY @ HOME" / "AWAY vs HOME" style labels into abbreviations.
 * Returns null if the label is not parseable into two tokens.
 */
export function parseGameLabelToMatchContext(
  gameLabel: string | null | undefined,
  commenceTimeIso: string | null | undefined
): GameMatchContext | null {
  const label = gameLabel?.trim() ?? '';
  if (!label || !commenceTimeIso) return null;

  const parts = label.split(/\s+(?:@|vs\.?|v)\s+/i);
  if (parts.length !== 2) return null;

  const away = normalizeTeamAbbreviation(parts[0]);
  const home = normalizeTeamAbbreviation(parts[1]);
  if (!away || !home) return null;

  return {
    awayAbbreviation: away,
    homeAbbreviation: home,
    commenceTimeIso,
  };
}

/**
 * Prefer explicit game context; else derive from leg.gameLabel when tip time is supplied.
 */
export function resolveGameMatchContext(input: {
  game?: GameMatchContext | null;
  gameLabel?: string | null;
  commenceTimeIso?: string | null;
  teamAbbreviation?: string | null;
  opponentAbbreviation?: string | null;
}): GameMatchContext | null {
  if (input.game?.homeAbbreviation && input.game?.awayAbbreviation && input.game?.commenceTimeIso) {
    const home = normalizeTeamAbbreviation(input.game.homeAbbreviation);
    const away = normalizeTeamAbbreviation(input.game.awayAbbreviation);
    if (home && away) {
      return {
        homeAbbreviation: home,
        awayAbbreviation: away,
        commenceTimeIso: input.game.commenceTimeIso,
      };
    }
  }

  return parseGameLabelToMatchContext(input.gameLabel, input.commenceTimeIso);
}

function commenceWithinTolerance(aIso: string, bIso: string, toleranceMs: number): boolean {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= toleranceMs;
}

/**
 * Exact normalized home/away abbreviation match + commence within tolerance.
 * Ambiguous multi-match returns ambiguous (caller must not pick arbitrarily).
 */
export function matchProviderEvent(input: {
  game: GameMatchContext;
  events: readonly ProviderEventCandidate[];
  toleranceMs?: number;
}): EventMatchResult {
  const toleranceMs = input.toleranceMs ?? EVENT_COMMENCE_TOLERANCE_MS;
  const wantHome = normalizeTeamAbbreviation(input.game.homeAbbreviation);
  const wantAway = normalizeTeamAbbreviation(input.game.awayAbbreviation);
  if (!wantHome || !wantAway) return { status: 'not_found' };

  const matches: ProviderEventCandidate[] = [];

  for (const event of input.events) {
    const home = teamNameToAbbreviation(event.homeTeam);
    const away = teamNameToAbbreviation(event.awayTeam);
    if (home !== wantHome || away !== wantAway) continue;
    if (!commenceWithinTolerance(event.commenceTimeIso, input.game.commenceTimeIso, toleranceMs)) {
      continue;
    }
    matches.push(event);
  }

  if (matches.length === 0) return { status: 'not_found' };
  if (matches.length > 1) return { status: 'ambiguous', candidates: matches };
  return { status: 'matched', event: matches[0]! };
}
