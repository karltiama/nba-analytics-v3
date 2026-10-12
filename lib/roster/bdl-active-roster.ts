/**
 * BallDontLie active-player roster collection.
 * The transport is injected. This module does not read credentials or call the network.
 * A finished pagination is response integrity, not an official league roster.
 */

export const BDL_ROSTER_PROVIDER = 'balldontlie' as const;
export const BDL_ACTIVE_ROSTER_ENDPOINT = '/nba/v1/players/active';
export const BDL_ACTIVE_ROSTER_URL = 'https://api.balldontlie.io/nba/v1/players/active';
export const BDL_ROSTER_SEASON_LABEL = '2026-27';
export const BDL_ROSTER_PER_PAGE = 100;
export const BDL_ROSTER_DEFAULT_MAX_REQUESTS = 12;
export const BDL_ROSTER_MIN_TEAM_SIZE = 12;
export const BDL_ROSTER_MAX_TEAM_SIZE = 30;
export const BDL_ROSTER_MIN_LEAGUE = 450;
export const BDL_ROSTER_MAX_LEAGUE = 780;
export const BDL_ROSTER_COVERAGE_SHIFT = 0.15;
export const BDL_ROSTER_COMPLETENESS = 'response_integrity' as const;

/** Current NBA abbreviations. Numeric BallDontLie team ids are not analytics.teams.team_id. */
export const CURRENT_NBA_ABBREVIATIONS = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS',
] as const;

const ABBREVIATION_SET = new Set<string>(CURRENT_NBA_ABBREVIATIONS);

export type ActiveRosterPlayer = {
  providerPlayerId: string;
  providerTeamId: string;
  teamAbbreviation: string;
};

export type RosterTransportResponse = {
  status: number;
  body: unknown;
  retryAfter?: string | null;
};

export type RosterTransport = (url: string) => Promise<RosterTransportResponse>;

export type RosterCollectionFailure =
  | 'budget'
  | 'timeout'
  | 'transport'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'http'
  | 'malformed'
  | 'missing_player_id'
  | 'missing_team'
  | 'repeated_cursor'
  | 'pagination';

export type ActiveRosterCollection = {
  provider: typeof BDL_ROSTER_PROVIDER;
  endpoint: typeof BDL_ACTIVE_ROSTER_ENDPOINT;
  seasonLabel: string;
  observedAt: string | null;
  requestCount: number;
  successfulPages: number;
  players: ActiveRosterPlayer[];
  teamCounts: Record<string, number>;
  missingPlayerIds: number;
  missingTeams: number;
  duplicatePlayerIds: string[];
  teamConflicts: string[];
  unexpectedTeams: string[];
  paginationComplete: boolean;
  error: RosterCollectionFailure | null;
  validation: { ok: boolean; failures: string[] };
};

export function activeRosterUrl(cursor: string | null): string {
  const params = new URLSearchParams();
  params.set('per_page', String(BDL_ROSTER_PER_PAGE));
  if (cursor) params.set('cursor', cursor);
  return `${BDL_ACTIVE_ROSTER_URL}?${params.toString()}`;
}

function cursorToken(value: unknown): string | null | 'invalid' {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^\d{1,12}$/.test(value)) return value;
  return 'invalid';
}

