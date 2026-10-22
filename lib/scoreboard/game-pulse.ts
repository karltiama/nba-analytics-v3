/**
 * Game Pulse, stat leaders, and team-stat context for Today's Games. Display only, pure.
 * Every value comes from one scoreboard.v1 snapshot: scores, lifecycle, and box_score lines.
 * Nothing here infers runs, momentum, possessions, causes, or win probability.
 */

import type { GameLifecycleState } from '@/lib/betting/normalize-game-status';
import type { ScoreboardGame } from './contract';

export type GamePhase = 'pregame' | 'live' | 'final' | 'other';

const IN_GAME: ReadonlySet<GameLifecycleState> = new Set(['live', 'halftime', 'overtime']);

export function gamePhase(lifecycle: GameLifecycleState | null): GamePhase {
  if (lifecycle === 'scheduled') return 'pregame';
  if (lifecycle != null && IN_GAME.has(lifecycle)) return 'live';
  if (lifecycle === 'final') return 'final';
  return 'other';
}

export type GamePulse = {
  kind: 'leading' | 'tied' | 'won';
  text: string;
  /** provider_team_id of the leader or winner. Null when tied. */
  teamId: string | null;
  margin: number;
};

export type TopScorer =
  | { kind: 'leader'; label: 'Leading scorer' | 'Top scorer'; text: string; pts: number; playerIds: string[] }
  | { kind: 'status'; text: string };

function validScore(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** City part of "Toronto Raptors" / "Portland Trail Blazers". Falls back to the abbreviation. */
function cityName(name: string | null, abbr: string | null): string {
  const trimmed = name?.trim() ?? '';
  const fallback = abbr?.trim() || trimmed || 'Team';
  if (!trimmed) return fallback;
  if (trimmed.endsWith('Trail Blazers')) return trimmed.slice(0, -'Trail Blazers'.length).trim() || fallback;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return fallback;
  return parts.slice(0, -1).join(' ');
}

/** Short team names for pulse copy. Uses abbreviations when the two city names would read the same. */
export function pulseTeamNames(game: Pick<ScoreboardGame, 'home' | 'visitor'>): { home: string; visitor: string } {
  const home = cityName(game.home?.name ?? null, game.home?.abbreviation ?? null);
  const visitor = cityName(game.visitor?.name ?? null, game.visitor?.abbreviation ?? null);
  if (home.toLowerCase() !== visitor.toLowerCase()) return { home, visitor };
  return {
    home: game.home?.abbreviation?.trim() || home,
    visitor: game.visitor?.abbreviation?.trim() || visitor,
  };
}

/**
 * Leader and margin while in progress, winner and margin when final.
 * A stale in-game snapshot is described in the past tense so it never reads as current.
 */
export function gamePulse(
  game: Pick<ScoreboardGame, 'lifecycle' | 'home' | 'visitor' | 'stale'> & { overtime_periods?: number }
): GamePulse | null {
  const phase = gamePhase(game.lifecycle ?? null);
  if (phase !== 'live' && phase !== 'final') return null;
  const homeScore = game.home?.score;
  const visitorScore = game.visitor?.score;
  if (!validScore(homeScore) || !validScore(visitorScore)) return null;
  const names = pulseTeamNames(game);
  const margin = Math.abs(homeScore - visitorScore);
  const homeAhead = homeScore > visitorScore;
  const leaderName = homeAhead ? names.home : names.visitor;
  const leaderId = homeAhead ? game.home.provider_team_id : game.visitor.provider_team_id;

  if (phase === 'final') {
    if (margin === 0) return null;
    const ot = game.overtime_periods ?? 0;
    const suffix = ot === 1 ? ' in overtime' : ot > 1 ? ` in ${ot} overtimes` : '';
    return { kind: 'won', text: `${leaderName} wins by ${margin}${suffix}`, teamId: leaderId, margin };
  }
  if (margin === 0) {
    return { kind: 'tied', text: game.stale ? 'Tied at last update' : 'Game tied', teamId: null, margin: 0 };
  }
  return {
    kind: 'leading',
    text: game.stale ? `${leaderName} led by ${margin} at last update` : `${leaderName} leads by ${margin}`,
    teamId: leaderId,
    margin,
  };
}

type Line = ScoreboardGame['box_score']['players'][number];

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export type LeaderStat = 'pts' | 'reb' | 'ast';

export type StatLeader = {
  stat: LeaderStat;
  value: number;
  /** Tied leaders in name order, then player id. */
  players: Array<{ id: string; name: string; teamId: string }>;
};

export type StatLeaders =
  | { kind: 'leaders'; pts: StatLeader | null; reb: StatLeader | null; ast: StatLeader | null }
  | { kind: 'status'; text: string };

type LeaderGame = Pick<ScoreboardGame, 'lifecycle' | 'home' | 'visitor' | 'stale' | 'box_score'>;

/**
 * Leader for one stat across both teams from usable lines: player id, name, one of the two team ids,
 * and an integer value for that stat. Missing values are skipped, never zero.
 * Both teams need a usable line for the stat; a top value of 0 is not a leader.
 */
function leaderFor(game: LeaderGame, stat: LeaderStat): StatLeader | null | 'incomplete' {
  const homeId = game.home?.provider_team_id;
  const visitorId = game.visitor?.provider_team_id;
  const byPlayer = new Map<string, { id: string; name: string; teamId: string; value: number }>();
  for (const line of (game.box_score?.players ?? []) as Line[]) {
    const id = typeof line?.playerId === 'string' ? line.playerId.trim() : '';
    const name = typeof line?.name === 'string' ? line.name.trim() : '';
    if (!id || !name) continue;
    const value = line[stat];
    if (!validScore(value)) continue;
    if (line.teamId !== homeId && line.teamId !== visitorId) continue;
    byPlayer.set(id, { id, name, teamId: line.teamId, value });
  }
  const lines = [...byPlayer.values()];
  const teamsSeen = new Set(lines.map((line) => line.teamId));
  if (!teamsSeen.has(homeId) || !teamsSeen.has(visitorId)) return 'incomplete';
  const best = Math.max(...lines.map((line) => line.value));
  if (best <= 0) return null;
  const players = lines
    .filter((line) => line.value === best)
    .sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id))
    .map(({ id, name, teamId }) => ({ id, name, teamId }));
  return { stat, value: best, players };
}

