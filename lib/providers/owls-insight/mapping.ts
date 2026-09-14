import { CC_SEASON_TO_OWLS } from './contract';
import type { CourtContextGame, GameMappingResult, IdentityClass, OwlsGameLike, PlayerMappingResult } from './types';

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

export function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizePersonName(value: string): string {
  const stripped = stripDiacritics(value)
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[.]/g, '')
    .replace(/[-_/]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = stripped.split(' ').filter((p) => p && !SUFFIXES.has(p));
  return parts.join(' ');
}

export const TEAM_ALIASES: Record<string, string> = {
  atl: 'ATL',
  atlanta: 'ATL',
  hawks: 'ATL',
  'atlanta hawks': 'ATL',
  bos: 'BOS',
  boston: 'BOS',
  celtics: 'BOS',
  'boston celtics': 'BOS',
  bkn: 'BKN',
  brooklyn: 'BKN',
  nets: 'BKN',
  'brooklyn nets': 'BKN',
  'new jersey nets': 'BKN',
  cha: 'CHA',
  charlotte: 'CHA',
  hornets: 'CHA',
  'charlotte hornets': 'CHA',
  chi: 'CHI',
  chicago: 'CHI',
  bulls: 'CHI',
  'chicago bulls': 'CHI',
  cle: 'CLE',
  cleveland: 'CLE',
  cavaliers: 'CLE',
  cavs: 'CLE',
  'cleveland cavaliers': 'CLE',
  dal: 'DAL',
  dallas: 'DAL',
  mavericks: 'DAL',
  mavs: 'DAL',
  'dallas mavericks': 'DAL',
  den: 'DEN',
  denver: 'DEN',
  nuggets: 'DEN',
  'denver nuggets': 'DEN',
  det: 'DET',
  detroit: 'DET',
  pistons: 'DET',
  'detroit pistons': 'DET',
  gsw: 'GSW',
  'golden state': 'GSW',
  warriors: 'GSW',
  'golden state warriors': 'GSW',
  hou: 'HOU',
  houston: 'HOU',
  rockets: 'HOU',
  'houston rockets': 'HOU',
  ind: 'IND',
  indiana: 'IND',
  pacers: 'IND',
  'indiana pacers': 'IND',
  lac: 'LAC',
  clippers: 'LAC',
  'la clippers': 'LAC',
  'los angeles clippers': 'LAC',
  'l.a. clippers': 'LAC',
  lal: 'LAL',
  lakers: 'LAL',
  'la lakers': 'LAL',
  'los angeles lakers': 'LAL',
  'l.a. lakers': 'LAL',
  mem: 'MEM',
  memphis: 'MEM',
  grizzlies: 'MEM',
  'memphis grizzlies': 'MEM',
  mia: 'MIA',
  miami: 'MIA',
  heat: 'MIA',
  'miami heat': 'MIA',
  mil: 'MIL',
  milwaukee: 'MIL',
  bucks: 'MIL',
  'milwaukee bucks': 'MIL',
  min: 'MIN',
  minnesota: 'MIN',
  timberwolves: 'MIN',
  wolves: 'MIN',
  'minnesota timberwolves': 'MIN',
  nop: 'NOP',
  'new orleans': 'NOP',
  pelicans: 'NOP',
  'new orleans pelicans': 'NOP',
  nyk: 'NYK',
  'new york': 'NYK',
  knicks: 'NYK',
  'ny knicks': 'NYK',
  'new york knicks': 'NYK',
  okc: 'OKC',
  'oklahoma city': 'OKC',
  thunder: 'OKC',
  'oklahoma city thunder': 'OKC',
  orl: 'ORL',
  orlando: 'ORL',
  magic: 'ORL',
  'orlando magic': 'ORL',
  phi: 'PHI',
  philadelphia: 'PHI',
  sixers: 'PHI',
  '76ers': 'PHI',
  'philadelphia 76ers': 'PHI',
  phx: 'PHX',
  phoenix: 'PHX',
  suns: 'PHX',
  'phoenix suns': 'PHX',
  por: 'POR',
  portland: 'POR',
  'trail blazers': 'POR',
  blazers: 'POR',
  'portland trail blazers': 'POR',
  sac: 'SAC',
  sacramento: 'SAC',
  kings: 'SAC',
  'sacramento kings': 'SAC',
  sas: 'SAS',
  'san antonio': 'SAS',
  spurs: 'SAS',
  'san antonio spurs': 'SAS',
  tor: 'TOR',
  toronto: 'TOR',
  raptors: 'TOR',
  'toronto raptors': 'TOR',
  uta: 'UTA',
  utah: 'UTA',
  jazz: 'UTA',
  'utah jazz': 'UTA',
  was: 'WAS',
  washington: 'WAS',
  wizards: 'WAS',
  'washington wizards': 'WAS',
};

