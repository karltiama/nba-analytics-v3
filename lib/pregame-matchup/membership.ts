/**
 * Split observed 2026–27 membership from 2025–26 minute leaders.
 * Names come from the roster observation already loaded for continuity.
 * This module does not query, rank a rotation, or assign starters.
 */

import { historicalContributors, type HistoricalContributor, type PlayerSumRow } from './aggregate';
import { formatRosterObservationLabel, type RosterPresentation } from './roster';

export const HISTORICAL_CONTRIBUTOR_LABEL =
  '2025–26 historical production — not a confirmed current roster';

export type ObservedRosterPlayer = {
  playerId: string;
  name: string;
  /** Null means no 2025–26 sample for this franchise. It is not a zero line. */
  prior: HistoricalContributor | null;
};

export type MatchupContributors = {
  membership: 'shown' | 'unavailable';
  observationDate: string | null;
  collectedAt: string | null;
  currentLabel: string;
  historicalLabel: string;
  unavailableNote: string | null;
  awayCurrent: ObservedRosterPlayer[];
  homeCurrent: ObservedRosterPlayer[];
  awayUnidentified: number;
  homeUnidentified: number;
  awayHistorical: HistoricalContributor[];
  homeHistorical: HistoricalContributor[];
  awayHistoricalEmpty: string;
  homeHistoricalEmpty: string;
};

const NO_SAMPLE = 'No positive-minute games in the 2025–26 regular season.';
const ALL_LISTED = 'No 2025–26 players with minutes for this franchise are outside the observed roster.';

export function observationStamp(observationDate: string | null, collectedAt: string | null): string | null {
  if (!observationDate) return null;
  const date = formatRosterObservationLabel(observationDate);
  if (!collectedAt) return date;
  const parsed = Date.parse(collectedAt);
  if (!Number.isFinite(parsed)) return date;
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
    timeZoneName: 'short',
  }).format(new Date(parsed));
  return `${date}, ${time}`;
}

function priorSample(rows: PlayerSumRow[], teamId: string, playerId: string): HistoricalContributor | null {
  const matches = rows.filter((row) => row.teamId === teamId && row.playerId === playerId);
  if (matches.length !== 1) return null;
  return historicalContributors(matches, teamId)[0] ?? null;
}

function hadFranchiseMinutes(rows: PlayerSumRow[], teamId: string): boolean {
  return rows.some((row) => row.teamId === teamId && row.games > 0 && row.minutes > 0 && Boolean(row.name?.trim()));
}

function historicalEmpty(hadMinutes: boolean, membershipShown: boolean, remaining: number): string {
  if (remaining > 0) return NO_SAMPLE;
  if (hadMinutes && membershipShown) return ALL_LISTED;
  return NO_SAMPLE;
}

function side(input: {
  teamId: string;
  rows: PlayerSumRow[];
  roster: RosterPresentation;
  membershipShown: boolean;
}): {
  current: ObservedRosterPlayer[];
  unidentified: number;
  historical: HistoricalContributor[];
  historicalEmpty: string;
} {
  const listed = input.membershipShown
    ? (input.roster.listedPlayers ?? []).filter((player) => player.teamId === input.teamId)
    : [];
  const exclude = new Set<string>();
  const current: ObservedRosterPlayer[] = [];
  let unidentified = 0;
  for (const member of listed) {
    if (member.identityStatus !== 'resolved') {
      unidentified += 1;
      continue;
    }
    const prior = member.playerId ? priorSample(input.rows, input.teamId, member.playerId) : null;
    const name = member.name ?? prior?.name ?? null;
    if (!name) {
      unidentified += 1;
      if (member.playerId) exclude.add(member.playerId);
      continue;
    }
    if (member.playerId) exclude.add(member.playerId);
    current.push({
      playerId: member.playerId ?? member.nbaPlayerId,
      name,
      prior,
    });
  }
  current.sort((a, b) => a.name.localeCompare(b.name) || a.playerId.localeCompare(b.playerId));
  const historicalRows = input.rows.filter((row) => !(row.teamId === input.teamId && exclude.has(row.playerId)));
  const historical = historicalContributors(historicalRows, input.teamId);
  return {
    current,
    unidentified,
    historical,
    historicalEmpty: historicalEmpty(hadFranchiseMinutes(input.rows, input.teamId), input.membershipShown, historical.length),
  };
}

export function attributeMatchupPlayers(input: {
  awayTeamId: string;
  homeTeamId: string;
  playerRows: PlayerSumRow[];
  roster: RosterPresentation;
}): MatchupContributors {
  const membershipShown = input.roster.status === 'shown' && input.roster.listedPlayers != null;
  const away = side({ teamId: input.awayTeamId, rows: input.playerRows, roster: input.roster, membershipShown });
  const home = side({ teamId: input.homeTeamId, rows: input.playerRows, roster: input.roster, membershipShown });
  const stamp = membershipShown ? observationStamp(input.roster.observationDate, input.roster.collectedAt ?? null) : null;
  return {
    membership: membershipShown ? 'shown' : 'unavailable',
    observationDate: membershipShown ? input.roster.observationDate : null,
    collectedAt: membershipShown ? input.roster.collectedAt ?? null : null,
    currentLabel: stamp
      ? `Roster observation ${stamp}. 2026–27 membership from that observation. A listing is not a starting assignment or a minutes projection.`
      : '2026–27 membership from the eligible roster observation. A listing is not a starting assignment or a minutes projection.',
    historicalLabel: HISTORICAL_CONTRIBUTOR_LABEL,
    unavailableNote: membershipShown ? null : input.roster.note,
    awayCurrent: away.current,
    homeCurrent: home.current,
    awayUnidentified: away.unidentified,
    homeUnidentified: home.unidentified,
    awayHistorical: away.historical,
    homeHistorical: home.historical,
    awayHistoricalEmpty: away.historicalEmpty,
    homeHistoricalEmpty: home.historicalEmpty,
  };
}
