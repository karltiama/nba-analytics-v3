import { describe, expect, it } from 'vitest';
import {
  assertDistinctCanonicalPlayers,
  findDuplicateCanonicalAssignments,
  planWilsonPippenBridgeRepair,
  PIPPEN_BDL_ID,
  PIPPEN_NBA_ID,
  WILSON_BDL_ID,
  WILSON_NBA_ID,
} from '../identity-integrity';
import {
  buildResolverIndex,
  resolveRosterIdentity,
} from '../identity-resolver';

describe('identity integrity — Wilson / Pippen', () => {
  it('never resolves Jalen Wilson and Scotty Pippen Jr. to the same analytics id (fixed maps)', () => {
    const index = buildResolverIndex({
      providerMaps: [
        { provider: 'nba', providerId: WILSON_NBA_ID, internalId: WILSON_NBA_ID },
        { provider: 'nba', providerId: PIPPEN_NBA_ID, internalId: PIPPEN_NBA_ID },
        { provider: 'balldontlie', providerId: WILSON_BDL_ID, internalId: WILSON_NBA_ID },
        { provider: 'balldontlie', providerId: PIPPEN_BDL_ID, internalId: PIPPEN_NBA_ID },
      ],
      analyticsPlayers: [
        {
          playerId: WILSON_BDL_ID,
          fullName: 'Jalen Wilson',
          position: 'F',
          pglTeamAbbrevs: ['BKN'],
        },
        {
          playerId: PIPPEN_BDL_ID,
          fullName: 'Scotty Pippen Jr.',
          position: 'G',
          pglTeamAbbrevs: ['MEM'],
        },
      ],
    });

    const wilson = resolveRosterIdentity(
      {
        nbaPlayerId: WILSON_NBA_ID,
        fullName: 'Jalen Wilson',
        teamAbbr: 'BKN',
        teamInternalId: '3',
        jersey: '22',
        position: 'F',
        season: '2025-26',
      },
      index
    );
    const pippen = resolveRosterIdentity(
      {
        nbaPlayerId: PIPPEN_NBA_ID,
        fullName: 'Scotty Pippen Jr.',
        teamAbbr: 'MEM',
        teamInternalId: '15',
        jersey: '1',
        position: 'G',
        season: '2025-26',
      },
      index
    );

    expect(wilson.status).toBe('provider_match');
    expect(pippen.status).toBe('provider_match');
    expect(wilson.analyticsPlayerId).toBe(WILSON_BDL_ID);
    expect(pippen.analyticsPlayerId).toBe(PIPPEN_BDL_ID);
    assertDistinctCanonicalPlayers(wilson.analyticsPlayerId, pippen.analyticsPlayerId);
  });

  it('detects duplicate canonical assignment within one roster snapshot', () => {
    const dups = findDuplicateCanonicalAssignments([
      {
        nbaPlayerId: WILSON_NBA_ID,
        analyticsPlayerId: WILSON_BDL_ID,
        fullName: 'Jalen Wilson',
        teamAbbr: 'BKN',
      },
      {
        nbaPlayerId: PIPPEN_NBA_ID,
        analyticsPlayerId: WILSON_BDL_ID,
        fullName: 'Scotty Pippen Jr.',
        teamAbbr: 'MEM',
      },
    ]);
    expect(dups).toHaveLength(1);
    expect(dups[0].analyticsPlayerId).toBe(WILSON_BDL_ID);
    expect(dups[0].assignments).toHaveLength(2);
  });

  it('provider-map conflicts fail closed in repair planner', () => {
    const actions = planWilsonPippenBridgeRepair([
      {
        provider: 'balldontlie',
        providerId: WILSON_BDL_ID,
        internalId: '999999', // unexpected
      },
    ]);
    expect(actions.some((a) => a.action === 'conflict')).toBe(true);
  });

  it('plans correction of Pippen→Wilson bad bridge', () => {
    const actions = planWilsonPippenBridgeRepair([
      {
        provider: 'balldontlie',
        providerId: WILSON_BDL_ID,
        internalId: PIPPEN_NBA_ID,
      },
      { provider: 'nba', providerId: WILSON_NBA_ID, internalId: WILSON_NBA_ID },
      { provider: 'nba', providerId: PIPPEN_NBA_ID, internalId: PIPPEN_NBA_ID },
    ]);
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'update_bdl_internal',
          providerId: WILSON_BDL_ID,
          fromInternalId: PIPPEN_NBA_ID,
          toInternalId: WILSON_NBA_ID,
        }),
        expect.objectContaining({
          action: 'insert_bdl_bridge',
          providerId: PIPPEN_BDL_ID,
          internalId: PIPPEN_NBA_ID,
        }),
      ])
    );
  });

  it('bad bridge causes collision (regression of pre-fix state)', () => {
    const index = buildResolverIndex({
      providerMaps: [
        { provider: 'nba', providerId: WILSON_NBA_ID, internalId: WILSON_NBA_ID },
        { provider: 'nba', providerId: PIPPEN_NBA_ID, internalId: PIPPEN_NBA_ID },
        // BAD: Pippen NBA → Wilson BDL
        { provider: 'balldontlie', providerId: WILSON_BDL_ID, internalId: PIPPEN_NBA_ID },
      ],
      analyticsPlayers: [
        {
          playerId: WILSON_BDL_ID,
          fullName: 'Jalen Wilson',
          position: 'F',
          pglTeamAbbrevs: ['BKN'],
        },
        {
          playerId: PIPPEN_BDL_ID,
          fullName: 'Scotty Pippen Jr.',
          position: 'G',
          pglTeamAbbrevs: ['MEM'],
        },
      ],
    });
    const wilson = resolveRosterIdentity(
      {
        nbaPlayerId: WILSON_NBA_ID,
        fullName: 'Jalen Wilson',
        teamAbbr: 'BKN',
        teamInternalId: '3',
        jersey: '22',
        position: 'F',
        season: '2025-26',
      },
      index
    );
    const pippen = resolveRosterIdentity(
      {
        nbaPlayerId: PIPPEN_NBA_ID,
        fullName: 'Scotty Pippen Jr.',
        teamAbbr: 'MEM',
        teamInternalId: '15',
        jersey: '1',
        position: 'G',
        season: '2025-26',
      },
      index
    );
    expect(pippen.analyticsPlayerId).toBe(WILSON_BDL_ID);
    expect(wilson.analyticsPlayerId).toBe(WILSON_BDL_ID);
    expect(() =>
      assertDistinctCanonicalPlayers(wilson.analyticsPlayerId, pippen.analyticsPlayerId)
    ).toThrow();
  });
});
