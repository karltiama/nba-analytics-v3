/**
 * "Teammates out tonight" for the Props Explorer player sidebar.
 *
 * Injury rows follow the same serving rules as the scoreboard card (freshness, the
 * INJURY_SERVING_ENABLED freeze, same-day Questionable only, 10+ baseline minutes), kept
 * local because nothing outside the scoreboard may import scoreboard modules.
 * With/without numbers come from the game-level WOWY summary, so they match /wowy.
 * Descriptive context only: backtests found who-is-out shifts a player's line by ~1-2%
 * and the market already prices most of it.
 */
import { query, queryOne } from '@/lib/db';
import {
  isFrozenInjuryServing,
  isInjuryAuthoritativeForServing,
  isInjurySnapshotFresh,
  parseInjurySnapshotAt,
} from '@/lib/injuries/freshness';
import { INJURY_REPORT_UNAVAILABLE } from '@/lib/betting/teammates-out-display';
import { parseMinutes } from '@/lib/wowy/appearance';
import { loadWowyPairSummary } from '@/lib/wowy/queries';
import type { WowyPairSummary } from '@/lib/wowy/types';
import type {
  SplitStats,
  TeammateOut,
  TeammateOutSplit,
  TeammateOutStatus,
  TeammatesOutResponse,
} from '@/lib/betting/teammates-out-display';

export type { SplitStats, TeammateOut, TeammateOutSplit, TeammatesOutResponse };

/** Same thresholds as the scoreboard card: 10+ usual minutes, 3+ games this season before using last season. */
export const KEY_BASELINE_MINUTES = 10;
export const CURRENT_SEASON_MIN_GAMES = 3;

const SEVERITY: Record<TeammateOutStatus, number> = { Out: 0, Doubtful: 1, Q: 2 };

/** Out / Doubtful / Questionable, including "Out - knee" style prefixes. Anything else is not listed. */
export function classifyTeammateStatus(status: string | null | undefined): TeammateOutStatus | null {
  const s = (status ?? '').trim().toLowerCase();
  if (s.startsWith('out')) return 'Out';
  if (s.startsWith('doubtful')) return 'Doubtful';
  if (s.startsWith('questionable')) return 'Q';
  return null;
}

