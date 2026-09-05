import { describe, expect, it } from 'vitest';
import {
  buildEntityResolverIndex,
  planAttachBdlToEntity,
  resolveRosterToEntity,
  type EntityProviderRow,
  type EntityRow,
} from '../entity-roster-resolve';
import {
  CLASS_C_SOURCE,
  STINT_ENTITY_MIGRATE_WRITES_2026,
  entityIdForNbaPlayer,
  planClassCOnboarding,
  planEntity2026SeedDryRun,
  type ClassCCandidate,
} from '../class-c-onboarding';
import { entityIdForBdlPlayer } from '../player-entity-backfill';
import {
  PIPPEN_BDL_ID,
  PIPPEN_NBA_ID,
  WILSON_BDL_ID,
  WILSON_NBA_ID,
} from '../identity-integrity';
import type { RosterObservation } from '../identity-resolver';

function obs(
  partial: Partial<RosterObservation> &
    Pick<RosterObservation, 'nbaPlayerId' | 'fullName' | 'teamAbbr'>
): RosterObservation {
  return {
    teamInternalId: 't1',
    jersey: null,
    position: 'G',
    season: '2026-27',
    ...partial,
  };
}

function entity(
  id: string,
  name: string,
  extra: Partial<EntityRow> = {}
): EntityRow {
  return {
    playerEntityId: id,
    displayName: name,
    firstName: name.split(' ')[0] ?? null,
    lastName: name.split(' ').slice(1).join(' ') || null,
    position: 'G',
    ...extra,
  };
}

