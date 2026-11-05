import type { InjuryReport, InjurySeverity } from './injury-report';

/** One certified starter in one finished game this season (analytics.game_starters, post-tip confirmed). */
export type StarterRow = {
  teamId: string;
  gameId: string;
  /** ET date, YYYY-MM-DD. */
  date: string;
  playerId: string;
  name: string;
  position: string | null;
};

export type LikelyStarter = {
  playerId: string;
  name: string;
  position: string | null;
  /** Games he started for this team this season. */
  starts: number;
  /** Feed status when listed (Questionable, Probable, ...). */
  status: string | null;
  severity: InjurySeverity | null;
  /** Set when he fills in for a last-game starter who is out. */
  replaces: { playerId: string; name: string; status: string } | null;
};

export type StartersTeam = {
  teamId: string;
  abbr: string;
  /** Games this season with a certified starting five. */
  games: number;
  lastGameDate: string | null;
  /** Last game's five, as started. */
  lastFive: LikelyStarter[];
  /** Last game's five with Out/Doubtful players swapped. Null with no games. */
  likely: LikelyStarter[] | null;
  /** Out/Doubtful last-game starters with nobody healthy to swap in. */
  unfilled: { playerId: string; name: string; status: string }[];
  /** Healthy regular starters who did not start last game. */
  regularsBack: LikelyStarter[];
};

export type StartersModel = {
  seasonLabel: string;
  /** False when the injury report could not be read, so no swaps were made. */
  injuryAdjusted: boolean;
  teams: StartersTeam[];
};

/** Statuses that take a player out of the likely five. */
const UNAVAILABLE: ReadonlySet<InjurySeverity> = new Set(['out', 'doubtful']);

/** A healthy player who started at least this share of the team's games but not the last one. */
export const REGULAR_START_SHARE = 0.5;

function samePositionGroup(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toUpperCase()[0] === b.trim().toUpperCase()[0];
}

/**
 * Likely starters: the team's last starting five, with Out/Doubtful players swapped for the healthy
 * player who has started most for the team this season (same position letter first). Never a
 * projection: teams announce lineups about 30 minutes before tip.
 */
export function buildStarters(input: {
  seasonLabel: string;
  teams: { teamId: string; abbr: string }[];
  rows: StarterRow[];
  injuries: InjuryReport | null;
}): StartersModel | null {
  if (input.rows.length === 0) return null;
  const injuryAdjusted = input.injuries?.status === 'listed' || input.injuries?.status === 'none';
  const status = new Map<string, { status: string; severity: InjurySeverity }>();
  if (injuryAdjusted) {
    for (const team of input.injuries!.teams) {
      for (const p of team.players) status.set(`${team.teamId}|${p.playerId}`, { status: p.status, severity: p.severity });
    }
  }

  const teams = input.teams.map((team): StartersTeam => {
    const rows = input.rows.filter((r) => r.teamId === team.teamId);
    const byGame = new Map<string, { date: string; rows: StarterRow[] }>();
    for (const r of rows) {
      const g = byGame.get(r.gameId) ?? { date: r.date, rows: [] };
      g.rows.push(r);
      byGame.set(r.gameId, g);
    }
    const games = [...byGame.entries()].sort((a, b) => (a[1].date === b[1].date ? a[0].localeCompare(b[0]) : a[1].date.localeCompare(b[1].date)));
    const starts = new Map<string, { row: StarterRow; count: number; last: string }>();
    for (const [, g] of games) {
      for (const r of g.rows) {
        const s = starts.get(r.playerId);
        starts.set(r.playerId, { row: r, count: (s?.count ?? 0) + 1, last: g.date });
      }
    }
    const last = games[games.length - 1];
    const inj = (playerId: string) => status.get(`${team.teamId}|${playerId}`) ?? null;
    const starter = (r: StarterRow): LikelyStarter => {
      const i = inj(r.playerId);
      return {
        playerId: r.playerId,
        name: r.name,
        position: r.position,
        starts: starts.get(r.playerId)?.count ?? 0,
        status: i?.status ?? null,
        severity: i?.severity ?? null,
        replaces: null,
      };
    };
    if (!last) {
      return { teamId: team.teamId, abbr: team.abbr, games: 0, lastGameDate: null, lastFive: [], likely: null, unfilled: [], regularsBack: [] };
    }

    const lastFive = last[1].rows.map(starter);
    const lastIds = new Set(lastFive.map((p) => p.playerId));
    const available = (playerId: string) => {
      const i = inj(playerId);
      return !i || !UNAVAILABLE.has(i.severity);
    };
    // Bench options: anyone who started for this team this season, healthy, not in the last five.
    const bench = [...starts.values()]
      .filter((s) => !lastIds.has(s.row.playerId) && available(s.row.playerId))
      .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last) || a.row.name.localeCompare(b.row.name));
    const used = new Set<string>();
    const unfilled: StartersTeam['unfilled'] = [];
    const likely: LikelyStarter[] = [];
    for (const p of lastFive) {
      if (available(p.playerId)) {
        likely.push(p);
        continue;
      }
      const out = { playerId: p.playerId, name: p.name, status: p.status ?? 'Out' };
      const pick =
        bench.find((s) => !used.has(s.row.playerId) && samePositionGroup(s.row.position, p.position)) ??
        bench.find((s) => !used.has(s.row.playerId));
      if (!pick) {
        unfilled.push(out);
        continue;
      }
      used.add(pick.row.playerId);
      likely.push({ ...starter(pick.row), replaces: out });
    }

    const regularsBack = bench
      .filter((s) => !used.has(s.row.playerId) && s.count >= Math.max(2, games.length * REGULAR_START_SHARE))
      .map((s) => starter(s.row));

    return {
      teamId: team.teamId,
      abbr: team.abbr,
      games: games.length,
      lastGameDate: last[1].date,
      lastFive,
      likely,
      unfilled,
      regularsBack,
    };
  });

  return { seasonLabel: input.seasonLabel, injuryAdjusted, teams };
}
