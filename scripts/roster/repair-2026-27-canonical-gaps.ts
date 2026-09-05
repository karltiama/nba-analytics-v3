/**
 * Phase 2.T.2D.1b — Narrow canonical gap repair for 2026–27 NBA.com roster queue.
 *
 * Usage:
 *   npx tsx scripts/roster/repair-2026-27-canonical-gaps.ts --dry-run
 *   npx tsx scripts/roster/repair-2026-27-canonical-gaps.ts --apply
 *
 * Never writes analytics.player_team_stints.
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import {
  ANALYTICS_PLAYER_ID_IS_BDL_COUPLED,
  GAP_REPAIR_WRITES_STINTS,
  assertNoFabricatedBdlIds,
  planCanonicalGapRepairs,
  type GapQueueRow,
  type LocalPlayer,
  type RepairPlanItem,
} from '../../lib/roster/canonical-gap-repair';
import type { ExistingMap } from '../../lib/roster/provider-map-backfill';

const OUT = path.join(process.cwd(), 'reports', 'roster');
const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply') && !args.has('--dry-run');
const MODE = APPLY ? 'apply' : 'dry-run';

function writeJson(name: string, data: unknown) {
  fs.mkdirSync(OUT, { recursive: true });
  const p = path.join(OUT, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Wrote ${p}`);
}

async function applyRepairs(client: PoolClient, plans: RepairPlanItem[]) {
  let analyticsCreated = 0;
  let nbaMaps = 0;
  let bdlBridges = 0;

  for (const p of plans) {
    if (
      p.action !== 'bridge_existing_player' &&
      p.action !== 'promote_raw_player_to_analytics'
    ) {
      continue;
    }
    if (!p.targetAnalyticsPlayerId) continue;

    if (p.promoteRaw) {
      const raw = await client.query<{
        id: string;
        first_name: string | null;
        last_name: string | null;
        position: string | null;
        height: string | null;
        weight: string | null;
      }>(
        `SELECT id::text AS id, first_name, last_name, position, height, weight
         FROM raw.players WHERE id::text = $1`,
        [p.targetAnalyticsPlayerId]
      );
      const row = raw.rows[0];
      if (!row) {
        throw new Error(`Missing raw.players ${p.targetAnalyticsPlayerId}`);
      }
      const fullName =
        [row.first_name, row.last_name].filter(Boolean).join(' ') || p.fullName;
      const ins = await client.query(
        `
        INSERT INTO analytics.players (
          player_id, full_name, first_name, last_name, position, height, weight
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (player_id) DO NOTHING
        `,
        [
          row.id,
          fullName,
          row.first_name,
          row.last_name,
          row.position,
          row.height,
          row.weight,
        ]
      );
      if ((ins.rowCount ?? 0) > 0) analyticsCreated += 1;
    }

    if (p.insertNbaMap) {
      const meta = {
        source: 'phase_2T2D1b_gap_repair',
        full_name: p.fullName,
        season: '2026-27',
      };
      await client.query(
        `
        INSERT INTO provider_id_map (
          entity_type, internal_id, provider, provider_id, metadata, fetched_at, created_at, updated_at
        ) VALUES (
          'player', $1, 'nba', $2, $3::jsonb, now(), now(), now()
        )
        ON CONFLICT (entity_type, provider, provider_id) DO NOTHING
        `,
        [p.nbaPlayerId, p.nbaPlayerId, JSON.stringify(meta)]
      );
      nbaMaps += 1;
    }

    if (p.insertBdlBridge) {
      const meta = {
        source: 'phase_2T2D1b_gap_repair',
        full_name: p.fullName,
        season: '2026-27',
        reason: p.reason,
      };
      const existing = await client.query<{ internal_id: string }>(
        `
        SELECT internal_id FROM provider_id_map
        WHERE entity_type = 'player' AND provider = 'balldontlie' AND provider_id = $1
        `,
        [p.targetAnalyticsPlayerId]
      );
      if (existing.rows.length > 0) {
        if (existing.rows[0]!.internal_id !== p.nbaPlayerId) {
          throw new Error(
            `Conflict: BDL ${p.targetAnalyticsPlayerId} already → ${existing.rows[0]!.internal_id}`
          );
        }
      } else {
        await client.query(
          `
          INSERT INTO provider_id_map (
            entity_type, internal_id, provider, provider_id, metadata, fetched_at, created_at, updated_at
          ) VALUES (
            'player', $1, 'balldontlie', $2, $3::jsonb, now(), now(), now()
          )
          `,
          [p.nbaPlayerId, p.targetAnalyticsPlayerId, JSON.stringify(meta)]
        );
        bdlBridges += 1;
      }
    }
  }

  return { analyticsCreated, nbaMaps, bdlBridges };
}

async function main() {
  if (GAP_REPAIR_WRITES_STINTS) {
    throw new Error('Gap repair must not write stints');
  }

  const queueJson = JSON.parse(
    fs.readFileSync(path.join(OUT, '2026-27-manual-review-queue.json'), 'utf8')
  );
  const fetchJson = JSON.parse(
    fs.readFileSync(path.join(OUT, '2026-27-nba-fetch.json'), 'utf8')
  );
  const fetchByNba = new Map(
    (fetchJson.players as Array<Record<string, unknown>>).map((p) => [
      String(p.nba_player_id),
      p,
    ])
  );

  const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });
  const client = await pool.connect();
  try {
    const maps = await client.query<{
      provider: string;
      provider_id: string;
      internal_id: string;
    }>(
      `SELECT provider, provider_id, internal_id
       FROM provider_id_map
       WHERE entity_type = 'player' AND provider IN ('nba', 'balldontlie')`
    );
    const analytics = await client.query<{
      player_id: string;
      full_name: string;
      first_name: string | null;
      last_name: string | null;
      position: string | null;
      height: string | null;
      weight: string | null;
    }>(
      `SELECT player_id, full_name, first_name, last_name, position, height, weight
       FROM analytics.players`
    );
    const raw = await client.query<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      position: string | null;
      height: string | null;
      weight: string | null;
    }>(
      `SELECT id::text AS id, first_name, last_name, position, height, weight
       FROM raw.players`
    );

    const existingMaps: ExistingMap[] = maps.rows.map((r) => ({
      provider: r.provider as 'nba' | 'balldontlie',
      providerId: r.provider_id,
      internalId: r.internal_id,
    }));
    const analyticsPlayers: LocalPlayer[] = analytics.rows.map((r) => ({
      playerId: r.player_id,
      fullName: r.full_name,
      firstName: r.first_name,
      lastName: r.last_name,
      position: r.position,
      height: r.height,
      weight: r.weight,
      source: 'analytics',
    }));
    const rawPlayers: LocalPlayer[] = raw.rows.map((r) => ({
      playerId: r.id,
      fullName: [r.first_name, r.last_name].filter(Boolean).join(' '),
      firstName: r.first_name,
      lastName: r.last_name,
      position: r.position,
      height: r.height,
      weight: r.weight,
      source: 'raw',
    }));

    const queue: GapQueueRow[] = (
      queueJson.rows as Array<Record<string, unknown>>
    ).map((r) => {
      const fp = fetchByNba.get(String(r.nba_player_id));
      return {
        nbaPlayerId: String(r.nba_player_id),
        fullName: String(r.name),
        teamAbbr: String(r.team),
        jersey: (r.jersey as string | null) ?? null,
        position: (r.position as string | null) ?? null,
        status: String(r.status),
        gapCause: (r.gap_cause as string | null) ?? null,
        howAcquired:
          (fp?.how_acquired as string | null) ??
          ((fp?.raw as Record<string, unknown> | undefined)?.HOW_ACQUIRED as
            | string
            | null) ??
          null,
        supplementalStatus:
          (fp?.supplemental_status as string | number | null) ??
          ((fp?.raw as Record<string, unknown> | undefined)
            ?.SUPPLEMENTAL_STATUS as string | number | null) ??
          null,
        experience: (fp?.experience as string | number | null) ?? null,
        school: (fp?.school as string | null) ?? null,
      };
    });

    const plans = planCanonicalGapRepairs({
      queue,
      existingMaps,
      analyticsPlayers,
      rawPlayers,
    });

    const knownBdlIds = new Set([
      ...analyticsPlayers.map((p) => p.playerId),
      ...rawPlayers.map((p) => p.playerId),
    ]);
    assertNoFabricatedBdlIds(plans, knownBdlIds);

    const classCounts = { A: 0, B: 0, C: 0, D: 0 };
    const actionCounts: Record<string, number> = {};
    for (const p of plans) {
      classCounts[p.repairClass] += 1;
      actionCounts[p.action] = (actionCounts[p.action] ?? 0) + 1;
    }

    const applyable = plans.filter(
      (p) =>
        (p.action === 'bridge_existing_player' ||
          p.action === 'promote_raw_player_to_analytics') &&
        (p.insertBdlBridge || p.insertNbaMap || p.promoteRaw)
    );

    let applyResult = {
      analyticsCreated: 0,
      nbaMaps: 0,
      bdlBridges: 0,
    };

    if (APPLY) {
      await client.query('BEGIN');
      try {
        applyResult = await applyRepairs(client, applyable);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }

    const rookieReport = plans.map((p) => ({
      nba_player_id: p.nbaPlayerId,
      name: p.fullName,
      team: p.teamAbbr,
      jersey: p.jersey,
      position: p.position,
      how_acquired: p.howAcquired,
      supplemental_status: p.supplementalStatus,
      raw_bdl_exists: p.rawBdlExists,
      analytics_player_exists: p.analyticsExists,
      nba_provider_map_exists: p.nbaProviderMapExists,
      bdl_provider_map_exists: p.bdlProviderMapExists,
      class: p.repairClass,
      proposed_action: p.action,
      target_analytics_player_id: p.targetAnalyticsPlayerId,
      reason: p.reason,
    }));

    const report = {
      phase: '2.T.2D.1b',
      mode: MODE,
      analytics_player_id_is_bdl_coupled: ANALYTICS_PLAYER_ID_IS_BDL_COUPLED,
      canonical_id_strategy:
        'Keep BDL-coupled analytics.player_id. Bridge NBA→BDL when unique local identity exists. Class C NBA-only rookies blocked_by_schema (no fake BDL ids). Smallest architecture fix later: provider-agnostic / namespaced nba:{id} + resolver Level-1.5.',
      class_counts: classCounts,
      action_counts: actionCounts,
      applyable_count: applyable.length,
      apply_result: APPLY ? applyResult : null,
      conflicts_untouched: plans.filter((p) => p.action === 'manual_review'),
      blocked_by_schema: plans.filter((p) => p.action === 'blocked_by_schema'),
      plans,
      writes: {
        analytics_player_team_stints: false,
        team_roster_ui: false,
        production_config: false,
      },
    };

    writeJson(
      MODE === 'apply'
        ? '2026-27-canonical-gap-repair-apply.json'
        : '2026-27-canonical-gap-repair-dry-run.json',
      report
    );
    writeJson('2026-27-rookie-new-player-repair-report.json', {
      rows: rookieReport,
    });

    console.log(
      JSON.stringify(
        {
          mode: MODE,
          class_counts: classCounts,
          action_counts: actionCounts,
          applyable: applyable.length,
          apply_result: applyResult,
          blocked: plans.filter((p) => p.action === 'blocked_by_schema').length,
          manual: plans.filter((p) => p.action === 'manual_review').length,
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
