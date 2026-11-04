import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { noVigProbability } from '@/lib/betting/market-probability';
import {
  explorerEvTextClass,
  explorerSampleLabel,
  formatFairProbability,
} from '@/lib/betting/props-explorer-row-display';
import { americanToImpliedProb } from '@/lib/betting/odds-utils';

const ROOT = join(__dirname, '../../..');

describe('noVigProbability', () => {
  it('removes the bookmaker margin from a two-way price', () => {
    const over = americanToImpliedProb(117)!;
    const under = americanToImpliedProb(-157)!;
    expect(over + under).toBeGreaterThan(1);
    const fairOver = noVigProbability(over, under)!;
    const fairUnder = noVigProbability(under, over)!;
    expect(fairOver + fairUnder).toBeCloseTo(1, 10);
    expect(fairOver).toBeLessThan(over);
  });

  it('returns null without a usable opposite side', () => {
    expect(noVigProbability(0.52, null)).toBeNull();
    expect(noVigProbability(null, 0.52)).toBeNull();
    expect(noVigProbability(0.52, 0)).toBeNull();
    expect(noVigProbability(1, 0.5)).toBeNull();
    expect(noVigProbability(Number.NaN, 0.5)).toBeNull();
  });
});

describe('props explorer honest display helpers', () => {
  it('colours Est. EV by sign, not always green', () => {
    expect(explorerEvTextClass(0.088)).toBe('text-[#178A45]');
    expect(explorerEvTextClass(-0.152)).toBe('text-[#B42318]');
    expect(explorerEvTextClass(0)).toBe('text-[#4a6366]');
    expect(explorerEvTextClass(null)).toBe('text-[#4a6366]');
  });

  it('labels the sample in games, capped at the 10-game window', () => {
    expect(explorerSampleLabel(1)).toBe('1 game');
    expect(explorerSampleLabel(6)).toBe('6 games');
    expect(explorerSampleLabel(10)).toBe('10+ games');
    expect(explorerSampleLabel(null)).toBe('—');
  });

  it('formats fair probability', () => {
    expect(formatFairProbability(0.4321)).toBe('43.2%');
    expect(formatFairProbability(null)).toBe('—');
  });
});

describe('props explorer table contract', () => {
  const page = readFileSync(join(ROOT, 'app/betting/props-explorer/page.tsx'), 'utf8');
  const list = readFileSync(join(ROOT, 'components/betting/PropsExplorerPropList.tsx'), 'utf8');

  it('does not hard-code Est. EV green', () => {
    expect(page).not.toContain('text-[#20B95A]">\n                          {formatPct(r.ev)}');
    expect(page).toContain('explorerEvTextClass(r.ev)');
  });

  it('shows Fair P and Sample by default and no Confidence column', () => {
    expect(page).toContain('Fair P');
    expect(page).toContain('Sample');
    expect(page).not.toMatch(/>\s*Confidence\s*</);
  });

  it('keeps the model value badge off the default mobile card', () => {
    expect(list).not.toContain('explorerCardValueLabel');
    expect(list).toContain('formatFairProbability');
  });
});
