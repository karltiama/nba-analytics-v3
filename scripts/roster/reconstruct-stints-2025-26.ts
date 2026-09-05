/**
 * Phase 2.T.2C — Reconstruct conservative 2025–26 historical player-team stints
 * from PGL appearance windows + existing NBA.com final roster open stints.
 *
 * Usage:
 *   npx tsx scripts/roster/reconstruct-stints-2025-26.ts --dry-run
 *   npx tsx scripts/roster/reconstruct-stints-2025-26.ts --apply
 *
 * Semantics: observed_from/to are appearance/observation evidence dates,
 * NOT signing/trade timestamps. No transaction records are created.
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { parseSeasonStartYear } from '../../lib/season';
import {
  assertNoTransactionDateClaims,
  findMultipleOpenPlayers,
  planHistoricalReconstruction,
  type FinalRosterMembership,
  type PglAppearance,
  type PlannedHistoricalStint,
} from '../../lib/roster/historical-stint-reconstruct';

const SEASON_LABEL = '2025-26';
const ANALYTICS_SEASON = String(parseSeasonStartYear(SEASON_LABEL)!);
const OUT_DIR = path.join(process.cwd(), 'reports', 'roster');
const INFERRED_SOURCE = 'inferred_pgl';
const NBA_SOURCE = 'nba_stats';

const WILSON_ID = '56677722';
const PIPPEN_ID = '38017656';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run') || !args.has('--apply');
const APPLY = args.has('--apply');

function writeJson(name: string, data: unknown) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Wrote ${p}`);
}

async function loadSkipAnalyticsIds(client: PoolClient): Promise<Set<string>> {
  // Load latest identity results if present — prefer DB-derived unresolved via
  // matching the same 16 skipped from the populate report when available.
  const reportPath = path.join(OUT_DIR, '2025-26-stint-populate-report.json');
  const skip = new Set<string>();
  if (!fs.existsSync(reportPath)) return skip;

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as {
    skipped?: Array<{ nba_player_id: string }>;
  };
  const nbaIds = (report.skipped ?? []).map((s) => s.nba_player_id);
  if (nbaIds.length === 0) return skip;

  // Map NBA ids → analytics via provider_id_map when present (usually absent for unresolved)
  const maps = await client.query<{ provider_id: string; internal_id: string }>(
    `
    SELECT provider_id, internal_id
    FROM provider_id_map
    WHERE entity_type = 'player'
      AND provider = 'nba'
      AND provider_id = ANY($1::text[])
    `,
    [nbaIds]
  );
  for (const r of maps.rows) {
    // Prefer BDL bridge for analytics id
    const bdl = await client.query<{ provider_id: string }>(
      `
      SELECT provider_id
      FROM provider_id_map
      WHERE entity_type = 'player'
        AND provider = 'balldontlie'
        AND internal_id = $1
      `,
      [r.internal_id]
    );
    for (const b of bdl.rows) skip.add(b.provider_id);
  }
  return skip;
}

async function applyInferredReplace(
  client: PoolClient,
  season: string,
  stints: PlannedHistoricalStint[]
) {
  await client.query(
    `
    DELETE FROM analytics.player_team_stints
    WHERE season = $1 AND source = $2
    `,
    [season, INFERRED_SOURCE]
  );

  for (const s of stints) {
    // Insert-only after deleting inferred_pgl for the season.
    // Do not ON CONFLICT UPDATE — that could clobber an nba_stats row
    // if (player, team, season, observed_from) ever collided.
    const clash = await client.query<{ source: string }>(
      `
      SELECT source
      FROM analytics.player_team_stints
      WHERE player_id = $1 AND team_id = $2 AND season = $3
        AND observed_from = $4::date
      LIMIT 1
      `,
      [s.playerId, s.teamId, s.season, s.observedFrom]
    );
    if (clash.rows.length > 0) {
      if (clash.rows[0]!.source === NBA_SOURCE) {
        // Fail closed: keep nba_stats; skip duplicate inferred key.
        continue;
      }
      throw new Error(
        `Unexpected existing stint for ${s.playerId}/${s.teamId}/${s.observedFrom} source=${clash.rows[0]!.source}`
      );
    }
    await client.query(
      `
      INSERT INTO analytics.player_team_stints (
        season, player_id, team_id, observed_from, observed_to,
        source, source_player_id, jersey, position, membership_type
      ) VALUES (
        $1, $2, $3, $4::date, $5::date,
        $6, NULL, NULL, NULL, NULL
      )
      `,
      [
        s.season,
        s.playerId,
        s.teamId,
        s.observedFrom,
        s.observedTo,
        s.source,
      ]
    );
  }
}

async function applyReconciles(
  client: PoolClient,
  reconciles: Array<{
    stintId: number;
    observedFrom: string;
  }>
) {
  for (const r of reconciles) {
    await client.query(
      `
      UPDATE analytics.player_team_stints
      SET observed_from = LEAST(observed_from, $2::date),
          updated_at = now()
      WHERE stint_id = $1
        AND observed_to IS NULL
        AND source = $3
      `,
      [r.stintId, r.observedFrom, NBA_SOURCE]
    );
  }
}

async function validationSnapshot(client: PoolClient) {
  const totals = await client.query<{
    total: number;
    open: number;
    closed: number;
    players: number;
    teams: number;
  }>(
    `
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE observed_to IS NULL)::int AS open,
      count(*) FILTER (WHERE observed_to IS NOT NULL)::int AS closed,
      count(DISTINCT player_id)::int AS players,
      count(DISTINCT team_id)::int AS teams
    FROM analytics.player_team_stints
    WHERE season = $1
    `,
    [ANALYTICS_SEASON]
  );

  const multiStint = await client.query<{ n: number }>(
    `
    SELECT count(*)::int AS n FROM (
      SELECT player_id
      FROM analytics.player_team_stints
      WHERE season = $1
      GROUP BY player_id
      HAVING count(*) > 1
    ) x
    `,
    [ANALYTICS_SEASON]
  );

  const multiOpen = await client.query<{ player_id: string; n: number }>(
    `
    SELECT player_id, count(*)::int AS n
    FROM analytics.player_team_stints
    WHERE season = $1 AND observed_to IS NULL
    GROUP BY player_id
    HAVING count(*) > 1
    `,
    [ANALYTICS_SEASON]
  );

  const sourceBreakdown = await client.query<{ source: string; n: number }>(
    `
    SELECT source, count(*)::int AS n
    FROM analytics.player_team_stints
    WHERE season = $1
    GROUP BY source
    ORDER BY source
    `,
    [ANALYTICS_SEASON]
  );

  const wilsonPippen = await client.query<{
    player_id: string;
    full_name: string;
    abbreviation: string;
    observed_from: string;
    observed_to: string | null;
    source: string;
  }>(
    `
    SELECT s.player_id, p.full_name, t.abbreviation,
           s.observed_from::text, s.observed_to::text, s.source
    FROM analytics.player_team_stints s
    JOIN analytics.players p ON p.player_id = s.player_id
    JOIN analytics.teams t ON t.team_id = s.team_id
    WHERE s.season = $1
      AND s.player_id IN ($2, $3)
    ORDER BY s.player_id, s.observed_from
    `,
    [ANALYTICS_SEASON, WILSON_ID, PIPPEN_ID]
  );

  const teamSanity = await client.query<{
    abbreviation: string;
    any_stint_players: number;
    open_roster: number;
    historical_only: number;
  }>(
    `
    WITH st AS (
      SELECT s.player_id, s.team_id, s.observed_to
      FROM analytics.player_team_stints s
      WHERE s.season = $1
    )
    SELECT
      t.abbreviation,
      count(DISTINCT st.player_id)::int AS any_stint_players,
      count(DISTINCT st.player_id) FILTER (WHERE st.observed_to IS NULL)::int AS open_roster,
      (
        count(DISTINCT st.player_id)
        - count(DISTINCT st.player_id) FILTER (WHERE st.observed_to IS NULL)
      )::int AS historical_only
    FROM analytics.teams t
    LEFT JOIN st ON st.team_id = t.team_id
    WHERE t.abbreviation IS NOT NULL
      AND t.abbreviation NOT IN ('EAST', 'WEST')
    GROUP BY t.abbreviation
    ORDER BY t.abbreviation
    `,
    [ANALYTICS_SEASON]
  );

  // Overlap anomalies: same player, overlapping date ranges on different or same teams
  const overlaps = await client.query<{
    player_id: string;
    a_team: string;
    b_team: string;
    a_from: string;
    a_to: string | null;
    b_from: string;
    b_to: string | null;
  }>(
    `
    SELECT a.player_id,
           a.team_id AS a_team, b.team_id AS b_team,
           a.observed_from::text AS a_from, a.observed_to::text AS a_to,
           b.observed_from::text AS b_from, b.observed_to::text AS b_to
    FROM analytics.player_team_stints a
    JOIN analytics.player_team_stints b
      ON a.player_id = b.player_id
     AND a.season = b.season
     AND a.stint_id < b.stint_id
    WHERE a.season = $1
      AND a.observed_from <= COALESCE(b.observed_to, '9999-12-31'::date)
      AND b.observed_from <= COALESCE(a.observed_to, '9999-12-31'::date)
    LIMIT 200
    `,
    [ANALYTICS_SEASON]
  );

  return {
    totals: totals.rows[0],
    players_with_multiple_stints: multiStint.rows[0]?.n ?? 0,
    players_with_multiple_open: multiOpen.rows,
    source_breakdown: Object.fromEntries(
      sourceBreakdown.rows.map((r) => [r.source, r.n])
    ),
    wilson_pippen: wilsonPippen.rows,
    team_sanity: teamSanity.rows,
    overlapping_stint_anomalies: overlaps.rows,
  };
}

async function main() {
  if (APPLY && DRY_RUN && args.has('--dry-run')) {
    // explicit dry-run wins if both passed oddly
  }
  const mode = APPLY && !args.has('--dry-run') ? 'apply' : 'dry-run';

  const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });
  const client = await pool.connect();

  try {
    const pgl = await client.query<{
      player_id: string;
      team_id: string;
      game_date: string;
      game_id: string;
    }>(
      `
      SELECT player_id, team_id, game_date::text AS game_date, game_id
      FROM analytics.player_game_logs
      WHERE season = $1
        AND game_date IS NOT NULL
        AND team_id IS NOT NULL
      ORDER BY player_id, game_date, game_id
      `,
      [ANALYTICS_SEASON]
    );

    const appearances: PglAppearance[] = pgl.rows.map((r) => ({
      playerId: r.player_id,
      teamId: r.team_id,
      gameDate: r.game_date.slice(0, 10),
      gameId: r.game_id,
    }));

    const openRows = await client.query<{
      stint_id: number;
      player_id: string;
      team_id: string;
      observed_from: string;
      source: string;
      source_player_id: string | null;
      jersey: string | null;
      position: string | null;
    }>(
      `
      SELECT stint_id, player_id, team_id,
             observed_from::text, source, source_player_id, jersey, position
      FROM analytics.player_team_stints
      WHERE season = $1 AND observed_to IS NULL AND source = $2
      `,
      [ANALYTICS_SEASON, NBA_SOURCE]
    );

    const finalOpenByPlayer = new Map<string, FinalRosterMembership>();
    for (const r of openRows.rows) {
      finalOpenByPlayer.set(r.player_id, {
        playerId: r.player_id,
        teamId: r.team_id,
        stintId: Number(r.stint_id),
        observedFrom: r.observed_from.slice(0, 10),
        source: r.source,
        sourcePlayerId: r.source_player_id,
        jersey: r.jersey,
        position: r.position,
      });
    }

    const skipPlayerIds = await loadSkipAnalyticsIds(client);

    const plan = planHistoricalReconstruction({
      season: ANALYTICS_SEASON,
      appearances,
      finalOpenByPlayer,
      skipPlayerIds,
    });

    assertNoTransactionDateClaims(plan.inferredStints);

    const multiOpenPlanned = findMultipleOpenPlayers(
      [...finalOpenByPlayer.values()],
      plan.inferredStints
    );
    if (multiOpenPlanned.length > 0) {
      throw new Error(
        `Plan would leave multiple opens: ${multiOpenPlanned.join(',')}`
      );
    }

    const before = await validationSnapshot(client);

    if (mode === 'apply') {
      await client.query('BEGIN');
      try {
        await applyInferredReplace(
          client,
          ANALYTICS_SEASON,
          plan.inferredStints
        );
        await applyReconciles(
          client,
          plan.reconcileOpens.map((r) => ({
            stintId: r.stintId,
            observedFrom: r.observedFrom,
          }))
        );
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }

    const after = mode === 'apply' ? await validationSnapshot(client) : before;

    // Idempotency: recompute plan after apply should match inferred set size
    let idempotent: Record<string, unknown> | null = null;
    if (mode === 'apply') {
      const plan2 = planHistoricalReconstruction({
        season: ANALYTICS_SEASON,
        appearances,
        finalOpenByPlayer: new Map(
          (
            await client.query<{
              stint_id: number;
              player_id: string;
              team_id: string;
              observed_from: string;
              source: string;
              source_player_id: string | null;
              jersey: string | null;
              position: string | null;
            }>(
              `
              SELECT stint_id, player_id, team_id,
                     observed_from::text, source, source_player_id, jersey, position
              FROM analytics.player_team_stints
              WHERE season = $1 AND observed_to IS NULL AND source = $2
              `,
              [ANALYTICS_SEASON, NBA_SOURCE]
            )
          ).rows.map((r) => [
            r.player_id,
            {
              playerId: r.player_id,
              teamId: r.team_id,
              stintId: Number(r.stint_id),
              observedFrom: r.observed_from.slice(0, 10),
              source: r.source,
              sourcePlayerId: r.source_player_id,
              jersey: r.jersey,
              position: r.position,
            } satisfies FinalRosterMembership,
          ])
        ),
        skipPlayerIds,
      });

      await client.query('BEGIN');
      try {
        await applyInferredReplace(
          client,
          ANALYTICS_SEASON,
          plan2.inferredStints
        );
        await applyReconciles(
          client,
          plan2.reconcileOpens.map((r) => ({
            stintId: r.stintId,
            observedFrom: r.observedFrom,
          }))
        );
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }

      const afterRerun = await validationSnapshot(client);
      idempotent = {
        first_inferred_count: plan.inferredStints.length,
        second_inferred_count: plan2.inferredStints.length,
        totals_after_first: after.totals,
        totals_after_second: afterRerun.totals,
        identical_totals:
          JSON.stringify(after.totals) === JSON.stringify(afterRerun.totals),
        identical_inferred_count:
          plan.inferredStints.length === plan2.inferredStints.length,
      };
    }

    const suspiciousTeams = (after.team_sanity ?? []).filter(
      (t) =>
        t.open_roster > 22 ||
        t.open_roster < 10 ||
        (t.any_stint_players > 0 && t.any_stint_players < t.open_roster)
    );

    const report = {
      phase: '2.T.2C',
      mode,
      season_label: SEASON_LABEL,
      analytics_season: ANALYTICS_SEASON,
      semantics: {
        observed_from_to:
          'appearance/observation evidence windows — NOT signing/trade timestamps',
        no_transaction_records: true,
        source_precedence: [
          'nba_stats open final roster (authoritative current membership)',
          'inferred_pgl closed historical appearance windows',
          'on agreement: reconcile nba_stats.observed_from to earliest matching PGL',
          'on disagreement: conflict queue; keep nba_stats open; closed PGL for non-final teams only',
        ],
      },
      plan_stats: plan.stats,
      planned_inferred_stints: plan.inferredStints.length,
      planned_reconcile_opens: plan.reconcileOpens.length,
      conflicts: plan.conflicts,
      manual_queue: plan.manualQueue,
      skipped_unresolved_player_ids: plan.skippedUnresolvedPlayerIds,
      before,
      after: mode === 'apply' ? after : null,
      idempotent_rerun: idempotent,
      suspicious_team_counts: suspiciousTeams,
      trustworthiness_note:
        'Historical Explorer can use closed inferred_pgl + open nba_stats with observation semantics; do not present as exact transaction history. Conflicts and identity queue remain fail-closed.',
      ready_for_2T2D_2026_seed: false,
      out_of_scope_confirmed: {
        no_2026_seed: true,
        no_team_roster_ui: true,
        no_production_config_change: true,
      },
    };

    writeJson(
      mode === 'apply'
        ? '2025-26-historical-stint-reconstruct-apply.json'
        : '2025-26-historical-stint-reconstruct-dry-run.json',
      report
    );
    writeJson('2025-26-historical-manual-review-queue.json', {
      note: 'Separate from identity unresolved/ambiguous queue. Fail-closed; do not auto-resolve.',
      conflicts: plan.conflicts,
      manual_queue: plan.manualQueue,
    });

    console.log(
      JSON.stringify(
        {
          mode,
          planned_inferred: plan.inferredStints.length,
          planned_reconciles: plan.reconcileOpens.length,
          conflicts: plan.conflicts.length,
          manual_queue: plan.manualQueue.length,
          multi_team: plan.stats.multiTeamPlayers,
          pgl_only: plan.stats.pglOnlyHistoricalPlayers,
          confidence: plan.stats.confidence,
          after_totals: mode === 'apply' ? after.totals : before.totals,
          wilson_pippen:
            mode === 'apply' ? after.wilson_pippen : before.wilson_pippen,
          idempotent,
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
