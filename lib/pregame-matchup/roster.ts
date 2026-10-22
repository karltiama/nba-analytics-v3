/**
 * Roster continuity for a pregame matchup.
 *
 * A snapshot says a player was listed on a team on snapshot_date. It is not a
 * transaction, an injury report, or proof the player is available for the game.
 * Shares use 2025–26 regular-season minutes and shot attempts for that same team.
 */

import { evaluateFetchIntegrity } from '@/lib/roster/entity-roster-refresh';

/** Analytics season of the roster list being observed (2026–27). */
export const ROSTER_SEASON = '2026';
export const ROSTER_SEASON_LABEL = '2026-27';
export const ROSTER_SOURCE = 'nba_stats';

/** Observation on or within this many days before the game can support a roster signal. */
export const FRESH_MAX_DAYS = 7;
/** Older than fresh, still a dated observation. Beyond this, shares are withheld. */
export const INFORMATIVE_MAX_DAYS = 21;
/** Unresolved identities at or above either limit can move the share, so it is withheld. */
export const MATERIAL_UNRESOLVED_SHARE = 0.1;
export const MATERIAL_UNRESOLVED_COUNT = 2;
/** Top two resolved listed players, combined, as a share of the team's historical FGA. */
export const CONCENTRATION_FGA_SHARE = 0.4;
export const EXPECTED_ROSTER_TEAMS = 30;

export type RosterFreshness = 'fresh' | 'informative' | 'stale';

export type RosterDaySummary = {
  snapshotDate: string;
  observations: number;
  teams: number;
  players: number;
  minTeamSize: number | null;
  crossTeamDuplicates: number;
  missingAnalyticsTeam: number;
  collectedAt: string | null;
};

/**
 * Unique NBA → entity is resolved even when no 2025–26 log id exists.
 * A missing provider bridge or a conflicting map stays unresolved.
 */
export type RosterIdentityStatus = 'resolved' | 'unresolved_no_bridge' | 'unresolved_ambiguous';

export type RosterMember = {
  teamId: string;
  nbaPlayerId: string;
  /** analytics.players.player_id when a unique entity has a log id. Null is not an identity failure by itself. */
  analyticsPlayerId: string | null;
  name: string | null;
  /**
   * Omitted values keep the prior rule: a null analytics id counts as unresolved.
   * Loaders set this from the provider bridge, never from a name.
   */
  identityStatus?: RosterIdentityStatus;
};

export function classifyRosterIdentity(input: {
  entityId: string | null;
  analyticsPlayerId: string | null;
  alternatePlayerId?: string | null;
  ambiguous?: boolean;
}): { identityStatus: RosterIdentityStatus; analyticsPlayerId: string | null } {
  if (input.ambiguous || !input.entityId) {
    return {
      identityStatus: input.ambiguous ? 'unresolved_ambiguous' : 'unresolved_no_bridge',
      analyticsPlayerId: null,
    };
  }
  const primary = input.analyticsPlayerId;
  const alternate = input.alternatePlayerId ?? null;
  if (primary && alternate && primary !== alternate) {
    return { identityStatus: 'unresolved_ambiguous', analyticsPlayerId: null };
  }
  return { identityStatus: 'resolved', analyticsPlayerId: primary ?? alternate };
}

export type ProductionRow = {
  teamId: string;
  playerId: string;
  minutes: number;
  fga: number;
  fta: number;
  usageMass: number;
  usagePossessions: number;
};

export type ListedKind = 'returning' | 'other_team' | 'no_prior_history' | 'unresolved';

export type TeamContinuity = {
  teamId: string;
  abbr: string;
  listed: number;
  unresolved: number;
  returning: number;
  otherTeam: number;
  noPriorHistory: number;
  minutesNumerator: number;
  minutesDenominator: number;
  minutesShare: number | null;
  fgaNumerator: number;
  fgaDenominator: number;
  fgaShare: number | null;
  ftaNumerator: number;
  ftaDenominator: number;
  ftaShare: number | null;
  concentration: string | null;
};

/** A player listed on the observation already loaded for continuity. Not a starter and not a minutes projection. */
export type ListedRosterPlayer = {
  teamId: string;
  nbaPlayerId: string;
  playerId: string | null;
  name: string | null;
  identityStatus: RosterIdentityStatus;
};

export type RosterPresentation = {
  status: 'shown' | 'hidden';
  observationDate: string | null;
  freshness: RosterFreshness | 'missing' | 'incomplete' | 'unresolved';
  note: string;
  teams: TeamContinuity[] | null;
  source?: 'balldontlie';
  collectedAt?: string | null;
  /**
   * Named only when this observation is eligible to describe membership.
   * Null means the names were withheld. An empty array means the observation listed nobody.
   */
  listedPlayers?: ListedRosterPlayer[] | null;
};

