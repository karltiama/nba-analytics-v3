/**
 * Phase 2.T.2D.1cB — Apply player entity DDL + backfill existing analytics.players.
 *
 * Usage:
 *   npx tsx scripts/roster/backfill-player-entities.ts --schema-only
 *   npx tsx scripts/roster/backfill-player-entities.ts --dry-run
 *   npx tsx scripts/roster/backfill-player-entities.ts --apply
 *
 * Does NOT create NBA-only rookies, modify stints, or seed 2026.
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import {
  ENTITY_BACKFILL_WRITES_STINTS,
  assertWilsonPippenDistinct,
  planPlayerEntityBackfill,
  provenanceMetadata,
  type AnalyticsPlayerRow,
  type EntityBackfillItem,
  type LegacyProviderMapRow,
} from '../../lib/roster/player-entity-backfill';
import {
  PIPPEN_BDL_ID,
  PIPPEN_NBA_ID,
  WILSON_BDL_ID,
  WILSON_NBA_ID,
} from '../../lib/roster/identity-integrity';

const OUT = path.join(process.cwd(), 'reports', 'roster');
const SCHEMA = path.join(
  process.cwd(),
  'db',
  'schemas',
  'analytics_player_entities.sql'
);

const args = new Set(process.argv.slice(2));
const SCHEMA_ONLY = args.has('--schema-only');
const APPLY = args.has('--apply') && !args.has('--dry-run');
const MODE = SCHEMA_ONLY ? 'schema-only' : APPLY ? 'apply' : 'dry-run';

function writeJson(name: string, data: unknown) {
  fs.mkdirSync(OUT, { recursive: true });
  const p = path.join(OUT, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Wrote ${p}`);
}

async function applySchema(client: PoolClient) {
  const sql = fs.readFileSync(SCHEMA, 'utf8');
  await client.query(sql);
  console.log(`Applied ${SCHEMA}`);
}

async function loadInputs(client: PoolClient) {
  const players = await client.query<{
    player_id: string;
    full_name: string;
    first_name: string | null;
    last_name: string | null;
    position: string | null;
    player_entity_id: string | null;
  }>(
    `
    SELECT player_id, full_name, first_name, last_name, position,
           player_entity_id::text AS player_entity_id
    FROM analytics.players
    ORDER BY player_id
    `
  );

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

  let existingProvider: Array<{
    player_entity_id: string;
    provider: string;
    provider_player_id: string;
  }> = [];
  try {
    const rows = await client.query<{
      player_entity_id: string;
      provider: string;
      provider_player_id: string;
    }>(
      `
      SELECT player_entity_id::text, provider, provider_player_id
      FROM analytics.player_provider_ids
      `
    );
    existingProvider = rows.rows;
  } catch {
    existingProvider = [];
  }

  return {
    analyticsPlayers: players.rows.map(
      (r): AnalyticsPlayerRow => ({
        playerId: r.player_id,
        fullName: r.full_name,
        firstName: r.first_name,
        lastName: r.last_name,
        position: r.position,
        playerEntityId: r.player_entity_id,
      })
    ),
    legacyMaps: maps.rows.map(
      (r): LegacyProviderMapRow => ({
        provider: r.provider as 'nba' | 'balldontlie',
        providerId: r.provider_id,
        internalId: r.internal_id,
      })
    ),
    existingProviderRows: existingProvider.map((r) => ({
      playerEntityId: r.player_entity_id,
      provider: r.provider,
      providerPlayerId: r.provider_player_id,
    })),
  };
}

async function applyPlan(client: PoolClient, items: EntityBackfillItem[]) {
  const toCreateEntities = items.filter((i) => i.createEntity);
  const toCreateBdl = items.filter((i) => i.createBdlMapping);
  const toCreateNba = items.filter(
    (i) => i.createNbaMapping && i.nbaPlayerId
  );

  const batchSize = 500;

  for (let i = 0; i < toCreateEntities.length; i += batchSize) {
    const chunk = toCreateEntities.slice(i, i + batchSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let n = 1;
    for (const item of chunk) {
      placeholders.push(
        `($${n++}::uuid, $${n++}, $${n++}, $${n++}, $${n++})`
      );
      values.push(
        item.playerEntityId,
        item.displayName,
        item.firstName,
        item.lastName,
        item.position
      );
    }
    await client.query(
      `
      INSERT INTO analytics.player_entities (
        player_entity_id, display_name, first_name, last_name, position
      ) VALUES ${placeholders.join(',')}
      ON CONFLICT (player_entity_id) DO NOTHING
      `,
      values
    );
  }

  const bdlMeta = JSON.stringify(
    provenanceMetadata({ role: 'bdl_analytics_player' })
  );
  for (let i = 0; i < toCreateBdl.length; i += batchSize) {
    const chunk = toCreateBdl.slice(i, i + batchSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let n = 1;
    for (const item of chunk) {
      placeholders.push(`($${n++}::uuid, 'balldontlie', $${n++}, true, $${n++}::jsonb)`);
      values.push(item.playerEntityId, item.analyticsPlayerId, bdlMeta);
    }
    await client.query(
      `
      INSERT INTO analytics.player_provider_ids (
        player_entity_id, provider, provider_player_id, is_primary, metadata
      ) VALUES ${placeholders.join(',')}
      ON CONFLICT (provider, provider_player_id) DO NOTHING
      `,
      values
    );
  }

  for (let i = 0; i < toCreateNba.length; i += batchSize) {
    const chunk = toCreateNba.slice(i, i + batchSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let n = 1;
    for (const item of chunk) {
      placeholders.push(
        `($${n++}::uuid, 'nba', $${n++}, false, $${n++}::jsonb)`
      );
      values.push(
        item.playerEntityId,
        item.nbaPlayerId,
        JSON.stringify(
          provenanceMetadata({
            role: 'nba_from_legacy_provider_id_map',
            analytics_player_id: item.analyticsPlayerId,
          })
        )
      );
    }
    await client.query(
      `
      INSERT INTO analytics.player_provider_ids (
        player_entity_id, provider, provider_player_id, is_primary, metadata
      ) VALUES ${placeholders.join(',')}
      ON CONFLICT (provider, provider_player_id) DO NOTHING
      `,
      values
    );
  }

  // Bulk link analytics.players → entity via provider map (idempotent)
  const link = await client.query(
    `
    UPDATE analytics.players p
    SET player_entity_id = m.player_entity_id,
        updated_at = now()
    FROM analytics.player_provider_ids m
    WHERE m.provider = 'balldontlie'
      AND m.provider_player_id = p.player_id
      AND (p.player_entity_id IS NULL OR p.player_entity_id = m.player_entity_id)
    `
  );

  return {
    entitiesCreated: toCreateEntities.length,
    bdlCreated: toCreateBdl.length,
    nbaCreated: toCreateNba.length,
    playersLinked: link.rowCount ?? 0,
  };
}

async function validationSnapshot(client: PoolClient) {
  const counts = await client.query<{
    entities: number;
    provider_rows: number;
    bdl_maps: number;
    nba_maps: number;
    players_total: number;
    players_with_entity: number;
    players_missing_entity: number;
  }>(
    `
    SELECT
      (SELECT count(*)::int FROM analytics.player_entities) AS entities,
      (SELECT count(*)::int FROM analytics.player_provider_ids) AS provider_rows,
      (SELECT count(*)::int FROM analytics.player_provider_ids WHERE provider='balldontlie') AS bdl_maps,
      (SELECT count(*)::int FROM analytics.player_provider_ids WHERE provider='nba') AS nba_maps,
      (SELECT count(*)::int FROM analytics.players) AS players_total,
      (SELECT count(*)::int FROM analytics.players WHERE player_entity_id IS NOT NULL) AS players_with_entity,
      (SELECT count(*)::int FROM analytics.players WHERE player_entity_id IS NULL) AS players_missing_entity
    `
  );

  const multiBdl = await client.query<{ player_entity_id: string; n: number }>(
    `
    SELECT player_entity_id::text, count(*)::int AS n
    FROM analytics.player_provider_ids
    WHERE provider = 'balldontlie'
    GROUP BY player_entity_id
    HAVING count(*) > 1
    `
  );
  const multiNba = await client.query<{ player_entity_id: string; n: number }>(
    `
    SELECT player_entity_id::text, count(*)::int AS n
    FROM analytics.player_provider_ids
    WHERE provider = 'nba'
    GROUP BY player_entity_id
    HAVING count(*) > 1
    `
  );

  const wilsonPippen = await client.query<{
    player_id: string;
    full_name: string;
    player_entity_id: string | null;
    nba_id: string | null;
  }>(
    `
    SELECT p.player_id, p.full_name, p.player_entity_id::text,
           nba.provider_player_id AS nba_id
    FROM analytics.players p
    LEFT JOIN analytics.player_provider_ids nba
      ON nba.player_entity_id = p.player_entity_id AND nba.provider = 'nba'
    WHERE p.player_id IN ($1, $2)
    ORDER BY p.player_id
    `,
    [WILSON_BDL_ID, PIPPEN_BDL_ID]
  );

  // Compatibility: legacy IDs still resolve in core tables
  const compat = await client.query<{
    pgl: number;
    psa: number;
    injuries: number;
    props: number;
    stints_2025: number;
    stints_2026: number;
  }>(
    `
    SELECT
      (SELECT count(*)::int FROM analytics.player_game_logs WHERE player_id = $1) AS pgl,
      (SELECT count(*)::int FROM analytics.player_season_averages WHERE player_id = $1) AS psa,
      (SELECT count(*)::int FROM analytics.player_injury_status_current WHERE player_id = $1) AS injuries,
      (SELECT count(*)::int FROM analytics.player_prop_lines WHERE player_id = $1) AS props,
      (SELECT count(*)::int FROM analytics.player_team_stints WHERE season='2025') AS stints_2025,
      (SELECT count(*)::int FROM analytics.player_team_stints WHERE season='2026') AS stints_2026
    `,
    [WILSON_BDL_ID]
  );

  // Class C rookies still absent as entities (sample: no nba-only entities without bdl)
  const nbaOnlyEntities = await client.query<{ n: number }>(
    `
    SELECT count(*)::int AS n
    FROM analytics.player_provider_ids nba
    WHERE nba.provider = 'nba'
      AND NOT EXISTS (
        SELECT 1 FROM analytics.player_provider_ids bdl
        WHERE bdl.player_entity_id = nba.player_entity_id
          AND bdl.provider = 'balldontlie'
      )
    `
  );

  const queuePath = path.join(OUT, '2026-27-manual-review-queue.json');
  let classCCount: number | null = null;
  if (fs.existsSync(queuePath)) {
    const q = JSON.parse(fs.readFileSync(queuePath, 'utf8')) as {
      rows?: Array<{ status: string; gap_cause?: string }>;
    };
    classCCount = (q.rows ?? []).filter(
      (r) =>
        r.status === 'unresolved' &&
        (r.gap_cause === 'rookie_or_new_player' ||
          r.gap_cause === 'analytics_player_absent')
    ).length;
  }

  return {
    counts: counts.rows[0],
    entities_with_multiple_bdl: multiBdl.rows,
    entities_with_multiple_nba: multiNba.rows,
    wilson_pippen: wilsonPippen.rows,
    compatibility_wilson_sample: compat.rows[0],
    nba_only_entities_without_bdl: nbaOnlyEntities.rows[0]?.n ?? 0,
    class_c_unresolved_from_queue: classCCount,
  };
}

async function main() {
  if (ENTITY_BACKFILL_WRITES_STINTS) {
    throw new Error('Entity backfill must not write stints');
  }

  const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });
  const client = await pool.connect();

  try {
    await applySchema(client);
    if (SCHEMA_ONLY) {
      console.log(JSON.stringify({ mode: MODE, schema_applied: true }, null, 2));
      return;
    }

    const inputs = await loadInputs(client);
    const plan = planPlayerEntityBackfill(inputs);
    const wilsonPippenPlan = assertWilsonPippenDistinct(plan.items);
    if (!wilsonPippenPlan.ok) {
      throw new Error(`Wilson/Pippen plan invalid: ${wilsonPippenPlan.detail}`);
    }

    const dryReport = {
      phase: '2.T.2D.1cB',
      mode: 'dry-run',
      stats: plan.stats,
      wilson_pippen: wilsonPippenPlan,
      conflict_count: plan.conflicts.length,
      sample_items: plan.items.slice(0, 10),
      note: 'No NBA-only rookies created. provider_id_map unchanged. stints unchanged.',
    };
    writeJson('player-entity-backfill-dry-run.json', dryReport);
    writeJson('player-entity-conflicts.json', {
      note: 'Fail-closed legacy conflicts; no auto-merge',
      conflicts: plan.conflicts,
    });

    if (!APPLY) {
      console.log(
        JSON.stringify(
          {
            mode: MODE,
            ...plan.stats,
            conflicts: plan.conflicts.length,
            wilson_pippen_ok: wilsonPippenPlan.ok,
          },
          null,
          2
        )
      );
      return;
    }

    await client.query('BEGIN');
    let applyResult;
    try {
      applyResult = await applyPlan(client, plan.items);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }

    // Idempotent rerun
    const inputs2 = await loadInputs(client);
    const plan2 = planPlayerEntityBackfill(inputs2);
    await client.query('BEGIN');
    let rerunResult;
    try {
      rerunResult = await applyPlan(client, plan2.items);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }

    const validation = await validationSnapshot(client);
    const coverage =
      validation.counts!.players_total === 0
        ? 0
        : Math.round(
            (validation.counts!.players_with_entity /
              validation.counts!.players_total) *
              10000
          ) / 100;

    const wilsonOk =
      validation.wilson_pippen.length === 2 &&
      validation.wilson_pippen[0]!.player_entity_id !==
        validation.wilson_pippen[1]!.player_entity_id &&
      validation.wilson_pippen.some(
        (r) =>
          r.player_id === WILSON_BDL_ID && r.nba_id === WILSON_NBA_ID
      ) &&
      validation.wilson_pippen.some(
        (r) =>
          r.player_id === PIPPEN_BDL_ID && r.nba_id === PIPPEN_NBA_ID
      );

    const applyReport = {
      phase: '2.T.2D.1cB',
      mode: 'apply',
      plan_stats: plan.stats,
      apply_result: applyResult,
      idempotent_rerun: {
        plan2_stats: plan2.stats,
        apply2: rerunResult,
        no_new_entities_on_rerun: rerunResult.entitiesCreated === 0,
        no_new_bdl_on_rerun: rerunResult.bdlCreated === 0,
        no_new_nba_on_rerun: rerunResult.nbaCreated === 0,
      },
      validation,
      coverage_pct: coverage,
      wilson_pippen_ok: wilsonOk,
      ready_for_1cC:
        coverage >= 99.9 &&
        wilsonOk &&
        validation.entities_with_multiple_bdl.length === 0 &&
        (validation.nba_only_entities_without_bdl ?? 0) === 0 &&
        validation.compatibility_wilson_sample?.stints_2026 === 0,
      out_of_scope_confirmed: {
        no_stint_schema_change: true,
        no_2026_stints: validation.compatibility_wilson_sample?.stints_2026 === 0,
        no_nba_only_rookies_created:
          (validation.nba_only_entities_without_bdl ?? 0) === 0,
        no_team_roster_ui: true,
        no_production_config: true,
        provider_id_map_unchanged: true,
      },
    };

    writeJson('player-entity-backfill-apply.json', applyReport);
    writeJson('player-entity-conflicts.json', {
      note: 'Fail-closed legacy conflicts; no auto-merge',
      conflicts: plan.conflicts,
    });

    console.log(
      JSON.stringify(
        {
          mode: MODE,
          apply_result: applyResult,
          coverage_pct: coverage,
          entities: validation.counts?.entities,
          bdl_maps: validation.counts?.bdl_maps,
          nba_maps: validation.counts?.nba_maps,
          missing_entity: validation.counts?.players_missing_entity,
          conflicts: plan.conflicts.length,
          wilson_pippen_ok: wilsonOk,
          idempotent: applyReport.idempotent_rerun,
          ready_for_1cC: applyReport.ready_for_1cC,
          class_c_queue: validation.class_c_unresolved_from_queue,
          nba_only_entities: validation.nba_only_entities_without_bdl,
          stints_2026: validation.compatibility_wilson_sample?.stints_2026,
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
