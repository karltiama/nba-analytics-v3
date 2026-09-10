import { describe, expect, it } from 'vitest';
import {
  formatHistoricalCoverageLine,
  groupBoxScoreByTeam,
  historicalCoverageLabels,
  historicalFinalNavIds,
  historicalModuleAvailability,
  isHistoricalFinalView,
  mapBoxLogRow,
  shouldFetchLiveMatchupAnalysis,
} from '../historical-final';

describe('isHistoricalFinalView', () => {
  it('uses authoritative Final status, not date', () => {
    expect(isHistoricalFinalView('Final')).toBe(true);
    expect(isHistoricalFinalView('Scheduled')).toBe(false);
    expect(isHistoricalFinalView('In Progress')).toBe(false);
    expect(isHistoricalFinalView(null)).toBe(false);
  });
});

describe('shouldFetchLiveMatchupAnalysis', () => {
  it('skips matchup-analysis (and therefore BDL lineups) for Final viewMode', () => {
    expect(shouldFetchLiveMatchupAnalysis('final')).toBe(false);
    expect(shouldFetchLiveMatchupAnalysis('live')).toBe(true);
    expect(shouldFetchLiveMatchupAnalysis(undefined)).toBe(true);
  });
});

describe('historicalModuleAvailability', () => {
  it('does not mark archive-only modules as product-ready', () => {
    expect(historicalModuleAvailability()).toEqual({
      starters: false,
      advanced: false,
      roleProfile: false,
      timeline: false,
      rotationContext: false,
    });
    expect(historicalModuleAvailability(true, true)).toEqual({
      starters: true,
      advanced: true,
      roleProfile: false,
      timeline: false,
      rotationContext: false,
    });
    expect(historicalModuleAvailability(true, true, true, true, true).timeline).toBe(true);
    expect(historicalModuleAvailability(true, true, true, true, true).rotationContext).toBe(true);
    expect(historicalModuleAvailability(true, true, true).roleProfile).toBe(true);
  });
});

describe('groupBoxScoreByTeam', () => {
  it('groups by game-night team_id and does not use a later team', () => {
    const box = groupBoxScoreByTeam(
      [
        {
          player_id: '434',
          player_name: 'Jayson Tatum',
          team_id: '2',
          minutes: '45.0',
          points: 31,
          rebounds: 8,
          assists: 11,
          steals: 2,
          blocks: 0,
        },
        {
          player_id: '132',
          player_name: 'Luka Doncic',
          team_id: '7',
          minutes: '43.0',
          points: 28,
          rebounds: 12,
          assists: 5,
          steals: 3,
          blocks: 0,
        },
        {
          player_id: '999',
          player_name: 'Traded later',
          team_id: '14',
          minutes: '10',
          points: 4,
          rebounds: 1,
          assists: 0,
          steals: 0,
          blocks: 0,
        },
      ],
      '2',
      '7'
    );
    expect(box.available).toBe(true);
    expect(box.home.map((p) => p.playerId)).toEqual(['434']);
    expect(box.away.map((p) => p.playerId)).toEqual(['132']);
    expect(box.home[0]?.points).toBe(31);
    expect(box.away[0]?.points).toBe(28);
  });

  it('marks box unavailable when logs are empty', () => {
    expect(groupBoxScoreByTeam([], '2', '7').available).toBe(false);
  });
});

describe('historical coverage and nav', () => {
  it('lists only present modules and does not imply older-season errors', () => {
    expect(
      formatHistoricalCoverageLine(
        historicalCoverageLabels({
          boxAvailable: true,
          startersAvailable: false,
          advancedAvailable: true,
          roleProfileAvailable: true,
          timelineAvailable: false,
        })
      )
    ).toBe('Completed game · Box · Advanced · Season Role');
    expect(
      formatHistoricalCoverageLine(
        historicalCoverageLabels({
          boxAvailable: true,
          startersAvailable: true,
          advancedAvailable: true,
          roleProfileAvailable: true,
          timelineAvailable: true,
        })
      )
    ).toBe('Completed game · Starting Five · Box · Advanced · Season Role · Timeline');
  });

  it('keeps Starting Five out of sticky nav and hides Timeline/Context when unavailable', () => {
    expect(
      historicalFinalNavIds({ roleProfile: true, timeline: true, storedOdds: true })
    ).toEqual(['section-box', 'section-context', 'section-timeline', 'section-odds']);
    expect(
      historicalFinalNavIds({ roleProfile: true, timeline: false, storedOdds: false })
    ).toEqual(['section-box', 'section-context']);
    expect(
      historicalFinalNavIds({ roleProfile: false, timeline: false, storedOdds: false })
    ).toEqual(['section-box']);
  });
});

describe('mapBoxLogRow', () => {
  it('keeps minutes as stored text', () => {
    expect(mapBoxLogRow({ player_id: '1', team_id: '2', minutes: '29.0', points: 22 }).minutes).toBe(
      '29.0'
    );
  });
});