export function parseActivePlayersPage(body: unknown):
  | { ok: true; players: ActiveRosterPlayer[]; nextCursor: string | null; perPage: number | null; missingPlayerIds: number; missingTeams: number }
  | { ok: false; reason: 'malformed' | 'missing_player_id' | 'missing_team' } {
  if (typeof body !== 'object' || body === null) return { ok: false, reason: 'malformed' };
  const record = body as { data?: unknown; meta?: unknown };
  if (!Array.isArray(record.data)) return { ok: false, reason: 'malformed' };
  if (record.data.length > BDL_ROSTER_PER_PAGE) return { ok: false, reason: 'malformed' };
  const players: ActiveRosterPlayer[] = [];
  let missingPlayerIds = 0;
  let missingTeams = 0;
  for (const item of record.data) {
    if (typeof item !== 'object' || item === null) return { ok: false, reason: 'malformed' };
    const row = item as { id?: unknown; team?: unknown };
    if (row.id == null || row.id === '') {
      missingPlayerIds += 1;
      return { ok: false, reason: 'missing_player_id' };
    }
    const playerId = typeof row.id === 'number' ? String(row.id) : typeof row.id === 'string' ? row.id : '';
    if (!/^[0-9]{1,16}$/.test(playerId)) return { ok: false, reason: 'malformed' };
    if (typeof row.team !== 'object' || row.team === null) {
      missingTeams += 1;
      return { ok: false, reason: 'missing_team' };
    }
    const team = row.team as { id?: unknown; abbreviation?: unknown };
    if (team.id == null || team.abbreviation == null || team.abbreviation === '') {
      missingTeams += 1;
      return { ok: false, reason: 'missing_team' };
    }
    const teamId = typeof team.id === 'number' ? String(team.id) : typeof team.id === 'string' ? team.id : '';
    const abbreviation = typeof team.abbreviation === 'string' ? team.abbreviation.trim().toUpperCase() : '';
    if (!/^[0-9]{1,8}$/.test(teamId) || !/^[A-Z]{2,4}$/.test(abbreviation)) {
      return { ok: false, reason: 'malformed' };
    }
    players.push({ providerPlayerId: playerId, providerTeamId: teamId, teamAbbreviation: abbreviation });
  }
  let nextCursor: string | null = null;
  let perPage: number | null = null;
  if (record.meta != null) {
    if (typeof record.meta !== 'object') return { ok: false, reason: 'malformed' };
    const meta = record.meta as { next_cursor?: unknown; per_page?: unknown };
    const token = cursorToken(meta.next_cursor);
    if (token === 'invalid') return { ok: false, reason: 'malformed' };
    nextCursor = token;
    if (meta.per_page != null) {
      if (typeof meta.per_page !== 'number' || !Number.isInteger(meta.per_page)) return { ok: false, reason: 'malformed' };
      perPage = meta.per_page;
    }
  }
  return { ok: true, players, nextCursor, perPage, missingPlayerIds, missingTeams };
}

function isTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = 'name' in error ? String(error.name) : '';
  const message = 'message' in error ? String(error.message).toLowerCase() : '';
  return name === 'AbortError' || name === 'TimeoutError' || message.includes('timeout');
}

export function validateLeagueObservation(input: {
  provider: string;
  endpoint: string;
  seasonLabel: string;
  observedAt: string | null;
  paginationComplete: boolean;
  repeatedCursor: boolean;
  players: ActiveRosterPlayer[];
  perPageMismatch: boolean;
  priorLeagueCount?: number | null;
  teamSizes?: Record<string, number>;
}): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  if (input.provider !== BDL_ROSTER_PROVIDER) failures.push('provider');
  if (input.endpoint !== BDL_ACTIVE_ROSTER_ENDPOINT) failures.push('endpoint');
  if (input.seasonLabel !== BDL_ROSTER_SEASON_LABEL) failures.push('season');
  if (!input.paginationComplete) failures.push('pagination');
  if (input.repeatedCursor) failures.push('repeated_cursor');
  if (input.perPageMismatch) failures.push('per_page');
  if (!input.observedAt || Number.isNaN(Date.parse(input.observedAt))) failures.push('timestamp');

  const seen = new Map<string, string>();
  const counts = new Map<string, number>();
  const teamIds = new Map<string, string>();
  for (const player of input.players) {
    if (!/^[0-9]{1,16}$/.test(player.providerPlayerId)) failures.push('player_id');
    if (!/^[0-9]{1,8}$/.test(player.providerTeamId)) failures.push('team_id');
    if (!ABBREVIATION_SET.has(player.teamAbbreviation)) failures.push('unexpected_team');
    const previous = seen.get(player.providerPlayerId);
    if (previous == null) {
      seen.set(player.providerPlayerId, `${player.providerTeamId}|${player.teamAbbreviation}`);
    } else if (previous !== `${player.providerTeamId}|${player.teamAbbreviation}`) {
      failures.push('team_conflict');
    } else {
      failures.push('duplicate_player');
    }
    counts.set(player.teamAbbreviation, (counts.get(player.teamAbbreviation) ?? 0) + 1);
    const knownTeam = teamIds.get(player.teamAbbreviation);
    if (knownTeam == null) teamIds.set(player.teamAbbreviation, player.providerTeamId);
    else if (knownTeam !== player.providerTeamId) failures.push('team_id_conflict');
  }

  const sizes = input.teamSizes ?? Object.fromEntries(counts);
  for (const abbreviation of CURRENT_NBA_ABBREVIATIONS) {
    const size = sizes[abbreviation];
    if (size == null) failures.push('missing_team');
    else if (size === 0) failures.push('empty_team');
    else if (size < BDL_ROSTER_MIN_TEAM_SIZE || size > BDL_ROSTER_MAX_TEAM_SIZE) failures.push('team_size');
  }
  for (const abbreviation of Object.keys(sizes)) {
    if (!ABBREVIATION_SET.has(abbreviation)) failures.push('unexpected_team');
  }

  const total = input.players.length;
  if (total < BDL_ROSTER_MIN_LEAGUE || total > BDL_ROSTER_MAX_LEAGUE) failures.push('league_count');
  const prior = input.priorLeagueCount;
  if (prior != null && prior > 0) {
    const shift = Math.abs(total - prior) / prior;
    if (shift > BDL_ROSTER_COVERAGE_SHIFT) failures.push('coverage_shift');
  }
  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}

