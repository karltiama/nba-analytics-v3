/**
 * Persistence for one validated BallDontLie roster observation.
 * Writes only raw.roster_observation_batches and raw.roster_observation_members.
 * Dry-run does not open a transaction. A failed insert rolls back.
 * An existing batch with the same provider and collected_at is not overwritten.
 */

import { createHash } from 'node:crypto';

import { utcSnapshotDate } from '@/lib/roster/roster-refresh-safety';
import {
  BDL_ACTIVE_ROSTER_ENDPOINT,
  BDL_ROSTER_COMPLETENESS,
  BDL_ROSTER_PROVIDER,
  type ActiveRosterPlayer,
} from '@/lib/roster/bdl-active-roster';

export const BDL_ROSTER_BATCH_TABLE = 'raw.roster_observation_batches';
export const BDL_ROSTER_MEMBER_TABLE = 'raw.roster_observation_members';

const FORBIDDEN_WRITE_TABLES = [
  'analytics.games',
  'analytics.players',
  'analytics.player_game_logs',
  'analytics.player_provider_ids',
  'analytics.player_team_stints',
  'raw.nba_roster_snapshots',
] as const;

export type RosterQueryClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type BdlRosterPersistenceDecision = {
  write: boolean;
  reason: 'dry_run' | 'blocked' | 'apply';
};

export function decideBdlRosterPersistence(input: { apply: boolean; validationOk: boolean }): BdlRosterPersistenceDecision {
  if (!input.apply) return { write: false, reason: 'dry_run' };
  if (!input.validationOk) return { write: false, reason: 'blocked' };
  return { write: true, reason: 'apply' };
}

export function plannedBdlWriteTargets(decision: BdlRosterPersistenceDecision): string[] {
  if (!decision.write) return [];
  return [BDL_ROSTER_BATCH_TABLE, BDL_ROSTER_MEMBER_TABLE];
}

