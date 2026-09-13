import { describe, expect, it } from 'vitest';
import { groupCertifiedStarters, shouldShowStartingFive } from '@/lib/betting/historical-starters';

describe('Starting Five UI visibility', () => {
  it('shows the module for a certified 2025 5+5 payload', () => {
    const five = (teamId: string) =>
      [1, 2, 3, 4, 5].map((n) => ({
        playerId: `${teamId}-${n}`,
        playerName: `P${n}`,
        teamId,
        position: n === 1 ? 'C' : 'G',
        nbaPlayerId: null,
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
        home: [{ playerId: '1', playerName: 'A', teamId: '10', position: 'G', nbaPlayerId: null }],
        away: [],
      })
    ).toBe(false);
  });

  it('maps NBA CDN ids when present and leaves unmapped starters null', () => {
    const rows = [
      ...[1, 2, 3, 4, 5].map((n) => ({
        player_id: `h${n}`,
        player_name: `Home ${n}`,
        team_id: '13',
        position: 'G',
        nba_player_id: n === 1 ? '1630596' : null,
      })),
      ...[1, 2, 3, 4, 5].map((n) => ({
        player_id: `a${n}`,
        player_name: `Away ${n}`,
        team_id: '27',
        position: 'F',
        nba_player_id: n === 1 ? ' 1629027 ' : '',
      })),
    ];
    const grouped = groupCertifiedStarters(rows, '13', '27');
    expect(grouped.home[0]?.nbaPlayerId).toBe('1630596');
    expect(grouped.home[1]?.nbaPlayerId).toBeNull();
    expect(grouped.away[0]?.nbaPlayerId).toBe('1629027');
    expect(grouped.away[1]?.nbaPlayerId).toBeNull();
  });

  it('does not use the Projected Starters label', () => {
    expect('Starting Five').not.toMatch(/projected/i);
  });
});
