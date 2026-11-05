/**
 * Full injury report for the pregame matchup page: every listed player on both teams, not just the
 * two key names the scoreboard card shows, with how long each has been out. Pure; the loader reads
 * analytics.player_injury_status_current, the teams' final games and the players' game logs.
 *
 * Time out comes from game logs, not the feed: the last game he played, and how many of his team's
 * games this season he has missed since. That is also what tells you whether the 2026-27 team
 * numbers on this page were built with or without him.
 */

import { isFrozenInjuryServing, isInjuryAuthoritativeForServing, isInjurySnapshotFresh, parseInjurySnapshotAt } from '@/lib/injuries/freshness';
import { parseMinutesText } from '@/lib/players/minutes-sql';
import { wowyHref } from '@/lib/wowy/href';

export type InjurySeverity = 'out' | 'doubtful' | 'questionable' | 'day_to_day' | 'probable' | 'other';

const SEVERITY_ORDER: Record<InjurySeverity, number> = {
  out: 0,
  doubtful: 1,
  questionable: 2,
  day_to_day: 3,
  probable: 4,
  other: 5,
};

/** Played at least this many minutes per game to count as a rotation player in the team note. */
export const ROTATION_MINUTES = 10;
/** Current-season games needed before his 2026-27 minutes replace last season's. */
export const CURRENT_BASELINE_MIN_GAMES = 3;

export function injurySeverity(status: string | null | undefined): InjurySeverity {
  const s = (status ?? '').trim().toLowerCase();
  if (s.startsWith('out')) return 'out';
  if (s.startsWith('doubtful')) return 'doubtful';
  if (s.startsWith('questionable')) return 'questionable';
  if (s.startsWith('day')) return 'day_to_day';
  if (s.startsWith('probable')) return 'probable';
  return 'other';
}