/**
 * Points, rebounds, and assists leaders while in progress or final.
 * A stale in-game snapshot says the stats are delayed and does not name leaders.
 * Returns a status when the box is missing, unverified, or covers one team.
 */
export function statLeaders(game: LeaderGame): StatLeaders | null {
  const phase = gamePhase(game.lifecycle ?? null);
  if (phase !== 'live' && phase !== 'final') return null;
  if (phase === 'live' && game.stale) return { kind: 'status', text: 'Player stats delayed' };
  const completeness = game.box_score?.completeness ?? 'none';
  const pending: StatLeaders =
    phase === 'final'
      ? { kind: 'status', text: completeness === 'none' ? 'Player stats pending' : 'Box score being verified' }
      : { kind: 'status', text: 'Awaiting live player stats' };
  if (completeness === 'none') return pending;
  if (phase === 'final' && completeness !== 'verified_final') return pending;
  const pts = leaderFor(game, 'pts');
  if (pts === 'incomplete') return pending;
  const reb = leaderFor(game, 'reb');
  const ast = leaderFor(game, 'ast');
  return {
    kind: 'leaders',
    pts,
    reb: reb === 'incomplete' ? null : reb,
    ast: ast === 'incomplete' ? null : ast,
  };
}

/**
 * Game-leading scorer as one line of text, from statLeaders.
 * Ties are listed in name order; three or more are summarized as a count.
 */
