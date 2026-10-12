import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateFetchIntegrity, planEntityRosterRefresh } from '@/lib/roster/entity-roster-refresh';
import {
  decideRosterPersistence,
  evaluateCollectionGate,
  plannedWriteTargets,
  previewSameDaySnapshot,
  rosterApplyRequested,
  rosterSnapshotsOnly,
  runRosterTransaction,
  utcSnapshotDate,
  type CollectionPlayer,
} from '@/lib/roster/roster-refresh-safety';

function fetch(over: Partial<Parameters<typeof evaluateFetchIntegrity>[0]> = {}) {
  const playersPerTeam: Record<string, number> = {};
  for (let index = 0; index < 30; index += 1) playersPerTeam[`T${index}`] = 18;
  return evaluateFetchIntegrity({
    teamsAttempted: 30,
    teamsSuccessful: 30,
    teamsFailed: [],
    totalObservations: 540,
    playersPerTeam,
    duplicateNbaPlayerIds: [],
    minTeamSize: 18,
    ...over,
  });
}

const ready = {
  apply: true,
  snapshotsOnly: false,
  fetchOk: true,
  massCloseOk: true,
  duplicateEntities: 0,
  multiTeamNbaIds: 0,
  conflicts: 0,
};

describe('roster refresh persistence', () => {
  it('accepts a complete 30-team payload and refuses a failed, duplicate, empty, or partial payload', () => {
    expect(fetch().ok).toBe(true);
    expect(fetch({ teamsSuccessful: 29, teamsFailed: [{ abbreviation: 'ORL' }] }).ok).toBe(false);
    expect(fetch({ duplicateNbaPlayerIds: [{ nba_player_id: '1' }] }).ok).toBe(false);
    expect(fetch({ minTeamSize: 0, playersPerTeam: { ORL: 0 } }).ok).toBe(false);
    expect(fetch({ totalObservations: 120, teamsSuccessful: 10, teamsFailed: [{ abbreviation: 'partial' }] }).ok).toBe(false);
  });

  it('writes nothing on dry-run, when both flags are set, or when a guard fails before persistence', () => {
    expect(rosterApplyRequested(['--season=2026-27', '--dry-run'])).toBe(false);
    expect(rosterApplyRequested(['--apply', '--dry-run'])).toBe(false);
    expect(rosterApplyRequested(['--apply'])).toBe(true);
    expect(decideRosterPersistence({ ...ready, apply: false })).toEqual({
      writeSnapshots: false,
      reconcileStints: false,
      reason: 'dry_run',
    });
    expect(decideRosterPersistence({ ...ready, fetchOk: false })).toEqual({
      writeSnapshots: false,
      reconcileStints: false,
      reason: 'blocked',
    });
    expect(decideRosterPersistence({ ...ready, conflicts: 1 }).writeSnapshots).toBe(false);
  });

  it('persists a passing apply, and snapshots-only skips stint reconciliation', () => {
    expect(decideRosterPersistence(ready)).toEqual({
      writeSnapshots: true,
      reconcileStints: true,
      reason: null,
    });
    expect(rosterSnapshotsOnly(['--apply', '--snapshots-only'])).toBe(true);
    expect(decideRosterPersistence({ ...ready, snapshotsOnly: true })).toEqual({
      writeSnapshots: true,
      reconcileStints: false,
      reason: null,
    });
  });

  it('records an absence as an observation date, not a transaction date', () => {
    const observedOn = '2026-10-11';
    const plan = planEntityRosterRefresh({
      season: '2026',
      observedOn,
      resolvedObservations: [],
      existingOpenStints: [
        {
          stintId: 9,
          playerEntityId: 'entity-1',
          playerId: '101',
          teamId: '22',
          season: '2026',
          observedFrom: '2026-09-05',
          jersey: null,
          position: null,
          source: 'nba_stats',
          sourcePlayerId: 'nba-1',
        },
      ],
      protectedNbaPlayerIds: new Set(),
      allowsCloses: true,
    });
    const close = plan.mutations.find((mutation) => mutation.type === 'close');
    expect(close).toMatchObject({ category: 'close_missing', observedTo: observedOn });
    expect(close).not.toHaveProperty('transactionDate');
    expect(JSON.stringify(close)).not.toMatch(/trade|waiver|signing/i);
  });

  it('keeps snapshot-only writes off team stints even when the stint guard would block plain apply', () => {
    const snapshotsOnly = decideRosterPersistence({
      ...ready,
      snapshotsOnly: true,
      massCloseOk: false,
      conflicts: 4,
    });
    expect(snapshotsOnly).toEqual({ writeSnapshots: true, reconcileStints: false, reason: null });
    expect(plannedWriteTargets(snapshotsOnly)).toEqual(['raw.nba_roster_snapshots']);
    const plain = decideRosterPersistence({ ...ready, massCloseOk: false });
    expect(plain.reason).toBe('blocked');
    expect(plannedWriteTargets(plain)).toEqual([]);
    expect(plannedWriteTargets(decideRosterPersistence(ready))).toEqual([
      'raw.nba_roster_snapshots',
      'analytics.player_team_stints',
    ]);
  });
});

function collectionPlayers(count = 540): CollectionPlayer[] {
  return Array.from({ length: count }, (_, index) => ({
    nbaPlayerId: String(1000 + index),
    nbaTeamId: String((index % 30) + 1),
    analyticsTeamId: String((index % 30) + 1),
  }));
}

