import { describe, expect, it } from 'vitest';
import {
  aiBriefingUnavailableCopy,
  isAiGameBriefingEligible,
  isAiSlateBriefingEligible,
} from '../ai-briefing-eligibility';

describe('isAiSlateBriefingEligible', () => {
  it('suppresses briefing when frozen even if games exist', () => {
    expect(isAiSlateBriefingEligible({ frozen: true, gameCount: 4 })).toBe(false);
  });

  it('suppresses briefing when there is no current slate', () => {
    expect(isAiSlateBriefingEligible({ frozen: false, gameCount: 0 })).toBe(false);
  });

  it('keeps briefing eligible with live current-slate context', () => {
    expect(isAiSlateBriefingEligible({ frozen: false, gameCount: 2 })).toBe(true);
  });
});

describe('isAiGameBriefingEligible', () => {
  it('suppresses game briefing under freeze', () => {
    expect(isAiGameBriefingEligible({ frozen: true })).toBe(false);
  });

  it('allows game briefing when not frozen', () => {
    expect(isAiGameBriefingEligible({ frozen: false })).toBe(true);
  });
});

describe('aiBriefingUnavailableCopy', () => {
  it('explains freeze vs empty slate', () => {
    expect(aiBriefingUnavailableCopy(true)).toMatch(/offseason freeze/i);
    expect(aiBriefingUnavailableCopy(false)).toMatch(/No current slate/i);
  });
});
