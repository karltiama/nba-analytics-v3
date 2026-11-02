/**
 * Key-injury copy for one pregame card.
 * Out and Doubtful use the shared authoritative gate. Questionable also has to
 * come from a snapshot taken on the game's ET date. The card never says
 * "no key injuries" unless that gate passes and an "as of" time exists.
 */

import {
  isFrozenInjuryServing,
  isInjuryAuthoritativeForServing,
  isInjurySnapshotFresh,
  parseInjurySnapshotAt,
} from '@/lib/injuries/freshness';
import { etDateFromInstant } from './schedule';

export const KEY_BASELINE_MINUTES = 10;
export const CURRENT_SEASON_MIN_GAMES = 3;
export const MAX_INJURY_NAMES_PER_TEAM = 2;
/** 2025–26 regular season, stored as the season start year. */
export const PRIOR_BASELINE_SEASON = '2025';

export const INJURY_UNAVAILABLE_TEXT = 'Injury report unavailable';

export type InjuryStatusClass = 'out' | 'doubtful' | 'questionable';
export type BaselineKind = 'current_season' | 'season_2025_26';

export type InjuryStatusLabel = 'Out' | 'Doubtful' | 'Q';

const STATUS_LABEL: Record<InjuryStatusClass, InjuryStatusLabel> = {
  out: 'Out',
  doubtful: 'Doubtful',
  questionable: 'Q',
};

const SEVERITY: Record<InjuryStatusClass, number> = {
  out: 0,
  doubtful: 1,
  questionable: 2,
};

export type PlayerInjuryInput = {
  playerId: string;
  teamId: string;
  lastName: string;
  fullName?: string | null;
  status: string | null;
  snapshotAt: string | null;
  /** Final regular-season + IST games with minutes, this season, this team. */
  currentSeasonGames: number;
  currentSeasonAvgMinutes: number | null;
  /** Final 2025–26 regular-season average, any team. */
  priorSeasonAvgMinutes: number | null;
};

export type SelectedKeyInjury = {
  playerId: string;
  teamId: string;
  lastName: string;
  status: InjuryStatusClass;
  baselineMinutes: number;
  baselineKind: BaselineKind;
};

export type InjuryLine = {
  status: 'listed' | 'none' | 'unavailable';
  text: string;
  asOf: string | null;
};

type Env = Record<string, string | undefined>;

/** Out / Doubtful / Questionable, including case and "Out - knee" style prefixes. */
export function classifyInjuryStatus(status: string | null | undefined): InjuryStatusClass | null {
  const normalized = (status ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith('out')) return 'out';
  if (normalized.startsWith('doubtful')) return 'doubtful';
  if (normalized.startsWith('questionable')) return 'questionable';
  return null;
}

export function injuryLastName(lastName: string | null | undefined, fullName: string | null | undefined): string {
  const last = (lastName ?? '').trim();
  if (last) return last;
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : 'Unknown';
}

export function selectBaseline(player: Pick<
  PlayerInjuryInput,
  'currentSeasonGames' | 'currentSeasonAvgMinutes' | 'priorSeasonAvgMinutes'
>): { minutes: number; kind: BaselineKind } | null {
  if (player.currentSeasonGames >= CURRENT_SEASON_MIN_GAMES) {
    const minutes = player.currentSeasonAvgMinutes;
    if (minutes == null || !Number.isFinite(minutes)) return null;
    return { minutes, kind: 'current_season' };
  }
  const prior = player.priorSeasonAvgMinutes;
  if (prior == null || !Number.isFinite(prior)) return null;
  return { minutes: prior, kind: 'season_2025_26' };
}

/** "5:00 PM ET". Always the ET suffix, including across the DST change. */
export function formatAsOfEt(instant: Date): string | null {
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(instant);
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;
  const dayPeriod = parts.find((part) => part.type === 'dayPeriod')?.value?.toUpperCase();
  if (!hour || !minute || (dayPeriod !== 'AM' && dayPeriod !== 'PM')) return null;
  return `${hour}:${minute} ${dayPeriod} ET`;
}

function displayName(player: PlayerInjuryInput): string {
  return injuryLastName(player.lastName, player.fullName);
}

