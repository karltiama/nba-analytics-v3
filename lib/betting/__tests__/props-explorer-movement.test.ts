import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeMovement,
  mainLineOf,
  movementLabel,
  movementSummary,
  movementTextClass,
  type MovementObservation,
} from '@/lib/betting/props-explorer-movement';

const T1 = '2026-11-04T13:00:00.000Z';
const T2 = '2026-11-04T17:00:00.000Z';
const T3 = '2026-11-04T22:45:00.000Z';

const ob = (at: string, side: string, line: number, odds: number): MovementObservation => ({
  side,
  lineValue: line,
  oddsAmerican: odds,
  oddsDecimal: null,
  observedAt: at,
});

/** A ladder: main line plus alternates priced far from even. */
const ladder = (at: string, main: number): MovementObservation[] => [
  ob(at, 'over', main - 2, -250),
  ob(at, 'under', main - 2, 190),
  ob(at, 'over', main, -110),
  ob(at, 'under', main, -110),
  ob(at, 'over', main + 2, 200),
  ob(at, 'under', main + 2, -260),
];

describe('mainLineOf', () => {
  it('picks the line whose two sides are priced closest to even, ignoring alt ladder rungs', () => {
    expect(mainLineOf(ladder(T1, 20.5))).toBe(20.5);
  });
  it('needs both sides of a line', () => {
    expect(mainLineOf([ob(T1, 'over', 20.5, -110)])).toBeNull();
  });
});

describe('computeMovement', () => {
  it('reports a main-line move and calls it toward the over when the line rises', () => {
    const history = [...ladder(T1, 19.5), ...ladder(T3, 20.5)];
    const m = computeMovement({ side: 'over', lineValue: 20.5, oddsAmerican: -110, oddsDecimal: null }, history)!;
    expect(m.mainLineOpen).toBe(19.5);
    expect(m.mainLineNow).toBe(20.5);
    expect(m.direction).toBe('toward');
    expect(movementLabel(m)).toBe('Line 19.5 → 20.5');
    const under = computeMovement({ side: 'under', lineValue: 20.5, oddsAmerican: -110, oddsDecimal: null }, history)!;
    expect(under.direction).toBe('away');
  });

  it('falls back to this line’s price move when the main line holds', () => {
    const history = [
      ob(T1, 'over', 19.5, -118),
      ob(T1, 'under', 19.5, -110),
      ob(T2, 'over', 19.5, -118),
      ob(T2, 'under', 19.5, -110),
      ob(T3, 'over', 19.5, -135),
      ob(T3, 'under', 19.5, 105),
    ];
    const m = computeMovement({ side: 'over', lineValue: 19.5, oddsAmerican: -135, oddsDecimal: null }, history)!;
    expect(m.points.map((p) => p.oddsAmerican)).toEqual([-118, -118, -135]);
    expect(m.openOddsAmerican).toBe(-118);
    expect(m.impliedChange!).toBeGreaterThan(0.02);
    expect(m.direction).toBe('toward');
    expect(movementLabel(m)).toBe('Opened −118');
    expect(movementTextClass(m)).toBe('text-[#8A5A00]');
    expect(movementSummary(m, 'over')).toContain('worse number');
  });

  it('treats a small price wiggle as flat', () => {
    const history = [ob(T1, 'over', 19.5, -118), ob(T1, 'under', 19.5, -110), ob(T3, 'over', 19.5, -115), ob(T3, 'under', 19.5, -113)];
    const m = computeMovement({ side: 'over', lineValue: 19.5, oddsAmerican: -115, oddsDecimal: null }, history)!;
    expect(m.direction).toBe('flat');
    expect(movementLabel(m)).toBeNull();
  });

  it('returns null with a single pull or no usable side', () => {
    expect(computeMovement({ side: 'over', lineValue: 19.5, oddsAmerican: -110, oddsDecimal: null }, ladder(T1, 19.5))).toBeNull();
    expect(computeMovement({ side: 'yes', lineValue: 19.5, oddsAmerican: -110, oddsDecimal: null }, [...ladder(T1, 19.5), ...ladder(T3, 19.5)])).toBeNull();
    expect(movementSummary(null, 'over')).toContain('No earlier price');
  });
});

describe('movement is wired into the explorer', () => {
  const root = join(__dirname, '../../..');
  it('serving loads history from the snapshot table and the page renders the label', () => {
    const serving = readFileSync(join(root, 'lib/betting/props-explorer-serving.ts'), 'utf8');
    expect(serving).toContain('raw.player_prop_snapshots_v2');
    expect(serving).toContain('movement: movementFor(r)');
    const page = readFileSync(join(root, 'app/betting/props-explorer/page.tsx'), 'utf8');
    expect(page).toContain('movementLabel(r.movement)');
  });
});
