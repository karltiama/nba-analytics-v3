/**
 * Player scoring by period from BDL play-by-play rows.
 * Scorer = first participant on a scoring play. Points come from score_value.
 *
 * Made-shot stats only. Attempts are not derived: on missed and blocked shots the
 * first participant is not reliably the shooter, so FGA/3PA/FTA disagree with box scores.
 * Pure: no I/O. Callers validate against box scores before serving.
 */

export type PlayerPeriodLine = {
  playerId: string;
  period: number;
  points: number;
  fgm: number;
  fg3m: number;
  ftm: number;
};

export type PlayerGameTotals = Omit<PlayerPeriodLine, 'period'>;

type Tally = Omit<PlayerPeriodLine, 'playerId' | 'period'>;

const emptyTally = (): Tally => ({ points: 0, fgm: 0, fg3m: 0, ftm: 0 });

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function firstParticipant(raw: Record<string, unknown>): string | null {
  const p = raw.participants;
  if (!Array.isArray(p) || p.length === 0) return null;
  const first = p[0];
  if (typeof first === 'number' || typeof first === 'string') {
    const s = String(first).trim();
    return s || null;
  }
  if (first && typeof first === 'object') {
    const id = (first as Record<string, unknown>).id ?? (first as Record<string, unknown>).player_id;
    const s = id == null ? '' : String(id).trim();
    return s || null;
  }
  return null;
}

/** Aggregate one game's play rows into per-player, per-period scoring lines (scorers only). */
export function playerPeriodLinesFromPlays(rows: Record<string, unknown>[]): PlayerPeriodLine[] {
  const byKey = new Map<string, { playerId: string; period: number; t: Tally }>();
  for (const raw of rows) {
    if (raw == null || typeof raw !== 'object') continue;
    if (raw.scoring_play !== true) continue;
    const period = num(raw.period);
    const value = num(raw.score_value);
    const playerId = firstParticipant(raw);
    if (period == null || period < 1 || value == null || value <= 0 || playerId == null) continue;

    const key = `${playerId}|${period}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { playerId, period, t: emptyTally() };
      byKey.set(key, entry);
    }
    const t = entry.t;
    t.points += value;
    const type = typeof raw.type === 'string' ? raw.type : '';
    if (/^free throw/i.test(type.trim())) {
      t.ftm += 1;
    } else {
      t.fgm += 1;
      if (value === 3) t.fg3m += 1;
    }
  }
  return [...byKey.values()]
    .map(({ playerId, period, t }) => ({ playerId, period, ...t }))
    .sort((a, b) => (a.playerId === b.playerId ? a.period - b.period : a.playerId.localeCompare(b.playerId)));
}

export function gameTotalsByPlayer(lines: PlayerPeriodLine[]): Map<string, PlayerGameTotals> {
  const out = new Map<string, PlayerGameTotals>();
  for (const l of lines) {
    const t = out.get(l.playerId) ?? { playerId: l.playerId, ...emptyTally() };
    t.points += l.points;
    t.fgm += l.fgm;
    t.fg3m += l.fg3m;
    t.ftm += l.ftm;
    out.set(l.playerId, t);
  }
  return out;
}

export type BoxTotals = { playerId: string; points: number; fgm: number; fg3m: number; ftm: number };

/**
 * Game-level check: every box-score player's made stats equal the play-by-play sums,
 * and no play-by-play scorer is missing from the box score.
 */
export function reconcileGameWithBox(
  lines: PlayerPeriodLine[],
  box: BoxTotals[]
): { reconciled: boolean; mismatches: string[] } {
  const totals = gameTotalsByPlayer(lines);
  const mismatches: string[] = [];
  const boxIds = new Set<string>();
  for (const b of box) {
    boxIds.add(b.playerId);
    const t = totals.get(b.playerId) ?? { playerId: b.playerId, ...emptyTally() };
    for (const f of ['points', 'fgm', 'fg3m', 'ftm'] as const) {
      if (t[f] !== b[f]) mismatches.push(`${b.playerId} ${f} ${t[f]}≠${b[f]}`);
    }
  }
  for (const id of totals.keys()) if (!boxIds.has(id)) mismatches.push(`${id} not in box score`);
  return { reconciled: mismatches.length === 0 && box.length > 0, mismatches };
}