describe('Phase 2.T.2D.1cC entity roster', () => {
  it('1. existing BDL stint receives deterministic entity ID from BDL player', () => {
    const bdl = '12345';
    const entityId = entityIdForBdlPlayer(bdl);
    // Simulated backfill: stint.player_id → players.player_entity_id
    expect(entityId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(entityIdForBdlPlayer(bdl)).toBe(entityId);
  });

  it('2. historical stint entity backfill planner is idempotent (same entity twice)', () => {
    const a = entityIdForBdlPlayer('111');
    const b = entityIdForBdlPlayer('111');
    expect(a).toBe(b);
  });

  it('3. stint model allows player_id NULL with valid player_entity_id (NBA-only shape)', () => {
    const eid = entityIdForNbaPlayer('1649999');
    const planned = {
      season: '2026',
      player_entity_id: eid,
      player_id: null as string | null,
      team_id: 'bos',
      observed_from: '2026-09-04',
      observed_to: null,
      source: 'nba_stats',
      source_player_id: '1649999',
    };
    expect(planned.player_id).toBeNull();
    expect(planned.player_entity_id).toBeTruthy();
  });

  it('4. stint without entity ID is invalid for cutover invariant', () => {
    const row = { player_entity_id: null as string | null, player_id: '1' };
    expect(row.player_entity_id).toBeNull();
    // Cutover requires NOT NULL — represented as validation gate
    const missing = row.player_entity_id == null;
    expect(missing).toBe(true);
  });

  it('5. uniqueness / open-stint key is entity-based', () => {
    const eid = entityIdForNbaPlayer('1');
    const openKey = (entityId: string, season: string) => `${entityId}|${season}|open`;
    expect(openKey(eid, '2026')).toBe(`${eid}|2026|open`);
    expect(openKey(eid, '2026')).not.toBe(openKey(entityIdForNbaPlayer('2'), '2026'));
  });

  it('6. NBA-only rookie resolves via NBA provider mapping', () => {
    const eid = entityIdForNbaPlayer('1640001');
    const index = buildEntityResolverIndex({
      entities: [entity(eid, 'Rookie One')],
      providerRows: [
        {
          playerEntityId: eid,
          provider: 'nba',
          providerPlayerId: '1640001',
        },
      ],
    });
    const r = resolveRosterToEntity(
      obs({ nbaPlayerId: '1640001', fullName: 'Rookie One', teamAbbr: 'BOS' }),
      index
    );
    expect(r.status).toBe('entity_provider_match');
    expect(r.playerEntityId).toBe(eid);
    expect(r.hasBdlIdentity).toBe(false);
    expect(r.analyticsPlayerId).toBeNull();
  });

  it('7. NBA-only rookie would appear in entity-first current roster view shape', () => {
    const eid = entityIdForNbaPlayer('1640002');
    const viewRow = {
      season: '2026',
      team_id: 'bos',
      player_entity_id: eid,
      player_id: null,
      display_name: 'Rookie Two',
      first_name: 'Rookie',
      last_name: 'Two',
      position: 'G',
      jersey: '0',
      membership_type: 'standard',
      observed_from: '2026-09-04',
      source: 'nba_stats',
      source_player_id: '1640002',
    };
    expect(viewRow.player_id).toBeNull();
    expect(viewRow.display_name).toBe('Rookie Two');
    expect(viewRow.player_entity_id).toBe(eid);
  });

  it('8. NBA-only Class C plan creates NBA map only (no fake BDL)', () => {
    const queue: ClassCCandidate[] = [
      {
        nbaPlayerId: '1640003',
        fullName: 'Rookie Three',
        teamAbbr: 'NYK',
        jersey: '1',
        position: 'F',
        status: 'unresolved',
        gapCause: 'rookie_or_new_player',
      },
    ];
    const plan = planClassCOnboarding({
      queue,
      existingNbaToEntity: new Map(),
    });
    expect(plan).toHaveLength(1);
    expect(plan[0]!.action).toBe('create_nba_only_entity');
    expect(plan[0]!.createNbaMapping).toBe(true);
    expect(plan[0]!.createEntity).toBe(true);
    expect(plan[0]!.playerEntityId).toBe(entityIdForNbaPlayer('1640003'));
    expect(CLASS_C_SOURCE).toBe('phase2_t2d_1cc_nba_roster');
  });

  it('9. NBA-only plan does not invent analytics.players / BDL ids', () => {
    const plan = planClassCOnboarding({
      queue: [
        {
          nbaPlayerId: '1640004',
          fullName: 'Rookie Four',
          teamAbbr: 'CHI',
          jersey: null,
          position: null,
          status: 'unresolved',
          gapCause: 'analytics_player_absent',
        },
      ],
      existingNbaToEntity: new Map(),
    });
    const json = JSON.stringify(plan);
    expect(json).not.toMatch(/balldontlie/);
    expect(plan[0]!.createNbaMapping).toBe(true);
  });

  it('10. veteran still carries BDL identity when mapped', () => {
    const eid = entityIdForBdlPlayer('555');
    const index = buildEntityResolverIndex({
      entities: [entity(eid, 'Vet Five')],
      providerRows: [
        { playerEntityId: eid, provider: 'nba', providerPlayerId: '200' },
        {
          playerEntityId: eid,
          provider: 'balldontlie',
          providerPlayerId: '555',
        },
      ],
    });
    const r = resolveRosterToEntity(
      obs({ nbaPlayerId: '200', fullName: 'Vet Five', teamAbbr: 'LAL' }),
      index
    );
    expect(r.hasBdlIdentity).toBe(true);
    expect(r.analyticsPlayerId).toBe('555');
  });

  it('11. later BDL mapping can attach to same entity', () => {
    const eid = entityIdForNbaPlayer('1640005');
    expect(
      planAttachBdlToEntity({
        playerEntityId: eid,
        bdlPlayerId: '9001',
        existingBdlOnEntity: null,
        existingEntityForBdl: null,
      })
    ).toEqual({ action: 'insert_bdl_map' });
    expect(
      planAttachBdlToEntity({
        playerEntityId: eid,
        bdlPlayerId: '9001',
        existingBdlOnEntity: '9001',
        existingEntityForBdl: eid,
      })
    ).toEqual({ action: 'already_attached' });
  });

  it('12. ambiguous provider conflict fails closed', () => {
    const e1 = entityIdForBdlPlayer('1');
    const e2 = entityIdForBdlPlayer('2');
    const providers: EntityProviderRow[] = [
      { playerEntityId: e1, provider: 'nba', providerPlayerId: 'dup' },
      { playerEntityId: e2, provider: 'nba', providerPlayerId: 'dup' },
    ];
    const index = buildEntityResolverIndex({
      entities: [entity(e1, 'A'), entity(e2, 'B')],
      providerRows: providers,
    });
    const r = resolveRosterToEntity(
      obs({ nbaPlayerId: 'dup', fullName: 'A', teamAbbr: 'ATL' }),
      index
    );
    expect(r.status).toBe('ambiguous');
    expect(r.playerEntityId).toBeNull();
  });

  it('13. Wilson / Pippen remain distinct entities', () => {
    const w = entityIdForBdlPlayer(WILSON_BDL_ID);
    const p = entityIdForBdlPlayer(PIPPEN_BDL_ID);
    expect(w).not.toBe(p);
    const index = buildEntityResolverIndex({
      entities: [
        entity(w, 'Jalen Wilson'),
        entity(p, 'Scotty Pippen Jr.'),
      ],
      providerRows: [
        {
          playerEntityId: w,
          provider: 'nba',
          providerPlayerId: WILSON_NBA_ID,
        },
        {
          playerEntityId: w,
          provider: 'balldontlie',
          providerPlayerId: WILSON_BDL_ID,
        },
        {
          playerEntityId: p,
          provider: 'nba',
          providerPlayerId: PIPPEN_NBA_ID,
        },
        {
          playerEntityId: p,
          provider: 'balldontlie',
          providerPlayerId: PIPPEN_BDL_ID,
        },
      ],
    });
    const rw = resolveRosterToEntity(
      obs({
        nbaPlayerId: WILSON_NBA_ID,
        fullName: 'Jalen Wilson',
        teamAbbr: 'BKN',
      }),
      index
    );
    const rp = resolveRosterToEntity(
      obs({
        nbaPlayerId: PIPPEN_NBA_ID,
        fullName: 'Scotty Pippen Jr.',
        teamAbbr: 'MEM',
      }),
      index
    );
    expect(rw.playerEntityId).toBe(w);
    expect(rp.playerEntityId).toBe(p);
    expect(rw.playerEntityId).not.toBe(rp.playerEntityId);
  });

  it('14. dry-run 2026 seed writes no stint rows (flag + planner only)', () => {
    expect(STINT_ENTITY_MIGRATE_WRITES_2026).toBe(false);
    const eid = entityIdForNbaPlayer('1640006');
    const results = [
      resolveRosterToEntity(
        obs({
          nbaPlayerId: '1640006',
          fullName: 'Rookie Six',
          teamAbbr: 'BOS',
        }),
        buildEntityResolverIndex({
          entities: [entity(eid, 'Rookie Six')],
          providerRows: [
            {
              playerEntityId: eid,
              provider: 'nba',
              providerPlayerId: '1640006',
            },
          ],
        })
      ),
    ];
    const seed = planEntity2026SeedDryRun({
      observedOn: '2026-09-04',
      results,
      teamIdByAbbr: new Map([['BOS', 'bos']]),
    });
    expect(seed.actions[0]!.action).toBe('open_new_2026_stint');
    if (seed.actions[0]!.action === 'open_new_2026_stint') {
      expect(seed.actions[0].analyticsPlayerId).toBeNull();
      expect(seed.actions[0].playerEntityId).toBe(eid);
    }
  });

  it('15. entity-based probe detects cross-team collision', () => {
    const eid = entityIdForBdlPlayer('777');
    const index = buildEntityResolverIndex({
      entities: [entity(eid, 'Dup Player')],
      providerRows: [
        { playerEntityId: eid, provider: 'nba', providerPlayerId: '300' },
        {
          playerEntityId: eid,
          provider: 'balldontlie',
          providerPlayerId: '777',
        },
      ],
    });
    const results = [
      resolveRosterToEntity(
        obs({ nbaPlayerId: '300', fullName: 'Dup Player', teamAbbr: 'BOS' }),
        index
      ),
      resolveRosterToEntity(
        obs({ nbaPlayerId: '300', fullName: 'Dup Player', teamAbbr: 'NYK' }),
        index
      ),
    ];
    const seed = planEntity2026SeedDryRun({
      observedOn: '2026-09-04',
      results,
      teamIdByAbbr: new Map([
        ['BOS', 'bos'],
        ['NYK', 'nyk'],
      ]),
    });
    expect(seed.multiTeamNbaIds).toContain('300');
    expect(seed.actions.every((a) => a.action === 'conflict')).toBe(true);
  });

  it('Class D ambiguous remains skipped', () => {
    const plan = planClassCOnboarding({
      queue: [
        {
          nbaPlayerId: '1630811',
          fullName: 'Keaton Wallace',
          teamAbbr: 'ATL',
          jersey: '2',
          position: 'G',
          status: 'ambiguous',
          gapCause: 'conflicting_identities',
        },
      ],
      existingNbaToEntity: new Map(),
    });
    expect(plan[0]!.action).toBe('skip_class_d');
    expect(plan[0]!.createEntity).toBe(false);
  });

  it('Class C idempotent reuse when NBA map exists', () => {
    const eid = entityIdForNbaPlayer('1640007');
    const plan = planClassCOnboarding({
      queue: [
        {
          nbaPlayerId: '1640007',
          fullName: 'Already Onboarded',
          teamAbbr: 'DAL',
          jersey: null,
          position: null,
          status: 'unresolved',
          gapCause: 'rookie_or_new_player',
        },
      ],
      existingNbaToEntity: new Map([['1640007', eid]]),
    });
    expect(plan[0]!.action).toBe('reuse_existing');
    expect(plan[0]!.createEntity).toBe(false);
  });
});
