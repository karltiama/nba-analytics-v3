import { describe, expect, it } from 'vitest';
import {
  buildResolverIndex,
  resolveRosterIdentity,
  type AnalyticsPlayerCandidate,
  type ProviderMapRow,
  type RosterObservation,
} from '../identity-resolver';
import { normalizePersonName, stripDiacritics } from '../normalize-player-name';
import { decideBdlBridgeBackfill } from '../provider-map-backfill';

function obs(partial: Partial<RosterObservation> & Pick<RosterObservation, 'nbaPlayerId' | 'fullName'>): RosterObservation {
  return {
    teamAbbr: 'NYK',
    teamInternalId: '20',
    jersey: '1',
    position: 'G',
    season: '2025-26',
    ...partial,
  };
}

describe('normalizePersonName', () => {
  it('strips diacritics', () => {
    expect(stripDiacritics('Luka Dončić')).toBe('Luka Doncic');
    expect(normalizePersonName('Luka Dončić')).toBe('luka doncic');
  });

  it('strips suffixes', () => {
    expect(normalizePersonName('Jimmy Butler III')).toBe('jimmy butler');
    expect(normalizePersonName('Tim Hardaway Jr.')).toBe('tim hardaway');
  });
});

describe('resolveRosterIdentity', () => {
  const analytics: AnalyticsPlayerCandidate[] = [
    {
      playerId: '132',
      fullName: 'Luka Doncic',
      position: 'G',
      pglTeamAbbrevs: ['LAL', 'DAL'],
    },
    {
      playerId: '9991',
      fullName: 'Brandon Williams',
      position: 'G',
      pglTeamAbbrevs: ['DAL'],
    },
    {
      playerId: '9992',
      fullName: 'Brandon Williams',
      position: 'F',
      pglTeamAbbrevs: ['LAC'],
    },
  ];

  it('exact NBA provider match', () => {
    const maps: ProviderMapRow[] = [
      { provider: 'nba', providerId: '1629029', internalId: '1629029' },
      { provider: 'balldontlie', providerId: '132', internalId: '1629029' },
    ];
    const index = buildResolverIndex({ providerMaps: maps, analyticsPlayers: analytics });
    const r = resolveRosterIdentity(
      obs({ nbaPlayerId: '1629029', fullName: 'Luka Dončić', teamAbbr: 'LAL' }),
      index
    );
    expect(r.status).toBe('provider_match');
    expect(r.analyticsPlayerId).toBe('132');
    expect(r.gapCause).toBeNull();
  });

  it('missing provider bridge falls through to unique name', () => {
    const maps: ProviderMapRow[] = [
      { provider: 'nba', providerId: '1629029', internalId: '1629029' },
      // no balldontlie bridge
    ];
    const index = buildResolverIndex({ providerMaps: maps, analyticsPlayers: analytics });
    const r = resolveRosterIdentity(
      obs({ nbaPlayerId: '1629029', fullName: 'Luka Dončić', teamAbbr: 'LAL' }),
      index
    );
    expect(r.status).toBe('safe_fallback_match');
    expect(r.analyticsPlayerId).toBe('132');
    expect(r.method).toContain('normalized_name_unique');
  });

  it('unique normalized-name fallback without provider', () => {
    const index = buildResolverIndex({ providerMaps: [], analyticsPlayers: analytics });
    const r = resolveRosterIdentity(
      obs({ nbaPlayerId: '1629029', fullName: 'Luka Doncic', teamAbbr: 'LAL' }),
      index
    );
    expect(r.status).toBe('safe_fallback_match');
    expect(r.analyticsPlayerId).toBe('132');
  });

  it('diacritic normalization matches', () => {
    const index = buildResolverIndex({ providerMaps: [], analyticsPlayers: analytics });
    const r = resolveRosterIdentity(
      obs({ nbaPlayerId: '1629029', fullName: 'Luka Dončić', teamAbbr: 'LAL' }),
      index
    );
    expect(r.status).toBe('safe_fallback_match');
    expect(r.analyticsPlayerId).toBe('132');
  });

  it('suffix normalization matches', () => {
    const withSuffix: AnalyticsPlayerCandidate[] = [
      {
        playerId: '710',
        fullName: 'Jimmy Butler',
        position: 'F',
        pglTeamAbbrevs: ['GSW'],
      },
    ];
    const index = buildResolverIndex({ providerMaps: [], analyticsPlayers: withSuffix });
    const r = resolveRosterIdentity(
      obs({ nbaPlayerId: '202710', fullName: 'Jimmy Butler III', teamAbbr: 'GSW' }),
      index
    );
    expect(r.status).toBe('safe_fallback_match');
    expect(r.analyticsPlayerId).toBe('710');
  });

  it('duplicate name without team disambiguation → ambiguous', () => {
    const index = buildResolverIndex({ providerMaps: [], analyticsPlayers: analytics });
    const r = resolveRosterIdentity(
      obs({ nbaPlayerId: '1', fullName: 'Brandon Williams', teamAbbr: 'BOS' }),
      index
    );
    expect(r.status).toBe('ambiguous');
    expect(r.analyticsPlayerId).toBeNull();
    expect(r.candidates.length).toBe(2);
  });

  it('duplicate name with unique PGL team → safe fallback', () => {
    const index = buildResolverIndex({ providerMaps: [], analyticsPlayers: analytics });
    const r = resolveRosterIdentity(
      obs({ nbaPlayerId: '1', fullName: 'Brandon Williams', teamAbbr: 'DAL' }),
      index
    );
    expect(r.status).toBe('safe_fallback_match');
    expect(r.analyticsPlayerId).toBe('9991');
  });

  it('missing analytics player → unresolved', () => {
    const index = buildResolverIndex({ providerMaps: [], analyticsPlayers: analytics });
    const r = resolveRosterIdentity(
      obs({ nbaPlayerId: '1642846', fullName: 'Ace Bailey', teamAbbr: 'UTA' }),
      index
    );
    expect(r.status).toBe('unresolved');
    expect(r.analyticsPlayerId).toBeNull();
  });

  it('conflicting balldontlie bridges → ambiguous', () => {
    const maps: ProviderMapRow[] = [
      { provider: 'nba', providerId: '1', internalId: '1' },
      { provider: 'balldontlie', providerId: '100', internalId: '1' },
      { provider: 'balldontlie', providerId: '200', internalId: '1' },
    ];
    const index = buildResolverIndex({
      providerMaps: maps,
      analyticsPlayers: [
        { playerId: '100', fullName: 'A', position: null, pglTeamAbbrevs: [] },
        { playerId: '200', fullName: 'B', position: null, pglTeamAbbrevs: [] },
      ],
    });
    const r = resolveRosterIdentity(obs({ nbaPlayerId: '1', fullName: 'A' }), index);
    expect(r.status).toBe('ambiguous');
    expect(r.gapCause).toBe('conflicting_identities');
  });

  it('never name-only auto-resolve when >1 candidate', () => {
    const index = buildResolverIndex({ providerMaps: [], analyticsPlayers: analytics });
    const r = resolveRosterIdentity(
      obs({ nbaPlayerId: '1', fullName: 'Brandon Williams', teamAbbr: 'NYK' }),
      index
    );
    expect(r.status).toBe('ambiguous');
    expect(r.analyticsPlayerId).toBeNull();
  });
});

