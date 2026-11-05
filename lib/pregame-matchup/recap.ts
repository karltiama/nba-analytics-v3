/**
 * Postgame recap for the matchup page: the final against the closing consensus line, and each team's
 * box score with starters compared with its previous game. Facts only: no payouts, no "you could have won".
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
  actual: RecapStarter[];
  /** The team's starting five in its previous game this season; null when none is on record. */
  previous: { date: string; players: RecapStarter[] } | null;
};

export type RecapStartersTeam = {
  actual: RecapStarter[];
  summary: string;
  in: RecapStarter[];
  out: RecapStarter[];
};

/** One tile: a short result chip and the sentence behind it. */
export type RecapMarketRow = { label: string; chip: string; text: string };

/** One player_game_logs row for this game. */
export type RecapBoxInput = {
  playerId: string;
  name: string;
  minutes: string | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  fgm: number | null;
  fga: number | null;
  tpm: number | null;
  tpa: number | null;
  ftm: number | null;
  fta: number | null;
  plusMinus: number | null;
};

export type RecapBoxLine = {
  playerId: string;
  name: string;
  starter: boolean;
  /** Listed with no minutes and no stats. */
  dnp: boolean;
  min: string;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fg: string;
  tp: string;
  ft: string;
  pm: number | null;
};

export type RecapBoxTotals = Pick<RecapBoxLine, 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'tov' | 'fg' | 'tp' | 'ft'>;

export type RecapTeam = {
  teamId: string;
  abbr: string;
  name: string;
  /** Starters compared with the previous game; null when no starters are loaded. */
  starters: RecapStartersTeam | null;
  /** Starters first, then bench by minutes, then players who did not play. Empty before logs load. */
  players: RecapBoxLine[];
  totals: RecapBoxTotals | null;
};

