/**
 * Persistence gate for the existing CommonTeamRoster refresh.
 * Dry-run writes nothing. Snapshot-only writes raw.nba_roster_snapshots.
 * Plain --apply also reconciles analytics.player_team_stints.
 * observed_from / observed_to remain observation dates, not transaction dates.
 */

export const AUTHORIZED_ROSTER_SEASON_LABEL = '2026-27';
export const SNAPSHOT_TABLE = 'raw.nba_roster_snapshots';
export const STINT_TABLE = 'analytics.player_team_stints';

export function rosterApplyRequested(argv: readonly string[]): boolean {
  const args = new Set(argv);
  return args.has('--apply') && !args.has('--dry-run');
}

export function rosterSnapshotsOnly(argv: readonly string[]): boolean {
  return argv.includes('--snapshots-only');
}

export type RosterPersistenceDecision = {
  writeSnapshots: boolean;
  reconcileStints: boolean;
  reason: 'dry_run' | 'blocked' | null;
};

export function decideRosterPersistence(input: {
  apply: boolean;
  snapshotsOnly: boolean;
  fetchOk: boolean;
  massCloseOk: boolean;
  duplicateEntities: number;
  multiTeamNbaIds: number;
  conflicts: number;
}): RosterPersistenceDecision {
  if (!input.apply) {
    return { writeSnapshots: false, reconcileStints: false, reason: 'dry_run' };
  }
  if (!input.fetchOk) {
    return { writeSnapshots: false, reconcileStints: false, reason: 'blocked' };
  }
  if (input.snapshotsOnly) {
    return { writeSnapshots: true, reconcileStints: false, reason: null };
  }
  const stintBlocked =
    !input.massCloseOk ||
    input.duplicateEntities > 0 ||
    input.multiTeamNbaIds > 0 ||
    input.conflicts > 0;
  if (stintBlocked) {
    return { writeSnapshots: false, reconcileStints: false, reason: 'blocked' };
  }
  return { writeSnapshots: true, reconcileStints: true, reason: null };
}

/** Tables a decision would mutate. Dry-run and a blocked fetch return none. */
export function plannedWriteTargets(decision: RosterPersistenceDecision): string[] {
  if (!decision.writeSnapshots) return [];
  return decision.reconcileStints ? [SNAPSHOT_TABLE, STINT_TABLE] : [SNAPSHOT_TABLE];
}

export type QueryClient = {
  query: (sql: string) => Promise<unknown>;
};

/**
 * Opens a transaction only when the decision writes snapshots.
 * Stint reconciliation runs only when that decision asks for it.
 * A thrown snapshot or stint error rolls the transaction back.
 */
export async function runRosterTransaction(
  client: QueryClient,
  decision: RosterPersistenceDecision,
  actions: {
    writeSnapshots: () => Promise<void>;
    reconcileStints: () => Promise<void>;
  }
): Promise<{ committed: boolean }> {
  if (!decision.writeSnapshots) return { committed: false };
  await client.query('BEGIN');
  try {
    await actions.writeSnapshots();
    if (decision.reconcileStints) await actions.reconcileStints();
    await client.query('COMMIT');
    return { committed: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** UTC calendar date of an ISO timestamp. This does not convert the instant into an earlier Eastern date. */
export function utcSnapshotDate(fetchedAt: string | null | undefined): string | null {
  if (!fetchedAt || !/^\d{4}-\d{2}-\d{2}T/.test(fetchedAt)) return null;
  const parsed = Date.parse(fetchedAt);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

export type CollectionPlayer = {
  nbaPlayerId: string;
  nbaTeamId: string;
  analyticsTeamId: string | null;
};

export function evaluateCollectionGate(input: {
  seasonLabel: string | null;
  fetchedAt: string | null;
  teamsAttempted: number;
  teamsSuccessful: number;
  teamsFailed: Array<{ abbreviation: string }>;
  totalPlayers: number;
  players: CollectionPlayer[];
  playersPerTeam: Record<string, number>;
  duplicateNbaPlayerIds: unknown[];
  minTeamSize: number | null;
}): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  if (input.seasonLabel !== AUTHORIZED_ROSTER_SEASON_LABEL) {
    failures.push(`seasonLabel=${input.seasonLabel ?? 'missing'} expected ${AUTHORIZED_ROSTER_SEASON_LABEL}`);
  }
  if (!utcSnapshotDate(input.fetchedAt)) {
    failures.push('missing or invalid fetched_at');
  }
  if (input.teamsAttempted !== 30 || input.teamsSuccessful !== 30) {
    failures.push(`teams=${input.teamsSuccessful}/${input.teamsAttempted} expected 30/30`);
  }
  if (input.teamsFailed.length > 0) {
    failures.push(`failed teams: ${input.teamsFailed.map((team) => team.abbreviation).join(',')}`);
  }
  if (input.players.length !== input.totalPlayers) {
    failures.push(`truncated payload: players=${input.players.length} total=${input.totalPlayers}`);
  }
  if (input.totalPlayers < 500) {
    failures.push(`total players ${input.totalPlayers} below 500`);
  }
  if (input.duplicateNbaPlayerIds.length > 0) {
    failures.push(`cross-team duplicate NBA ids: ${input.duplicateNbaPlayerIds.length}`);
  }
  const zeroTeams = Object.entries(input.playersPerTeam)
    .filter(([, count]) => count === 0)
    .map(([abbr]) => abbr);
  if (zeroTeams.length > 0) failures.push(`empty rosters: ${zeroTeams.join(',')}`);
  if (input.minTeamSize == null || input.minTeamSize < 8) {
    failures.push(`min team size ${input.minTeamSize ?? 'missing'} below 8`);
  }
  const seen = new Set<string>();
  for (const player of input.players) {
    if (!/^\d{1,10}$/.test(player.nbaPlayerId)) failures.push(`invalid NBA player id ${player.nbaPlayerId || 'blank'}`);
    if (!player.analyticsTeamId) failures.push(`missing analytics team for ${player.nbaPlayerId || 'blank'}`);
    const key = `${player.nbaTeamId}|${player.nbaPlayerId}`;
    if (seen.has(key)) failures.push(`duplicate player-team ${key}`);
    seen.add(key);
  }
  return { ok: failures.length === 0, failures };
}

/** Same-day replacement: upsert every incoming row and delete stored rows absent from the payload. */
export function previewSameDaySnapshot(input: { existingKeys: string[]; incomingKeys: string[] }): {
  target: typeof SNAPSHOT_TABLE;
  upserts: number;
  deletes: number;
} {
  const incoming = new Set(input.incomingKeys);
  const deletes = input.existingKeys.filter((key) => !incoming.has(key)).length;
  return { target: SNAPSHOT_TABLE, upserts: input.incomingKeys.length, deletes };
}
