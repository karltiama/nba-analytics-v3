/**
 * Read-only dry run of the stored 2026-10-12 BallDontLie roster batch.
 *
 *   npx tsx scripts/roster/dry-run-stored-roster.ts
 *
 * Selects from Postgres. Does not INSERT, UPDATE, or call a provider.
 * Writes a summary JSON next to this file. Applying that plan is a separate step.
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import {
  planStoredRosterReconcile,
  type OpenRosterStint,
  type RosterIdentityCandidate,
  type StoredBatchMember,
} from '../../lib/roster/stored-roster-reconcile';

const BATCH_DATE = '2026-10-12';
const SEASON_LABEL = '2026-27';
const OUT = path.join(process.cwd(), 'scripts', 'roster', 'october-2026-roster-dry-run.json');

const SELECTS = {
  batch: `
    SELECT batch_id::text, snapshot_date::text, season_label, player_count
    FROM raw.roster_observation_batches
    WHERE provider = 'balldontlie'
      AND season_label = $1
      AND snapshot_date = $2::date
  `,
  members: `
    SELECT provider_player_id, team_abbreviation
    FROM raw.roster_observation_members
    WHERE batch_id = $1::uuid
  `,
  providerIds: `
    SELECT provider_player_id, player_entity_id::text AS player_entity_id
    FROM analytics.player_provider_ids
    WHERE provider = 'balldontlie'
  `,
  players: `
    SELECT player_id, player_entity_id::text AS player_entity_id, full_name
    FROM analytics.players
    WHERE player_entity_id IS NOT NULL
  `,
  stints: `
    SELECT stint_id, player_entity_id::text AS player_entity_id, player_id,
           team_id, season, observed_from::text AS observed_from
    FROM analytics.player_team_stints
    WHERE season = '2026' AND observed_to IS NULL
  `,
  teams: `
    SELECT team_id, abbreviation
    FROM analytics.teams
  `,
  trey: `
    SELECT pl.full_name, pl.player_id, pl.player_entity_id::text AS player_entity_id,
           t.abbreviation AS open_2026_team
    FROM analytics.players pl
    LEFT JOIN analytics.player_team_stints s
      ON s.player_entity_id = pl.player_entity_id
     AND s.season = '2026'
     AND s.observed_to IS NULL
    LEFT JOIN analytics.teams t ON t.team_id = s.team_id
    WHERE pl.player_id = '1028203085'
  `,
} as const;

function assertSelectOnly(sql: string): void {
  if (!/^\s*select\b/i.test(sql)) throw new Error('Refusing non-SELECT');
  if (/\b(insert|update|delete|alter|drop|truncate|grant|copy)\b/i.test(sql)) {
    throw new Error('Refusing a statement that is not a plain SELECT');
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error('SUPABASE_DB_URL is not set');
  for (const sql of Object.values(SELECTS)) assertSelectOnly(sql);

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const batch = await pool.query(SELECTS.batch, [SEASON_LABEL, BATCH_DATE]);
    if (batch.rows.length !== 1) {
      throw new Error(`Expected one ${BATCH_DATE} batch, found ${batch.rows.length}`);
    }
    const batchId = String(batch.rows[0].batch_id);
    const [members, providerIds, players, stints, teams, trey] = await Promise.all([
      pool.query(SELECTS.members, [batchId]),
      pool.query(SELECTS.providerIds),
      pool.query(SELECTS.players),
      pool.query(SELECTS.stints),
      pool.query(SELECTS.teams),
      pool.query(SELECTS.trey),
    ]);

    const nameByEntity = new Map<string, { playerId: string; fullName: string | null }>();
    for (const row of players.rows) {
      nameByEntity.set(String(row.player_entity_id), {
        playerId: String(row.player_id),
        fullName: row.full_name == null ? null : String(row.full_name),
      });
    }

    const identities: RosterIdentityCandidate[] = [];
    for (const row of providerIds.rows) {
      const entityId = String(row.player_entity_id);
      const providerPlayerId = String(row.provider_player_id);
      const named = nameByEntity.get(entityId);
      identities.push({
        providerPlayerId,
        playerEntityId: entityId,
        playerId: named && named.playerId === providerPlayerId ? named.playerId : null,
        fullName: named?.fullName ?? null,
      });
    }
    const mapped = new Set(identities.map((row) => `${row.providerPlayerId}|${row.playerEntityId}`));
    for (const row of players.rows) {
      const providerPlayerId = String(row.player_id);
      const playerEntityId = String(row.player_entity_id);
      const key = `${providerPlayerId}|${playerEntityId}`;
      if (mapped.has(key)) continue;
      identities.push({
        providerPlayerId,
        playerEntityId,
        playerId: providerPlayerId,
        fullName: row.full_name == null ? null : String(row.full_name),
      });
    }

    const memberRows: StoredBatchMember[] = members.rows.map((row) => ({
      providerPlayerId: String(row.provider_player_id),
      teamAbbr: String(row.team_abbreviation ?? ''),
    }));
    const openStints: OpenRosterStint[] = stints.rows.map((row) => ({
      stintId: Number(row.stint_id),
      playerEntityId: String(row.player_entity_id),
      playerId: row.player_id == null ? null : String(row.player_id),
      teamId: String(row.team_id),
      season: String(row.season),
      observedFrom: String(row.observed_from).slice(0, 10),
    }));

    const plan = planStoredRosterReconcile({
      season: '2026',
      observedOn: BATCH_DATE,
      members: memberRows,
      identities,
      openStints,
      teams: teams.rows.map((row) => ({
        teamId: String(row.team_id),
        abbreviation: String(row.abbreviation),
      })),
    });

    const teamAbbr = new Map(teams.rows.map((row) => [String(row.team_id), String(row.abbreviation)]));
    const exclusionCounts: Record<string, number> = {};
    for (const row of plan.exclusions) {
      exclusionCounts[row.kind] = (exclusionCounts[row.kind] ?? 0) + 1;
    }
    const treyRow = trey.rows[0] ?? null;
    const treyEntity = treyRow ? String(treyRow.player_entity_id) : null;
    const treyInWrites =
      plan.teamChanges.some((row) => row.playerEntityId === treyEntity) ||
      plan.opens.some((row) => row.playerEntityId === treyEntity);

    const summary = {
      batchId,
      snapshotDate: BATCH_DATE,
      seasonLabel: SEASON_LABEL,
      batchPlayers: members.rows.length,
      open2026Stints: openStints.length,
      unchanged: plan.unchanged,
      teamChanges: plan.teamChanges.map((row) => ({
        fullName: row.fullName,
        providerPlayerId: row.providerPlayerId,
        playerEntityId: row.playerEntityId,
        from: teamAbbr.get(row.fromTeamId) ?? row.fromTeamId,
        to: row.toTeamAbbr,
        closeStintId: row.stintId,
        closeObservedTo: row.closeObservedTo,
        openObservedFrom: row.openObservedFrom,
      })),
      opens: plan.opens.map((row) => ({
        fullName: row.fullName,
        providerPlayerId: row.providerPlayerId,
        playerEntityId: row.playerEntityId,
        team: row.teamAbbr,
        observedFrom: row.observedFrom,
      })),
      exclusionCounts,
      preparedAbsenceCloses: plan.preparedAbsenceCloses,
      massCloseIfAbsenceWereApplied: plan.massCloseIfAbsenceWereApplied,
      treyAlexander: treyRow
        ? {
            fullName: treyRow.full_name,
            playerId: treyRow.player_id,
            open2026Team: treyRow.open_2026_team,
            includedInPreparedWrites: treyInWrites,
          }
        : null,
      writes: {
        season: plan.season,
        source: plan.source,
        closes: plan.teamChanges.length,
        inserts: plan.teamChanges.length + plan.opens.length,
        tables: ['analytics.player_team_stints'],
        forbiddenTables: [
          'analytics.players',
          'analytics.player_game_logs',
          'analytics.player_season_averages',
          'analytics.player_props_current',
          'raw.player_prop_snapshots_v2',
        ],
      },
    };

    fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({
      unchanged: summary.unchanged,
      teamChanges: summary.teamChanges.length,
      opens: summary.opens.length,
      exclusionCounts: summary.exclusionCounts,
      massCloseOk: summary.massCloseIfAbsenceWereApplied.ok,
      trey: summary.treyAlexander,
      out: OUT,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
