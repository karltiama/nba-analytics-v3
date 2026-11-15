import type {
  Last5GameBar,
  Last5Market,
  Last5VideoSnapshot,
  LineRecord,
  LineResult,
} from './types';

/** One book's over/under quote at one line. */
export interface BookLineQuote {
  sportsbook: string;
  line: number;
  side: 'over' | 'under';
  impliedProbability: number | null;
}

/**
 * Consensus main line for one player and market.
 *
 * Books list alternate lines next to the main one. Per book, the main line is
 * the one whose over price is closest to 50%. The consensus is the most common
 * main line across books; a tie goes to the lower line.
 */
export type Last5BoardRead =
  | { status: 'ready'; line: number; bookCount: number }
  | { status: 'empty_slate' }
  | { status: 'historical_lines_unavailable' };

/**
 * The video line is the current-board consensus. Research closes are a different
 * observation and are not a fallback, including when the board rows are gone.
 */
export function resolveLast5Line(input: {
  date: string;
  todayEt: string;
  gamesOnDate: number;
  boardQuotes: BookLineQuote[];
  researchCloses: BookLineQuote[];
}): Last5BoardRead {
  if (input.boardQuotes.length > 0) {
    const line = consensusMainLine(input.boardQuotes);
    return line ? { status: 'ready', line: line.line, bookCount: line.bookCount } : { status: 'empty_slate' };
  }
  if (input.date < input.todayEt && input.gamesOnDate > 0) {
    return { status: 'historical_lines_unavailable' };
  }
  return { status: 'empty_slate' };
}

export function consensusMainLine(
  quotes: BookLineQuote[]
): { line: number; bookCount: number } | null {
  const mainByBook = new Map<string, { line: number; distance: number }>();
  for (const q of quotes) {
    if (q.side !== 'over' || !Number.isFinite(q.line)) continue;
    const distance = q.impliedProbability == null ? 1 : Math.abs(q.impliedProbability - 0.5);
    const current = mainByBook.get(q.sportsbook);
    if (
      !current ||
      distance < current.distance ||
      (distance === current.distance && q.line < current.line)
    ) {
      mainByBook.set(q.sportsbook, { line: q.line, distance });
    }
  }
  if (mainByBook.size === 0) return null;

  const counts = new Map<number, number>();
  for (const { line } of mainByBook.values()) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  let best: { line: number; n: number } | null = null;
  for (const [line, n] of counts) {
    if (!best || n > best.n || (n === best.n && line < best.line)) best = { line, n };
  }
  return best ? { line: best.line, bookCount: mainByBook.size } : null;
}

export interface PlayerGameLogInput {
  /** ET date, YYYY-MM-DD. */
  date: string;
  opponentAbbr: string;
  isHome: boolean;
  value: number;
  minutes: number | null;
}

export function lineResult(value: number, line: number): LineResult {
  if (value > line) return 'over';
  if (value < line) return 'under';
  return 'push';
}

export function lineRecord(values: number[], line: number): LineRecord {
  const record: LineRecord = { overs: 0, unders: 0, pushes: 0, games: values.length };
  for (const v of values) {
    const r = lineResult(v, line);
    if (r === 'over') record.overs += 1;
    else if (r === 'under') record.unders += 1;
    else record.pushes += 1;
  }
  return record;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

function averageOrNull(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length === 0 ? null : average(present);
}

export const MIN_GAMES_FOR_VIDEO = 5;

export interface BuildLast5SnapshotInput {
  player: Last5VideoSnapshot['player'];
  tonight: Last5VideoSnapshot['tonight'];
  market: Last5Market;
  line: number;
  bookCount: number;
  linesAsOf: string;
  /** This season's games played (minutes > 0), any order. Tonight's game excluded. */
  seasonGames: PlayerGameLogInput[];
}

/**
 * Pure builder. Returns an error string rather than a thin snapshot so a video
 * is never rendered from fewer than five games.
 */
export function buildLast5Snapshot(
  input: BuildLast5SnapshotInput
): Last5VideoSnapshot | { error: string } {
  const games = [...input.seasonGames]
    .filter((g) => g.date < input.tonight.date)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (games.length < MIN_GAMES_FOR_VIDEO) {
    return { error: `${input.player.name} has ${games.length} games this season; need ${MIN_GAMES_FOR_VIDEO}.` };
  }

  const recent5 = games.slice(0, 5);
  const recent10 = games.slice(0, 10);
  const last5: Last5GameBar[] = recent5
    .map((g) => ({ ...g, result: lineResult(g.value, input.line) }))
    .reverse();

  return {
    kind: 'last5',
    player: input.player,
    tonight: input.tonight,
    market: input.market,
    line: input.line,
    bookCount: input.bookCount,
    last5,
    last5Average: average(recent5.map((g) => g.value)),
    last5Record: lineRecord(recent5.map((g) => g.value), input.line),
    last10Record: lineRecord(recent10.map((g) => g.value), input.line),
    seasonRecord: lineRecord(games.map((g) => g.value), input.line),
    seasonAverage: average(games.map((g) => g.value)),
    minutes: {
      last5Average: averageOrNull(recent5.map((g) => g.minutes)),
      seasonAverage: averageOrNull(games.map((g) => g.minutes)),
    },
    linesAsOf: input.linesAsOf,
    logsThrough: games[0].date,
  };
}

export function isLast5Snapshot(
  result: Last5VideoSnapshot | { error: string }
): result is Last5VideoSnapshot {
  return !('error' in result);
}