export type ParsedInjuryNote = {
  /** "Right High Ankle Sprain", "Rest". Null when the feed note has no labelled injury. */
  injury: string | null;
  /** Date of the earliest reporting the feed quotes ("Prior reporting (2026-10-24)"), YYYY-MM-DD. */
  reportedOn: string | null;
  /** The reporting text after the date, or the whole note when it has no structure. */
  note: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Feed notes look like "Injury/Illness - Right High Ankle Sprain (2026-11-05, ORL@PHX). Prior reporting
 * (2026-10-24): Banchero is expected to ...". Older or hand-written notes have no structure.
 */
export function parseInjuryNote(description: string | null | undefined): ParsedInjuryNote {
  const d = (description ?? '').trim();
  if (!d) return { injury: null, reportedOn: null, note: null };
  const head = /^(.*?)\s*\(\d{4}-\d{2}-\d{2},[^)]*\)\./.exec(d);
  let injury: string | null = null;
  if (head) {
    const label = head[1].replace(/^Injury\/Illness\s*-\s*/i, '').trim();
    injury = label && label !== '-' ? label : null;
  }
  const prior = /Prior reporting \((\d{4}-\d{2}-\d{2})\):\s*([\s\S]*)$/.exec(d);
  if (prior) return { injury: injury ?? injuryFromProse(prior[2]), reportedOn: prior[1], note: prior[2].trim() || null };
  return { injury: injury ?? injuryFromProse(d), reportedOn: null, note: head ? null : d };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Plain-prose notes ("Goodwin (calf) won't play...", "...out due to a sprained left ankle") name the
 * injury loosely. Returns null rather than guessing when neither pattern is there.
 */
export function injuryFromProse(text: string): string | null {
  const paren = /^[A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*)?\s+\(([a-z][a-z ,/-]{1,40})\)/.exec(text.trim());
  if (paren) return capitalize(paren[1].trim());
  const dueTo = /\bdue to (?:a |an |the )?([a-z][a-z -]{2,40}?)(?=[.,;]|\s+(?:and|but|on|in|for|against)\b)/i.exec(text);
  if (dueTo) return capitalize(dueTo[1].trim());
  return null;
}

export type InjuryFeedRow = {
  playerId: string;
  teamId: string;
  name: string;
  status: string | null;
  description: string | null;
  returnDateRaw: string | null;
  snapshotAt: string | null;
};

export type TeamGameRow = { teamId: string; date: string };

export type PlayerLogRow = { playerId: string; teamId: string; season: string; date: string; minutes: string | null };

/** One teammate's minutes for a team in a season (from game logs). */
export type RotationRow = {
  playerId: string;
  teamId: string;
  season: string;
  name: string;
  games: number;
  avgMinutes: number;
};

/** WOWY links for one injury: top healthy teammates' stats with and without him. */
export type InjuryWowy = {
  season: string;
  seasonLabel: string;
  links: Array<{ playerId: string; name: string; href: string }>;
};

/** Games on each side (with and without him) before this season's split is worth opening. */
export const WOWY_CURRENT_MIN_GAMES = 5;
/** His games for this team last season before last season's split is worth opening. */
export const WOWY_PRIOR_MIN_GAMES = 5;
export const WOWY_LINKS_PER_INJURY = 3;
/** Teammate games for the team in the chosen season to be offered as a subject. */
const WOWY_SUBJECT_MIN_GAMES = 3;

export type InjuryReportPlayer = {
  playerId: string;
  name: string;
  status: string;
  severity: InjurySeverity;
  injury: string | null;
  reportedOn: string | null;
  /** Feed's expected return, only when it is after the game date. */
  expectedReturn: string | null;
  note: string | null;
  /** Last game he played (any team, this season or last), YYYY-MM-DD. */
  lastPlayed: string | null;
  /** His team's final games this season before this game. */
  teamGames: number;
  /** Of those, games he played. */
  playedThisSeason: number;
  /** Team games this season since he last played (all of them if he hasn't played this season). */
  missedStreak: number;
  baselineMinutes: number | null;
  baselineSeason: string | null;
  /** Null for non-rotation players, or when he has no games with this team to compare. */
  wowy: InjuryWowy | null;
};

export type InjuryReportTeam = {
  teamId: string;
  abbr: string;
  players: InjuryReportPlayer[];
  /** Rotation players who missed this season's games, for the "your numbers exclude him" note. */
  sampleNote: string | null;
};

export type InjuryReport = {
  status: 'listed' | 'none' | 'unavailable';
  /** Newest snapshot used, ISO. */
  asOf: string | null;
  seasonLabel: string;
  teams: InjuryReportTeam[];
};

type Env = Record<string, string | undefined>;

function avg(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

const NAME_SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v']);
const NAME_PARTICLES = new Set(['da', 'de', 'del', 'della', 'di', 'du', 'la', 'le', 'van', 'von', 'der', 'st.']);

/** Short display name: "Tristan da Silva" → "da Silva", "Jaren Jackson Jr." → "Jackson". */
export function lastName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  while (parts.length > 1 && NAME_SUFFIXES.has(parts[parts.length - 1].toLowerCase())) parts.pop();
  if (parts.length === 0) return name;
  let start = parts.length - 1;
  while (start > 1 && NAME_PARTICLES.has(parts[start - 1].toLowerCase())) start--;
  return parts.slice(start).join(' ');
}

export function buildInjuryReport(input: {
  gameEtDate: string;
  season: string;
  priorSeason: string;
  seasonLabel: string;
  priorSeasonLabel: string;
  teams: Array<{ teamId: string; abbr: string }>;
  injuries: InjuryFeedRow[] | null;
  feedSnapshotAt: string | null;
  teamGames: TeamGameRow[];
  logs: PlayerLogRow[];
  /** Team minutes by player and season, for WOWY teammate links. */
  rotation?: RotationRow[];
  now: Date;
  env: Env;
}): InjuryReport {
  const empty = (status: InjuryReport['status']): InjuryReport => ({
    status,
    asOf: null,
    seasonLabel: input.seasonLabel,
    teams: [],
  });
  if (input.injuries == null || isFrozenInjuryServing(input.env)) return empty('unavailable');

  const teamIds = new Set(input.teams.map((t) => t.teamId));
  const rows = input.injuries.filter(
    (r) =>
      teamIds.has(r.teamId) &&
      isInjuryAuthoritativeForServing({ snapshotAt: r.snapshotAt, status: r.status }, input.env, input.now)
  );
  const feedAt = parseInjurySnapshotAt(input.feedSnapshotAt);
  const feedFresh = feedAt != null && isInjurySnapshotFresh(feedAt, input.env, input.now);
  if (rows.length === 0 && !feedFresh) return empty('unavailable');

  let asOf: string | null = feedFresh && feedAt ? feedAt.toISOString() : null;
  for (const r of rows) {
    const at = parseInjurySnapshotAt(r.snapshotAt);
    if (at && (!asOf || at.toISOString() > asOf)) asOf = at.toISOString();
  }

  const gamesByTeam = new Map<string, string[]>();
  for (const g of input.teamGames) {
    if (g.date >= input.gameEtDate) continue;
    const list = gamesByTeam.get(g.teamId) ?? [];
    list.push(g.date);
    gamesByTeam.set(g.teamId, list);
  }

  const logsByPlayer = new Map<string, PlayerLogRow[]>();
  for (const l of input.logs) {
    if (l.date >= input.gameEtDate) continue;
    const list = logsByPlayer.get(l.playerId) ?? [];
    list.push(l);
    logsByPlayer.set(l.playerId, list);
  }

  const sidelined = new Set(
    rows.filter((r) => ['out', 'doubtful'].includes(injurySeverity(r.status))).map((r) => r.playerId)
  );
  const rotation = input.rotation ?? [];
  const onTeamNow = new Set(
    rotation.filter((r) => r.season === input.season && r.games > 0).map((r) => `${r.teamId}|${r.playerId}`)
  );

  /**
   * This season once he has enough games both with and without him; otherwise last season if he played
   * enough for this team then; otherwise this season's thin split (the WOWY page flags low support).
   */
  function wowyFor(args: {
    playerId: string;
    teamId: string;
    playedThisSeason: number;
    missedThisSeason: number;
    priorTeamGames: number;
  }): InjuryWowy | null {
    let season: string | null = null;
    if (args.playedThisSeason >= WOWY_CURRENT_MIN_GAMES && args.missedThisSeason >= WOWY_CURRENT_MIN_GAMES) {
      season = input.season;
    } else if (args.priorTeamGames >= WOWY_PRIOR_MIN_GAMES) {
      season = input.priorSeason;
    } else if (args.playedThisSeason > 0) {
      season = input.season;
    }
    if (!season) return null;
    const links = rotation
      .filter(
        (r) =>
          r.teamId === args.teamId &&
          r.season === season &&
          r.playerId !== args.playerId &&
          r.games >= WOWY_SUBJECT_MIN_GAMES &&
          !sidelined.has(r.playerId) &&
          onTeamNow.has(`${r.teamId}|${r.playerId}`)
      )
      .sort((a, b) => b.avgMinutes - a.avgMinutes || a.name.localeCompare(b.name))
      .slice(0, WOWY_LINKS_PER_INJURY)
      .map((r) => ({
        playerId: r.playerId,
        name: lastName(r.name),
        href: wowyHref({ subjectId: r.playerId, teammateId: args.playerId, season, teamId: args.teamId }),
      }));
    if (links.length === 0) return null;
    return { season, seasonLabel: season === input.season ? input.seasonLabel : input.priorSeasonLabel, links };
  }

  const teams: InjuryReportTeam[] = input.teams.map((team) => {
    const teamDates = gamesByTeam.get(team.teamId) ?? [];
    const players = rows
      .filter((r) => r.teamId === team.teamId)
      .map((r): InjuryReportPlayer => {
        const parsed = parseInjuryNote(r.description);
        const logs = logsByPlayer.get(r.playerId) ?? [];
        const played = logs.filter((l) => (parseMinutesText(l.minutes) ?? 0) > 0);
        const lastPlayed = played.reduce<string | null>((max, l) => (max == null || l.date > max ? l.date : max), null);
        const playedThisSeason = new Set(
          played.filter((l) => l.season === input.season && l.teamId === team.teamId).map((l) => l.date)
        ).size;
        const missedStreak = teamDates.filter((d) => lastPlayed == null || d > lastPlayed).length;

        const current = played.filter((l) => l.season === input.season).map((l) => parseMinutesText(l.minutes) ?? 0);
        const prior = played.filter((l) => l.season === input.priorSeason).map((l) => parseMinutesText(l.minutes) ?? 0);
        let baselineMinutes: number | null = null;
        let baselineSeason: string | null = null;
        if (current.length >= CURRENT_BASELINE_MIN_GAMES) {
          baselineMinutes = avg(current);
          baselineSeason = input.seasonLabel;
        } else if (prior.length > 0) {
          baselineMinutes = avg(prior);
          baselineSeason = input.priorSeasonLabel;
        } else if (current.length > 0) {
          baselineMinutes = avg(current);
          baselineSeason = input.seasonLabel;
        }

        const ret = (r.returnDateRaw ?? '').trim();
        const priorTeamGames = new Set(
          played.filter((l) => l.season === input.priorSeason && l.teamId === team.teamId).map((l) => l.date)
        ).size;
        const severity = injurySeverity(r.status);
        const wowy =
          (baselineMinutes ?? 0) >= ROTATION_MINUTES && severity !== 'probable' && severity !== 'other'
            ? wowyFor({
                playerId: r.playerId,
                teamId: team.teamId,
                playedThisSeason,
                missedThisSeason: teamDates.length - playedThisSeason,
                priorTeamGames,
              })
            : null;
        return {
          playerId: r.playerId,
          name: r.name,
          status: (r.status ?? '').trim() || 'Listed',
          severity,
          injury: parsed.injury,
          reportedOn: parsed.reportedOn,
          expectedReturn: DATE_RE.test(ret) && ret > input.gameEtDate ? ret : null,
          note: parsed.note,
          lastPlayed,
          teamGames: teamDates.length,
          playedThisSeason,
          missedStreak,
          baselineMinutes,
          baselineSeason,
          wowy,
        };
      })
      .sort(
        (a, b) =>
          SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
          (b.baselineMinutes ?? -1) - (a.baselineMinutes ?? -1) ||
          a.name.localeCompare(b.name)
      );

    const missing = players.filter(
      (p) =>
        p.teamGames > 0 &&
        p.playedThisSeason < p.teamGames &&
        (p.baselineMinutes ?? 0) >= ROTATION_MINUTES &&
        (p.severity === 'out' || p.severity === 'doubtful')
    );
    const sampleNote =
      missing.length > 0
        ? `${team.abbr}'s ${input.seasonLabel} numbers: ${missing
            .map((p) => `${lastName(p.name)} played ${p.playedThisSeason} of ${p.teamGames}`)
            .join(', ')}.`
        : null;

    return { teamId: team.teamId, abbr: team.abbr, players, sampleNote };
  });

  return {
    status: rows.length > 0 ? 'listed' : 'none',
    asOf,
    seasonLabel: input.seasonLabel,
    teams,
  };
}

/** "Last played Oct 24 · missed last 6 ORL games" style copy for one player. */
export function timeOutLabel(p: InjuryReportPlayer, abbr: string, formatDate: (ymd: string) => string): string {
  const games = (n: number) => `${n} ${abbr} game${n === 1 ? '' : 's'}`;
  if (p.lastPlayed == null) {
    return p.teamGames > 0 ? `No games this season or last · missed all ${games(p.teamGames)}` : 'No games this season or last';
  }
  if (p.teamGames === 0) return `Last played ${formatDate(p.lastPlayed)}`;
  if (p.missedStreak === 0) return `Played ${abbr}'s last game (${formatDate(p.lastPlayed)})`;
  if (p.playedThisSeason === 0) return `Last played ${formatDate(p.lastPlayed)} · missed all ${games(p.teamGames)} this season`;
  return `Last played ${formatDate(p.lastPlayed)} · missed last ${games(p.missedStreak)}`;
}
