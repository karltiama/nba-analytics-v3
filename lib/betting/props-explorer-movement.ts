/**
 * Line and price movement for a Props Explorer row, from the stored snapshot history
 * (raw.player_prop_snapshots_v2). Client-safe (no db).
 *
 * Two views:
 * - This exact line at this book: price when first seen vs now.
 * - The book's main line for the player and prop: at each pull, the over/under line whose two sides
 *   are priced closest to even. Opening main line vs latest main line.
 *
 * Books list alternate lines (ladders), so "the first quote for this player" is not an opening line;
 * comparing main lines avoids reading a ladder rung as a move.
 */

import { toDecimalOdds } from '@/lib/betting/props-explorer-arb';

export type MovementObservation = {
  side: string | null;
  lineValue: number | null;
  oddsAmerican: number | null;
  oddsDecimal: number | null;
  observedAt: string | Date;
};

export type MovementPoint = { at: string; oddsAmerican: number | null };
export type MainLinePoint = { at: string; line: number };

export type PropsExplorerMovement = {
  /** Price history for this exact side and line at this book, oldest first (one point per pull). */
  points: MovementPoint[];
  openOddsAmerican: number | null;
  openAt: string | null;
  /** Current implied probability minus opening implied probability (0.02 = 2 points shorter now). */
  impliedChange: number | null;
  /** Main line per pull, oldest first; empty when the book never priced both sides of one line. */
  mainLine: MainLinePoint[];
  mainLineOpen: number | null;
  mainLineNow: number | null;
  /** toward: the market moved in this side's favour (line moved against it or its price shortened). */
  direction: 'toward' | 'away' | 'flat';
};

/** Implied-probability change, in probability units, below which a price move counts as flat. */
export const PRICE_MOVE_THRESHOLD = 0.01;

function iso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function sideOf(s: string | null | undefined): 'over' | 'under' | null {
  const v = (s ?? '').trim().toLowerCase();
  return v === 'over' || v === 'under' ? v : null;
}

/** At one pull: the line whose over and under prices are closest to each other. */
export function mainLineOf(obs: MovementObservation[]): number | null {
  const byLine = new Map<number, { over?: number; under?: number }>();
  for (const o of obs) {
    const side = sideOf(o.side);
    const dec = toDecimalOdds(o.oddsDecimal, o.oddsAmerican);
    if (!side || o.lineValue == null || dec == null) continue;
    const e = byLine.get(o.lineValue) ?? {};
    e[side] = dec;
    byLine.set(o.lineValue, e);
  }
  let best: { line: number; gap: number } | null = null;
  for (const [line, e] of byLine) {
    if (e.over == null || e.under == null) continue;
    const gap = Math.abs(1 / e.over - 1 / e.under);
    if (!best || gap < best.gap - 1e-9 || (Math.abs(gap - best.gap) <= 1e-9 && line < best.line)) best = { line, gap };
  }
  return best?.line ?? null;
}

function impliedOf(american: number | null, decimal: number | null = null): number | null {
  const dec = toDecimalOdds(decimal, american);
  return dec == null ? null : 1 / dec;
}

/**
 * Movement for one row. `history` holds every stored observation for the row's game, player, book and
 * prop (both sides, all lines, all pulls). Returns null when there is nothing earlier to compare with.
 */