function collection(over: Partial<Parameters<typeof evaluateCollectionGate>[0]> = {}) {
  const playersPerTeam: Record<string, number> = {};
  for (let index = 0; index < 30; index += 1) playersPerTeam[`T${index}`] = 18;
  return evaluateCollectionGate({
    seasonLabel: '2026-27',
    fetchedAt: '2026-10-11T23:30:00.000Z',
    teamsAttempted: 30,
    teamsSuccessful: 30,
    teamsFailed: [],
    totalPlayers: 540,
    players: collectionPlayers(),
    playersPerTeam,
    duplicateNbaPlayerIds: [],
    minTeamSize: 18,
    ...over,
  });
}

describe('roster collection gate', () => {
  it('accepts a complete 2026-27 payload and rejects incomplete, duplicate, unmapped, empty, and undated payloads', () => {
    expect(collection().ok).toBe(true);
    expect(collection({ teamsSuccessful: 29, teamsFailed: [{ abbreviation: 'ORL' }] }).ok).toBe(false);
    expect(collection({ duplicateNbaPlayerIds: [{ nba_player_id: '1' }] }).ok).toBe(false);
    expect(collection({ players: collectionPlayers().map((player, index) => index === 0 ? { ...player, analyticsTeamId: null } : player) }).ok).toBe(false);
    expect(collection({ totalPlayers: 100, players: collectionPlayers(100) }).failures.join(' ')).toMatch(/total players|truncated|min team size|teams=/);
    expect(collection({ fetchedAt: null }).failures.join(' ')).toMatch(/fetched_at/);
    expect(collection({ seasonLabel: '2025-26' }).ok).toBe(false);
    const duplicated = collectionPlayers();
    duplicated.push({ ...duplicated[0]! });
    expect(collection({ players: duplicated, totalPlayers: duplicated.length }).failures.join(' ')).toMatch(/duplicate player-team/);
    expect(collection({ players: collectionPlayers().map((player, index) => index === 0 ? { ...player, nbaPlayerId: 'abc' } : player) }).failures.join(' ')).toMatch(/invalid NBA player id/);
    expect(collection({ minTeamSize: 0, playersPerTeam: { ORL: 0 } }).failures.join(' ')).toMatch(/empty rosters/);
  });

  it('uses the UTC date and does not move a late Eastern instant onto the previous day', () => {
    expect(utcSnapshotDate('2026-10-12T03:30:00.000Z')).toBe('2026-10-12');
    expect(utcSnapshotDate('2026-10-11T23:30:00.000Z')).toBe('2026-10-11');
    expect(utcSnapshotDate('')).toBeNull();
  });

  it('previews same-day replacement without writing', () => {
    expect(previewSameDaySnapshot({
      existingKeys: ['1|a', '1|b'],
      incomingKeys: ['1|a', '1|c'],
    })).toEqual({ target: 'raw.nba_roster_snapshots', upserts: 2, deletes: 1 });
  });

  it('does not open a transaction on dry-run, and rolls back a failed snapshot write', async () => {
    const sql: string[] = [];
    const client = {
      query: async (text: string) => {
        sql.push(text);
      },
    };
    const dryRun = decideRosterPersistence({ ...ready, apply: false });
    const skipped = await runRosterTransaction(client, dryRun, {
      writeSnapshots: async () => {
        sql.push('INSERT INTO raw.nba_roster_snapshots');
      },
      reconcileStints: async () => {
        sql.push('UPDATE analytics.player_team_stints');
      },
    });
    expect(skipped.committed).toBe(false);
    expect(sql).toEqual([]);

    const snapshotsOnly = decideRosterPersistence({ ...ready, snapshotsOnly: true, conflicts: 2 });
    sql.length = 0;
    const committed = await runRosterTransaction(client, snapshotsOnly, {
      writeSnapshots: async () => {
        sql.push('raw.nba_roster_snapshots');
      },
      reconcileStints: async () => {
        sql.push('analytics.player_team_stints');
      },
    });
    expect(committed.committed).toBe(true);
    expect(sql).toEqual(['BEGIN', 'raw.nba_roster_snapshots', 'COMMIT']);

    sql.length = 0;
    await expect(runRosterTransaction(client, snapshotsOnly, {
      writeSnapshots: async () => {
        throw new Error('snapshot failed');
      },
      reconcileStints: async () => {
        sql.push('analytics.player_team_stints');
      },
    })).rejects.toThrow('snapshot failed');
    expect(sql).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('keeps the refresh script from calling snapshot writes outside the persistence decision', () => {
    const source = readFileSync('scripts/roster/refresh-current-rosters.ts', 'utf8');
    expect(source).toContain('runRosterTransaction');
    expect(source).toContain('plannedWriteTargets(persistence)');
    expect(source.match(/writeRawSnapshots\(/g)).toHaveLength(2);
    expect(source).toContain('reconcileStints: async () =>');
    expect(source).not.toMatch(/INSERT INTO analytics\.player_provider_ids/i);
    expect(source).not.toMatch(/UPDATE analytics\.player_provider_ids/i);
    expect(source).not.toMatch(/DELETE FROM analytics\.player_provider_ids/i);
    expect(source).not.toMatch(/INSERT INTO analytics\.(games|players|player_game_logs)/i);
  });
});
