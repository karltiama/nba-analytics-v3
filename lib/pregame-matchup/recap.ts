/**
 * Postgame recap for the matchup page: the final against the closing consensus line, and who started
 * against each team's previous starting five. Facts only: no payouts, no "you could have won".
 */

/** Consensus at tip from the odds job's last pregame pull, plus the first pull for the move. */
export type ClosingLine = {
  /** Home spread (negative = home favoured). */
  spread: number | null;
  total: number | null;
  /** No-vig home win chance, integer percent. */
  homeProb: number | null;
  books: number;
  openSpread: number | null;
  openTotal: number | null;
};

export type RecapStarter = { playerId: string; name: string };

export type RecapStartersInput = {
  teamId: string;
  abbr: string;
  actual: RecapStarter[];
  /** The team's starting five in its previous game this season; null when none is on record. */
  previous: { date: string; players: RecapStarter[] } | null;
};

export type RecapStartersTeam = {
  abbr: string;
  actual: RecapStarter[];
  summary: string;
  in: RecapStarter[];
  out: RecapStarter[];
};

export type GameRecap = {
  headline: string;
  /** One line each: spread, total, favorite, line move. Empty when no closing line. */
  market: { label: string; text: string }[];
  marketCaption: string | null;
  marketNote: string | null;
  starters: RecapStartersTeam[] | null;
};

function num(v: number): string {
  return String(Math.abs(v));
}

function line(v: number): string {
  return v > 0 ? `+${num(v)}` : v < 0 ? `−${num(v)}` : 'PK';
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
}

function spreadLines(close: ClosingLine, away: string, home: string, homeMargin: number): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  const s = close.spread;
  if (s != null) {
    const cover = homeMargin + s;
    const closed = s === 0 ? 'Closed pick’em' : s < 0 ? `Closed ${home} ${line(s)}` : `Closed ${away} ${line(-s)}`;
    const result =
      cover === 0 ? 'Push.' : cover > 0 ? `${home} covered by ${num(cover)}.` : `${away} covered by ${num(cover)}.`;
    out.push({ label: 'Spread', text: `${closed}. ${result}` });
  }
  return out;
}

function totalLine(close: ClosingLine, points: number): { label: string; text: string } | null {
  const t = close.total;
  if (t == null) return null;
  const diff = points - t;
  const result = diff === 0 ? 'Push.' : diff > 0 ? `Over by ${num(diff)}.` : `Under by ${num(diff)}.`;
  return { label: 'Total', text: `Closed ${t}. Final total ${points}: ${result}` };
}

function favoriteLine(close: ClosingLine, away: string, home: string, homeWon: boolean): { label: string; text: string } | null {
  const p = close.homeProb;
  if (p == null || p === 50) return null;
  const homeFav = p > 50;
  const fav = homeFav ? home : away;
  const favPct = homeFav ? p : 100 - p;
  const dog = homeFav ? away : home;
  if (homeFav === homeWon) return { label: 'Favorite', text: `${fav} won as ${favPct}% favorites (no-vig).` };
  return { label: 'Favorite', text: `Upset: ${dog} won as ${100 - favPct}% underdogs (no-vig).` };
}

function moveLines(close: ClosingLine, away: string, home: string, homeMargin: number, points: number): { label: string; text: string } | null {
  const parts: string[] = [];
  const { openSpread: o, spread: c, openTotal: ot, total: t } = close;
  if (o != null && c != null && o !== c) {
    const toward = c < o ? home : away;
    const cover = homeMargin + c;
    const coveredSide = cover === 0 ? null : cover > 0 ? home : away;
    const verdict = coveredSide == null ? 'push at the close' : `${coveredSide} covered`;
    parts.push(`spread moved toward ${toward} (${home} ${line(o)} → ${line(c)}); ${verdict}`);
  }
  if (ot != null && t != null && ot !== t) {
    const up = t > ot;
    const diff = points - t;
    const verdict = diff === 0 ? 'push at the close' : diff > 0 ? 'went over' : 'went under';
    parts.push(`total moved ${up ? 'up' : 'down'} (${ot} → ${t}); ${verdict}`);
  }
  if (parts.length === 0) {
    if (o == null && ot == null) return null;
    return { label: 'Line move', text: 'Lines held steady from our first pull to tip.' };
  }
  const text = parts.join(' · ');
  return { label: 'Line move', text: `${text[0]!.toUpperCase()}${text.slice(1)}.` };
}

export function buildStartersRecap(team: RecapStartersInput): RecapStartersTeam | null {
  if (team.actual.length === 0) return null;
  if (!team.previous || team.previous.players.length === 0) {
    return { abbr: team.abbr, actual: team.actual, summary: 'First starting five on record this season.', in: [], out: [] };
  }
  const prev = new Set(team.previous.players.map((p) => p.playerId));
  const now = new Set(team.actual.map((p) => p.playerId));
  const added = team.actual.filter((p) => !prev.has(p.playerId));
  const dropped = team.previous.players.filter((p) => !now.has(p.playerId));
  const kept = team.actual.length - added.length;
  const when = shortDate(team.previous.date);
  const summary =
    added.length === 0
      ? `Same five as the previous game (${when}).`
      : `${kept} of ${team.actual.length} from the previous game (${when}).`;
  return { abbr: team.abbr, actual: team.actual, summary, in: added, out: dropped };
}

export function buildGameRecap(input: {
  awayAbbr: string;
  homeAbbr: string;
  awayScore: number;
  homeScore: number;
  overtimePeriods?: number;
  close: ClosingLine | null;
  starters: RecapStartersInput[] | null;
}): GameRecap {
  const { awayAbbr: away, homeAbbr: home, awayScore, homeScore } = input;
  const homeWon = homeScore > awayScore;
  const ot = input.overtimePeriods && input.overtimePeriods > 0 ? (input.overtimePeriods === 1 ? ' (OT)' : ` (${input.overtimePeriods}OT)`) : '';
  const headline =
    homeScore === awayScore
      ? `Final ${awayScore}–${homeScore}${ot}`
      : homeWon
        ? `${home} beat ${away} ${homeScore}–${awayScore}${ot}`
        : `${away} won at ${home} ${awayScore}–${homeScore}${ot}`;
  const homeMargin = homeScore - awayScore;
  const points = homeScore + awayScore;
  const close = input.close;
  const market = close
    ? [
        ...spreadLines(close, away, home, homeMargin),
        totalLine(close, points),
        favoriteLine(close, away, home, homeWon),
        moveLines(close, away, home, homeMargin, points),
      ].filter((x): x is { label: string; text: string } => x != null)
    : [];
  const starters = (input.starters ?? []).map(buildStartersRecap).filter((x): x is RecapStartersTeam => x != null);
  return {
    headline,
    market,
    marketCaption: close && market.length > 0 ? `Closing consensus of ${close.books} sportsbooks, last pull before tip` : null,
    marketNote: market.length > 0 ? null : 'No closing line stored for this game.',
    starters: starters.length > 0 ? starters : null,
  };
}