describe('decideBdlBridgeBackfill', () => {
  it('inserts when nba map exists and no bdl bridge', () => {
    const d = decideBdlBridgeBackfill({
      nbaPlayerId: '1629029',
      fullName: 'Luka Doncic',
      analyticsPlayerId: '132',
      resolutionMethod: 'normalized_name_unique+pgl_team',
      existingMaps: [{ provider: 'nba', providerId: '1629029', internalId: '1629029' }],
    });
    expect(d.action).toBe('insert');
  });

  it('skip when identical bridge already present', () => {
    const d = decideBdlBridgeBackfill({
      nbaPlayerId: '1629029',
      fullName: 'Luka Doncic',
      analyticsPlayerId: '132',
      resolutionMethod: 'normalized_name_unique',
      existingMaps: [
        { provider: 'nba', providerId: '1629029', internalId: '1629029' },
        { provider: 'balldontlie', providerId: '132', internalId: '1629029' },
      ],
    });
    expect(d.action).toBe('skip_already_present');
  });

  it('conflict → no overwrite when provider_id maps elsewhere', () => {
    const d = decideBdlBridgeBackfill({
      nbaPlayerId: '1629029',
      fullName: 'Luka Doncic',
      analyticsPlayerId: '132',
      resolutionMethod: 'normalized_name_unique',
      existingMaps: [
        { provider: 'nba', providerId: '1629029', internalId: '1629029' },
        { provider: 'balldontlie', providerId: '132', internalId: 'OTHER' },
      ],
    });
    expect(d.action).toBe('conflict');
  });

  it('conflict when internal already bridged to different bdl id', () => {
    const d = decideBdlBridgeBackfill({
      nbaPlayerId: '1629029',
      fullName: 'Luka Doncic',
      analyticsPlayerId: '132',
      resolutionMethod: 'normalized_name_unique',
      existingMaps: [
        { provider: 'nba', providerId: '1629029', internalId: '1629029' },
        { provider: 'balldontlie', providerId: '999', internalId: '1629029' },
      ],
    });
    expect(d.action).toBe('conflict');
  });

  it('reject without nba provider row', () => {
    const d = decideBdlBridgeBackfill({
      nbaPlayerId: '1629029',
      fullName: 'Luka Doncic',
      analyticsPlayerId: '132',
      resolutionMethod: 'normalized_name_unique',
      existingMaps: [],
    });
    expect(d.action).toBe('reject');
  });

  it('idempotent: second decide after insert shape is skip', () => {
    const maps = [
      { provider: 'nba' as const, providerId: '1629029', internalId: '1629029' },
    ];
    const first = decideBdlBridgeBackfill({
      nbaPlayerId: '1629029',
      fullName: 'Luka',
      analyticsPlayerId: '132',
      resolutionMethod: 'normalized_name_unique',
      existingMaps: maps,
    });
    expect(first.action).toBe('insert');
    const second = decideBdlBridgeBackfill({
      nbaPlayerId: '1629029',
      fullName: 'Luka',
      analyticsPlayerId: '132',
      resolutionMethod: 'normalized_name_unique',
      existingMaps: [
        ...maps,
        { provider: 'balldontlie', providerId: '132', internalId: '1629029' },
      ],
    });
    expect(second.action).toBe('skip_already_present');
  });
});
