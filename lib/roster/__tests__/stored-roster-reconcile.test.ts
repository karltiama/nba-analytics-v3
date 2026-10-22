import { describe, expect, it } from 'vitest';
import { planStoredRosterReconcile } from '../stored-roster-reconcile';

const teams = [
  { teamId: '1', abbreviation: 'ATL' },
  { teamId: '2', abbreviation: 'MIL' },
  { teamId: '3', abbreviation: 'UTA' },
];

const observedOn = '2026-10-12';

describe('planStoredRosterReconcile', () => {
  it('keeps the same team, moves a confirmed player, and adds a resolved player', () => {
    const plan = planStoredRosterReconcile({
      season: '2026',
      observedOn,
      teams,
      members: [
        { providerPlayerId: 'dort', teamAbbr: 'ATL' },
        { providerPlayerId: 'kawhi', teamAbbr: 'MIL' },
        { providerPlayerId: 'rookie', teamAbbr: 'ATL' },
      ],
      identities: [
        { providerPlayerId: 'dort', playerEntityId: 'e-dort', playerId: 'dort', fullName: 'Luguentz Dort' },
        { providerPlayerId: 'kawhi', playerEntityId: 'e-kawhi', playerId: 'kawhi', fullName: 'Kawhi Leonard' },
        { providerPlayerId: 'rookie', playerEntityId: 'e-rookie', playerId: 'rookie', fullName: 'New Player' },
      ],
      openStints: [
        { stintId: 10, playerEntityId: 'e-dort', playerId: 'dort', teamId: '1', season: '2026', observedFrom: '2026-09-04' },
        { stintId: 11, playerEntityId: 'e-kawhi', playerId: 'kawhi', teamId: '3', season: '2026', observedFrom: '2026-09-04' },
        { stintId: 12, playerEntityId: 'e-kept', playerId: 'kept', teamId: '2', season: '2026', observedFrom: '2026-09-04' },
        { stintId: 99, playerEntityId: 'e-dort', playerId: 'dort', teamId: '9', season: '2025', observedFrom: '2025-10-21' },
      ],
    });

    expect(plan.season).toBe('2026');
    expect(plan.unchanged).toBe(1);
    expect(plan.teamChanges).toEqual([
      expect.objectContaining({
        stintId: 11,
        fromTeamId: '3',
        toTeamId: '2',
        closeObservedTo: '2026-10-12',
        openObservedFrom: '2026-10-12',
        source: 'balldontlie',
      }),
    ]);
    expect(plan.opens).toEqual([
      expect.objectContaining({ playerEntityId: 'e-rookie', teamId: '1', observedFrom: '2026-10-12' }),
    ]);
    expect(plan.preparedAbsenceCloses).toBe(0);
    expect(plan.exclusions.some((e) => e.kind === 'missing_from_batch' && e.playerEntityId === 'e-kept')).toBe(true);
    expect(plan.exclusions.some((e) => e.detail.includes('2025'))).toBe(false);
    expect(plan.massCloseIfAbsenceWereApplied.ok).toBe(false);
  });

  it('does not apply a second time once the team change is open', () => {
    const first = planStoredRosterReconcile({
      season: '2026',
      observedOn,
      teams,
      members: [{ providerPlayerId: 'kawhi', teamAbbr: 'MIL' }],
      identities: [
        { providerPlayerId: 'kawhi', playerEntityId: 'e-kawhi', playerId: 'kawhi', fullName: 'Kawhi Leonard' },
      ],
      openStints: [
        { stintId: 11, playerEntityId: 'e-kawhi', playerId: 'kawhi', teamId: '3', season: '2026', observedFrom: '2026-09-04' },
      ],
    });
    const second = planStoredRosterReconcile({
      season: '2026',
      observedOn,
      teams,
      members: [{ providerPlayerId: 'kawhi', teamAbbr: 'MIL' }],
      identities: [
        { providerPlayerId: 'kawhi', playerEntityId: 'e-kawhi', playerId: 'kawhi', fullName: 'Kawhi Leonard' },
      ],
      openStints: [
        {
          stintId: 20,
          playerEntityId: 'e-kawhi',
          playerId: 'kawhi',
          teamId: '2',
          season: '2026',
          observedFrom: '2026-10-12',
        },
      ],
    });
    expect(first.teamChanges).toHaveLength(1);
    expect(second.teamChanges).toHaveLength(0);
    expect(second.opens).toHaveLength(0);
    expect(second.unchanged).toBe(1);
  });

  it('excludes ambiguous and conflicting memberships', () => {
    const plan = planStoredRosterReconcile({
      season: '2026',
      observedOn,
      teams,
      members: [
        { providerPlayerId: 'split', teamAbbr: 'ATL' },
        { providerPlayerId: 'two', teamAbbr: 'ATL' },
        { providerPlayerId: 'two', teamAbbr: 'MIL' },
      ],
      identities: [
        { providerPlayerId: 'split', playerEntityId: 'e1', playerId: 'split', fullName: 'A' },
        { providerPlayerId: 'split', playerEntityId: 'e2', playerId: 'split', fullName: 'A' },
        { providerPlayerId: 'two', playerEntityId: 'e3', playerId: 'two', fullName: 'B' },
      ],
      openStints: [],
    });
    expect(plan.opens).toHaveLength(0);
    expect(plan.teamChanges).toHaveLength(0);
    expect(plan.exclusions.map((e) => e.kind).sort()).toEqual([
      'ambiguous_identity',
      'conflicting_membership',
    ]);
  });

  it('refuses any season other than 2026', () => {
    expect(() =>
      planStoredRosterReconcile({
        season: '2025',
        observedOn,
        teams,
        members: [],
        identities: [],
        openStints: [],
      })
    ).toThrow(/2026 only/);
  });
});
