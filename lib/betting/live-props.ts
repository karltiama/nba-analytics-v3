/**
 * Live prop tracker for the game page ("Follow live"). Client-safe (no db).
 *
 * Joins the scoreboard's live box score (the collector's player lines, refreshed about every 60s)
 * to the pregame consensus line for each player prop. There are no in-game odds: props stop being
 * pulled at tip, so the line shown is the last pregame main line across books.
 *
 * The live box carries pts/reb/ast/3PM only, so steals, blocks and other markets are left out.
 */

import { mainLineOf, type MovementObservation } from '@/lib/betting/props-explorer-movement';
import { parseMinutesText } from '@/lib/players/minutes-sql';
import { toDecimalOdds } from '@/lib/betting/props-explorer-arb';

export type LiveBoxLine = {
  playerId: string;
  teamId: string;
  name: string | null;
  min: string | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  fg3m: number | null;
};

type StatGetter = (l: LiveBoxLine) => number | null;

const sum =
  (...gets: StatGetter[]): StatGetter =>
  (l) => {
    let total = 0;
    for (const g of gets) {
      const v = g(l);
      if (v == null) return null;
      total += v;
    }
    return total;
  };

const pts: StatGetter = (l) => l.pts;
const reb: StatGetter = (l) => l.reb;
const ast: StatGetter = (l) => l.ast;
const threes: StatGetter = (l) => l.fg3m;

/** Prop types the live box can grade, in display order. */
export const LIVE_PROP_STATS: Record<string, { label: string; short: string; get: StatGetter }> = {
  points: { label: 'Points', short: 'PTS', get: pts },
  rebounds: { label: 'Rebounds', short: 'REB', get: reb },
  assists: { label: 'Assists', short: 'AST', get: ast },
  threes: { label: 'Threes', short: '3PM', get: threes },
  points_rebounds_assists: { label: 'Pts + Reb + Ast', short: 'PRA', get: sum(pts, reb, ast) },
  points_rebounds: { label: 'Pts + Reb', short: 'P+R', get: sum(pts, reb) },
  points_assists: { label: 'Pts + Ast', short: 'P+A', get: sum(pts, ast) },
  rebounds_assists: { label: 'Reb + Ast', short: 'R+A', get: sum(reb, ast) },
};

export const LIVE_PROP_TYPES = Object.keys(LIVE_PROP_STATS);

export type PropQuoteRow = {
  playerId: string;
  playerName: string | null;
  sportsbook: string;
  propType: string;
  lineValue: number;
  side: string;
  oddsAmerican: number | null;
  oddsDecimal: number | null;
};

