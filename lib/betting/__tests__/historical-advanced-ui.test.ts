import { describe, expect, it } from 'vitest';
import {
  HISTORICAL_PLAYER_VIEW_DEFAULT,
  shouldShowHistoricalAdvanced,
} from '@/lib/betting/historical-advanced';
import { attachAdvancedToBox, groupBoxScoreByTeam } from '@/lib/betting/historical-final';
import { emptyPlayerAdvanced } from '@/lib/betting/historical-advanced';
import { formatAdvancedRow } from '@/lib/betting/historical-advanced-format';
import { shouldShowStartingFive } from '@/lib/betting/historical-starters';

const tatum = {
  usagePercentage: 0.284,
  trueShootingPercentage: 0.563,
  effectiveFieldGoalPercentage: 0.479,
  offensiveRating: 122.4,
  defensiveRating: 103.6,
  netRating: 18.7,
  pace: 89.7,
  possessions: 85,
  assistPercentage: 0.423,
  reboundPercentage: 0.089,
  turnoverRatio: 5,
  pie: 0.205,
};

function availability(advanced: boolean, starters = false) {
  return {
    starters,
    advanced,
    roleProfile: false as const,
    timeline: false as const,
    rotationContext: false as const,
  };
}

describe('historical Advanced UI contract', () => {
  it('defaults the player view to Box Score', () => {
    expect(HISTORICAL_PLAYER_VIEW_DEFAULT).toBe('box');
  });

  it('shows Advanced from the Final contract, not season number', () => {
    expect(shouldShowHistoricalAdvanced(availability(true))).toBe(true);
    expect(shouldShowHistoricalAdvanced(availability(false))).toBe(false);
    expect(shouldShowHistoricalAdvanced(undefined)).toBe(false);
    expect(shouldShowHistoricalAdvanced({ advanced: true })).toBe(true);
  });

  it('marks 2023/2024/2025 Finals available when serving says so, and 2026 not', () => {
    expect(shouldShowHistoricalAdvanced(availability(true))).toBe(true);
    expect(shouldShowHistoricalAdvanced(availability(false))).toBe(false);
  });

  it('keeps Starting Five independent of Advanced', () => {
    expect(shouldShowStartingFive({ available: true, home: [], away: [] })).toBe(false);
    const five = (teamId: string) =>
      [1, 2, 3, 4, 5].map((n) => ({
        playerId: `${teamId}-${n}`,
        playerName: `P${n}`,
        teamId,
        position: 'G',
      }));
    expect(
      shouldShowStartingFive({ available: true, home: five('13'), away: five('27') })
    ).toBe(true);
    expect(shouldShowHistoricalAdvanced(availability(true, true))).toBe(true);
  });

  it('keeps box players when Advanced is null and does not invent Advanced-only rows', () => {
    const box = groupBoxScoreByTeam(
      [
        { player_id: '434', player_name: 'Jayson Tatum', team_id: '2', points: 31 },
        { player_id: '132', player_name: 'Luka Doncic', team_id: '7', points: 28 },
      ],
      '2',
      '7'
    );
    const enriched = attachAdvancedToBox(
      box,
      new Map([
        ['434', tatum],
        ['273', tatum],
      ])
    );
    expect(enriched.home.map((p) => p.playerId)).toEqual(['434']);
    expect(enriched.away.map((p) => p.playerId)).toEqual(['132']);
    expect(enriched.away[0]?.advanced).toBeNull();
    expect(formatAdvancedRow(enriched.away[0]?.advanced).usg).toBe('—');
    expect(enriched.home[0]?.advanced?.usagePercentage).toBe(0.284);
    expect(formatAdvancedRow(enriched.home[0]?.advanced).usg).toBe('28.4%');
    expect([...enriched.home, ...enriched.away].map((p) => p.playerId)).not.toContain('273');
  });

  it('preserves home/away grouping and treats all-null Advanced as missing values', () => {
    const box = groupBoxScoreByTeam(
      [
        { player_id: '434', player_name: 'Jayson Tatum', team_id: '2', points: 31 },
        { player_id: '999', player_name: 'Bench', team_id: '7', points: 2 },
      ],
      '2',
      '7'
    );
    const enriched = attachAdvancedToBox(
      box,
      new Map([
        ['434', tatum],
        ['999', emptyPlayerAdvanced()],
      ])
    );
    expect(enriched.home[0]?.playerName).toBe('Jayson Tatum');
    expect(enriched.away[0]?.playerName).toBe('Bench');
    expect(formatAdvancedRow(enriched.away[0]?.advanced).ts).toBe('—');
    expect(formatAdvancedRow(enriched.away[0]?.advanced).ortg).not.toBe('0.0');
  });
});