function teamCountsOf(players: ActiveRosterPlayer[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const player of players) counts[player.teamAbbreviation] = (counts[player.teamAbbreviation] ?? 0) + 1;
  return counts;
}

function identityFindings(players: ActiveRosterPlayer[]): { duplicatePlayerIds: string[]; teamConflicts: string[]; unexpectedTeams: string[] } {
  const teams = new Map<string, Set<string>>();
  const copies = new Map<string, number>();
  const unexpected = new Set<string>();
  for (const player of players) {
    const set = teams.get(player.providerPlayerId) ?? new Set<string>();
    set.add(`${player.providerTeamId}|${player.teamAbbreviation}`);
    teams.set(player.providerPlayerId, set);
    copies.set(player.providerPlayerId, (copies.get(player.providerPlayerId) ?? 0) + 1);
    if (!ABBREVIATION_SET.has(player.teamAbbreviation)) unexpected.add(player.teamAbbreviation);
  }
  const duplicatePlayerIds: string[] = [];
  const teamConflicts: string[] = [];
  for (const [playerId, set] of teams) {
    if (set.size > 1) teamConflicts.push(playerId);
    else if ((copies.get(playerId) ?? 0) > 1) duplicatePlayerIds.push(playerId);
  }
  return { duplicatePlayerIds, teamConflicts, unexpectedTeams: [...unexpected] };
}

export function parseBdlRosterCollectArgs(argv: readonly string[]): {
  ok: true;
  seasonLabel: string;
  apply: boolean;
  maxRequests: number;
} | { ok: false; message: string } {
  const seasonArg = argv.find((arg) => arg.startsWith('--season='));
  const seasonLabel = seasonArg ? seasonArg.slice('--season='.length) : null;
  if (seasonLabel !== BDL_ROSTER_SEASON_LABEL) {
    return { ok: false, message: `season must be ${BDL_ROSTER_SEASON_LABEL}` };
  }
  const dryRun = argv.includes('--dry-run');
  const applyFlag = argv.includes('--apply');
  if (!dryRun && !applyFlag) return { ok: false, message: 'pass --dry-run or --apply' };
  const maxArg = argv.find((arg) => arg.startsWith('--max-requests='));
  const maxRaw = maxArg ? maxArg.slice('--max-requests='.length) : null;
  const maxRequests = maxRaw == null ? BDL_ROSTER_DEFAULT_MAX_REQUESTS : Number(maxRaw);
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > BDL_ROSTER_DEFAULT_MAX_REQUESTS) {
    return { ok: false, message: `max-requests must be an integer from 1 to ${BDL_ROSTER_DEFAULT_MAX_REQUESTS}` };
  }
  return { ok: true, seasonLabel, apply: applyFlag && !dryRun, maxRequests };
}