export function normalizeTeamKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = stripDiacritics(value).toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  return TEAM_ALIASES[raw] ?? TEAM_ALIASES[raw.replace(/^the /, '')] ?? raw.toUpperCase();
}

const DEFAULT_TIME_WINDOW_MS = 18 * 60 * 60 * 1000;
const POSTPONED_WINDOW_MS = 72 * 60 * 60 * 1000;

export function formatEtYmd(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(t));
}

/** Owls `gameDate` is a date-only midnight UTC stamp. Late ET tips cross UTC midnight. */
export function owlsHistoryDateWindow(startTimeIso: string): { startDate: string; endDate: string } {
  const utcDate = startTimeIso.slice(0, 10);
  const etDate = formatEtYmd(startTimeIso) ?? utcDate;
  return {
    startDate: etDate < utcDate ? etDate : utcDate,
    endDate: etDate > utcDate ? etDate : utcDate,
  };
}

export function matchOwlsGameToCourtContext(
  owls: OwlsGameLike,
  games: CourtContextGame[],
  opts?: { timeWindowMs?: number }
): GameMappingResult {
  const home = normalizeTeamKey(owls.homeTeam);
  const away = normalizeTeamKey(owls.awayTeam);
  const start = owls.startTime ? Date.parse(owls.startTime) : NaN;
  const timeWindow = opts?.timeWindowMs ?? DEFAULT_TIME_WINDOW_MS;
  const seasonHint = owls.season ? owlsSeasonToCc(owls.season) : null;

  const exact: CourtContextGame[] = [];
  const postponed: CourtContextGame[] = [];
  const reversed: CourtContextGame[] = [];

  for (const g of games) {
    const gHome = normalizeTeamKey(g.homeTeam) ?? normalizeTeamKey(g.homeTeamName);
    const gAway = normalizeTeamKey(g.awayTeam) ?? normalizeTeamKey(g.awayTeamName);
    const seasonOk = !seasonHint || g.season === seasonHint;
    if (!seasonOk) continue;
    const gStart = Date.parse(g.startTime);
    const dt = Number.isFinite(start) && Number.isFinite(gStart) ? Math.abs(gStart - start) : Number.POSITIVE_INFINITY;
    const teamsExact = home != null && away != null && gHome === home && gAway === away;
    const teamsReversed = home != null && away != null && gHome === away && gAway === home;
    const sameCalendarDate =
      sameUtcCalendarDate(owls.startTime, g.startTime) ||
      (Boolean(owls.startTime) && formatEtYmd(g.startTime) === owls.startTime!.slice(0, 10));
    if (teamsExact && (dt <= timeWindow || sameCalendarDate)) exact.push(g);
    else if (teamsExact && dt <= POSTPONED_WINDOW_MS) postponed.push(g);
    else if (teamsReversed && dt <= POSTPONED_WINDOW_MS) reversed.push(g);
  }

  if (exact.length === 1) {
    return {
      status: 'MATCHED',
      providerGameId: owls.providerGameId,
      courtContextGameId: exact[0]!.courtContextGameId,
      candidates: [exact[0]!.courtContextGameId],
      reason: 'home_away_season_start_time',
    };
  }
  if (exact.length > 1) {
    return ambiguous(
      owls.providerGameId,
      exact.map((g) => g.courtContextGameId),
      'multiple_games_in_time_window'
    );
  }
  if (postponed.length === 1) {
    return {
      status: 'MATCHED',
      providerGameId: owls.providerGameId,
      courtContextGameId: postponed[0]!.courtContextGameId,
      candidates: [postponed[0]!.courtContextGameId],
      reason: 'postponed_or_rescheduled_unique',
    };
  }
  if (postponed.length > 1) {
    return ambiguous(
      owls.providerGameId,
      postponed.map((g) => g.courtContextGameId),
      'ambiguous_rescheduled_candidates'
    );
  }
  if (reversed.length > 0) {
    return {
      status: 'UNMATCHED',
      providerGameId: owls.providerGameId,
      courtContextGameId: null,
      candidates: reversed.map((g) => g.courtContextGameId),
      reason: 'home_away_reversed_not_auto_accepted',
    };
  }
  return {
    status: 'UNMATCHED',
    providerGameId: owls.providerGameId,
    courtContextGameId: null,
    candidates: [],
    reason: 'no_matching_court_context_game',
  };
}