export function computeMovement(
  row: { side: string | null; lineValue: number | null; oddsAmerican: number | null; oddsDecimal: number | null },
  history: MovementObservation[]
): PropsExplorerMovement | null {
  const side = sideOf(row.side);
  if (!side || row.lineValue == null || history.length === 0) return null;

  const pulls = new Map<string, MovementObservation[]>();
  for (const o of history) {
    const k = iso(o.observedAt);
    const list = pulls.get(k) ?? [];
    list.push(o);
    pulls.set(k, list);
  }
  const times = [...pulls.keys()].sort();

  const points: MovementPoint[] = [];
  const mainLine: MainLinePoint[] = [];
  for (const at of times) {
    const obs = pulls.get(at)!;
    const own = obs.find((o) => sideOf(o.side) === side && o.lineValue === row.lineValue);
    if (own) points.push({ at, oddsAmerican: own.oddsAmerican });
    const main = mainLineOf(obs);
    if (main != null) mainLine.push({ at, line: main });
  }
  if (points.length < 2 && mainLine.length < 2) return null;

  const open = points[0] ?? null;
  const openImplied = open ? impliedOf(open.oddsAmerican) : null;
  const nowImplied = impliedOf(row.oddsAmerican, row.oddsDecimal);
  const impliedChange = points.length >= 2 && openImplied != null && nowImplied != null ? nowImplied - openImplied : null;

  const mainLineOpen = mainLine[0]?.line ?? null;
  const mainLineNow = mainLine[mainLine.length - 1]?.line ?? null;

  let direction: PropsExplorerMovement['direction'] = 'flat';
  if (mainLineOpen != null && mainLineNow != null && mainLineNow !== mainLineOpen) {
    // A higher main line means the book expects more: the market moved toward the over.
    const up = mainLineNow > mainLineOpen;
    direction = up === (side === 'over') ? 'toward' : 'away';
  } else if (impliedChange != null && Math.abs(impliedChange) >= PRICE_MOVE_THRESHOLD) {
    direction = impliedChange > 0 ? 'toward' : 'away';
  }

  return {
    points,
    openOddsAmerican: open?.oddsAmerican ?? null,
    openAt: open?.at ?? null,
    impliedChange,
    mainLine,
    mainLineOpen,
    mainLineNow,
    direction,
  };
}

function fmtLine(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

function fmtOdds(n: number | null): string {
  if (n == null) return '—';
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}

/**
 * Short label under the odds: the main-line move when there is one, else this line's price move.
 * "Line 20.5 → 19.5", "Opened −118", or null when nothing moved.
 */
export function movementLabel(m: PropsExplorerMovement | null | undefined): string | null {
  if (!m) return null;
  if (m.mainLineOpen != null && m.mainLineNow != null && m.mainLineOpen !== m.mainLineNow) {
    return `Line ${fmtLine(m.mainLineOpen)} → ${fmtLine(m.mainLineNow)}`;
  }
  if (m.impliedChange != null && Math.abs(m.impliedChange) >= PRICE_MOVE_THRESHOLD) {
    return `Opened ${fmtOdds(m.openOddsAmerican)}`;
  }
  return null;
}

export function movementTextClass(m: PropsExplorerMovement | null | undefined): string {
  if (!m || m.direction === 'flat') return 'text-[#4a6366]';
  return m.direction === 'toward' ? 'text-[#8A5A00]' : 'text-[#178A45]';
}

/** One sentence for the detail sheet. */
export function movementSummary(m: PropsExplorerMovement | null | undefined, side: string | null): string {
  if (!m) return 'No earlier price stored for this prop yet.';
  const label = (side ?? '').toLowerCase() === 'under' ? 'the under' : 'the over';
  if (m.direction === 'toward') {
    return `The market has moved toward ${label}: you're getting a worse number than at the open.`;
  }
  if (m.direction === 'away') {
    return `The market has moved away from ${label}: this number is better than at the open.`;
  }
  return 'Little movement since the open.';
}

export const MOVEMENT_TITLE =
  "Line movement at this book since we first saw it today. 'Line' is the book's main line (the over/under priced closest to even); 'Opened' is this exact line's first price. Amber: the market moved toward this side, so the number is worse than at the open. Green: it moved away, so the number is better. Prices are pulled a few times a day, not live.";

/** "9:00 AM" in Eastern time. */
export function movementTimeLabel(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
}

export { fmtOdds as formatMovementOdds, fmtLine as formatMovementLine };