export type GameRecap = {
  headline: string;
  score: { away: number; home: number };
  /** One tile each: spread, total, favorite, line move. Empty when no closing line. */
  market: RecapMarketRow[];
  marketCaption: string | null;
  marketNote: string | null;
  /** Away then home. */
  teams: RecapTeam[];
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

function spreadLine(close: ClosingLine, away: string, home: string, homeMargin: number): RecapMarketRow | null {
  const s = close.spread;
  if (s == null) return null;
  const cover = homeMargin + s;
  const closed = s === 0 ? 'Closed pick’em' : s < 0 ? `Closed ${home} ${line(s)}` : `Closed ${away} ${line(-s)}`;
  const side = cover > 0 ? home : away;
  const result = cover === 0 ? 'Push.' : `${side} covered by ${num(cover)}.`;
  return { label: 'Spread', chip: cover === 0 ? 'Push' : `${side} covered`, text: `${closed}. ${result}` };
}

function totalLine(close: ClosingLine, points: number): RecapMarketRow | null {
  const t = close.total;
  if (t == null) return null;
  const diff = points - t;
  const chip = diff === 0 ? 'Push' : diff > 0 ? `Over ${num(diff)}` : `Under ${num(diff)}`;
  const result = diff === 0 ? 'Push.' : diff > 0 ? `Over by ${num(diff)}.` : `Under by ${num(diff)}.`;
  return { label: 'Total', chip, text: `Closed ${t}. Final total ${points}: ${result}` };
}

function favoriteLine(close: ClosingLine, away: string, home: string, homeWon: boolean): RecapMarketRow | null {
  const p = close.homeProb;
  if (p == null || p === 50) return null;
  const homeFav = p > 50;
  const fav = homeFav ? home : away;
  const favPct = homeFav ? p : 100 - p;
  const dog = homeFav ? away : home;
  if (homeFav === homeWon) return { label: 'Favorite', chip: 'Favorite won', text: `${fav} won as ${favPct}% favorites (no-vig).` };
  return { label: 'Favorite', chip: 'Upset', text: `${dog} won as ${100 - favPct}% underdogs (no-vig).` };
}

function moveLine(close: ClosingLine, away: string, home: string, homeMargin: number, points: number): RecapMarketRow | null {
  const parts: string[] = [];
  let chip: string | null = null;
  const { openSpread: o, spread: c, openTotal: ot, total: t } = close;
  if (o != null && c != null && o !== c) {
    const toward = c < o ? home : away;
    chip = `Toward ${toward}`;
    const cover = homeMargin + c;
    const verdict = cover === 0 ? 'push at the close' : `${cover > 0 ? home : away} covered`;
    parts.push(`spread moved toward ${toward} (${home} ${line(o)} → ${line(c)}); ${verdict}`);
  }
  if (ot != null && t != null && ot !== t) {
    const up = t > ot;
    chip ??= `Total ${up ? 'up' : 'down'}`;
    const diff = points - t;
    const verdict = diff === 0 ? 'push at the close' : diff > 0 ? 'went over' : 'went under';
    parts.push(`total moved ${up ? 'up' : 'down'} (${ot} → ${t}); ${verdict}`);
  }
  if (parts.length === 0) {
    if (o == null && ot == null) return null;
    return { label: 'Line move', chip: 'Steady', text: 'Lines held steady from our first pull to tip.' };
  }
  const text = parts.join(' · ');
  return { label: 'Line move', chip: chip!, text: `${text[0]!.toUpperCase()}${text.slice(1)}.` };
}

export function buildStartersRecap(team: RecapStartersInput): RecapStartersTeam | null {
  if (team.actual.length === 0) return null;
  if (!team.previous || team.previous.players.length === 0) {
    return { actual: team.actual, summary: 'First starting five on record this season.', in: [], out: [] };
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
      : `${kept} of ${team.actual.length} starters from the previous game (${when}).`;
  return { actual: team.actual, summary, in: added, out: dropped };
}

/** "36:48" or "0" to minutes; null when unreadable. */
function minutesOf(raw: string | null): number | null {
  if (raw == null || raw.trim() === '') return null;
  const [m, s] = raw.trim().split(':');
  const value = Number(m) + (s ? Number(s) / 60 : 0);
  return Number.isFinite(value) ? value : null;
}

const n0 = (v: number | null): number => (v != null && Number.isFinite(v) ? v : 0);
const made = (m: number | null, a: number | null): string => `${n0(m)}-${n0(a)}`;

/** One team's box score: starters first, bench by minutes, then players who did not play. */
export function buildBoxLines(
  rows: RecapBoxInput[],
  starterIds: ReadonlySet<string>
): { players: RecapBoxLine[]; totals: RecapBoxTotals | null } {
  if (rows.length === 0) return { players: [], totals: null };
  const lines = rows.map((r) => {
    const mins = minutesOf(r.minutes);
    const starter = starterIds.has(r.playerId);
    const noStats = n0(r.points) + n0(r.rebounds) + n0(r.assists) + n0(r.fga) + n0(r.fta) === 0;
    const dnp = !starter && (mins == null || mins === 0) && noStats;
    const boxLine: RecapBoxLine = {
      playerId: r.playerId,
      name: r.name,
      starter,
      dnp,
      min: dnp ? 'DNP' : r.minutes?.trim() || '—',
      pts: n0(r.points),
      reb: n0(r.rebounds),
      ast: n0(r.assists),
      stl: n0(r.steals),
      blk: n0(r.blocks),
      tov: n0(r.turnovers),
      fg: made(r.fgm, r.fga),
      tp: made(r.tpm, r.tpa),
      ft: made(r.ftm, r.fta),
      pm: r.plusMinus,
    };
    return { mins: mins ?? 0, line: boxLine };
  });
  const rank = (x: { line: RecapBoxLine }) => (x.line.starter ? 0 : x.line.dnp ? 2 : 1);
  lines.sort((a, b) => rank(a) - rank(b) || b.mins - a.mins || b.line.pts - a.line.pts);
  const sum = (f: (r: RecapBoxInput) => number | null) => rows.reduce((t, r) => t + n0(f(r)), 0);
  return {
    players: lines.map((x) => x.line),
    totals: {
      pts: sum((r) => r.points),
      reb: sum((r) => r.rebounds),
      ast: sum((r) => r.assists),
      stl: sum((r) => r.steals),
      blk: sum((r) => r.blocks),
      tov: sum((r) => r.turnovers),
      fg: `${sum((r) => r.fgm)}-${sum((r) => r.fga)}`,
      tp: `${sum((r) => r.tpm)}-${sum((r) => r.tpa)}`,
      ft: `${sum((r) => r.ftm)}-${sum((r) => r.fta)}`,
    },
  };
}

export function buildGameRecap(input: {
  awayAbbr: string;
  homeAbbr: string;
  awayScore: number;
  homeScore: number;
  overtimePeriods?: number;
  close: ClosingLine | null;
  /** Away then home. */
  teams: { teamId: string; abbr: string; name: string; starters: RecapStartersInput | null; box: RecapBoxInput[] }[];
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
        spreadLine(close, away, home, homeMargin),
        totalLine(close, points),
        favoriteLine(close, away, home, homeWon),
        moveLine(close, away, home, homeMargin, points),
      ].filter((x): x is RecapMarketRow => x != null)
    : [];
  const teams = input.teams.map((team): RecapTeam => {
    const starters = team.starters ? buildStartersRecap(team.starters) : null;
    const box = buildBoxLines(team.box, new Set(starters?.actual.map((p) => p.playerId) ?? []));
    return { teamId: team.teamId, abbr: team.abbr, name: team.name, starters, ...box };
  });
  return {
    headline,
    score: { away: awayScore, home: homeScore },
    market,
    marketCaption: close && market.length > 0 ? `Closing consensus of ${close.books} sportsbooks, last pull before tip` : null,
    marketNote: market.length > 0 ? null : 'No closing line stored for this game.',
    teams,
  };
}
