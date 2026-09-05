/**
 * Phase 2.T.2D.1cC — Entity-based stints + Class C NBA-only onboarding + 2026 re-probe.
 *
 * Usage:
 *   npx tsx scripts/roster/migrate-stints-to-entities.ts --dry-run
 *   npx tsx scripts/roster/migrate-stints-to-entities.ts --apply
 *
 * Does NOT seed 2026 stints, modify TeamRoster UI, or change Production config.
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import {
  CLASS_C_SOURCE,
  STINT_ENTITY_MIGRATE_WRITES_2026,
  assertNoFabricatedBdlInClassC,
  planClassCOnboarding,
  planEntity2026SeedDryRun,
  splitDisplayName,
  type ClassCCandidate,
} from '../../lib/roster/class-c-onboarding';
import {
  buildEntityResolverIndex,
  planAttachBdlToEntity,
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
const SCHEMA_A = path.join(
  process.cwd(),
  'db',
  'schemas',
  'analytics_roster_stints_entity.sql'
);
const FETCH_PATH = path.join(OUT, '2026-27-nba-fetch.json');
const QUEUE_PATH = path.join(OUT, '2026-27-manual-review-queue.json');

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply') && !args.has('--dry-run');
const MODE = APPLY ? 'apply' : 'dry-run';
const OBSERVED_ON = new Date().toISOString().slice(0, 10);

function writeJson(name: string, data: unknown) {
  fs.mkdirSync(OUT, { recursive: true });
  const p = path.join(OUT, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Wrote ${p}`);
}

async function applyStepA(client: PoolClient) {
  await client.query(fs.readFileSync(SCHEMA_A, 'utf8'));
}

async function backfillStintEntities(client: PoolClient) {
  const res = await client.query(
    `
    UPDATE analytics.player_team_stints s
    SET player_entity_id = p.player_entity_id,
        updated_at = now()
    FROM analytics.players p
    WHERE s.player_id = p.player_id
      AND p.player_entity_id IS NOT NULL
      AND s.player_entity_id IS NULL
    `
  );
  return res.rowCount ?? 0;
}

async function validateStintEntityBackfill(client: PoolClient) {
  const r = await client.query<{
    total: number;
    with_entity: number;
    missing_entity: number;
    open: number;
    closed: number;
    multi_open_entities: number;
    identity_dupes: number;
  }>(
    `
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE player_entity_id IS NOT NULL)::int AS with_entity,
      count(*) FILTER (WHERE player_entity_id IS NULL)::int AS missing_entity,
      count(*) FILTER (WHERE observed_to IS NULL)::int AS open,
      count(*) FILTER (WHERE observed_to IS NOT NULL)::int AS closed,
      (
        SELECT count(*)::int FROM (
          SELECT player_entity_id, season
          FROM analytics.player_team_stints
          WHERE observed_to IS NULL AND player_entity_id IS NOT NULL
          GROUP BY player_entity_id, season
          HAVING count(*) > 1
        ) x
      ) AS multi_open_entities,
      (
        SELECT count(*)::int FROM (
          SELECT player_entity_id, team_id, season, observed_from
          FROM analytics.player_team_stints
          WHERE player_entity_id IS NOT NULL
          GROUP BY 1,2,3,4
          HAVING count(*) > 1
        ) y
      ) AS identity_dupes
    FROM analytics.player_team_stints
    WHERE season = '2025'
    `
  );
  return r.rows[0]!;
}

async function cutoverConstraints(client: PoolClient) {
  // Enforce NOT NULL entity id (idempotent if already set)
  await client.query(
    `
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='analytics' AND table_name='player_team_stints'
          AND column_name='player_entity_id' AND is_nullable='YES'
      ) THEN
        ALTER TABLE analytics.player_team_stints
          ALTER COLUMN player_entity_id SET NOT NULL;
      END IF;
    END $$;
    `
  );

  await client.query(
    `DROP INDEX IF EXISTS analytics.analytics_player_team_stints_open_uniq`
  );
  await client.query(
    `DROP INDEX IF EXISTS analytics.analytics_player_team_stints_identity_uniq`
  );

  await client.query(
    `
    CREATE UNIQUE INDEX IF NOT EXISTS analytics_player_team_stints_open_entity_uniq
      ON analytics.player_team_stints (player_entity_id, season)
      WHERE observed_to IS NULL
    `
  );
  await client.query(
    `
    CREATE UNIQUE INDEX IF NOT EXISTS analytics_player_team_stints_identity_entity_uniq
      ON analytics.player_team_stints (player_entity_id, team_id, season, observed_from)
    `
  );

  await client.query(
    `
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='analytics' AND table_name='player_team_stints'
          AND column_name='player_id' AND is_nullable='NO'
      ) THEN
        ALTER TABLE analytics.player_team_stints
          ALTER COLUMN player_id DROP NOT NULL;
      END IF;
    END $$;
    `
  );
}

async function replaceTeamRosterCurrentView(client: PoolClient) {
  // Column shape changed (entity-first); CREATE OR REPLACE cannot rename columns.
  await client.query(`DROP VIEW IF EXISTS analytics.team_roster_current`);
  await client.query(
    `
    CREATE VIEW analytics.team_roster_current AS
    SELECT
      s.season,
      s.team_id,
      s.player_entity_id,
      s.player_id,
      e.display_name,
      e.first_name,
      e.last_name,
      COALESCE(s.position, e.position) AS position,
      s.jersey,
      s.membership_type,
      s.observed_from,
      s.source,
      s.source_player_id,
      s.stint_id
    FROM analytics.player_team_stints s
    JOIN analytics.player_entities e
      ON e.player_entity_id = s.player_entity_id
    WHERE s.observed_to IS NULL
    `
  );
  await client.query(
    `
    COMMENT ON VIEW analytics.team_roster_current IS
      'Open roster by team/season keyed by player_entity_id. player_id (BDL) is optional.';
    `
  );
}

async function onboardClassC(client: PoolClient, dryRun: boolean) {
  const queueJson = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8')) as {
    rows: Array<Record<string, unknown>>;
  };
  const existingNba = await client.query<{
    provider_player_id: string;
    player_entity_id: string;
  }>(
    `
    SELECT provider_player_id, player_entity_id::text
    FROM analytics.player_provider_ids
    WHERE provider = 'nba'
    `
  );
  const nbaMap = new Map(
    existingNba.rows.map((r) => [r.provider_player_id, r.player_entity_id])
  );

  const queue: ClassCCandidate[] = queueJson.rows.map((r) => ({
    nbaPlayerId: String(r.nba_player_id),
    fullName: String(r.name),
    teamAbbr: String(r.team),
    jersey: (r.jersey as string | null) ?? null,
    position: (r.position as string | null) ?? null,
    status: String(r.status),
    gapCause: (r.gap_cause as string | null) ?? null,
  }));

  const plan = planClassCOnboarding({ queue, existingNbaToEntity: nbaMap });
  assertNoFabricatedBdlInClassC(plan);

  let entitiesCreated = 0;
  let nbaMapsCreated = 0;
  if (!dryRun) {
    for (const item of plan) {
      if (!item.createEntity || !item.playerEntityId) continue;
      const names = splitDisplayName(item.fullName);
      const entIns = await client.query(
        `
        INSERT INTO analytics.player_entities (
          player_entity_id, display_name, first_name, last_name, position
        ) VALUES ($1::uuid, $2, $3, $4, $5)
        ON CONFLICT (player_entity_id) DO NOTHING
        `,
        [
          item.playerEntityId,
          item.fullName,
          names.firstName,
          names.lastName,
          item.position,
        ]
      );
      entitiesCreated += entIns.rowCount ?? 0;
      const mapIns = await client.query(
        `
        INSERT INTO analytics.player_provider_ids (
          player_entity_id, provider, provider_player_id, is_primary, metadata
        ) VALUES ($1::uuid, 'nba', $2, true, $3::jsonb)
        ON CONFLICT (provider, provider_player_id) DO NOTHING
        `,
        [
          item.playerEntityId,
          item.nbaPlayerId,
          JSON.stringify({
            source: CLASS_C_SOURCE,
            season: '2026-27',
            team: item.teamAbbr,
            jersey: item.jersey,
          }),
        ]
      );
      nbaMapsCreated += mapIns.rowCount ?? 0;
    }
  }

  return {
    plan,
    stats: {
      queue: queue.length,
      create: plan.filter((p) => p.action === 'create_nba_only_entity').length,
      reuse: plan.filter((p) => p.action === 'reuse_existing').length,
      skip_class_d: plan.filter((p) => p.action === 'skip_class_d').length,
      skip_other: plan.filter((p) => p.action === 'skip_other').length,
      entitiesCreated: dryRun ? 0 : entitiesCreated,
      nbaMapsCreated: dryRun ? 0 : nbaMapsCreated,
    },
  };
}

async function entityProbe(client: PoolClient) {
  const fetch = JSON.parse(fs.readFileSync(FETCH_PATH, 'utf8')) as {
    players: Array<{
      nba_player_id: string;
      player_name: string;
      team_abbreviation: string;
      analytics_team_id: string;
      jersey: string | null;
      position: string | null;
    }>;
    total_roster_players: number;
  };

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

  const counts = {
    total: results.length,
    entity_provider_match: 0,
    entity_safe_fallback: 0,
    unresolved: 0,
    ambiguous: 0,
    with_bdl: 0,
    nba_only: 0,
  };
  const byTeam: Record<
    string,
    { total: number; resolved: number; unresolved: number; ambiguous: number }
  > = {};
  for (const r of results) {
    counts[r.status] += 1;
    if (
      r.status === 'entity_provider_match' ||
      r.status === 'entity_safe_fallback'
    ) {
      if (r.hasBdlIdentity) counts.with_bdl += 1;
      else counts.nba_only += 1;
    }
    const t = byTeam[r.teamAbbr] ?? {
      total: 0,
      resolved: 0,
      unresolved: 0,
      ambiguous: 0,
    };
    t.total += 1;
    if (
      r.status === 'entity_provider_match' ||
      r.status === 'entity_safe_fallback'
    )
      t.resolved += 1;
    else if (r.status === 'unresolved') t.unresolved += 1;
    else t.ambiguous += 1;
    byTeam[r.teamAbbr] = t;
  }
  const resolved =
    counts.entity_provider_match + counts.entity_safe_fallback;
  const resolution_pct =
    counts.total === 0
      ? 0
      : Math.round((resolved / counts.total) * 10000) / 100;

  const seed = planEntity2026SeedDryRun({
    observedOn: OBSERVED_ON,
    results,
    teamIdByAbbr,
  });
  const actionCounts = seed.actions.reduce(
    (acc, a) => {
      acc[a.action] = (acc[a.action] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // Fabrication checks for Class C onboarded entities
  const fabricated = await client.query<{
    class_c_entities: number;
    with_bdl_map: number;
    with_analytics_row: number;
  }>(
    `
    SELECT
      count(*)::int AS class_c_entities,
      count(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM analytics.player_provider_ids bdl
          WHERE bdl.player_entity_id = nba.player_entity_id
            AND bdl.provider = 'balldontlie'
        )
      )::int AS with_bdl_map,
      count(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM analytics.players p
          WHERE p.player_entity_id = nba.player_entity_id
        )
      )::int AS with_analytics_row
    FROM analytics.player_provider_ids nba
    WHERE nba.provider = 'nba'
      AND nba.metadata->>'source' = $1
    `,
    [CLASS_C_SOURCE]
  );

  const nbaOnlySpot = await client.query<{
    nba_id: string;
    entity_id: string;
    display_name: string;
    has_bdl: boolean;
    has_analytics_row: boolean;
  }>(
    `
    SELECT nba.provider_player_id AS nba_id,
           e.player_entity_id::text AS entity_id,
           e.display_name,
           EXISTS (
             SELECT 1 FROM analytics.player_provider_ids bdl
             WHERE bdl.player_entity_id = e.player_entity_id
               AND bdl.provider = 'balldontlie'
           ) AS has_bdl,
           EXISTS (
             SELECT 1 FROM analytics.players p
             WHERE p.player_entity_id = e.player_entity_id
           ) AS has_analytics_row
    FROM analytics.player_provider_ids nba
    JOIN analytics.player_entities e ON e.player_entity_id = nba.player_entity_id
    WHERE nba.provider = 'nba'
      AND nba.metadata->>'source' = $1
    ORDER BY e.display_name
    LIMIT 12
    `,
    [CLASS_C_SOURCE]
  );

  // Future BDL attach path support check (pure)
  const attachDemo = planAttachBdlToEntity({
    playerEntityId: '00000000-0000-0000-0000-000000000001',
    bdlPlayerId: '999',
    existingBdlOnEntity: null,
    existingEntityForBdl: null,
  });

  return {
    resolution: { ...counts, resolved, resolution_pct, by_team: byTeam },
    seed: {
      action_counts: actionCounts,
      duplicate_entities: seed.duplicateEntities,
      multi_team_nba_ids: seed.multiTeamNbaIds,
      sample_opens: seed.actions
        .filter((a) => a.action === 'open_new_2026_stint')
        .slice(0, 8),
      sample_nba_only_opens: seed.actions
        .filter(
          (a) =>
            a.action === 'open_new_2026_stint' && a.analyticsPlayerId == null
        )
        .slice(0, 8),
    },
    fabrication: fabricated.rows[0],
    nba_only_spot_checks: nbaOnlySpot.rows,
    future_bdl_attach_helper: attachDemo,
  };
}

async function historicalValidation(client: PoolClient) {
  const totals = await client.query<{
    total: number;
    open: number;
    closed: number;
    multi_stint_players: number;
    multi_open: number;
    missing_entity: number;
    null_player_id: number;
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
       ) x)::int AS multi_stint_players,
      (SELECT count(*)::int FROM (
         SELECT player_entity_id FROM analytics.player_team_stints
         WHERE season='2025' AND observed_to IS NULL AND player_entity_id IS NOT NULL
         GROUP BY player_entity_id HAVING count(*)>1
       ) y)::int AS multi_open,
      count(*) FILTER (WHERE player_entity_id IS NULL)::int AS missing_entity,
      count(*) FILTER (WHERE player_id IS NULL)::int AS null_player_id
    FROM analytics.player_team_stints
    WHERE season = '2025'
    `
  );

  const wp = await client.query<{
    player_id: string | null;
    player_entity_id: string;
    abbreviation: string;
    observed_to: string | null;
    source: string;
  }>(
    `
    SELECT s.player_id, s.player_entity_id::text, t.abbreviation,
           s.observed_to::text, s.source
    FROM analytics.player_team_stints s
    JOIN analytics.teams t ON t.team_id = s.team_id
    WHERE s.season = '2025'
      AND s.player_id IN ($1, $2)
      AND s.observed_to IS NULL
    ORDER BY s.player_id
    `,
    [WILSON_BDL_ID, PIPPEN_BDL_ID]
  );

  const stints2026 = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM analytics.player_team_stints WHERE season='2026'`
  );

  return {
    totals: totals.rows[0],
    wilson_pippen_open: wp.rows,
    stints_2026: stints2026.rows[0]?.n ?? 0,
  };
}

async function main() {
  if (STINT_ENTITY_MIGRATE_WRITES_2026) {
    throw new Error('Must not write 2026 stints in 1cC');
  }

  const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });
  const client = await pool.connect();

  try {
    await applyStepA(client);

    let updated = 0;
    let pre;
    if (APPLY) {
      updated = await backfillStintEntities(client);
      pre = await validateStintEntityBackfill(client);
    } else {
      const would = await client.query<{ n: number }>(
        `
        SELECT count(*)::int AS n
        FROM analytics.player_team_stints s
        JOIN analytics.players p ON p.player_id = s.player_id
        WHERE s.season = '2025'
          AND p.player_entity_id IS NOT NULL
          AND s.player_entity_id IS DISTINCT FROM p.player_entity_id
        `
      );
      updated = would.rows[0]?.n ?? 0;
      // After step A, entity column exists but may be empty — estimate coverage via join
      const est = await client.query<{
        total: number;
        linkable: number;
      }>(
        `
        SELECT
          count(*)::int AS total,
          count(*) FILTER (
            WHERE p.player_entity_id IS NOT NULL
          )::int AS linkable
        FROM analytics.player_team_stints s
        LEFT JOIN analytics.players p ON p.player_id = s.player_id
        WHERE s.season = '2025'
        `
      );
      pre = {
        total: est.rows[0]!.total,
        with_entity: 0,
        missing_entity: est.rows[0]!.total,
        open: 0,
        closed: 0,
        multi_open_entities: 0,
        identity_dupes: 0,
        linkable: est.rows[0]!.linkable,
        would_update: updated,
      } as Awaited<ReturnType<typeof validateStintEntityBackfill>> & {
        linkable: number;
        would_update: number;
      };
    }

    if (
      APPLY &&
      (pre.missing_entity > 0 ||
        pre.multi_open_entities > 0 ||
        pre.identity_dupes > 0)
    ) {
      writeJson('2026-27-1cc-stint-migration-BLOCKED.json', { pre, updated });
      throw new Error(
        `Stint entity backfill validation failed: missing=${pre.missing_entity} multi_open=${pre.multi_open_entities} dupes=${pre.identity_dupes}`
      );
    }

    let cutoverDone = false;
    let classC;
    if (APPLY) {
      await client.query('BEGIN');
      try {
        await cutoverConstraints(client);
        await replaceTeamRosterCurrentView(client);
        classC = await onboardClassC(client, false);
        // Idempotent Class C rerun inside same txn path after commit
        await client.query('COMMIT');
        cutoverDone = true;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }

      // Idempotent Class C rerun
      const classC2 = await onboardClassC(client, false);
      classC = {
        ...classC,
        rerun: classC2.stats,
      };
    } else {
      classC = await onboardClassC(client, true);
    }

    const hist = await historicalValidation(client);
    const probe = APPLY
      ? await entityProbe(client)
      : {
          note: 'Probe after apply only (entities not created in dry-run)',
        };

    // Second stint backfill idempotency
    const updated2 = APPLY ? await backfillStintEntities(client) : 0;

    const ready =
      APPLY &&
      typeof probe === 'object' &&
      'resolution' in probe &&
      (probe as { resolution: { resolution_pct: number }; fabrication: { with_bdl_map: number; with_analytics_row: number } })
        .resolution.resolution_pct >= 95 &&
      (probe as { fabrication: { with_bdl_map: number; with_analytics_row: number } })
        .fabrication.with_bdl_map === 0 &&
      (probe as { fabrication: { with_analytics_row: number } }).fabrication
        .with_analytics_row === 0 &&
      hist.stints_2026 === 0 &&
      hist.totals?.missing_entity === 0 &&
      hist.totals?.multi_open === 0;

    const report = {
      phase: '2.T.2D.1cC',
      mode: MODE,
      stint_backfill: {
        rows_touched_first: updated,
        rows_touched_rerun: updated2,
        validation_before_cutover: pre,
      },
      cutover_done: cutoverDone,
      class_c: classC,
      historical: hist,
      probe,
      out_of_scope: {
        no_2026_stint_seed: hist.stints_2026 === 0,
        no_team_roster_ui: true,
        no_production_config: true,
      },
      ready_for_2T2D2: ready,
    };

    writeJson(
      APPLY
        ? '2026-27-1cc-entity-stint-migration-apply.json'
        : '2026-27-1cc-entity-stint-migration-dry-run.json',
      report
    );

    if (APPLY && 'resolution' in probe) {
      writeJson('2026-27-entity-roster-probe.json', probe);
      writeJson('2026-27-simulated-entity-stint-seed-plan.json', {
        note: 'DRY RUN ONLY — not applied',
        ...(probe as { seed: unknown }).seed,
      });
    }

    console.log(
      JSON.stringify(
        {
          mode: MODE,
          stint_backfill: pre,
          cutover_done: cutoverDone,
          class_c_stats: classC.stats,
          historical: hist.totals,
          stints_2026: hist.stints_2026,
          probe_resolution:
            probe && 'resolution' in probe
              ? (probe as { resolution: unknown }).resolution
              : null,
          ready_for_2T2D2: report.ready_for_2T2D2,
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
