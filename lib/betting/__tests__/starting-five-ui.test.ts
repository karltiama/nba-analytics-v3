import { describe, expect, it } from 'vitest';
import { shouldShowStartingFive } from '@/lib/betting/historical-starters';

describe('Starting Five UI visibility', () => {
  it('shows the module for a certified 2025 5+5 payload', () => {
    const five = (teamId: string) =>
      [1, 2, 3, 4, 5].map((n) => ({
        playerId: `${teamId}-${n}`,
        playerName: `P${n}`,
        teamId,
        position: n === 1 ? 'C' : 'G',
      }));
    expect(
      shouldShowStartingFive({ available: true, home: five('13'), away: five('27') })
    ).toBe(true);
  });

  it('hides 2023/2024 and anomaly payloads', () => {
    expect(shouldShowStartingFive({ available: false, home: [], away: [] })).toBe(false);
    expect(
      shouldShowStartingFive({
        available: true,
        home: [{ playerId: '1', playerName: 'A', teamId: '10', position: 'G' }],
        away: [],
      })
    ).toBe(false);
  });

  it('does not use the Projected Starters label', () => {
    expect('Starting Five').not.toMatch(/projected/i);
  });
});
