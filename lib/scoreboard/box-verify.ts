/**
 * Final box-score verification. Pure.
 *
 * verified_final needs provider-final evidence AND internally consistent statistics:
 *   provider: /games lifecycle final, confirmed SCOREBOARD_POLICY.TERMINAL_CONFIRMATIONS times;
 *             the box row's own status is final and its scores equal the confirmed final scores;
 *             the box was observed at or after the game was first seen final.
 *   per player: shooting fields present and non-negative, makes <= attempts, 3PM <= FGM,
 *             pts = 2*FGM + 3PM + FTM, and reb = oreb + dreb when all three are present.
 *   per team: at least 5 player lines, player points sum to the team score, and player minutes
 *             sum to 5 * (48 + 5 * OT) within 1 minute per line with minutes (provider rounding).
 * Any missing field fails closed to final_unverified.
 */

import type { BoxScoreCompleteness, LiveBoxObservation, ScoreboardPlayerLine, StoredScoreboardGame } from './contract';
import { SCOREBOARD_POLICY } from './planner';

export type BoxVerifyGame = Pick<
  StoredScoreboardGame,
  | 'lifecycle'
  | 'terminalConfirmations'
  | 'finalObservedAt'
  | 'homeTeamId'
  | 'visitorTeamId'
  | 'homeScore'
  | 'visitorScore'
  | 'overtimePeriods'
>;

const MIN_LINES_PER_TEAM = 5;

/** "34", "34:12", "34.5" → minutes; null/"" → 0 (did not play); anything else → NaN. */
export function parseMinutes(min: string | null): number {
  if (min == null || min.trim() === '') return 0;
  const s = min.trim();
  const mmss = /^(\d{1,3}):([0-5]\d)$/.exec(s);
  if (mmss) return Number(mmss[1]) + Number(mmss[2]) / 60;
  if (/^\d{1,3}(\.\d+)?$/.test(s)) return Number(s);
  return Number.NaN;
}

function lineFailures(l: ScoreboardPlayerLine): string[] {
  const out: string[] = [];
  const who = `player ${l.playerId}`;
  const req = { pts: l.pts, fgm: l.fgm, fga: l.fga, fg3m: l.fg3m, fg3a: l.fg3a, ftm: l.ftm, fta: l.fta };
  for (const [k, v] of Object.entries(req)) {
    if (v == null) out.push(`${who}: missing ${k}`);
    else if (v < 0) out.push(`${who}: negative ${k}`);
  }
  if (out.length) return out;
  const { pts, fgm, fga, fg3m, fg3a, ftm, fta } = req as Record<keyof typeof req, number>;
  if (fgm > fga) out.push(`${who}: fgm > fga`);
  if (fg3m > fg3a) out.push(`${who}: fg3m > fg3a`);
  if (ftm > fta) out.push(`${who}: ftm > fta`);
  if (fg3m > fgm) out.push(`${who}: fg3m > fgm`);
  if (pts !== 2 * fgm + fg3m + ftm) out.push(`${who}: pts != 2*fgm + fg3m + ftm`);
  if (l.reb != null && l.oreb != null && l.dreb != null && l.reb !== l.oreb + l.dreb) {
    out.push(`${who}: reb != oreb + dreb`);
  }
  if (Number.isNaN(parseMinutes(l.min))) out.push(`${who}: unparseable min`);
  return out;
}

function teamFailures(side: string, lines: ScoreboardPlayerLine[], score: number | null, overtimePeriods: number): string[] {
  const out: string[] = [];
  if (lines.length < MIN_LINES_PER_TEAM) out.push(`${side}: ${lines.length} player lines < ${MIN_LINES_PER_TEAM}`);
  const pts = lines.reduce((s, l) => s + (l.pts ?? 0), 0);
  if (score == null || pts !== score) out.push(`${side}: player points ${pts} != score ${score}`);
  const minutes = lines.map((l) => parseMinutes(l.min));
  if (minutes.some(Number.isNaN)) return out;
  const total = minutes.reduce((s, m) => s + m, 0);
  const expected = 5 * (48 + 5 * overtimePeriods);
  const tolerance = minutes.filter((m) => m > 0).length;
  if (Math.abs(total - expected) > tolerance) out.push(`${side}: minutes ${total.toFixed(1)} != ${expected} ± ${tolerance}`);
  return out;
}

export function verifyFinalBoxScore(
  game: BoxVerifyGame,
  box: LiveBoxObservation,
  boxObservedAt: string
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  if (game.lifecycle !== 'final') failures.push('game not final');
  if (game.terminalConfirmations < SCOREBOARD_POLICY.TERMINAL_CONFIRMATIONS) failures.push('final not yet confirmed');
  if (!/final/i.test(box.providerStatus ?? '')) failures.push(`box status not final: ${box.providerStatus ?? 'null'}`);
  if (box.homeScore !== game.homeScore || box.visitorScore !== game.visitorScore) {
    failures.push(`box score ${box.visitorScore}-${box.homeScore} != final ${game.visitorScore}-${game.homeScore}`);
  }
  if (game.finalObservedAt == null || Date.parse(boxObservedAt) < Date.parse(game.finalObservedAt)) {
    failures.push('box observed before final');
  }
  const home = box.lines.filter((l) => l.teamId === game.homeTeamId);
  const visitor = box.lines.filter((l) => l.teamId === game.visitorTeamId);
  if (home.length + visitor.length !== box.lines.length) failures.push('player line with unknown team');
  failures.push(...teamFailures('home', home, game.homeScore, game.overtimePeriods));
  failures.push(...teamFailures('visitor', visitor, game.visitorScore, game.overtimePeriods));
  for (const l of box.lines) failures.push(...lineFailures(l));
  return { ok: failures.length === 0, failures };
}

/** Completeness label for a freshly observed box row. */
export function boxScoreCompleteness(
  game: BoxVerifyGame,
  box: LiveBoxObservation | null,
  boxObservedAt: string | null
): BoxScoreCompleteness {
  if (!box || box.lines.length === 0 || !boxObservedAt) return 'none';
  if (game.lifecycle !== 'final') return 'live_partial';
  return verifyFinalBoxScore(game, box, boxObservedAt).ok ? 'verified_final' : 'final_unverified';
}

/**
 * No fresh box row this tick: a verified box stays verified; stored lines on a final game cannot be
 * re-verified without the provider's final row, so they are final_unverified.
 */
export function carriedBoxCompleteness(
  game: Pick<StoredScoreboardGame, 'lifecycle' | 'boxCompleteness'>,
  hasStoredLines: boolean
): BoxScoreCompleteness {
  if (!hasStoredLines) return 'none';
  if (game.lifecycle !== 'final') return 'live_partial';
  return game.boxCompleteness === 'verified_final' ? 'verified_final' : 'final_unverified';
}