export function listedPlayersFromMembers(members: RosterMember[]): ListedRosterPlayer[] {
  return dedupeMembers(members).map((member) => {
    const identityStatus = member.identityStatus ?? (member.analyticsPlayerId ? 'resolved' : 'unresolved_no_bridge');
    const name = member.name?.trim() ? member.name.trim() : null;
    return {
      teamId: member.teamId,
      nbaPlayerId: member.nbaPlayerId,
      playerId: identityStatus === 'resolved' ? member.analyticsPlayerId : null,
      name,
      identityStatus,
    };
  });
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function calendarDaysBetween(earlier: string, later: string): number | null {
  if (!YMD.test(earlier) || !YMD.test(later)) return null;
  const start = Date.parse(`${earlier}T00:00:00Z`);
  const end = Date.parse(`${later}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86_400_000);
}

export function rosterFreshness(ageDays: number): RosterFreshness {
  if (ageDays <= FRESH_MAX_DAYS) return 'fresh';
  if (ageDays <= INFORMATIVE_MAX_DAYS) return 'informative';
  return 'stale';
}

export function dayIsComplete(day: RosterDaySummary): boolean {
  if (!YMD.test(day.snapshotDate) || !day.collectedAt) return false;
  if (day.missingAnalyticsTeam > 0) return false;
  const integrity = evaluateFetchIntegrity({
    teamsAttempted: EXPECTED_ROSTER_TEAMS,
    teamsSuccessful: day.teams,
    teamsFailed: day.teams < EXPECTED_ROSTER_TEAMS ? [{ abbreviation: 'coverage' }] : [],
    totalObservations: day.observations,
    playersPerTeam: {},
    duplicateNbaPlayerIds: day.crossTeamDuplicates > 0 ? [{ nba_player_id: 'cross-team' }] : [],
    minTeamSize: day.minTeamSize,
  });
  return integrity.ok;
}

/** Latest complete observation on or before the game date. A failed day does not replace an older complete one. */
export function selectQualifyingDay(days: RosterDaySummary[], gameDate: string): RosterDaySummary | null {
  const ordered = [...days].sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
  for (const day of ordered) {
    const age = calendarDaysBetween(day.snapshotDate, gameDate);
    if (age == null || age < 0) continue;
    if (dayIsComplete(day)) return day;
  }
  return null;
}

function dedupeMembers(members: RosterMember[]): RosterMember[] {
  const byKey = new Map<string, RosterMember>();
  for (const member of members) {
    const key = `${member.teamId}|${member.nbaPlayerId}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, member);
      continue;
    }
    const left = existing.identityStatus ?? (existing.analyticsPlayerId ? 'resolved' : 'unresolved_no_bridge');
    const right = member.identityStatus ?? (member.analyticsPlayerId ? 'resolved' : 'unresolved_no_bridge');
    if (left !== right || existing.analyticsPlayerId !== member.analyticsPlayerId) {
      byKey.set(key, { ...existing, analyticsPlayerId: null, identityStatus: 'unresolved_ambiguous' });
    }
  }
  return [...byKey.values()];
}

function positive(rows: ProductionRow[], teamId: string): ProductionRow[] {
  return rows.filter((row) => row.teamId === teamId && row.minutes > 0 && Number.isFinite(row.minutes));
}

