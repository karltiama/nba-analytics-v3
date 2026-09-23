import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  explorerCardPlayerName,
  explorerCardValueLabel,
  explorerTableValueCopy,
  explorerValueGrade,
  formatExplorerOdds,
} from '@/lib/betting/props-explorer-row-display';

const ROOT = join(__dirname, '../../..');

describe('explorer odds and names', () => {
  it('keeps the full odds string, including long prices', () => {
    expect(formatExplorerOdds(-450)).toBe('-450');
    expect(formatExplorerOdds(1800)).toBe('+1800');
    expect(formatExplorerOdds(114)).toBe('+114');
  });

  it('keeps missing odds as an em dash', () => {
    expect(formatExplorerOdds(null)).toBe('—');
    expect(formatExplorerOdds(undefined)).toBe('—');
    expect(formatExplorerOdds(Number.NaN)).toBe('—');
  });

  it('does not abbreviate the player name', () => {
    expect(explorerCardPlayerName('Cameron Okonkwo-Bellamy', 9)).toBe('Cameron Okonkwo-Bellamy');
    expect(explorerCardPlayerName('  ', 42)).toBe('42');
  });
});

describe('explorer value labels', () => {
  it('keeps the existing grade thresholds', () => {
    expect(explorerValueGrade(0.031)).toBe('good');
    expect(explorerValueGrade(0.03)).toBe('fair');
    expect(explorerValueGrade(-0.02)).toBe('fair');
    expect(explorerValueGrade(-0.021)).toBe('bad');
    expect(explorerValueGrade(null)).toBe('unknown');
  });

  it('uses a short one-line card label and the longer table copy', () => {
    expect(explorerCardValueLabel(0.22)).toBe('Good');
    expect(explorerCardValueLabel(-0.08)).toBe('Bad');
    expect(explorerCardValueLabel(-0.015)).toBe('Fair');
    expect(explorerCardValueLabel(null)).toBe('No signal');
    expect(explorerTableValueCopy(0.22)).toBe('Good Value');
    expect(explorerTableValueCopy(null)).toBe('No Signal');
    expect(explorerCardValueLabel(0.22, 'historical')).toBe('Unavailable');
  });
});

describe('props explorer mobile phase 1 contract', () => {
  const page = readFileSync(join(ROOT, 'app/betting/props-explorer/page.tsx'), 'utf8');
  const card = readFileSync(join(ROOT, 'components/betting/PropsExplorerPropCard.tsx'), 'utf8');
  const coachmark = readFileSync(join(ROOT, 'components/onboarding/CoachmarkCallout.tsx'), 'utf8');

  it('shows cards below lg and the table from lg up', () => {
    expect(page).toContain('lg:hidden min-w-0 space-y-3');
    expect(page).toContain('hidden lg:block');
    expect(page).toContain('<PropsExplorerPropCard');
  });

  it('wires card actions to the existing handlers', () => {
    expect(page).toContain('onParlay={() => addToParlay(r)}');
    expect(page).toContain('onCompare={() => {');
    expect(page).toContain("completeChecklistItem('compare_opened')");
    expect(page).toContain('PROP_ADDED_TO_PARLAY');
    expect(page).toContain('PLAYER_SEARCH_RESULT_OPENED');
    expect(page).toContain('PROP_CONTEXT_OPENED');
    expect(card).toContain('Compare books');
    expect(card).toContain("'Paper'");
    expect(card).toContain('aria-pressed={isOnParlay}');
    expect(card).toContain('aria-label={isOnParlay ? \'Added to parlay\' : \'Add to Parlay\'}');
    expect(card).toContain('whitespace-nowrap');
    expect(card).toContain('min-h-11');
    expect(card).not.toContain('formatPlayerLabel');
  });

  it('keeps the coachmark dismiss inside a bounded, safe-area layout', () => {
    expect(coachmark).toContain('safe-area-inset-top');
    expect(coachmark).toContain('safe-area-inset-bottom');
    expect(coachmark).toContain('100dvh');
    expect(coachmark).toContain('min-h-11');
    expect(coachmark).toContain('shrink-0');
    expect(coachmark).not.toContain('bottom-3');
  });
});