export type ConsensusLine = {
  playerId: string;
  playerName: string | null;
  propType: string;
  line: number;
  /** Books whose main line equals `line`. */
  books: number;
  /** Books with a priced main line for this player and prop. */
  totalBooks: number;
  /**
   * Pregame prices at `line`: the median over and under price across the books whose main line it is
   * (American odds), and the median no-vig chance of the over (0..1). Fixed at tip; not live odds.
   */
  overOdds: number | null;
  underOdds: number | null;
  overProb: number | null;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Decimal odds to American, rounded to a whole number (2.0 -> +100, 1.909 -> -110). */
export function decimalToAmerican(decimal: number): number {
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

/** Over and under decimal prices at one line for one book, from its rows (last seen wins). */
function pricesAt(obs: MovementObservation[], line: number): { over: number | null; under: number | null } {
  let over: number | null = null;
  let under: number | null = null;
  for (const o of obs) {
    if (o.lineValue !== line) continue;
    const dec = toDecimalOdds(o.oddsDecimal, o.oddsAmerican);
    if (dec == null) continue;
    const side = (o.side ?? '').trim().toLowerCase();
    if (side === 'over') over = dec;
    else if (side === 'under') under = dec;
  }
  return { over, under };
}

/**
 * One line per player and prop: each book's main line (over and under priced closest to even), then
 * the line most books agree on. Ties go to the lower line.
 */
export function consensusLines(rows: PropQuoteRow[]): ConsensusLine[] {
  const groups = new Map<string, { playerId: string; propType: string; name: string | null; byBook: Map<string, MovementObservation[]> }>();
  for (const r of rows) {
    if (!LIVE_PROP_STATS[r.propType] || !Number.isFinite(r.lineValue)) continue;
    const key = `${r.playerId}::${r.propType}`;
    let g = groups.get(key);
    if (!g) {
      g = { playerId: r.playerId, propType: r.propType, name: null, byBook: new Map() };
      groups.set(key, g);
    }
    if (!g.name && r.playerName?.trim()) g.name = r.playerName.trim();
    const book = r.sportsbook.trim().toLowerCase();
    const obs = g.byBook.get(book) ?? [];
    obs.push({ observedAt: '', side: r.side, lineValue: r.lineValue, oddsAmerican: r.oddsAmerican, oddsDecimal: r.oddsDecimal });
    g.byBook.set(book, obs);
  }

  const out: ConsensusLine[] = [];
  for (const g of groups.values()) {
    const votes = new Map<number, number>();
    const mainByBook = new Map<string, number>();
    let totalBooks = 0;
    for (const [book, obs] of g.byBook) {
      const main = mainLineOf(obs);
      if (main == null) continue;
      totalBooks++;
      mainByBook.set(book, main);
      votes.set(main, (votes.get(main) ?? 0) + 1);
    }
    let best: { line: number; n: number } | null = null;
    for (const [line, n] of votes) {
      if (!best || n > best.n || (n === best.n && line < best.line)) best = { line, n };
    }
    if (best) {
      const overs: number[] = [];
      const unders: number[] = [];
      const probs: number[] = [];
      for (const [book, main] of mainByBook) {
        if (main !== best.line) continue;
        const { over, under } = pricesAt(g.byBook.get(book) ?? [], best.line);
        if (over == null || under == null) continue;
        overs.push(over);
        unders.push(under);
        probs.push(1 / over / (1 / over + 1 / under));
      }
      const overDec = median(overs);
      const underDec = median(unders);
      out.push({
        playerId: g.playerId,
        playerName: g.name,
        propType: g.propType,
        line: best.line,
        books: best.n,
        totalBooks,
        overOdds: overDec == null ? null : decimalToAmerican(overDec),
        underOdds: underDec == null ? null : decimalToAmerican(underDec),
        overProb: median(probs),
      });
    }
  }
  return out;
}

const REGULATION_MINUTES = 48;
const QUARTER_MINUTES = 12;
const OT_MINUTES = 5;

function periodStartMinute(period: number): number {
  return period <= 4 ? (period - 1) * QUARTER_MINUTES : REGULATION_MINUTES + (period - 5) * OT_MINUTES;
}

function periodLength(period: number): number {
  return period <= 4 ? QUARTER_MINUTES : OT_MINUTES;
}

/**
 * Game minutes elapsed from the scoreboard's period and clock ("Q3 3:28", "OT1 2:10", "Half").
 * Null when the clock can't be read.
 */
export function gameElapsedMinutes(period: number | null, clock: string | null): number | null {
  const c = (clock ?? '').trim();
  if (/^half/i.test(c)) return 24;
  const m = /(\d{1,2}):(\d{2}(?:\.\d+)?)\s*$/.exec(c);
  if (period == null || period < 1) return null;
  if (m) {
    const left = Number(m[1]) + Number(m[2]) / 60;
    const len = periodLength(period);
    return periodStartMinute(period) + Math.max(0, len - Math.min(left, len));
  }
  if (/end/i.test(c)) return periodStartMinute(period) + periodLength(period);
  return null;
}

/** Minutes left in regulation, or in the current overtime. */
export function gameMinutesLeft(period: number | null, elapsed: number | null): number | null {
  if (elapsed == null || period == null) return null;
  const end = period <= 4 ? REGULATION_MINUTES : periodStartMinute(period) + OT_MINUTES;
  return Math.max(0, end - elapsed);
}

/** Below this many minutes played, a per-minute pace is noise. */
export const PACE_MIN_MINUTES = 4;

export type LivePropStatus = 'hit' | 'on_pace' | 'behind' | 'too_early' | 'not_in' | 'missed';

export type LivePropProgress = {
  current: number | null;
  minutesPlayed: number | null;
  /** Stat at the final buzzer if he keeps his current per-minute rate. Null when too early. */
  projected: number | null;
  /** How many more he needs to clear the line (0 once hit). */
  needed: number | null;
  status: LivePropStatus;
  /** Expected minutes still to come, used for the projection. */
  minutesLeft: number | null;
};

export function liveProgress(args: {
  current: number | null;
  line: number;
  minutes: string | null;
  /** Average minutes in recent games; null when unknown. */
  typicalMinutes: number | null;
  /** Game minutes left; null when the clock can't be read. */
  gameMinutesLeft: number | null;
  /** Game minutes elapsed; used when typical minutes are unknown. */
  gameElapsed: number | null;
  final: boolean;
}): LivePropProgress {
  const played = parseMinutesText(args.minutes);
  const current = args.current;
  if (current == null) {
    return { current: null, minutesPlayed: played, projected: null, needed: null, status: 'not_in', minutesLeft: null };
  }
  const needed = Math.max(0, Math.floor(args.line) + 1 - current);
  if (current > args.line) {
    return { current, minutesPlayed: played, projected: null, needed: 0, status: 'hit', minutesLeft: null };
  }
  if (args.final) {
    return { current, minutesPlayed: played, projected: null, needed, status: 'missed', minutesLeft: 0 };
  }
  if (played == null || played <= 0) {
    return { current, minutesPlayed: played, projected: null, needed, status: 'not_in', minutesLeft: null };
  }

  let minutesLeft: number | null = null;
  if (args.typicalMinutes != null && args.typicalMinutes > 0) {
    minutesLeft = Math.max(0, args.typicalMinutes - played);
  } else if (args.gameElapsed != null && args.gameElapsed > 0 && args.gameMinutesLeft != null) {
    // Unknown role: assume he keeps his share of the game so far.
    minutesLeft = args.gameMinutesLeft * Math.min(1, played / args.gameElapsed);
  }
  if (minutesLeft != null && args.gameMinutesLeft != null) minutesLeft = Math.min(minutesLeft, args.gameMinutesLeft);

  if (played < PACE_MIN_MINUTES || minutesLeft == null) {
    return { current, minutesPlayed: played, projected: null, needed, status: 'too_early', minutesLeft };
  }
  const projected = current + (current / played) * minutesLeft;
  return {
    current,
    minutesPlayed: played,
    projected,
    needed,
    status: projected > args.line ? 'on_pace' : 'behind',
    minutesLeft,
  };
}

export type BlowoutRisk = { level: 'watch' | 'high'; text: string } | null;

/**
 * Starters tend to sit in big late leads, which sinks overs. Watch: 20+ in the 3rd or later.
 * High: 20+ with under 8 minutes left, or 30+ in the second half.
 */
export function blowoutRisk(margin: number | null, period: number | null, minutesLeft: number | null): BlowoutRisk {
  if (margin == null || period == null) return null;
  const m = Math.abs(margin);
  if (period < 3 || m < 20) return null;
  if (m >= 30 || (minutesLeft != null && minutesLeft <= 8 && period >= 4)) {
    return { level: 'high', text: `${m}-point game late: starters may sit, which hurts overs.` };
  }
  return { level: 'watch', text: `${m}-point game: watch for starters sitting in the 4th.` };
}

export type LivePropRow = {
  playerId: string;
  playerName: string;
  teamId: string | null;
  propType: string;
  propLabel: string;
  propShort: string;
  line: number;
  books: number;
  totalBooks: number;
  /** Pregame consensus prices at the line (see ConsensusLine). */
  overOdds: number | null;
  underOdds: number | null;
  overProb: number | null;
  typicalMinutes: number | null;
} & LivePropProgress;

const BEHIND_RANK: Record<LivePropStatus, number> = { behind: 0, too_early: 1, on_pace: 2, not_in: 3, missed: 4, hit: 5 };

export type LivePropSort = 'closest' | 'behind' | 'player';

/** Share of the line reached so far (0..1+). */
export function progressRatio(row: Pick<LivePropRow, 'current' | 'line'>): number {
  if (row.current == null || row.line <= 0) return 0;
  return row.current / row.line;
}

export function sortLiveProps(rows: LivePropRow[], sort: LivePropSort): LivePropRow[] {
  const typeOrder = (t: string) => LIVE_PROP_TYPES.indexOf(t);
  const copy = [...rows];
  if (sort === 'player') {
    copy.sort((a, b) => a.playerName.localeCompare(b.playerName) || typeOrder(a.propType) - typeOrder(b.propType));
    return copy;
  }
  const projRatio = (r: LivePropRow) => (r.projected != null && r.line > 0 ? r.projected / r.line : progressRatio(r));
  if (sort === 'closest') {
    // Unhit props nearest the line first (fewest needed relative to the line), then hits.
    copy.sort((a, b) => {
      const aHit = a.status === 'hit' ? 1 : 0;
      const bHit = b.status === 'hit' ? 1 : 0;
      if (aHit !== bHit) return aHit - bHit;
      if ((a.status === 'not_in') !== (b.status === 'not_in')) return a.status === 'not_in' ? 1 : -1;
      return progressRatio(b) - progressRatio(a) || a.playerName.localeCompare(b.playerName);
    });
    return copy;
  }
  // Furthest behind: behind props by projected share of the line, then the rest by status.
  copy.sort(
    (a, b) =>
      BEHIND_RANK[a.status] - BEHIND_RANK[b.status] || projRatio(a) - projRatio(b) || a.playerName.localeCompare(b.playerName)
  );
  return copy;
}

export function buildLivePropRows(args: {
  lines: ConsensusLine[];
  box: LiveBoxLine[];
  typicalMinutes: Map<string, number>;
  period: number | null;
  clock: string | null;
  final: boolean;
}): LivePropRow[] {
  const byPlayer = new Map(args.box.map((l) => [l.playerId, l]));
  const elapsed = gameElapsedMinutes(args.period, args.clock);
  const left = args.final ? 0 : gameMinutesLeft(args.period, elapsed);
  const out: LivePropRow[] = [];
  for (const cl of args.lines) {
    const stat = LIVE_PROP_STATS[cl.propType];
    if (!stat) continue;
    const box = byPlayer.get(cl.playerId) ?? null;
    const typical = args.typicalMinutes.get(cl.playerId) ?? null;
    const progress = liveProgress({
      current: box ? stat.get(box) : null,
      line: cl.line,
      minutes: box?.min ?? null,
      typicalMinutes: typical,
      gameMinutesLeft: left,
      gameElapsed: elapsed,
      final: args.final,
    });
    out.push({
      playerId: cl.playerId,
      playerName: box?.name?.trim() || cl.playerName || 'Unknown player',
      teamId: box?.teamId ?? null,
      propType: cl.propType,
      propLabel: stat.label,
      propShort: stat.short,
      line: cl.line,
      books: cl.books,
      totalBooks: cl.totalBooks,
      overOdds: cl.overOdds,
      underOdds: cl.underOdds,
      overProb: cl.overProb,
      typicalMinutes: typical,
      ...progress,
    });
  }
  return out;
}

export const LIVE_STATUS_COPY: Record<LivePropStatus, string> = {
  hit: 'Hit',
  on_pace: 'On pace',
  behind: 'Behind',
  too_early: 'Too early',
  not_in: "Hasn't played",
  missed: 'Missed',
};