function share(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

function usageLabel(row: ProductionRow | undefined): string | null {
  if (!row || row.usagePossessions <= 0) return null;
  const weighted = row.usageMass / row.usagePossessions;
  if (!Number.isFinite(weighted) || weighted < 0 || weighted > 1) return null;
  return `${(weighted * 100).toFixed(1)}%`;
}

function concentrationSentence(abbr: string, date: string, rows: ProductionRow[], teamFga: number, names: Map<string, string>): string | null {
  if (!date) return null;
  if (teamFga <= 0) return null;
  const ranked = [...rows].filter((row) => row.fga > 0 && names.has(row.playerId)).sort((a, b) => b.fga - a.fga || a.playerId.localeCompare(b.playerId));
  const top = ranked.slice(0, 2);
  if (top.length < 2) return null;
  const combined = top[0]!.fga + top[1]!.fga;
  if (combined / teamFga < CONCENTRATION_FGA_SHARE) return null;
  const left = names.get(top[0]!.playerId)!;
  const right = names.get(top[1]!.playerId)!;
  const usage = [usageLabel(top[0]), usageLabel(top[1])];
  const usageText = usage[0] && usage[1] ? ` Last season their possession-weighted usage was ${usage[0]} and ${usage[1]}. That is not an expected role for 2026–27.` : '';
  return `Among ${abbr} players listed on ${date} whose identities resolved, ${left} and ${right} accounted for ${((combined / teamFga) * 100).toFixed(1)}% of the team's 2025–26 regular-season field-goal attempts.${usageText}`;
}

export function teamContinuity(input: {
  teamId: string;
  abbr: string;
  observationDate: string;
  members: RosterMember[];
  production: ProductionRow[];
}): TeamContinuity {
  const listed = dedupeMembers(input.members.filter((member) => member.teamId === input.teamId));
  const mine = positive(input.production, input.teamId);
  const minutesDenominator = mine.reduce((sum, row) => sum + row.minutes, 0);
  const fgaDenominator = mine.reduce((sum, row) => sum + (row.fga > 0 ? row.fga : 0), 0);
  const ftaDenominator = mine.reduce((sum, row) => sum + (row.fta > 0 ? row.fta : 0), 0);
  const resolved = new Map<string, RosterMember>();
  let unresolved = 0;
  let noPriorHistory = 0;
  for (const member of listed) {
    const status = member.identityStatus ?? (member.analyticsPlayerId ? 'resolved' : 'unresolved_no_bridge');
    if (status !== 'resolved') {
      unresolved += 1;
      continue;
    }
    if (!member.analyticsPlayerId) {
      noPriorHistory += 1;
      continue;
    }
    resolved.set(member.analyticsPlayerId, member);
  }
  const thisTeamIds = new Set(mine.map((row) => row.playerId));
  const anyTeamIds = new Set(input.production.filter((row) => row.minutes > 0).map((row) => row.playerId));
  let returning = 0;
  let otherTeam = 0;
  const returningIds = new Set<string>();
  for (const [playerId] of resolved) {
    if (thisTeamIds.has(playerId)) {
      returning += 1;
      returningIds.add(playerId);
    } else if (anyTeamIds.has(playerId)) {
      otherTeam += 1;
    } else {
      noPriorHistory += 1;
    }
  }
  const returningRows = mine.filter((row) => returningIds.has(row.playerId));
  const minutesNumerator = returningRows.reduce((sum, row) => sum + row.minutes, 0);
  const fgaNumerator = returningRows.reduce((sum, row) => sum + (row.fga > 0 ? row.fga : 0), 0);
  const ftaNumerator = returningRows.reduce((sum, row) => sum + (row.fta > 0 ? row.fta : 0), 0);
  const names = new Map<string, string>();
  for (const member of resolved.values()) {
    if (member.analyticsPlayerId && member.name?.trim()) names.set(member.analyticsPlayerId, member.name.trim());
  }
  return {
    teamId: input.teamId,
    abbr: input.abbr,
    listed: listed.length,
    unresolved,
    returning,
    otherTeam,
    noPriorHistory,
    minutesNumerator,
    minutesDenominator,
    minutesShare: share(minutesNumerator, minutesDenominator),
    fgaNumerator,
    fgaDenominator,
    fgaShare: share(fgaNumerator, fgaDenominator),
    ftaNumerator,
    ftaDenominator,
    ftaShare: share(ftaNumerator, ftaDenominator),
    concentration: concentrationSentence(input.abbr, input.observationDate, returningRows, fgaDenominator, names),
  };
}

function identityDistorts(team: TeamContinuity): boolean {
  if (team.listed <= 0) return true;
  if (team.unresolved >= MATERIAL_UNRESOLVED_COUNT) return true;
  return team.unresolved / team.listed >= MATERIAL_UNRESOLVED_SHARE;
}

export function presentRoster(input: {
  gameDate: string;
  day: RosterDaySummary | null;
  teams: TeamContinuity[];
}): RosterPresentation {
  if (!input.day) {
    return {
      status: 'hidden',
      observationDate: null,
      freshness: 'missing',
      note: 'Current roster continuity is unavailable.',
      teams: null,
      listedPlayers: null,
    };
  }
  const age = calendarDaysBetween(input.day.snapshotDate, input.gameDate);
  if (age == null || age < 0 || !dayIsComplete(input.day)) {
    return {
      status: 'hidden',
      observationDate: null,
      freshness: 'incomplete',
      note: 'Current roster continuity is unavailable. The stored roster observation is incomplete.',
      teams: null,
      listedPlayers: null,
    };
  }
  const freshness = rosterFreshness(age);
  if (freshness === 'stale') {
    return {
      status: 'hidden',
      observationDate: input.day.snapshotDate,
      freshness,
      note: `Current roster continuity is unavailable. The latest complete observation (${input.day.snapshotDate}) is too old to describe the roster for this game.`,
      teams: null,
      listedPlayers: null,
    };
  }
  const distorted = input.teams.filter(identityDistorts);
  if (distorted.length > 0 || input.teams.some((team) => team.minutesShare == null || team.fgaShare == null)) {
    return {
      status: 'hidden',
      observationDate: input.day.snapshotDate,
      freshness: 'unresolved',
      note: `Current roster continuity is unavailable. The ${input.day.snapshotDate} observation has unresolved player identities, so a continuity percentage would not be reliable.`,
      teams: null,
      listedPlayers: null,
    };
  }
  const ageNote = freshness === 'informative' ? ' This observation is older than a week, so it describes that date, not tonight.' : '';
  return {
    status: 'shown',
    observationDate: input.day.snapshotDate,
    freshness,
    note: `Roster list observed ${input.day.snapshotDate}. A listing is not confirmation that a player is available, active, or starting.${ageNote}`,
    teams: input.teams,
  };
}

export function formatRosterObservationLabel(ymd: string): string {
  if (!YMD.test(ymd)) return ymd;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${ymd}T00:00:00Z`));
}

export function presentBdlRoster(input: {
  observationEtDate: string | null;
  collectedAt: string | null;
  reason: 'eligible' | 'missing' | 'incomplete' | 'after_tipoff' | 'invalid_time';
  freshness: RosterFreshness | null;
  teams: TeamContinuity[];
  /** Members already read for the continuity shares. Omitted when that read did not run. */
  members?: RosterMember[];
}): RosterPresentation {
  const label = input.observationEtDate ? formatRosterObservationLabel(input.observationEtDate) : null;
  const base = {
    source: 'balldontlie' as const,
    collectedAt: input.collectedAt,
  };
  if (input.reason === 'after_tipoff') {
    return {
      ...base,
      status: 'hidden',
      observationDate: input.observationEtDate,
      freshness: 'incomplete',
      note: 'Current roster continuity is unavailable. The stored roster observation was collected after this game tipped off, so it is not pregame evidence.',
      teams: null,
      listedPlayers: null,
    };
  }
  if (input.reason === 'incomplete') {
    return {
      ...base,
      status: 'hidden',
      observationDate: null,
      freshness: 'incomplete',
      note: 'Current roster continuity is unavailable. The stored roster observation is incomplete.',
      teams: null,
      listedPlayers: null,
    };
  }
  if (input.reason !== 'eligible' || !input.observationEtDate || !input.freshness || !label) {
    return {
      ...base,
      status: 'hidden',
      observationDate: null,
      freshness: 'missing',
      note: 'Current roster continuity is unavailable. No eligible BallDontLie roster observation was stored before tipoff.',
      teams: null,
      listedPlayers: null,
    };
  }
  if (input.freshness === 'stale') {
    return {
      ...base,
      status: 'hidden',
      observationDate: input.observationEtDate,
      freshness: 'stale',
      note: `Current roster continuity is unavailable. The latest complete observation (${label}) is too old to describe the roster for this game.`,
      teams: null,
      listedPlayers: null,
    };
  }
  const distorted = input.teams.filter(identityDistorts);
  if (distorted.length > 0 || input.teams.some((team) => team.minutesShare == null || team.fgaShare == null)) {
    return {
      ...base,
      status: 'hidden',
      observationDate: input.observationEtDate,
      freshness: 'unresolved',
      note: `Current roster continuity is unavailable. The ${label} observation has unresolved player identities, so a continuity percentage would not be reliable.`,
      teams: null,
      listedPlayers: null,
    };
  }
  const ageNote = input.freshness === 'informative'
    ? ` This observation is older than a week, so it describes ${label}, not tonight.`
    : '';
  return {
    ...base,
    status: 'shown',
    observationDate: input.observationEtDate,
    freshness: input.freshness,
    note: `Roster observation: ${label}. Players listed by BALLDONTLIE in the most recent eligible observation. Returning minutes share based on 2025–26 regular-season production. A listing is not confirmation that a player is available, active, or starting.${ageNote}`,
    teams: input.teams,
    listedPlayers: input.members ? listedPlayersFromMembers(input.members) : null,
  };
}

export function hiddenRosterForUnconfirmedTeam(): RosterPresentation {
  return {
    status: 'hidden',
    observationDate: null,
    freshness: 'missing',
    note: 'Current roster continuity is unavailable.',
    teams: null,
      listedPlayers: null,
  };
}