export function topScorer(game: LeaderGame): TopScorer | null {
  const leaders = statLeaders(game);
  if (!leaders) return null;
  if (leaders.kind === 'status') return leaders;
  const pts = leaders.pts;
  if (!pts) return null;
  const names = pts.players.map((player) => player.name);
  const who = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} & ${names[1]}` : `${names.length} players tied`;
  return {
    kind: 'leader',
    label: gamePhase(game.lifecycle ?? null) === 'final' ? 'Top scorer' : 'Leading scorer',
    text: `${who} · ${pts.value} PTS`,
    pts: pts.value,
    playerIds: pts.players.map((player) => player.id),
  };
}

/**
 * Selection heuristics for team-stat context. Product thresholds, not statistical significance tests.
 * A candidate qualifies at or above its threshold.
 */
export const PULSE_THRESHOLDS = {
  /** Both teams need at least this many 3PA. */
  threePointMinAttempts: 8,
  /** 3P% gap in percentage points. */
  threePointMinGap: 18,
  /** Both teams need at least this many FGA for eFG%, and as the activity floor for OREB and FTA. */
  minFieldGoalAttempts: 15,
  /** eFG% gap in percentage points. */
  efgMinGap: 12,
  offensiveReboundMinGap: 5,
  /** Total-rebound gap. Both teams also need the field-goal attempt floor. */
  reboundMinGap: 8,
  /** Unique points leader, and that player has at least this many field-goal attempts. */
  leadingPlayerMinPoints: 12,
  leadingPlayerMinFga: 8,
  freeThrowAttemptMinGap: 8,
  /** A lower-priority candidate must beat the top-priority one by this much (gap / threshold) to be shown. */
  switchMargin: 0.25,
  /** Player lines a team needs before its totals are trusted. Same floor as box-verify. */
  minLinesPerTeam: 5,
} as const;

export type TeamTotals = {
  teamId: string;
  pts: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  /** Null when any line lacks oreb or contradicts reb = oreb + dreb. */
  oreb: number | null;
  /** Null when any line lacks reb. Never filled in as zero. */
  reb: number | null;
};

type TotalsGame = Pick<ScoreboardGame, 'home' | 'visitor' | 'box_score'>;

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Team totals from one box snapshot, or null when the box itself cannot be trusted.
 * Every player id appears once and belongs to the home or visitor team; every line has whole,
 * non-negative shooting counts with makes <= attempts, 3PM <= FGM, 3PA <= FGA, and
 * pts = 2*FGM + 3PM + FTM; each team has enough lines. Missing values are never zero.
 * The scoreboard score is a separate observation and is not required to match.
 * Zero-minute lines count only through the values they carry.
 */
export function teamTotals(game: TotalsGame): { home: TeamTotals; visitor: TeamTotals } | null {
  const homeId = game.home?.provider_team_id;
  const visitorId = game.visitor?.provider_team_id;
  if (!homeId || !visitorId || homeId === visitorId) return null;
  const seen = new Set<string>();
  const totals = new Map<string, TeamTotals & { lines: number }>();
  for (const id of [homeId, visitorId]) {
    totals.set(id, { teamId: id, pts: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, reb: 0, lines: 0 });
  }
  for (const line of (game.box_score?.players ?? []) as Line[]) {
    const id = typeof line?.playerId === 'string' ? line.playerId.trim() : '';
    if (!id || seen.has(id)) return null;
    seen.add(id);
    const team = totals.get(line.teamId);
    if (!team) return null;
    const { pts, fgm, fga, fg3m, fg3a, ftm, fta } = line;
    if (!count(pts) || !count(fgm) || !count(fga) || !count(fg3m) || !count(fg3a) || !count(ftm) || !count(fta)) return null;
    if (fgm > fga || fg3m > fg3a || ftm > fta || fg3m > fgm || fg3a > fga) return null;
    if (pts !== 2 * fgm + fg3m + ftm) return null;
    team.lines += 1;
    team.pts += pts;
    team.fgm += fgm;
    team.fga += fga;
    team.fg3m += fg3m;
    team.fg3a += fg3a;
    team.ftm += ftm;
    team.fta += fta;
    const orebKnown = count(line.oreb) && !(count(line.reb) && count(line.dreb) && line.reb !== line.oreb + line.dreb);
    team.oreb = team.oreb != null && orebKnown ? team.oreb + (line.oreb as number) : null;
    team.reb = team.reb != null && count(line.reb) ? team.reb + line.reb : null;
  }
  const home = totals.get(homeId)!;
  const visitor = totals.get(visitorId)!;
  if (home.lines < PULSE_THRESHOLDS.minLinesPerTeam || visitor.lines < PULSE_THRESHOLDS.minLinesPerTeam) return null;
  const strip = (t: TeamTotals): TeamTotals => ({
    teamId: t.teamId, pts: t.pts, fgm: t.fgm, fga: t.fga, fg3m: t.fg3m, fg3a: t.fg3a, ftm: t.ftm, fta: t.fta, oreb: t.oreb, reb: t.reb,
  });
  return { home: strip(home), visitor: strip(visitor) };
}

/**
 * True when both team scores are known and equal the box's own player-point sums.
 * Claims that mention the scoreboard score require this. Box-only insights do not.
 */
export function boxScoreAligned(
  game: TotalsGame,
  totals: { home: TeamTotals; visitor: TeamTotals }
): boolean {
  return (
    validScore(game.home?.score) &&
    validScore(game.visitor?.score) &&
    totals.home.pts === game.home.score &&
    totals.visitor.pts === game.visitor.score
  );
}

export type PulseInsightId =
  | 'three_point_pct'
  | 'efg_pct'
  | 'rebounds'
  | 'offensive_rebounds'
  | 'free_throw_attempts'
  | 'leading_player';

export type PulseInsight = {
  id: PulseInsightId;
  text: string;
  /** provider_team_id of the team with the higher value. */
  teamId: string;
  /** Raw values for the advantaged team first. Percentages are unrounded. */
  values: { leader: number; trailer: number; gap: number };
  /** gap / category threshold. A ranking aid, not a confidence or effect size. */
  score: number;
  /** box_score.acquired_at of the snapshot the values came from. */
  observedAt: string | null;
};

/** Cross-family order used for ties and the switch margin. Shooting first, then rebounding, then FTA. */
const INSIGHT_PRIORITY: readonly PulseInsightId[] = [
  'three_point_pct',
  'efg_pct',
  'rebounds',
  'offensive_rebounds',
  'free_throw_attempts',
];

/** Multiply first so whole-percent results (8/25 = 32) are exact at the threshold. */
function pct(made: number, attempts: number): number {
  return (made * 100) / attempts;
}

function efg(t: TeamTotals): number {
  return ((t.fgm + 0.5 * t.fg3m) * 100) / t.fga;
}

/** "an 8–3", "an 11–6", "an 18–9", otherwise "a". */
function article(n: number): string {
  const s = String(n);
  return s.startsWith('8') || s === '11' || s === '18' ? 'an' : 'a';
}

type Side = { totals: TeamTotals; name: string };

/** Every qualifying candidate for one trusted snapshot, unsorted. */
export function insightCandidates(
  totals: { home: TeamTotals; visitor: TeamTotals },
  names: { home: string; visitor: string },
  final: boolean,
  observedAt: string | null
): PulseInsight[] {
  const T = PULSE_THRESHOLDS;
  const home: Side = { totals: totals.home, name: names.home };
  const visitor: Side = { totals: totals.visitor, name: names.visitor };
  const out: PulseInsight[] = [];
  const order = (h: number, v: number): [Side, Side, number, number] | null =>
    h === v ? null : h > v ? [home, visitor, h, v] : [visitor, home, v, h];
  const push = (id: PulseInsightId, lead: Side, leader: number, trailer: number, threshold: number, text: string) =>
    out.push({ id, text, teamId: lead.totals.teamId, values: { leader, trailer, gap: leader - trailer }, score: (leader - trailer) / threshold, observedAt });
  const enoughFga = home.totals.fga >= T.minFieldGoalAttempts && visitor.totals.fga >= T.minFieldGoalAttempts;

  if (home.totals.fg3a >= T.threePointMinAttempts && visitor.totals.fg3a >= T.threePointMinAttempts) {
    const o = order(pct(home.totals.fg3m, home.totals.fg3a), pct(visitor.totals.fg3m, visitor.totals.fg3a));
    if (o && o[2] - o[3] >= T.threePointMinGap) {
      const [lead, trail, a, b] = o;
      const verb = final ? 'shot' : 'is shooting';
      push('three_point_pct', lead, a, b, T.threePointMinGap,
        `${lead.name} ${verb} ${Math.round(a)}% from three (${lead.totals.fg3m}/${lead.totals.fg3a}), compared with ${Math.round(b)}% for ${trail.name} (${trail.totals.fg3m}/${trail.totals.fg3a}).`);
    }
  }
  if (enoughFga) {
    const o = order(efg(home.totals), efg(visitor.totals));
    if (o && o[2] - o[3] >= T.efgMinGap) {
      const [lead, trail, a, b] = o;
      const verb = final ? 'finished with' : 'has';
      push('efg_pct', lead, a, b, T.efgMinGap,
        `${lead.name} ${verb} a ${Math.round(a)}% effective field-goal percentage, compared with ${Math.round(b)}% for ${trail.name}.`);
    }
    const ho = home.totals.oreb;
    const vo = visitor.totals.oreb;
    if (ho != null && vo != null) {
      const o2 = order(ho, vo);
      if (o2 && o2[2] - o2[3] >= T.offensiveReboundMinGap) {
        const [lead, , a, b] = o2;
        const verb = final ? 'finished with' : 'has';
        push('offensive_rebounds', lead, a, b, T.offensiveReboundMinGap, `${lead.name} ${verb} ${article(a)} ${a}–${b} advantage in offensive rebounds.`);
      }
    }
    const hr = home.totals.reb;
    const vr = visitor.totals.reb;
    if (hr != null && vr != null) {
      const oReb = order(hr, vr);
      if (oReb && oReb[2] - oReb[3] >= T.reboundMinGap) {
        const [lead, trail, a, b] = oReb;
        const verb = final ? 'finished with' : 'has';
        push('rebounds', lead, a, b, T.reboundMinGap, `${lead.name} ${verb} ${a} rebounds, compared with ${b} for ${trail.name}.`);
      }
    }
    const o3 = order(home.totals.fta, visitor.totals.fta);
    if (o3 && o3[2] - o3[3] >= T.freeThrowAttemptMinGap) {
      const [lead, trail, a, b] = o3;
      const verb = final ? 'attempted' : 'has attempted';
      push('free_throw_attempts', lead, a, b, T.freeThrowAttemptMinGap, `${lead.name} ${verb} ${a} free throws, compared with ${b} for ${trail.name}.`);
    }
  }
  return out;
}

/**
 * One insight from the candidates, deterministically.
 * 3P% and eFG% describe overlapping shooting edges, so only the stronger of the two survives
 * (3P% on an equal score). Then the highest-priority candidate is shown unless another beats its
 * score by at least switchMargin, so small changes between refreshes do not flip the panel.
 */
export function selectInsight(candidates: PulseInsight[]): PulseInsight | null {
  const rank = (id: PulseInsightId) => INSIGHT_PRIORITY.indexOf(id);
  const three = candidates.find((c) => c.id === 'three_point_pct');
  const eff = candidates.find((c) => c.id === 'efg_pct');
  const dropShooting: PulseInsightId | null = three && eff ? (eff.score > three.score ? 'three_point_pct' : 'efg_pct') : null;
  const totalReb = candidates.find((c) => c.id === 'rebounds');
  const offensive = candidates.find((c) => c.id === 'offensive_rebounds');
  const dropRebounds: PulseInsightId | null =
    totalReb && offensive ? (offensive.score > totalReb.score ? 'rebounds' : 'offensive_rebounds') : null;
  const pool = candidates
    .filter((c) => c.id !== dropShooting && c.id !== dropRebounds && c.id !== 'leading_player')
    .sort((a, b) => rank(a.id) - rank(b.id));
  if (pool.length === 0) return null;
  let chosen = pool[0];
  for (const candidate of pool.slice(1)) {
    if (candidate.score >= chosen.score + PULSE_THRESHOLDS.switchMargin) chosen = candidate;
  }
  return chosen;
}

export type GameContext =
  | { kind: 'insight'; text: string; insight: PulseInsight; support: PulseInsight | null }
  | { kind: 'developing' | 'no_standout' | 'pending' | 'unavailable' | 'stale'; text: string };

function countLabel(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function joinCounts(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/**
 * One player's observed line, only after teamTotals has accepted the box.
 * A tie is not a leader. Turnovers and fouls are not on the stored line, so they are not described.
 */
export function leadingPlayerInsight(
  game: Pick<ScoreboardGame, 'lifecycle' | 'home' | 'visitor' | 'stale' | 'box_score'>,
  trusted: boolean,
  final: boolean,
  observedAt: string | null
): PulseInsight | null {
  if (!trusted) return null;
  const leaders = statLeaders(game);
  if (!leaders || leaders.kind !== 'leaders' || !leaders.pts || leaders.pts.players.length !== 1) return null;
  const top = leaders.pts;
  if (top.value < PULSE_THRESHOLDS.leadingPlayerMinPoints) return null;
  const player = top.players[0];
  const line = ((game.box_score?.players ?? []) as Line[]).find((row) => row.playerId === player.id);
  if (!line || !count(line.fga) || line.fga < PULSE_THRESHOLDS.leadingPlayerMinFga) return null;
  const parts = [countLabel(top.value, 'point', 'points')];
  if (count(line.reb) && line.reb > 0) parts.push(countLabel(line.reb, 'rebound', 'rebounds'));
  if (count(line.ast) && line.ast > 0) parts.push(countLabel(line.ast, 'assist', 'assists'));
  const verb = final ? 'finished with' : 'has';
  const second = ((game.box_score?.players ?? []) as Line[])
    .filter((row) => row.playerId !== player.id && count(row.pts))
    .reduce((best, row) => Math.max(best, row.pts as number), 0);
  return {
    id: 'leading_player',
    text: `${player.name} ${verb} ${joinCounts(parts)}.`,
    teamId: player.teamId,
    values: { leader: top.value, trailer: second, gap: top.value - second },
    score: top.value / PULSE_THRESHOLDS.leadingPlayerMinPoints,
    observedAt,
  };
}

export const GAME_CONTEXT_COPY = {
  developing: 'More game context will appear as stats develop.',
  stale: 'Game context resumes when fresh stats arrive.',
  noStandout: 'No standout team stat gap in the final box score.',
  pending: 'Recap stats appear once the final box score is verified.',
  unavailable: 'Team stat recap is not available for this game.',
} as const;

/**
 * Text for the Game Pulse (live) or Game Recap (final) panel. Never restates the score or the
 * stat leaders. Live uses the latest non-stale snapshot; final uses only a verified_final box.
 * Null before tip and for postponed, canceled, and unknown games.
 */
export function gameContext(
  game: Pick<ScoreboardGame, 'lifecycle' | 'home' | 'visitor' | 'stale' | 'box_score'>
): GameContext | null {
  const phase = gamePhase(game.lifecycle ?? null);
  if (phase !== 'live' && phase !== 'final') return null;
  if (phase === 'live' && game.stale) return { kind: 'stale', text: GAME_CONTEXT_COPY.stale };
  const completeness = game.box_score?.completeness ?? 'none';
  if (phase === 'final' && completeness !== 'verified_final') return { kind: 'pending', text: GAME_CONTEXT_COPY.pending };
  const fallback: GameContext =
    phase === 'final' ? { kind: 'no_standout', text: GAME_CONTEXT_COPY.noStandout } : { kind: 'developing', text: GAME_CONTEXT_COPY.developing };
  if (phase === 'live' && completeness !== 'live_partial') return fallback;
  const totals = teamTotals(game);
  if (!totals) return phase === 'final' ? { kind: 'unavailable', text: GAME_CONTEXT_COPY.unavailable } : fallback;
  if (!game.box_score?.acquired_at) return fallback;
  const observedAt = game.box_score?.acquired_at ?? null;
  const names = pulseTeamNames(game);
  const insight = selectInsight(insightCandidates(totals, names, phase === 'final', observedAt));
  const player = leadingPlayerInsight(game, true, phase === 'final', observedAt);
  if (insight) return { kind: 'insight', text: insight.text, insight, support: player };
  if (player) return { kind: 'insight', text: player.text, insight: player, support: null };
  return fallback;
}

/**
 * Relative freshness from the server observation time. Minute resolution because the page
 * re-reads about once a minute. Older than an hour falls back to null so callers use clock time.
 */
export function freshnessAgeLabel(iso: string | null | undefined, nowMs: number): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return null;
  const ageMs = nowMs - at;
  if (ageMs < 60_000) return 'Updated just now';
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  return null;
}