export async function collectBdlActiveRoster(input: {
  transport: RosterTransport;
  seasonLabel?: string;
  maxRequests?: number;
  observedAt?: string;
  priorLeagueCount?: number | null;
  now?: () => Date;
}): Promise<ActiveRosterCollection> {
  const seasonLabel = input.seasonLabel ?? BDL_ROSTER_SEASON_LABEL;
  const maxRequests = input.maxRequests ?? BDL_ROSTER_DEFAULT_MAX_REQUESTS;
  const observedAt = input.observedAt ?? (input.now ?? (() => new Date()))().toISOString();
  const players: ActiveRosterPlayer[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let requestCount = 0;
  let successfulPages = 0;
  let error: RosterCollectionFailure | null = null;
  let paginationComplete = false;
  let repeatedCursor = false;
  let perPageMismatch = false;
  let missingPlayerIds = 0;
  let missingTeams = 0;

  while (requestCount < maxRequests) {
    const requestCursor: string | null = cursor;
    if (requestCursor && seenCursors.has(requestCursor)) {
      repeatedCursor = true;
      error = 'repeated_cursor';
      break;
    }
    requestCount += 1;
    let response: RosterTransportResponse;
    try {
      response = await input.transport(activeRosterUrl(requestCursor));
    } catch (caught) {
      error = isTimeout(caught) ? 'timeout' : 'transport';
      break;
    }
    if (response.status === 401) {
      error = 'unauthorized';
      break;
    }
    if (response.status === 403) {
      error = 'forbidden';
      break;
    }
    if (response.status === 429) {
      error = 'rate_limited';
      break;
    }
    if (response.status !== 200) {
      error = 'http';
      break;
    }
    const page = parseActivePlayersPage(response.body);
    if (!page.ok) {
      error = page.reason;
      if (page.reason === 'missing_player_id') missingPlayerIds += 1;
      if (page.reason === 'missing_team') missingTeams += 1;
      break;
    }
    if (requestCursor) seenCursors.add(requestCursor);
    if (page.perPage != null && page.perPage !== BDL_ROSTER_PER_PAGE) perPageMismatch = true;
    successfulPages += 1;
    players.push(...page.players);
    if (page.nextCursor == null) {
      paginationComplete = true;
      break;
    }
    if (seenCursors.has(page.nextCursor) || page.nextCursor === requestCursor) {
      repeatedCursor = true;
      error = 'repeated_cursor';
      break;
    }
    cursor = page.nextCursor;
  }

  if (!paginationComplete && error == null) error = 'budget';
  const findings = identityFindings(players);
  const validation = validateLeagueObservation({
    provider: BDL_ROSTER_PROVIDER,
    endpoint: BDL_ACTIVE_ROSTER_ENDPOINT,
    seasonLabel,
    observedAt,
    paginationComplete,
    repeatedCursor,
    players,
    perPageMismatch,
    priorLeagueCount: input.priorLeagueCount,
  });
  if (error === 'missing_player_id') missingPlayerIds = Math.max(missingPlayerIds, 1);
  if (error === 'missing_team') missingTeams = Math.max(missingTeams, 1);
  const absentTeams = CURRENT_NBA_ABBREVIATIONS.filter((abbreviation) => !(abbreviation in teamCountsOf(players))).length;

  return {
    provider: BDL_ROSTER_PROVIDER,
    endpoint: BDL_ACTIVE_ROSTER_ENDPOINT,
    seasonLabel,
    observedAt,
    requestCount,
    successfulPages,
    players,
    teamCounts: teamCountsOf(players),
    missingPlayerIds,
    missingTeams: missingTeams + (paginationComplete ? absentTeams : 0),
    duplicatePlayerIds: findings.duplicatePlayerIds,
    teamConflicts: findings.teamConflicts,
    unexpectedTeams: findings.unexpectedTeams,
    paginationComplete,
    error,
    validation,
  };
}