export function selectKeyInjuries(input: {
  players: PlayerInjuryInput[];
  teamId: string;
  gameEtDate: string;
  now: Date;
  env: Env;
}): SelectedKeyInjury[] {
  const selected: SelectedKeyInjury[] = [];
  for (const player of input.players) {
    if (player.teamId !== input.teamId) continue;
    const status = classifyInjuryStatus(player.status);
    if (!status) continue;
    if (!isInjuryAuthoritativeForServing({ snapshotAt: player.snapshotAt, status: player.status }, input.env, input.now)) {
      continue;
    }
    if (status === 'questionable') {
      const at = parseInjurySnapshotAt(player.snapshotAt);
      const etDate = at ? etDateFromInstant(at) : null;
      if (etDate !== input.gameEtDate) continue;
    }
    const baseline = selectBaseline(player);
    if (!baseline || baseline.minutes < KEY_BASELINE_MINUTES) continue;
    selected.push({
      playerId: player.playerId,
      teamId: player.teamId,
      lastName: displayName(player),
      status,
      baselineMinutes: baseline.minutes,
      baselineKind: baseline.kind,
    });
  }
  selected.sort((a, b) => {
    if (SEVERITY[a.status] !== SEVERITY[b.status]) return SEVERITY[a.status] - SEVERITY[b.status];
    if (a.baselineMinutes !== b.baselineMinutes) return b.baselineMinutes - a.baselineMinutes;
    const name = a.lastName.localeCompare(b.lastName);
    if (name !== 0) return name;
    return a.playerId.localeCompare(b.playerId);
  });
  return selected;
}

function teamNames(players: SelectedKeyInjury[]): string {
  const shown = players.slice(0, MAX_INJURY_NAMES_PER_TEAM);
  const extra = players.length - shown.length;
  const names = shown.map((player) => `${player.lastName} (${STATUS_LABEL[player.status]})`).join(', ');
  return extra > 0 ? `${names} +${extra}` : names;
}

function unavailable(): InjuryLine {
  return { status: 'unavailable', text: INJURY_UNAVAILABLE_TEXT, asOf: null };
}

export function buildInjuryLine(input: {
  gameEtDate: string;
  away: { teamId: string; abbr: string } | null;
  home: { teamId: string; abbr: string } | null;
  players: PlayerInjuryInput[] | null;
  /** Newest snapshot_at on the current table. Null when the table is empty or the read failed. */
  feedSnapshotAt: string | null;
  now: Date;
  env: Env;
}): InjuryLine {
  if (input.players == null || input.away == null || input.home == null) return unavailable();
  if (!input.away.teamId || !input.home.teamId || input.away.teamId === input.home.teamId) return unavailable();
  if (isFrozenInjuryServing(input.env)) return unavailable();

  const teamIds = new Set([input.away.teamId, input.home.teamId]);
  const teamRows = input.players.filter((player) => teamIds.has(player.teamId));
  const isAuthoritative = (player: PlayerInjuryInput) =>
    isInjuryAuthoritativeForServing({ snapshotAt: player.snapshotAt, status: player.status }, input.env, input.now);
  const authoritative = teamRows.filter(isAuthoritative);
  const feedAt = parseInjurySnapshotAt(input.feedSnapshotAt);
  const feedFresh = feedAt != null && isInjurySnapshotFresh(feedAt, input.env, input.now);
  const teamResolved = (teamId: string) => {
    const rows = teamRows.filter((player) => player.teamId === teamId);
    if (rows.length === 0) return feedFresh || authoritative.length > 0;
    return rows.some(isAuthoritative);
  };
  if (!teamResolved(input.away.teamId) || !teamResolved(input.home.teamId)) return unavailable();

  let asOfSource: string | null = null;
  if (authoritative.length > 0) {
    let latest = 0;
    for (const player of authoritative) {
      const at = parseInjurySnapshotAt(player.snapshotAt);
      if (at && at.getTime() >= latest) {
        latest = at.getTime();
        asOfSource = at.toISOString();
      }
    }
  } else if (feedAt && feedFresh) {
    asOfSource = feedAt.toISOString();
  } else {
    return unavailable();
  }

  const asOfDate = parseInjurySnapshotAt(asOfSource);
  const asOfLabel = asOfDate ? formatAsOfEt(asOfDate) : null;
  if (!asOfDate || !asOfLabel) return unavailable();

  const awayPlayers = selectKeyInjuries({
    players: teamRows,
    teamId: input.away.teamId,
    gameEtDate: input.gameEtDate,
    now: input.now,
    env: input.env,
  });
  const homePlayers = selectKeyInjuries({
    players: teamRows,
    teamId: input.home.teamId,
    gameEtDate: input.gameEtDate,
    now: input.now,
    env: input.env,
  });
  const asOf = asOfDate.toISOString();
  if (awayPlayers.length === 0 && homePlayers.length === 0) {
    return { status: 'none', text: `No key injuries listed · as of ${asOfLabel}`, asOf };
  }
  const awayText = awayPlayers.length > 0 ? `${input.away.abbr}: ${teamNames(awayPlayers)}` : `${input.away.abbr}: no key injuries listed`;
  const homeText = homePlayers.length > 0 ? `${input.home.abbr}: ${teamNames(homePlayers)}` : `${input.home.abbr}: no key injuries listed`;
  return { status: 'listed', text: `${awayText} · ${homeText} · as of ${asOfLabel}`, asOf };
}