function sameUtcCalendarDate(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const left = a.slice(0, 10);
  const right = b.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(left) && left === right;
}

function ambiguous(providerGameId: string, candidates: string[], reason: string): GameMappingResult {
  return {
    status: 'AMBIGUOUS',
    providerGameId,
    courtContextGameId: null,
    candidates,
    reason,
  };
}

export function owlsSeasonToCc(owlsSeason: string): string | null {
  const trimmed = owlsSeason.trim();
  for (const [cc, owls] of Object.entries(CC_SEASON_TO_OWLS)) {
    if (owls === trimmed) return cc;
  }
  if (/^\d{4}$/.test(trimmed)) return trimmed;
  return null;
}

export type PlayerIdentitySeed = {
  playerId: string;
  fullName: string;
  teamAbbr?: string | null;
};

export function matchOwlsPlayer(args: {
  providerPlayerId?: string | null;
  providerPlayerName: string;
  teamAbbr?: string | null;
  index: PlayerIdentitySeed[];
  bridgeByProviderId?: Map<string, string[]>;
}): PlayerMappingResult {
  const name = args.providerPlayerName;
  const providerId = args.providerPlayerId?.trim() || null;
  if (providerId && args.bridgeByProviderId) {
    const bridged = args.bridgeByProviderId.get(providerId) ?? [];
    if (bridged.length === 1) {
      return {
        status: 'MATCHED',
        providerPlayerId: providerId,
        providerPlayerName: name,
        courtContextPlayerId: bridged[0]!,
        candidates: bridged,
        reason: 'provider_id_bridge',
      };
    }
    if (bridged.length > 1) {
      return {
        status: 'AMBIGUOUS',
        providerPlayerId: providerId,
        providerPlayerName: name,
        courtContextPlayerId: null,
        candidates: bridged,
        reason: 'provider_id_bridge_conflict',
      };
    }
  }

  const needle = normalizePersonName(name);
  const nameHits = args.index.filter((p) => normalizePersonName(p.fullName) === needle);
  if (nameHits.length === 1) {
    return {
      status: 'MATCHED',
      providerPlayerId: providerId,
      providerPlayerName: name,
      courtContextPlayerId: nameHits[0]!.playerId,
      candidates: [nameHits[0]!.playerId],
      reason: 'normalized_name_unique',
    };
  }
  if (nameHits.length > 1) {
    const team = normalizeTeamKey(args.teamAbbr);
    if (team) {
      const teamHits = nameHits.filter((p) => normalizeTeamKey(p.teamAbbr) === team);
      if (teamHits.length === 1) {
        return {
          status: 'MATCHED',
          providerPlayerId: providerId,
          providerPlayerName: name,
          courtContextPlayerId: teamHits[0]!.playerId,
          candidates: [teamHits[0]!.playerId],
          reason: 'normalized_name_plus_team',
        };
      }
    }
    return {
      status: 'AMBIGUOUS',
      providerPlayerId: providerId,
      providerPlayerName: name,
      courtContextPlayerId: null,
      candidates: nameHits.map((p) => p.playerId),
      reason: 'duplicate_normalized_name',
    };
  }
  return {
    status: 'UNMATCHED',
    providerPlayerId: providerId,
    providerPlayerName: name,
    courtContextPlayerId: null,
    candidates: [],
    reason: 'no_matching_court_context_player',
  };
}

export function identityAccepted(status: IdentityClass): boolean {
  return status === 'MATCHED';
}
