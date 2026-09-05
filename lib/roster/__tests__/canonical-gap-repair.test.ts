import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_PLAYER_ID_IS_BDL_COUPLED,
  GAP_REPAIR_WRITES_STINTS,
  assertNoFabricatedBdlIds,
  planCanonicalGapRepairs,
  type GapQueueRow,
  type LocalPlayer,
} from '../canonical-gap-repair';
import { normalizePersonName } from '../normalize-player-name';
import type { ExistingMap } from '../provider-map-backfill';

function q(
  partial: Partial<GapQueueRow> & Pick<GapQueueRow, 'nbaPlayerId' | 'fullName'>
): GapQueueRow {
  return {
    teamAbbr: 'CHI',
    jersey: '1',
    position: 'G',
    status: 'unresolved',
    gapCause: 'analytics_player_absent',
    ...partial,
  };
}

describe('normalizePersonName initials', () => {
  it('matches A.J. Green and AJ Green', () => {
    expect(normalizePersonName('A.J. Green')).toBe('aj green');
    expect(normalizePersonName('AJ Green')).toBe('aj green');
    expect(normalizePersonName('K.J. Simpson')).toBe(
      normalizePersonName('KJ Simpson')
    );
  });
});

describe('planCanonicalGapRepairs', () => {
  const analytics: LocalPlayer[] = [
    {
      playerId: '666508',
      fullName: 'Nicolas Claxton',
      source: 'analytics',
    },
    {
      playerId: '38017733',
      fullName: 'A.J. Green',
      source: 'analytics',
    },
  ];
  const raw: LocalPlayer[] = [
    {
      playerId: '666508',
      fullName: 'Nicolas Claxton',
      source: 'raw',
    },
    {
      playerId: '999001',
      fullName: 'Only In Raw',
      firstName: 'Only',
      lastName: 'In Raw',
      source: 'raw',
    },
  ];

  it('Class A: existing canonical + missing bridge', () => {
    const maps: ExistingMap[] = [
      { provider: 'nba', providerId: '1629651', internalId: '1629651' },
    ];
    const plans = planCanonicalGapRepairs({
      queue: [q({ nbaPlayerId: '1629651', fullName: 'Nic Claxton' })],
      existingMaps: maps,
      analyticsPlayers: analytics,
      rawPlayers: raw,
    });
    expect(plans[0]).toMatchObject({
      repairClass: 'A',
      action: 'bridge_existing_player',
      targetAnalyticsPlayerId: '666508',
      insertBdlBridge: true,
    });
  });

  it('Class A via initials normalize: AJ Green → A.J. Green', () => {
    const maps: ExistingMap[] = [
      { provider: 'nba', providerId: '1631260', internalId: '1631260' },
    ];
    const plans = planCanonicalGapRepairs({
      queue: [q({ nbaPlayerId: '1631260', fullName: 'AJ Green', teamAbbr: 'MIL' })],
      existingMaps: maps,
      analyticsPlayers: analytics,
      rawPlayers: raw,
    });
    expect(plans[0]?.action).toBe('bridge_existing_player');
    expect(plans[0]?.targetAnalyticsPlayerId).toBe('38017733');
  });

  it('Class B: raw exists, analytics missing', () => {
    const plans = planCanonicalGapRepairs({
      queue: [q({ nbaPlayerId: '1', fullName: 'Only In Raw' })],
      existingMaps: [
        { provider: 'nba', providerId: '1', internalId: '1' },
      ],
      analyticsPlayers: analytics,
      rawPlayers: raw,
    });
    expect(plans[0]).toMatchObject({
      repairClass: 'B',
      action: 'promote_raw_player_to_analytics',
      promoteRaw: true,
      targetAnalyticsPlayerId: '999001',
    });
  });

  it('Class C: NBA-only rookie blocked by schema', () => {
    const plans = planCanonicalGapRepairs({
      queue: [
        q({
          nbaPlayerId: '1643412',
          fullName: 'Kingston Flemings',
          gapCause: 'rookie_or_new_player',
        }),
      ],
      existingMaps: [],
      analyticsPlayers: analytics,
      rawPlayers: raw,
    });
    expect(plans[0]).toMatchObject({
      repairClass: 'C',
      action: 'blocked_by_schema',
    });
    expect(ANALYTICS_PLAYER_ID_IS_BDL_COUPLED).toBe(true);
  });

  it('Class D: duplicate-name / conflicting', () => {
    const plans = planCanonicalGapRepairs({
      queue: [
        q({
          nbaPlayerId: '1630811',
          fullName: 'Keaton Wallace',
          status: 'ambiguous',
          gapCause: 'conflicting_identities',
        }),
      ],
      existingMaps: [
        { provider: 'nba', providerId: '1630811', internalId: '1630811' },
        {
          provider: 'balldontlie',
          providerId: '1',
          internalId: '1630811',
        },
        {
          provider: 'balldontlie',
          providerId: '2',
          internalId: '1630811',
        },
      ],
      analyticsPlayers: analytics,
      rawPlayers: raw,
    });
    expect(plans[0]?.action).toBe('manual_review');
    expect(plans[0]?.repairClass).toBe('D');
  });

  it('refuses fabricated BDL ids', () => {
    expect(() =>
      assertNoFabricatedBdlIds(
        [
          {
            nbaPlayerId: '1',
            fullName: 'X',
            teamAbbr: 'ATL',
            jersey: null,
            position: null,
            howAcquired: null,
            supplementalStatus: null,
            repairClass: 'A',
            taxonomy: 't',
            rawBdlExists: false,
            analyticsExists: false,
            nbaProviderMapExists: false,
            bdlProviderMapExists: false,
            candidateAnalyticsIds: [],
            candidateRawIds: [],
            action: 'bridge_existing_player',
            targetAnalyticsPlayerId: 'fake-id',
            insertNbaMap: false,
            insertBdlBridge: true,
            promoteRaw: false,
            reason: 'x',
          },
        ],
        new Set(['666508'])
      )
    ).toThrow(/fabricated/);
  });

  it('dry-run contract never writes stints', () => {
    expect(GAP_REPAIR_WRITES_STINTS).toBe(false);
  });

  it('idempotent: already-bridged Class A is skip-safe', () => {
    const maps: ExistingMap[] = [
      { provider: 'nba', providerId: '1629651', internalId: '1629651' },
      {
        provider: 'balldontlie',
        providerId: '666508',
        internalId: '1629651',
      },
    ];
    const plans = planCanonicalGapRepairs({
      queue: [q({ nbaPlayerId: '1629651', fullName: 'Nic Claxton' })],
      existingMaps: maps,
      analyticsPlayers: analytics,
      rawPlayers: raw,
    });
    expect(plans[0]?.insertBdlBridge).toBe(false);
    expect(plans[0]?.action).toBe('bridge_existing_player');
  });
});
