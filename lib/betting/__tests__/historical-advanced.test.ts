import { describe, expect, it } from 'vitest';
import { attachAdvancedToBox, groupBoxScoreByTeam, historicalModuleAvailability } from '../historical-final';
import { isAdvancedServingSeason } from '../historical-advanced';

const metrics = {
  usagePercentage: 0.32,
  trueShootingPercentage: 0.587,
  effectiveFieldGoalPercentage: 0.55,
  offensiveRating: 118.4,
  defensiveRating: 104.1,
  netRating: 14.3,
  pace: 99.2,
  possessions: 82,
  assistPercentage: 0.21,
  reboundPercentage: 0.09,
  turnoverRatio: 8.4,
  pie: 0.142,
};

describe('historical Advanced contract helpers', () => {
  it('marks availability.advanced true only from serving, not archive existence', () => {
    expect(historicalModuleAvailability(true, true).advanced).toBe(true);
    expect(historicalModuleAvailability(true, false).advanced).toBe(false);
    expect(isAdvancedServingSeason('2023')).toBe(true);
    expect(isAdvancedServingSeason('2024')).toBe(true);
    expect(isAdvancedServingSeason('2025')).toBe(true);
    expect(isAdvancedServingSeason('2026')).toBe(false);
  });

  it('attaches Advanced onto existing box players and leaves missing Advanced as null', () => {
    const box = groupBoxScoreByTeam(
      [
        { player_id: '434', player_name: 'Jayson Tatum', team_id: '2', points: 31 },
        { player_id: '132', player_name: 'Luka Doncic', team_id: '7', points: 28 },
      ],
      '2',
      '7'
    );
    const enriched = attachAdvancedToBox(box, new Map([['434', metrics]]));
    expect(enriched.home[0]?.advanced?.usagePercentage).toBe(0.32);
    expect(enriched.away[0]?.advanced).toBeNull();
    expect(enriched.home.map((p) => p.playerId)).toEqual(['434']);
    expect(enriched.away.map((p) => p.playerId)).toEqual(['132']);
  });

  it('does not fabricate a box row for Advanced-only identities', () => {
    const box = groupBoxScoreByTeam(
      [{ player_id: '434', player_name: 'Jayson Tatum', team_id: '2', points: 31 }],
      '2',
      '7'
    );
    const enriched = attachAdvancedToBox(
      box,
      new Map([
        ['434', metrics],
        ['273', { ...metrics, pie: 0.01 }],
      ])
    );
    const ids = [...enriched.home, ...enriched.away].map((p) => p.playerId);
    expect(ids).toEqual(['434']);
    expect(ids).not.toContain('273');
  });
});
