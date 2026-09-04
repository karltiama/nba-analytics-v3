/**
 * Phase 2.T.2B — Apply roster schema + populate 2025–26 observations/stints.
 *
 * Usage:
 *   npx tsx scripts/roster/populate-stints-2025-26.ts
 *   npx tsx scripts/roster/populate-stints-2025-26.ts --dry-run
 *   npx tsx scripts/roster/populate-stints-2025-26.ts --schema-only
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { parseSeasonStartYear } from '../../lib/season';
import {
  buildResolverIndex,
  resolveRosterIdentity,
  type AnalyticsPlayerCandidate,
  type ProviderMapRow,
  type RosterObservation,
} from '../../lib/roster/identity-resolver';
import {
  assertSingleOpenPerPlayerSeason,
  planStintSync,
  type ExistingStint,
  type ObservedMembership,
  type StintMutation,
} from '../../lib/roster/stint-sync';

const SEASON_LABEL = '2025-26';
const ANALYTICS_SEASON = parseSeasonStartYear(SEASON_LABEL)!;
const SOURCE = 'nba_stats';
const OUT_DIR = path.join(process.cwd(), 'reports', 'roster');
const SCHEMA_PATH = path.join(
  process.cwd(),
  'db',
  'schemas',
  'analytics_roster_stints.sql'
);

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const SCHEMA_ONLY = args.has('--schema-only');

function writeJson(name: string, data: unknown) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Wrote ${p}`);
}

async function applySchema(client: PoolClient) {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  await client.query(sql);
  console.log(`Applied schema ${SCHEMA_PATH}`);
}

async function applyMutations(client: PoolClient, mutations: StintMutation[]) {
  for (const m of mutations) {
    if (m.type === 'close') {
      await client.query(
        `
        UPDATE analytics.player_team_stints
        SET observed_to = $2::date, updated_at = now()
        WHERE stint_id = $1 AND observed_to IS NULL
        `,
        [m.stintId, m.observedTo]
      );
    } else if (m.type === 'touch') {
      await client.query(
        `
        UPDATE analytics.player_team_stints
        SET jersey = $2,
            position = $3,
            membership_type = COALESCE($4, membership_type),
            source_player_id = COALESCE($5, source_player_id),
            updated_at = now()
        WHERE stint_id = $1 AND observed_to IS NULL
        `,
        [m.stintId, m.jersey, m.position, m.membershipType, m.sourcePlayerId]
      );
    } else if (m.type === 'open') {
      await client.query(
        `
        INSERT INTO analytics.player_team_stints (
          season, player_id, team_id, observed_from, observed_to,
          source, source_player_id, jersey, position, membership_type
        ) VALUES ($1,$2,$3,$4::date,NULL,$5,$6,$7,$8,$9)
        ON CONFLICT (player_id, team_id, season, observed_from) DO UPDATE SET
          jersey = EXCLUDED.jersey,
          position = EXCLUDED.position,
          membership_type = COALESCE(EXCLUDED.membership_type, analytics.player_team_stints.membership_type),
          source_player_id = COALESCE(EXCLUDED.source_player_id, analytics.player_team_stints.source_player_id),
          updated_at = now()
        WHERE analytics.player_team_stints.observed_to IS NULL
        `,
        [
          m.season,
          m.playerId,
          m.teamId,
          m.observedFrom,
          m.source,
          m.sourcePlayerId,
          m.jersey,
          m.position,
          m.membershipType,
        ]
      );
    }
  }
}

async function main() {
  const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });
  const client = await pool.connect();

  try {
    await applySchema(client);
    if (SCHEMA_ONLY) {
      console.log('Schema-only complete.');
      return;
    }

    const snapshotAt = new Date();
    const snapshotDate = snapshotAt.toISOString().slice(0, 10);

    const roster = await client.query<{
      player_id: string;
      full_name: string;
      team_id: string;
      abbreviation: string;
      jersey: string | null;
      position: string | null;
      active: boolean | null;
      nba_team_provider_id: string | null;
    }>(
      `
      SELECT ptr.player_id, p.full_name, ptr.team_id, t.abbreviation,
             ptr.jersey, p.position, ptr.active,
             (
               SELECT m.provider_id
               FROM provider_id_map m
               WHERE m.entity_type = 'team'
                 AND m.provider = 'nba'
                 AND m.internal_id = ptr.team_id
               LIMIT 1
             ) AS nba_team_provider_id
      FROM player_team_rosters ptr
      JOIN players p ON p.player_id = ptr.player_id
      JOIN teams t ON t.team_id = ptr.team_id
      WHERE ptr.season = $1
      ORDER BY t.abbreviation, p.full_name
      `,
      [SEASON_LABEL]
    );

    // --- Raw observations (all rows, including unresolved) ---
    let rawInserted = 0;
    let rawUpdated = 0;
    if (!DRY_RUN) {
      for (const row of roster.rows) {
        const payload = {
          player_id: row.player_id,
          full_name: row.full_name,
          team_id: row.team_id,
          abbreviation: row.abbreviation,
          jersey: row.jersey,
          position: row.position,
          active: row.active,
          source: SOURCE,
        };
        const res = await client.query(
          `
          INSERT INTO raw.nba_roster_snapshots (
            snapshot_at, snapshot_date, season_label, analytics_season,
            nba_team_id, nba_player_id, player_name, team_abbreviation,
            analytics_team_id, jersey, position, roster_status,
            raw_payload
          ) VALUES (
            $1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb
          )
          ON CONFLICT (snapshot_date, season_label, nba_team_id, nba_player_id) DO UPDATE SET
            player_name = EXCLUDED.player_name,
            team_abbreviation = EXCLUDED.team_abbreviation,
            analytics_team_id = EXCLUDED.analytics_team_id,
            jersey = EXCLUDED.jersey,
            position = EXCLUDED.position,
            roster_status = EXCLUDED.roster_status,
            raw_payload = EXCLUDED.raw_payload,
            snapshot_at = EXCLUDED.snapshot_at
          RETURNING (xmax = 0) AS inserted
          `,
          [
            snapshotAt.toISOString(),
            snapshotDate,
            SEASON_LABEL,
            ANALYTICS_SEASON,
            row.nba_team_provider_id ?? row.team_id,
            row.player_id,
            row.full_name,
            row.abbreviation,
            row.team_id,
            row.jersey,
            row.position,
            row.active == null ? null : row.active ? 'ACTIVE' : 'INACTIVE',
            JSON.stringify(payload),
          ]
        );
        if (res.rows[0]?.inserted) rawInserted += 1;
        else rawUpdated += 1;
      }
    } else {
      rawInserted = roster.rows.length;
    }

    // --- Identity resolve ---
    const maps = await client.query<{
      provider: string;
      provider_id: string;
      internal_id: string;
    }>(
      `
      SELECT provider, provider_id, internal_id
      FROM provider_id_map
      WHERE entity_type = 'player' AND provider IN ('nba', 'balldontlie')
      `
    );
    const analytics = await client.query<{
      player_id: string;
      full_name: string;
      position: string | null;
    }>(`SELECT player_id, full_name, position FROM analytics.players`);
    const pglTeams = await client.query<{ player_id: string; abbreviation: string }>(
      `
      SELECT DISTINCT pgl.player_id, t.abbreviation
      FROM analytics.player_game_logs pgl
      JOIN analytics.teams t ON t.team_id = pgl.team_id
      WHERE pgl.season = $1
      `,
      [ANALYTICS_SEASON]
    );
    const pglByPlayer = new Map<string, string[]>();
    for (const r of pglTeams.rows) {
      const list = pglByPlayer.get(r.player_id) ?? [];
      list.push(r.abbreviation);
      pglByPlayer.set(r.player_id, list);
    }

    const index = buildResolverIndex({
      providerMaps: maps.rows.map((r) => ({
        provider: r.provider as 'nba' | 'balldontlie',
        providerId: r.provider_id,
        internalId: r.internal_id,
      })) as ProviderMapRow[],
      analyticsPlayers: analytics.rows.map(
        (r): AnalyticsPlayerCandidate => ({
          playerId: r.player_id,
          fullName: r.full_name,
          position: r.position,
          pglTeamAbbrevs: pglByPlayer.get(r.player_id) ?? [],
        })
      ),
    });

    const skipped: Array<Record<string, unknown>> = [];
    const observations: ObservedMembership[] = [];
    const resolvedPairs: Array<{ nbaPlayerId: string; analyticsPlayerId: string; team: string; name: string }> =
      [];

    for (const row of roster.rows) {
      const obs: RosterObservation = {
        nbaPlayerId: row.player_id,
        fullName: row.full_name,
        teamAbbr: row.abbreviation,
        teamInternalId: row.team_id,
        jersey: row.jersey,
        position: row.position,
        season: SEASON_LABEL,
      };
      const resolved = resolveRosterIdentity(obs, index);
      if (
        resolved.status !== 'provider_match' &&
        resolved.status !== 'safe_fallback_match'
      ) {
        skipped.push({
          nba_player_id: row.player_id,
          name: row.full_name,
          team: row.abbreviation,
          status: resolved.status,
          gap_cause: resolved.gapCause,
          reason: resolved.reason,
        });
        continue;
      }
      resolvedPairs.push({
        nbaPlayerId: row.player_id,
        analyticsPlayerId: resolved.analyticsPlayerId!,
        team: row.abbreviation,
        name: row.full_name,
      });
      observations.push({
        playerId: resolved.analyticsPlayerId!,
        teamId: row.team_id,
        sourcePlayerId: row.player_id,
        jersey: row.jersey,
        position: row.position,
        membershipType: 'standard',
      });
    }

    const byAnalytics = new Map<string, typeof resolvedPairs>();
    for (const p of resolvedPairs) {
      const list = byAnalytics.get(p.analyticsPlayerId) ?? [];
      list.push(p);
      byAnalytics.set(p.analyticsPlayerId, list);
    }
    const duplicateAnalyticsResolutions = [...byAnalytics.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([analyticsPlayerId, list]) => ({ analyticsPlayerId, rows: list }));

    const openRows = await client.query<{
      stint_id: number;
      player_id: string;
      team_id: string;
      season: string;
      observed_from: string;
      observed_to: string | null;
      jersey: string | null;
      position: string | null;
      source: string;
      source_player_id: string | null;
    }>(
      `
      SELECT stint_id, player_id, team_id, season,
             observed_from::text, observed_to::text,
             jersey, position, source, source_player_id
      FROM analytics.player_team_stints
      WHERE season = $1 AND observed_to IS NULL
      `,
      [ANALYTICS_SEASON]
    );

    const existingOpen: ExistingStint[] = openRows.rows.map((r) => ({
      stintId: Number(r.stint_id),
      playerId: r.player_id,
      teamId: r.team_id,
      season: r.season,
      observedFrom: r.observed_from.slice(0, 10),
      observedTo: r.observed_to ? r.observed_to.slice(0, 10) : null,
      jersey: r.jersey,
      position: r.position,
      source: r.source,
      sourcePlayerId: r.source_player_id,
    }));

    const mutations = planStintSync({
      season: ANALYTICS_SEASON,
      observedOn: snapshotDate,
      source: SOURCE,
      observations,
      existingOpenStints: existingOpen,
    });
    assertSingleOpenPerPlayerSeason(mutations, existingOpen, ANALYTICS_SEASON);

    if (!DRY_RUN) {
      await client.query('BEGIN');
      try {
        await applyMutations(client, mutations);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }

    const counts = await client.query<{
      team_id: string;
      abbreviation: string;
      n: number;
    }>(
      `
      SELECT s.team_id, t.abbreviation, count(*)::int AS n
      FROM analytics.team_roster_current s
      JOIN analytics.teams t ON t.team_id = s.team_id
      WHERE s.season = $1
      GROUP BY s.team_id, t.abbreviation
      ORDER BY t.abbreviation
      `,
      [ANALYTICS_SEASON]
    );

    const openDup = await client.query<{ n: number }>(
      `
      SELECT count(*)::int AS n FROM (
        SELECT player_id FROM analytics.player_team_stints
        WHERE season = $1 AND observed_to IS NULL
        GROUP BY player_id HAVING count(*) > 1
      ) d
      `,
      [ANALYTICS_SEASON]
    );

    const totalOpen = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM analytics.player_team_stints
       WHERE season = $1 AND observed_to IS NULL`,
      [ANALYTICS_SEASON]
    );

    const rawCount = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM raw.nba_roster_snapshots
       WHERE snapshot_date = $1::date AND season_label = $2`,
      [snapshotDate, SEASON_LABEL]
    );

    const report = {
      dry_run: DRY_RUN,
      snapshot_at: snapshotAt.toISOString(),
      snapshot_date: snapshotDate,
      season_label: SEASON_LABEL,
      analytics_season: ANALYTICS_SEASON,
      note:
        'observed_from/observed_to are roster observation dates, not exact signing/trade timestamps. Single-snapshot rehearsal does not reconstruct midseason history.',
      roster_rows_from_public: roster.rows.length,
      raw_snapshot_rows_today: rawCount.rows[0]?.n ?? 0,
      raw_inserted: rawInserted,
      raw_updated: rawUpdated,
      resolved_for_stints: observations.length,
      unique_analytics_players: byAnalytics.size,
      duplicate_analytics_resolutions: duplicateAnalyticsResolutions,
      skipped_unresolved_or_ambiguous: skipped.length,
      skipped,
      mutations: {
        open: mutations.filter((m) => m.type === 'open').length,
        touch: mutations.filter((m) => m.type === 'touch').length,
        close: mutations.filter((m) => m.type === 'close').length,
      },
      open_stints_total: totalOpen.rows[0]?.n ?? 0,
      players_with_multiple_open_stints: openDup.rows[0]?.n ?? 0,
      teams_represented: counts.rows.length,
      team_counts: Object.fromEntries(counts.rows.map((r) => [r.abbreviation, r.n])),
    };

    writeJson('2025-26-stint-populate-report.json', report);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