export function rosterObservationBatchId(provider: string, collectedAt: string): string {
  const bytes = createHash('sha256').update(`${provider}|${collectedAt}`).digest();
  const id = Buffer.from(bytes.subarray(0, 16));
  id[6] = (id[6]! & 0x0f) | 0x50;
  id[8] = (id[8]! & 0x3f) | 0x80;
  const hex = id.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type BdlRosterWritePreview = {
  batchId: string;
  collectedAt: string;
  snapshotDate: string;
  playerCount: number;
  targets: string[];
};

export function previewBdlRosterWrite(input: {
  collectedAt: string;
  players: ActiveRosterPlayer[];
  decision: BdlRosterPersistenceDecision;
}): BdlRosterWritePreview | null {
  if (!input.decision.write && input.decision.reason !== 'dry_run') return null;
  const snapshotDate = utcSnapshotDate(input.collectedAt);
  if (!snapshotDate) return null;
  return {
    batchId: rosterObservationBatchId(BDL_ROSTER_PROVIDER, input.collectedAt),
    collectedAt: input.collectedAt,
    snapshotDate,
    playerCount: input.players.length,
    targets: input.decision.write ? plannedBdlWriteTargets(input.decision) : [],
  };
}

function membershipKey(players: ActiveRosterPlayer[]): string {
  return [...players]
    .map((player) => `${player.providerPlayerId}|${player.providerTeamId}|${player.teamAbbreviation}`)
    .sort()
    .join('\n');
}

function assertSafeSql(sql: string): void {
  const normalized = sql.toLowerCase();
  if (/\b(drop|alter|truncate)\b/.test(normalized)) throw new Error('roster observation sql is not a schema change');
  for (const table of FORBIDDEN_WRITE_TABLES) {
    if (normalized.includes(`insert into ${table}`) || normalized.includes(`update ${table}`) || normalized.includes(`delete from ${table}`)) {
      throw new Error(`roster observation sql must not write ${table}`);
    }
  }
}

export async function persistBdlRosterObservation(
  client: RosterQueryClient,
  decision: BdlRosterPersistenceDecision,
  input: {
    collectedAt: string;
    seasonLabel: string;
    requestCount: number;
    pageCount: number;
    players: ActiveRosterPlayer[];
    minTeamSize: number;
    maxTeamSize: number;
  }
): Promise<
  | { written: false; reason: 'dry_run' | 'blocked' | 'invalid_timestamp' | 'already_stored' | 'conflict_existing'; batchId: string | null }
  | { written: true; reason: 'apply'; batchId: string }
> {
  const batchId = rosterObservationBatchId(BDL_ROSTER_PROVIDER, input.collectedAt);
  if (!decision.write) {
    return { written: false, reason: decision.reason === 'blocked' ? 'blocked' : 'dry_run', batchId: null };
  }
  const snapshotDate = utcSnapshotDate(input.collectedAt);
  if (!snapshotDate || input.players.length === 0) {
    return { written: false, reason: 'invalid_timestamp', batchId: null };
  }

  const selectBatch = `SELECT batch_id::text AS batch_id
     FROM ${BDL_ROSTER_BATCH_TABLE}
     WHERE provider = $1 AND collected_at = $2::timestamptz`;
  const selectMembers = `SELECT provider_player_id, provider_team_id, team_abbreviation
     FROM ${BDL_ROSTER_MEMBER_TABLE}
     WHERE batch_id = $1::uuid`;
  const insertBatch = `INSERT INTO ${BDL_ROSTER_BATCH_TABLE} (
       batch_id, provider, season_label, collected_at, snapshot_date, endpoint, status,
       request_count, page_count, player_count, team_count, min_team_size, max_team_size,
       gate_ok, completeness_scope
     ) VALUES (
       $1::uuid, $2, $3, $4::timestamptz, $5::date, $6, 'complete',
       $7, $8, $9, 30, $10, $11,
       true, $12
     )`;
  const insertMembers = `INSERT INTO ${BDL_ROSTER_MEMBER_TABLE} (
       batch_id, provider, provider_player_id, provider_team_id, team_abbreviation
     )
     SELECT $1::uuid, $2, player_id, team_id, abbreviation
     FROM unnest($3::text[], $4::text[], $5::text[]) AS row(player_id, team_id, abbreviation)`;

  for (const sql of [selectBatch, selectMembers, insertBatch, insertMembers, 'BEGIN', 'COMMIT', 'ROLLBACK']) {
    assertSafeSql(sql);
  }

  await client.query('BEGIN');
  try {
    const existing = await client.query(selectBatch, [BDL_ROSTER_PROVIDER, input.collectedAt]);
    if (existing.rows.length > 0) {
      const storedId = String(existing.rows[0]?.batch_id ?? '');
      const stored = await client.query(selectMembers, [storedId]);
      const storedKey = membershipKey(stored.rows.map((row) => ({
        providerPlayerId: String(row.provider_player_id),
        providerTeamId: String(row.provider_team_id),
        teamAbbreviation: String(row.team_abbreviation),
      })));
      if (storedKey === membershipKey(input.players)) {
        await client.query('COMMIT');
        return { written: false, reason: 'already_stored', batchId: storedId };
      }
      await client.query('ROLLBACK');
      return { written: false, reason: 'conflict_existing', batchId: storedId };
    }

    await client.query(insertBatch, [
      batchId,
      BDL_ROSTER_PROVIDER,
      input.seasonLabel,
      input.collectedAt,
      snapshotDate,
      BDL_ACTIVE_ROSTER_ENDPOINT,
      input.requestCount,
      input.pageCount,
      input.players.length,
      input.minTeamSize,
      input.maxTeamSize,
      BDL_ROSTER_COMPLETENESS,
    ]);
    await client.query(insertMembers, [
      batchId,
      BDL_ROSTER_PROVIDER,
      input.players.map((player) => player.providerPlayerId),
      input.players.map((player) => player.providerTeamId),
      input.players.map((player) => player.teamAbbreviation),
    ]);
    await client.query('COMMIT');
    return { written: true, reason: 'apply', batchId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
