import { describe, expect, it } from 'vitest';
import {
  attachAdvancedToBox,
  attachRoleProfileToBox,
  groupBoxScoreByTeam,
  historicalModuleAvailability,
} from '@/lib/betting/historical-final';
import {
  PRIMARY_ROLE_LABEL_POLICY,
  defaultRoleProfilePlayerId,
  shouldShowHistoricalRoleProfile,
} from '@/lib/betting/historical-role-profile';
import { formatRolePercent, formatRolePpp, visiblePlaytypes } from '@/lib/betting/historical-role-profile-format';
import { shouldShowHistoricalAdvanced } from '@/lib/betting/historical-advanced';

const tatumSeason = {
  season: '2023',
  isolationPossPct: 0.189,
  isolationPpp: 1.04,
  pnrBallHandlerPossPct: 0.176,
  pnrBallHandlerPpp: 0.96,
  pnrRollManPossPct: null,
  pnrRollManPpp: null,
  drivesPerGame: 12.4,
  drivePointsPerGame: 8.1,
  passesPerGame: 48.7,
  potentialAssistsPerGame: 8.2,
  restrictedAreaFga: 4.1,
  restrictedAreaFgPct: 0.62,
  paintNonRaFga: 2.0,
  paintNonRaFgPct: 0.45,
  midrangeFga: 3.2,
  midrangeFgPct: 0.41,
  cornerThreeFga: 0.8,
  cornerThreeFgPct: 0.39,
  aboveBreakThreeFga: 5.1,
  aboveBreakThreeFgPct: 0.36,
};

describe('historical Role Profile contract helpers', () => {
  it('shows Role Profile from the Final contract, not season number', () => {
    expect(shouldShowHistoricalRoleProfile({ roleProfile: true })).toBe(true);
    expect(shouldShowHistoricalRoleProfile({ roleProfile: false })).toBe(false);
    expect(shouldShowHistoricalRoleProfile(undefined)).toBe(false);
    expect(historicalModuleAvailability(true, true, true).roleProfile).toBe(true);
    expect(historicalModuleAvailability(true, true).roleProfile).toBe(false);
  });

  it('keeps Advanced independent of Role Profile', () => {
    expect(shouldShowHistoricalAdvanced({ advanced: true })).toBe(true);
    expect(shouldShowHistoricalRoleProfile({ roleProfile: true, advanced: true })).toBe(true);
    expect(PRIMARY_ROLE_LABEL_POLICY).toBe('omit');
  });

  it('attaches season Role Profile onto box players and leaves missing profiles null', () => {
    const box = groupBoxScoreByTeam(
      [
        { player_id: '434', player_name: 'Jayson Tatum', team_id: '2', points: 31 },
        { player_id: '132', player_name: 'Luka Doncic', team_id: '7', points: 28 },
      ],
      '2',
      '7'
    );
    const withAdvanced = attachAdvancedToBox(
      box,
      new Map([
        [
          '434',
          {
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
          },
        ],
      ])
    );
    const enriched = attachRoleProfileToBox(withAdvanced, new Map([['434', tatumSeason]]));
    expect(enriched.home[0]?.advanced?.usagePercentage).toBe(0.284);
    expect(enriched.home[0]?.roleProfile?.isolationPossPct).toBe(0.189);
    expect(enriched.home[0]?.roleProfile?.season).toBe('2023');
    expect(enriched.away[0]?.playerId).toBe('132');
    expect(enriched.away[0]?.roleProfile).toBeNull();
    expect(enriched.home.map((p) => p.playerId)).toEqual(['434']);
  });

  it('does not invent a box row for Role Profile-only identities', () => {
    const box = groupBoxScoreByTeam(
      [{ player_id: '434', player_name: 'Jayson Tatum', team_id: '2', points: 31 }],
      '2',
      '7'
    );
    const enriched = attachRoleProfileToBox(box, new Map([['999', tatumSeason]]));
    expect(enriched.home.map((p) => p.playerId)).toEqual(['434']);
    expect(enriched.away).toHaveLength(0);
    expect(enriched.home[0]?.roleProfile).toBeNull();
  });

  it('defaults Context selection to first starter, else first box player', () => {
    const box = {
      away: [{ playerId: '132' }, { playerId: '200' }],
      home: [{ playerId: '434' }],
    };
    expect(defaultRoleProfilePlayerId({ box, starters: null })).toBe('132');
    const five = (teamId: string, start: number) =>
      [0, 1, 2, 3, 4].map((n) => ({ playerId: `${teamId}-${start + n}` }));
    expect(
      defaultRoleProfilePlayerId({
        box,
        starters: { available: true, away: five('27', 1), home: five('13', 1) },
      })
    ).toBe('27-1');
  });
});

describe('Role Profile UI semantics', () => {
  it('labels Context as season-level and does not percent-format PPP', () => {
    expect('Season Role — 2023–24').toMatch(/Season Role/);
    expect('This season, not this game').not.toMatch(/Tonight's Role|Game Role/i);
    expect(formatRolePpp(1.04)).toBe('1.04');
    expect(formatRolePercent(0.42)).toBe('42.0%');
    const missingIso = visiblePlaytypes({
      ...tatumSeason,
      isolationPossPct: null,
      isolationPpp: null,
      pnrBallHandlerPossPct: 0.42,
      pnrBallHandlerPpp: 0.96,
      pnrRollManPossPct: null,
      pnrRollManPpp: null,
    });
    expect(missingIso.map((r) => r.id)).toEqual(['pnrBallHandler']);
    expect(missingIso.some((r) => r.frequency === '0.0%')).toBe(false);
  });
});
