import { describe, expect, it } from 'vitest';
import { getGameSummaryBulletsForAi } from '@/lib/betting/ai-game-summary-payload';

const stats = {
  homeTeamStats: { offensiveRating: 112, defensiveRating: 110, pace: 100 },
  awayTeamStats: { offensiveRating: 114, defensiveRating: 111, pace: 101 },
  spreadMovement: [],
  injuries: { home: [], away: [] },
};

describe('getGameSummaryBulletsForAi injury claims', () => {
  it('does not claim a clean injury report when the feed is not current', () => {
    const bullets = getGameSummaryBulletsForAi({ ...stats, injuryFeed: 'not_current' });
    expect(bullets.join(' ')).toMatch(/Injury status not current/);
    expect(bullets.join(' ')).toMatch(/research-season/i);
    expect(bullets.join(' ')).not.toMatch(/No major injuries|projected|advantage/);
  });

  it('says no injuries are listed only when the empty feed is authoritative', () => {
    const bullets = getGameSummaryBulletsForAi({ ...stats, injuryFeed: 'authoritative_empty' });
    expect(bullets.join(' ')).toMatch(/No injuries listed/);
    expect(bullets.join(' ')).not.toMatch(/No major injuries/);
  });
});