/** Calendar date in America/New_York. */
export function etDate(instant: Date): string | null {
  if (Number.isNaN(instant.getTime())) return null;
  const ymd = instant.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

/** "as of 1:00 PM ET", or "as of Nov 3, 1:00 PM ET" when the report is from an earlier ET date. */
export function asOfLabel(instant: Date, gameEtDate: string): string | null {
  const day = etDate(instant);
  if (!day) return null;
  const clock = instant.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  if (day === gameEtDate) return `as of ${clock} ET`;
  const md = instant.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
  return `as of ${md}, ${clock} ET`;
}

export type InjuredTeammate = {
  playerId: string;
  name: string;
  status: string | null;
  snapshotAt: string | null;
  currentSeasonGames: number;
  currentSeasonAvgMinutes: number | null;
  priorSeasonAvgMinutes: number | null;
};

export type SelectedTeammate = {
  playerId: string;
  name: string;
  status: TeammateOutStatus;
  avgMinutes: number;
  snapshotAt: Date | null;
};

/**
 * Teammates to list: served (fresh, not frozen), Out/Doubtful, or Questionable on a same-day report,
 * with 10+ usual minutes. Sorted Out, Doubtful, Q, then by minutes.
 */
export function selectTeammatesOut(args: {
  rows: InjuredTeammate[];
  gameEtDate: string;
  env: Record<string, string | undefined>;
  now: Date;
}): SelectedTeammate[] {
  const out: SelectedTeammate[] = [];
  for (const r of args.rows) {
    const status = classifyTeammateStatus(r.status);
    if (!status) continue;
    if (!isInjuryAuthoritativeForServing({ snapshotAt: r.snapshotAt, status: r.status }, args.env, args.now)) continue;
    const at = parseInjurySnapshotAt(r.snapshotAt);
    if (status === 'Q' && (!at || etDate(at) !== args.gameEtDate)) continue;
    const minutes =
      r.currentSeasonGames >= CURRENT_SEASON_MIN_GAMES ? r.currentSeasonAvgMinutes : r.priorSeasonAvgMinutes;
    if (minutes == null || !Number.isFinite(minutes) || minutes < KEY_BASELINE_MINUTES) continue;
    out.push({ playerId: r.playerId, name: r.name, status, avgMinutes: minutes, snapshotAt: at });
  }
  return out.sort(
    (a, b) => SEVERITY[a.status] - SEVERITY[b.status] || b.avgMinutes - a.avgMinutes || a.name.localeCompare(b.name)
  );
}

const INJURY_ROWS_SQL = `
SELECT i.player_id, i.status, i.snapshot_at, p.full_name, p.last_name
FROM analytics.player_injury_status_current i
LEFT JOIN analytics.players p ON p.player_id = i.player_id
WHERE i.team_id = $1 AND i.player_id <> $2
`.trim();

const INJURY_FEED_SQL = `SELECT max(snapshot_at) AS snapshot_at FROM analytics.player_injury_status_current`;

/** Final games before tip: this season with this team, and last season with any team. */
const BASELINE_LOGS_SQL = `
SELECT pgl.player_id, pgl.team_id, g.season, pgl.minutes
FROM analytics.player_game_logs pgl
JOIN analytics.games g ON g.game_id = pgl.game_id
WHERE pgl.player_id = ANY($1::text[])
  AND g.season = ANY($2::text[])
  AND g.status = 'Final'
  AND g.start_time < $3
`.trim();


/** Teammates that get a with/without split (the rest are listed only). */
export const TEAMMATES_OUT_SPLIT_LIMIT = 2;

type GameRow = { game_id: string; season: string; start_time: Date | string | null; home_team_id: string; away_team_id: string };

function text(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function isoOf(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const t = text(v);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function statsOf(s: WowyPairSummary['with']): SplitStats {
  return { minutes: s.perGame.minutes, pts: s.perGame.pts, reb: s.perGame.reb, ast: s.perGame.ast, tpm: s.perGame.tpm };
}

export function toSplit(summary: WowyPairSummary, season: string): TeammateOutSplit {
  return {
    season,
    tier: summary.support.tier,
    withGames: summary.support.withGames,
    withoutGames: summary.support.withoutGames,
    with: statsOf(summary.with),
    without: statsOf(summary.without),
  };
}

/**
 * This season's split when it has enough games on both sides, else last season's (same team only),
 * else this season's thin split so the UI can say there are too few games.
 */
export function chooseSplit(current: TeammateOutSplit | null, prior: TeammateOutSplit | null): TeammateOutSplit | null {
  if (current && current.tier !== 'insufficient') return current;
  if (prior && prior.tier !== 'insufficient') return prior;
  return current ?? prior;
}

export function wowyHref(args: { subjectId: string; teammateId: string; season: string; teamId: string }): string {
  const sp = new URLSearchParams({ subject: args.subjectId, teammate: args.teammateId, season: args.season, teamId: args.teamId });
  return `/wowy?${sp.toString()}`;
}

/** The player's team in this game: his latest log for either side before tip, else the current roster. */
async function resolveTeam(playerId: string, game: GameRow): Promise<string | null> {
  const sides = [text(game.home_team_id), text(game.away_team_id)].filter(Boolean);
  const tip = isoOf(game.start_time) ?? new Date().toISOString();
  const fromLogs = await queryOne<{ team_id: string }>(
    `SELECT pgl.team_id
       FROM analytics.player_game_logs pgl
       JOIN analytics.games g ON g.game_id = pgl.game_id
      WHERE pgl.player_id = $1 AND pgl.team_id = ANY($2::text[]) AND g.start_time < $3
      ORDER BY g.start_time DESC
      LIMIT 1`,
    [playerId, sides, tip]
  );
  if (fromLogs?.team_id) return text(fromLogs.team_id);
  try {
    const roster = await queryOne<{ team_id: string }>(
      `SELECT team_id FROM analytics.team_roster_current WHERE player_id = $1 AND team_id = ANY($2::text[]) LIMIT 1`,
      [playerId, sides]
    );
    return roster?.team_id ? text(roster.team_id) : null;
  } catch {
    return null;
  }
}

async function loadSplit(args: { subjectId: string; teammateId: string; teamId: string; season: string; cutoff: string | null }) {
  try {
    const res = await loadWowyPairSummary({
      subjectPlayerId: args.subjectId,
      teammatePlayerId: args.teammateId,
      season: args.season,
      teamId: args.teamId,
      seasonType: 'regular',
      cutoffStartTime: args.cutoff,
    });
    return res.ok ? toSplit(res.summary, args.season) : null;
  } catch (error) {
    console.error('[teammates-out] wowy split', error);
    return null;
  }
}

export async function loadTeammatesOut(args: {
  playerId: string;
  gameId: string;
  env?: Record<string, string | undefined>;
  now?: Date;
}): Promise<TeammatesOutResponse> {
  const env = args.env ?? process.env;
  const now = args.now ?? new Date();
  // A frozen or stale feed is "unavailable", never "nobody is out".
  if (isFrozenInjuryServing(env)) return { status: 'unavailable', reason: INJURY_REPORT_UNAVAILABLE };
  const feed = await queryOne<{ snapshot_at: Date | string | null }>(INJURY_FEED_SQL, []);
  if (!isInjurySnapshotFresh(isoOf(feed?.snapshot_at), env, now)) {
    return { status: 'unavailable', reason: INJURY_REPORT_UNAVAILABLE };
  }
  const game = await queryOne<GameRow>(
    `SELECT game_id, season, start_time, home_team_id, away_team_id FROM analytics.games WHERE game_id = $1`,
    [args.gameId]
  );
  if (!game) return { status: 'unavailable', reason: 'Game not found' };
  const tip = isoOf(game.start_time);
  const gameEtDate = tip ? etDate(new Date(tip)) : null;
  if (!gameEtDate) return { status: 'unavailable', reason: 'Game time unknown' };

  const teamId = await resolveTeam(args.playerId, game);
  if (!teamId) return { status: 'unavailable', reason: 'Team not found for this player' };
  const season = text(game.season);

  const priorSeason = String(Number(season) - 1);
  const [injuryRows, team] = await Promise.all([
    query(INJURY_ROWS_SQL, [teamId, args.playerId]),
    queryOne<{ abbreviation: string }>(`SELECT abbreviation FROM analytics.teams WHERE team_id = $1`, [teamId]),
  ]);
  const ids = [...new Set(injuryRows.map((r) => text(r.player_id)).filter(Boolean))];
  const logRows = ids.length > 0 ? await query(BASELINE_LOGS_SQL, [ids, [season, priorSeason], tip]) : [];

  const current = new Map<string, { games: number; minutes: number }>();
  const prior = new Map<string, { games: number; minutes: number }>();
  for (const row of logRows) {
    const m = parseMinutes(row.minutes);
    if (m == null || !Number.isFinite(m) || m <= 0) continue;
    const pid = text(row.player_id);
    const bucket =
      text(row.season) === season && text(row.team_id) === teamId ? current : text(row.season) === priorSeason ? prior : null;
    if (!bucket) continue;
    const b = bucket.get(pid) ?? { games: 0, minutes: 0 };
    b.games++;
    b.minutes += m;
    bucket.set(pid, b);
  }

  const key = selectTeammatesOut({
    rows: injuryRows.map((r) => {
      const pid = text(r.player_id);
      const c = current.get(pid);
      const p = prior.get(pid);
      return {
        playerId: pid,
        name: text(r.full_name) || text(r.last_name) || pid,
        status: r.status == null ? null : String(r.status),
        snapshotAt: isoOf(r.snapshot_at),
        currentSeasonGames: c?.games ?? 0,
        currentSeasonAvgMinutes: c && c.games > 0 ? c.minutes / c.games : null,
        priorSeasonAvgMinutes: p && p.games > 0 ? p.minutes / p.games : null,
      };
    }),
    gameEtDate,
    env,
    now,
  });
  const latest = key
    .map((k) => k.snapshotAt)
    .filter((d): d is Date => d != null)
    .sort((x, y) => y.getTime() - x.getTime())[0];

  const teammates: TeammateOut[] = await Promise.all(
    key.map(async (k, i) => {
      let split: TeammateOutSplit | null = null;
      if (i < TEAMMATES_OUT_SPLIT_LIMIT) {
        const [cur, prev] = await Promise.all([
          loadSplit({ subjectId: args.playerId, teammateId: k.playerId, teamId, season, cutoff: tip }),
          loadSplit({ subjectId: args.playerId, teammateId: k.playerId, teamId, season: priorSeason, cutoff: null }),
        ]);
        split = chooseSplit(cur, prev);
      }
      return {
        playerId: k.playerId,
        name: k.name,
        status: k.status,
        avgMinutes: k.avgMinutes,
        split,
        wowyHref: wowyHref({ subjectId: args.playerId, teammateId: k.playerId, season: split?.season ?? season, teamId }),
      };
    })
  );

  return {
    status: 'ok',
    teamId,
    teamAbbr: team?.abbreviation ?? null,
    asOfLabel: latest ? asOfLabel(latest, gameEtDate) : null,
    minutesFreed: teammates.filter((t) => t.status !== 'Q').reduce((a, t) => a + t.avgMinutes, 0),
    teammates,
  };
}

