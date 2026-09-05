import { describe, expect, it } from 'vitest';
import type { ResolveResult } from '../identity-resolver';
import {
  ROSTER_PROBE_WRITES_STINTS,
  analyticsSeasonForNbaLabel,
  compare2026VsOpen2025,
  plan2026StintSeedDryRun,
  verify2026SeasonSemantics,
} from '../roster-season-probe';

function result(
  partial: Partial<ResolveResult> &
    Pick<ResolveResult, 'nbaPlayerId' | 'fullName' | 'teamAbbr' | 'status'>
): ResolveResult {
  return {
    jersey: '1',
    position: 'G',
    analyticsPlayerId: null,
    method: null,
    gapCause: null,
    reason: null,
    candidates: [],
    ...partial,
  };
}

describe('2026-27 season semantics', () => {
  it('maps 2026-27 → analytics season 2026', () => {
    expect(analyticsSeasonForNbaLabel('2026-27')).toBe('2026');
    const v = verify2026SeasonSemantics();
    expect(v.analyticsSeason).toBe('2026');
    expect(v.roundTripNbaLabel).toBe('2026-27');
  });
});

describe('plan2026StintSeedDryRun', () => {
  it('detects duplicate canonical assignment as conflict', () => {
    const { actions, duplicateCanonical } = plan2026StintSeedDryRun({
      observedOn: '2026-09-04',
      results: [
        result({
          nbaPlayerId: '1',
          fullName: 'A',
          teamAbbr: 'BOS',
          status: 'provider_match',
          analyticsPlayerId: 'same',
        }),
        result({
          nbaPlayerId: '2',
          fullName: 'B',
          teamAbbr: 'NYK',
          status: 'provider_match',
          analyticsPlayerId: 'same',
        }),
      ],
    });
    expect(duplicateCanonical).toHaveLength(1);
    expect(actions.every((a) => a.action === 'conflict')).toBe(true);
  });

  it('skips unresolved rookies', () => {
    const { actions } = plan2026StintSeedDryRun({
      observedOn: '2026-09-04',
      results: [
        result({
          nbaPlayerId: '99',
          fullName: 'Rookie X',
          teamAbbr: 'CHA',
          status: 'unresolved',
          gapCause: 'rookie_or_new_player',
          reason: 'absent',
        }),
      ],
    });
    expect(actions).toEqual([
      expect.objectContaining({
        action: 'skip_unresolved',
        season: '2026',
        observedTo: null,
        source: 'nba_stats',
      }),
    ]);
  });

  it('opens stint for returning resolved player', () => {
    const { actions } = plan2026StintSeedDryRun({
      observedOn: '2026-09-04',
      results: [
        result({
          nbaPlayerId: '10',
          fullName: 'Returner',
          teamAbbr: 'MEM',
          status: 'provider_match',
          analyticsPlayerId: '38017656',
        }),
      ],
    });
    expect(actions[0]).toMatchObject({
      action: 'open_new_2026_stint',
      analyticsPlayerId: '38017656',
      season: '2026',
    });
  });

  it('dry-run contract never writes stints', () => {
    expect(ROSTER_PROBE_WRITES_STINTS).toBe(false);
  });
});

describe('compare2026VsOpen2025', () => {
  it('reports returning player and offseason team change', () => {
    const rows = compare2026VsOpen2025({
      results: [
        result({
          nbaPlayerId: '1',
          fullName: 'Same',
          teamAbbr: 'BKN',
          status: 'provider_match',
          analyticsPlayerId: 'a1',
        }),
        result({
          nbaPlayerId: '2',
          fullName: 'Moved',
          teamAbbr: 'MIA',
          status: 'provider_match',
          analyticsPlayerId: 'a2',
        }),
      ],
      open2025ByPlayer: new Map([
        ['a1', { playerId: 'a1', teamId: 't1', teamAbbr: 'BKN' }],
        ['a2', { playerId: 'a2', teamId: 't2', teamAbbr: 'DET' }],
      ]),
      lastPgl2025ByPlayer: new Map([
        ['a1', { playerId: 'a1', teamAbbr: 'BKN', lastGameDate: '2026-04-10' }],
        ['a2', { playerId: 'a2', teamAbbr: 'DET', lastGameDate: '2026-01-29' }],
      ]),
    });
    expect(rows.find((r) => r.nbaPlayerId === '1')?.classification).toBe(
      'returning_same_team'
    );
    expect(rows.find((r) => r.nbaPlayerId === '2')?.classification).toBe(
      'offseason_team_change'
    );
  });
});
