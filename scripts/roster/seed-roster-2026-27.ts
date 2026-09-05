/**
 * Phase 2.T.2D.2 — Apply 2026–27 canonical roster seed (entity-first).
 *
 * Usage:
 *   npx tsx scripts/roster/seed-roster-2026-27.ts --dry-run
 *   npx tsx scripts/roster/seed-roster-2026-27.ts --apply
 *
 * Does NOT close 2025 stints, resolve Class D, modify TeamRoster UI,
 * or change Production season/freeze/live-ingestion config.
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import {
  EXPECTED_CLASS_D_2026,
  SEED_2026_SEASON,
  SEED_2026_SOURCE,
  SEED_2026_WRITES_2025,
  assertIntegrityGate,
  assertIntegrityGateFirstApply,
  classifyCrossSeason,
  planEntity2026SeedMutations,
  wilsonPippenSeedExpectations,
  type ExistingOpenStint2026,
  type SeedMutation,
} from '../../lib/roster/entity-2026-seed';
import {
  buildEntityResolverIndex,
  resolveRosterToEntity,
  type EntityProviderRow,
  type EntityRow,
} from '../../lib/roster/entity-roster-resolve';
import {
  PIPPEN_BDL_ID,
  WILSON_BDL_ID,
} from '../../lib/roster/identity-integrity';
import type { RosterObservation } from '../../lib/roster/identity-resolver';

const OUT = path.join(process.cwd(), 'reports', 'roster');
const FETCH_PATH = path.join(OUT, '2026-27-nba-fetch.json');

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply') && !args.has('--dry-run');
const MODE = APPLY ? 'apply' : 'dry-run';

function writeJson(name: string, data: unknown) {
  fs.mkdirSync(OUT, { recursive: true });
  const p = path.join(OUT, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Wrote ${p}`);
}

async function loadResolveResults(client: PoolClient) {
  const fetch = JSON.parse(fs.readFileSync(FETCH_PATH, 'utf8')) as {
    fetched_at: string;
    total_roster_players: number;
    players: Array<{
      nba_player_id: string;
      player_name: string;
      team_abbreviation: string;
      analytics_team_id: string;
      jersey: string | null;
      position: string | null;
    }>;
  };

  const observedOn = fetch.fetched_at.slice(0, 10);

  const entities = await client.query<{
    player_entity_id: string;
    display_name: string;
    first_name: string | null;
    last_name: string | null;
    position: string | null;
  }>(
    `SELECT player_entity_id::text, display_name, first_name, last_name, position
     FROM analytics.player_entities`
  );
  const providers = await client.query<{
    player_entity_id: string;
    provider: string;
    provider_player_id: string;
  }>(
    `SELECT player_entity_id::text, provider, provider_player_id
     FROM analytics.player_provider_ids
     WHERE provider IN ('nba', 'balldontlie')`
  );
  const teams = await client.query<{ team_id: string; abbreviation: string }>(
    `SELECT team_id, abbreviation FROM analytics.teams WHERE length(abbreviation)=3`
  );
  const analyticsIds = await client.query<{ player_id: string }>(
    `SELECT player_id FROM analytics.players`
  );

  const teamIdByAbbr = new Map(
    teams.rows.map((t) => [t.abbreviation, t.team_id])
  );
  const index = buildEntityResolverIndex({
    entities: entities.rows.map(
      (e): EntityRow => ({
        playerEntityId: e.player_entity_id,
        displayName: e.display_name,
        firstName: e.first_name,
        lastName: e.last_name,
        position: e.position,
      })
    ),
    providerRows: providers.rows.map(
      (p): EntityProviderRow => ({
        playerEntityId: p.player_entity_id,
        provider: p.provider as 'nba' | 'balldontlie',
        providerPlayerId: p.provider_player_id,
      })
    ),
  });

  const results = fetch.players.map((p) => {
    const obs: RosterObservation = {
      nbaPlayerId: p.nba_player_id,
      fullName: p.player_name,
      teamAbbr: p.team_abbreviation,
      teamInternalId: p.analytics_team_id,
      jersey: p.jersey,
      position: p.position,
      season: '2026-27',
    };
    return resolveRosterToEntity(obs, index);
  });

  return {
    fetch,
    observedOn,
    results,
    teamIdByAbbr,
    analyticsPlayerIds: new Set(analyticsIds.rows.map((r) => r.player_id)),
  };
}

async function loadExistingOpen2026(
  client: PoolClient
): Promise<ExistingOpenStint2026[]> {
  const r = await client.query<{
    stint_id: number;
    player_entity_id: string;
    player_id: string | null;
    team_id: string;
    observed_from: string;
    source_player_id: string | null;
    jersey: string | null;
    position: string | null;
  }>(
    `
    SELECT stint_id, player_entity_id::text, player_id, team_id,
           observed_from::text, source_player_id, jersey, position
    FROM analytics.player_team_stints
    WHERE season = $1 AND observed_to IS NULL
    `,
    [SEED_2026_SEASON]
  );
  return r.rows.map((row) => ({
    stintId: row.stint_id,
    playerEntityId: row.player_entity_id,
    playerId: row.player_id,
    teamId: row.team_id,
    observedFrom: row.observed_from,
    sourcePlayerId: row.source_player_id,
    jersey: row.jersey,
    position: row.position,
  }));
}

async function applyMutations(client: PoolClient, mutations: SeedMutation[]) {
  let opened = 0;
  let touched = 0;
  for (const m of mutations) {
    if (m.type === 'open') {
      await client.query(
        `
        INSERT INTO analytics.player_team_stints (
          season, player_entity_id, player_id, team_id,
          observed_from, observed_to, source, source_player_id,
          jersey, position, membership_type
        ) VALUES (
          $1, $2::uuid, $3, $4, $5::date, NULL, $6, $7, $8, $9, $10
        )
        `,
        [
          m.season,
          m.playerEntityId,
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
      opened += 1;
    } else if (m.type === 'touch') {
      await client.query(
        `
        UPDATE analytics.player_team_stints
        SET jersey = $2,
            position = $3,
            updated_at = now()
        WHERE stint_id = $1
          AND observed_to IS NULL
          AND season = $4
        `,
        [m.stintId, m.jersey, m.position, SEED_2026_SEASON]
      );
      touched += 1;
    }
  }
  return { opened, touched };
}

async function validateAfter(client: PoolClient) {
  const open2026 = await client.query<{
    total: number;
    with_bdl: number;
    nba_only: number;
    teams: number;
    dup_entities: number;
    multi_team_entities: number;
    missing_display: number;
  }>(
    `
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE s.player_id IS NOT NULL)::int AS with_bdl,
      count(*) FILTER (WHERE s.player_id IS NULL)::int AS nba_only,
      count(DISTINCT s.team_id)::int AS teams,
      (
        SELECT count(*)::int FROM (
          SELECT player_entity_id FROM analytics.player_team_stints
          WHERE season='2026' AND observed_to IS NULL
          GROUP BY player_entity_id HAVING count(*)>1
        ) d
      ) AS dup_entities,
      (
        SELECT count(*)::int FROM (
          SELECT player_entity_id FROM analytics.player_team_stints
          WHERE season='2026' AND observed_to IS NULL
          GROUP BY player_entity_id HAVING count(DISTINCT team_id)>1
        ) m
      ) AS multi_team_entities,
      (
        SELECT count(*)::int
        FROM analytics.team_roster_current c
        WHERE c.season='2026' AND (c.display_name IS NULL OR c.display_name='')
      ) AS missing_display
    FROM analytics.player_team_stints s
    WHERE s.season='2026' AND s.observed_to IS NULL
    `
  );

  const view = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM analytics.team_roster_current WHERE season='2026'`
  );

  const byTeam = await client.query<{
    abbreviation: string;
    total: number;
    bdl: number;
    nba_only: number;
  }>(
    `
    SELECT t.abbreviation,
           count(*)::int AS total,
           count(*) FILTER (WHERE s.player_id IS NOT NULL)::int AS bdl,
           count(*) FILTER (WHERE s.player_id IS NULL)::int AS nba_only
    FROM analytics.player_team_stints s
    JOIN analytics.teams t ON t.team_id = s.team_id
    WHERE s.season='2026' AND s.observed_to IS NULL
    GROUP BY t.abbreviation
    ORDER BY t.abbreviation
    `
  );

  const hist2025 = await client.query<{
    total: number;
    open: number;
    closed: number;
    multi_stint: number;
    multi_open: number;
  }>(
    `
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE observed_to IS NULL)::int AS open,
      count(*) FILTER (WHERE observed_to IS NOT NULL)::int AS closed,
      (SELECT count(*)::int FROM (
         SELECT player_entity_id FROM analytics.player_team_stints
         WHERE season='2025' AND player_entity_id IS NOT NULL
         GROUP BY player_entity_id HAVING count(*)>1
       ) x)::int AS multi_stint,
      (SELECT count(*)::int FROM (
         SELECT player_entity_id FROM analytics.player_team_stints
         WHERE season='2025' AND observed_to IS NULL AND player_entity_id IS NOT NULL
         GROUP BY player_entity_id HAVING count(*)>1
       ) y)::int AS multi_open
    FROM analytics.player_team_stints
    WHERE season='2025'
    `
  );

  const open2025 = await client.query<{
    player_entity_id: string;
    team_id: string;
  }>(
    `SELECT player_entity_id::text, team_id FROM analytics.player_team_stints
     WHERE season='2025' AND observed_to IS NULL`
  );
  const open2026Rows = await client.query<{
    player_entity_id: string;
    team_id: string;
  }>(
    `SELECT player_entity_id::text, team_id FROM analytics.player_team_stints
     WHERE season='2026' AND observed_to IS NULL`
  );
  const cross = classifyCrossSeason({
    open2025: open2025.rows.map((r) => ({
      playerEntityId: r.player_entity_id,
      teamId: r.team_id,
    })),
    open2026: open2026Rows.rows.map((r) => ({
      playerEntityId: r.player_entity_id,
      teamId: r.team_id,
    })),
  });

  const ids = wilsonPippenSeedExpectations();
  const wp = await client.query<{
    season: string;
    player_id: string | null;
    abbreviation: string;
    display_name: string;
    nba_id: string | null;
  }>(
    `
    SELECT s.season, s.player_id, t.abbreviation, e.display_name,
           s.source_player_id AS nba_id
    FROM analytics.player_team_stints s
    JOIN analytics.teams t ON t.team_id = s.team_id
    JOIN analytics.player_entities e ON e.player_entity_id = s.player_entity_id
    WHERE s.observed_to IS NULL
      AND s.player_id IN ($1, $2)
    ORDER BY s.player_id, s.season
    `,
    [WILSON_BDL_ID, PIPPEN_BDL_ID]
  );

  const nbaOnlyInView = await client.query<{ n: number }>(
    `
    SELECT count(*)::int AS n
    FROM analytics.team_roster_current
    WHERE season='2026' AND player_id IS NULL
    `
  );

  const fabricated = await client.query<{
    seed_tagged_bdl_maps: number;
    nba_only_stints_with_player_id: number;
  }>(
    `
    SELECT
      (
        SELECT count(*)::int FROM analytics.player_provider_ids
        WHERE provider='balldontlie'
          AND metadata->>'source' = 'phase2_t2d_2_roster_seed'
      ) AS seed_tagged_bdl_maps,
      (
        SELECT count(*)::int FROM analytics.player_team_stints s
        WHERE s.season='2026'
          AND s.observed_to IS NULL
          AND s.player_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM analytics.players p WHERE p.player_id = s.player_id
          )
      ) AS nba_only_stints_with_player_id
    `
  );

  return {
    open2026: open2026.rows[0],
    view_count: view.rows[0]?.n ?? 0,
    by_team: byTeam.rows,
    hist2025: hist2025.rows[0],
    cross,
    wilson_pippen: wp.rows,
    nba_only_in_view: nbaOnlyInView.rows[0]?.n ?? 0,
    fabrication: fabricated.rows[0],
    expected_nba_ids: ids,
  };
}

async function main() {
  if (SEED_2026_WRITES_2025) {
    throw new Error('Must not mutate 2025 stints in 2.T.2D.2');
  }

  const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });
  const client = await pool.connect();

  try {
    const { fetch, observedOn, results, teamIdByAbbr, analyticsPlayerIds } =
      await loadResolveResults(client);

    const existing = await loadExistingOpen2026(client);
    const planned = planEntity2026SeedMutations({
      observedOn,
      results,
      teamIdByAbbr,
      existingOpen2026: existing,
      analyticsPlayerIds,
    });

    let gate = assertIntegrityGate({
      results,
      stints2026Before: existing.length,
      duplicateEntityCount: planned.duplicateEntities.length,
      multiTeamNbaIds: planned.multiTeamNbaIds,
    });
    if (existing.length === 0) {
      gate = assertIntegrityGateFirstApply(gate);
    }

    if (!gate.ok) {
      writeJson('2026-27-roster-seed-BLOCKED.json', {
        mode: MODE,
        gate,
        expected_class_d: EXPECTED_CLASS_D_2026,
      });
      throw new Error(`Pre-apply integrity gate failed: ${gate.failures.join('; ')}`);
    }

    let mutationResult = { opened: 0, touched: 0 };
    if (APPLY) {
      await client.query('BEGIN');
      try {
        mutationResult = await applyMutations(client, planned.mutations);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }

    // Idempotent second pass (apply only) to measure rerun
    let rerun = { opened: 0, touched: 0, plan_counts: planned.counts };
    if (APPLY) {
      const existing2 = await loadExistingOpen2026(client);
      const planned2 = planEntity2026SeedMutations({
        observedOn,
        results,
        teamIdByAbbr,
        existingOpen2026: existing2,
        analyticsPlayerIds,
      });
      await client.query('BEGIN');
      try {
        rerun = {
          ...(await applyMutations(client, planned2.mutations)),
          plan_counts: planned2.counts,
        };
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }

    const validation = APPLY
      ? await validateAfter(client)
      : { note: 'Validation after apply only' };

    const skipAmbiguous = planned.mutations.filter(
      (m) => m.type === 'skip_ambiguous'
    );

    const classDReport = {
      phase: '2.T.2D.2',
      note: 'Class D skipped after seed — fail-closed; identities not invented.',
      count: skipAmbiguous.length,
      expected: EXPECTED_CLASS_D_2026,
      rows: skipAmbiguous.map((m) => ({
        nba_player_id: m.nbaPlayerId,
        name: m.fullName,
        team: m.teamAbbr,
        reason: m.reason,
        candidates: 'candidates' in m ? m.candidates : [],
        action: 'skip_ambiguous',
      })),
    };

    const report = {
      phase: '2.T.2D.2',
      mode: MODE,
      source: {
        fetch_path: FETCH_PATH,
        fetched_at: fetch.fetched_at,
        observed_from: observedOn,
        season_label: '2026-27',
        analytics_season: SEED_2026_SEASON,
        source: SEED_2026_SOURCE,
        observation_count: fetch.total_roster_players,
      },
      pre_apply_gate: gate,
      plan_counts: planned.counts,
      first_run: mutationResult,
      rerun,
      validation,
      out_of_scope: {
        no_2025_mutation: true,
        no_class_d_auto_resolve: true,
        no_team_roster_ui: true,
        no_production_config: true,
        no_live_bdl: true,
      },
      trustworthy_for_ui_refresh:
        APPLY &&
        typeof validation === 'object' &&
        'open2026' in validation &&
        validation.open2026?.total === 578 &&
        validation.open2026?.dup_entities === 0 &&
        validation.open2026?.multi_team_entities === 0 &&
        validation.hist2025?.total === 697 &&
        validation.hist2025?.open === 514,
    };

    writeJson(
      APPLY
        ? '2026-27-roster-seed-apply.json'
        : '2026-27-roster-seed-dry-run.json',
      report
    );
    writeJson('2026-27-class-d-skipped-after-seed.json', classDReport);

    console.log(
      JSON.stringify(
        {
          mode: MODE,
          gate: {
            ok: gate.ok,
            total: gate.total,
            resolved: gate.resolved,
            ambiguous: gate.ambiguous,
          },
          plan_counts: planned.counts,
          first_run: mutationResult,
          rerun: APPLY ? rerun : null,
          open_2026:
            APPLY && typeof validation === 'object' && 'open2026' in validation
              ? validation.open2026
              : null,
          hist_2025:
            APPLY && typeof validation === 'object' && 'hist2025' in validation
              ? validation.hist2025
              : null,
          trustworthy_for_ui_refresh: report.trustworthy_for_ui_refresh,
        },
        null,
        2
      )
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
