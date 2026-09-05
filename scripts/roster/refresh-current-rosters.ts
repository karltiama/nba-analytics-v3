/**
 * Phase 2.T.2E — 2026–27 (season-aware) roster snapshot refresh + stint reconciliation.
 *
 * Usage:
 *   npx tsx scripts/roster/refresh-current-rosters.ts --season=2026-27 --dry-run
 *   npx tsx scripts/roster/refresh-current-rosters.ts --season=2026-27 --apply
 *   npx tsx scripts/roster/refresh-current-rosters.ts --season=2026-27 --dry-run --skip-fetch
 *   npx tsx scripts/roster/refresh-current-rosters.ts --season=2026-27 --apply --allow-large-close
 *
 * Does NOT touch other seasons' stints, TeamRoster UI, Production config, or Class D auto-resolve.
 *
 * Callers of analytics.team_roster_current MUST filter by season — the view is all open stints.
 */

import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { parseSeasonStartYear } from '../../lib/season';
import {
  EXPECTED_CLASS_D_2026,
} from '../../lib/roster/entity-2026-seed';
import {
  ROSTER_REFRESH_SOURCE,
  ROSTER_REFRESH_TOUCHES_OTHER_SEASONS,
  assertSingleOpenPerEntitySeason,
  evaluateFetchIntegrity,
  evaluateMassCloseGuard,
  groupTeamChangePairs,
  partitionResolveResults,
  planEntityRosterRefresh,
  type ExistingEntityOpenStint,
  type RefreshMutation,
} from '../../lib/roster/entity-roster-refresh';
import {
  buildEntityResolverIndex,
  resolveRosterToEntity,
  type EntityProviderRow,
  type EntityRow,
} from '../../lib/roster/entity-roster-resolve';
import type { RosterObservation } from '../../lib/roster/identity-resolver';

const OUT = path.join(process.cwd(), 'reports', 'roster');

function argValue(prefix: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return null;
  const eq = hit.indexOf('=');
  return eq >= 0 ? hit.slice(eq + 1) : null;
}

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply') && !args.has('--dry-run');
const SKIP_FETCH = args.has('--skip-fetch');
const ALLOW_LARGE_CLOSE = args.has('--allow-large-close');
const SEASON_LABEL = argValue('--season=') ?? '2026-27';
const ANALYTICS_SEASON = parseSeasonStartYear(SEASON_LABEL);
if (!ANALYTICS_SEASON) {
  throw new Error(`Invalid --season=${SEASON_LABEL}`);
}
const MODE = APPLY ? 'apply' : 'dry-run';

function writeJson(name: string, data: unknown) {
  fs.mkdirSync(OUT, { recursive: true });
  const p = path.join(OUT, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Wrote ${p}`);
}

type FetchJson = {
  fetched_at: string;
  requested_season: string;
  teams_attempted: number;
  teams_successful: number;
  teams_failed: Array<{ abbreviation: string; error?: string }>;
  total_roster_players: number;
  players_per_team: Record<string, number>;
  duplicate_nba_player_ids: Array<{ nba_player_id: string; teams?: string[] }>;
  roster_size_stats?: { min: number | null };
  players: Array<{
    nba_player_id: string;
    player_name: string;
    team_abbreviation: string;
    nba_team_id: string;
    analytics_team_id: string;
    jersey: string | null;
    position: string | null;
    roster_status?: string | null;
    height?: string | null;
    weight?: string | null;
    experience?: string | null;
    school?: string | null;
    raw?: Record<string, unknown>;
  }>;
};

function runPythonFetch(seasonLabel: string, outPath: string) {
  const py = path.join(
    process.cwd(),
    'scripts',
    'roster',
    'probe_commonteamroster.py'
  );
  const r = spawnSync(
    'python',
    [py, '--season', seasonLabel, '--out', outPath],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  if (r.status !== 0) {
    console.error(r.stdout);
    console.error(r.stderr);
    throw new Error(`Python roster fetch failed (exit ${r.status})`);
  }
}

async function writeRawSnapshots(
  client: PoolClient,
  fetch: FetchJson,
  snapshotAt: Date,
  snapshotDate: string,
  dryRun: boolean
) {
  let inserted = 0;
  let updated = 0;
  if (dryRun) {
    return { inserted: fetch.players.length, updated: 0 };
  }
  for (const p of fetch.players) {
    const how =
      p.raw && typeof p.raw.HOW_ACQUIRED === 'string'
        ? p.raw.HOW_ACQUIRED
        : null;
    const supp =
      p.raw && typeof p.raw.SUPPLEMENTAL_STATUS === 'string'
        ? p.raw.SUPPLEMENTAL_STATUS
        : null;
    const payload = {
      ...p.raw,
      how_acquired: how,
      supplemental_status: supp,
      refresh_phase: '2.T.2E',
    };
    const res = await client.query<{ inserted: boolean }>(
      `
      INSERT INTO raw.nba_roster_snapshots (
        snapshot_at, snapshot_date, season_label, analytics_season,
        nba_team_id, nba_player_id, player_name, team_abbreviation,
        analytics_team_id, jersey, position, roster_status,
        height, weight, experience, school, raw_payload
      ) VALUES (
        $1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb
      )
      ON CONFLICT (snapshot_date, season_label, nba_team_id, nba_player_id) DO UPDATE SET
        player_name = EXCLUDED.player_name,
        team_abbreviation = EXCLUDED.team_abbreviation,
        analytics_team_id = EXCLUDED.analytics_team_id,
        jersey = EXCLUDED.jersey,
        position = EXCLUDED.position,
        roster_status = EXCLUDED.roster_status,
        height = EXCLUDED.height,
        weight = EXCLUDED.weight,
        experience = EXCLUDED.experience,
        school = EXCLUDED.school,
        raw_payload = EXCLUDED.raw_payload,
        snapshot_at = EXCLUDED.snapshot_at
      RETURNING (xmax = 0) AS inserted
      `,
      [
        snapshotAt.toISOString(),
        snapshotDate,
        SEASON_LABEL,
        ANALYTICS_SEASON,
        p.nba_team_id,
        p.nba_player_id,
        p.player_name,
        p.team_abbreviation,
        p.analytics_team_id,
        p.jersey,
        p.position,
        p.roster_status ?? null,
        p.height ?? null,
        p.weight ?? null,
        p.experience ?? null,
        p.school ?? null,
        JSON.stringify(payload),
      ]
    );
    if (res.rows[0]?.inserted) inserted += 1;
    else updated += 1;
  }
  return { inserted, updated };
}

async function applyMutations(client: PoolClient, mutations: RefreshMutation[]) {
  let opened = 0;
  let touched = 0;
  let closed = 0;
  let teamChanges = 0;

  const pairs = groupTeamChangePairs(mutations);
  const pairCloseIds = new Set(pairs.map((p) => p.close.stintId));
  const pairOpenKeys = new Set(
    pairs.map((p) => `${p.open.playerEntityId}|${p.open.teamId}|team_change`)
  );

  // Atomic team changes via savepoints (caller owns the outer transaction).
  for (const pair of pairs) {
    const sp = `tc_${pair.close.stintId}`;
    await client.query(`SAVEPOINT ${sp}`);
    try {
      await client.query(
        `
        UPDATE analytics.player_team_stints
        SET observed_to = $2::date, updated_at = now()
        WHERE stint_id = $1 AND observed_to IS NULL AND season = $3
        `,
        [pair.close.stintId, pair.close.observedTo, ANALYTICS_SEASON]
      );
      await client.query(
        `
        INSERT INTO analytics.player_team_stints (
          season, player_entity_id, player_id, team_id,
          observed_from, observed_to, source, source_player_id,
          jersey, position, membership_type
        ) VALUES (
          $1, $2::uuid, $3, $4, $5::date, NULL, $6, $7, $8, $9, NULL
        )
        `,
        [
          pair.open.season,
          pair.open.playerEntityId,
          pair.open.playerId,
          pair.open.teamId,
          pair.open.observedFrom,
          pair.open.source,
          pair.open.sourcePlayerId,
          pair.open.jersey,
          pair.open.position,
        ]
      );
      await client.query(`RELEASE SAVEPOINT ${sp}`);
      closed += 1;
      opened += 1;
      teamChanges += 1;
    } catch (e) {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      throw e;
    }
  }

  for (const m of mutations) {
    if (m.type === 'close' && pairCloseIds.has(m.stintId)) continue;
    if (
      m.type === 'open' &&
      m.category === 'team_change_open' &&
      pairOpenKeys.has(`${m.playerEntityId}|${m.teamId}|team_change`)
    ) {
      continue;
    }

    if (m.type === 'touch') {
      await client.query(
        `
        UPDATE analytics.player_team_stints
        SET jersey = $2,
            position = $3,
            source_player_id = COALESCE($4, source_player_id),
            updated_at = now()
        WHERE stint_id = $1 AND observed_to IS NULL AND season = $5
        `,
        [m.stintId, m.jersey, m.position, m.sourcePlayerId, ANALYTICS_SEASON]
      );
      touched += 1;
    } else if (m.type === 'open') {
      await client.query(
        `
        INSERT INTO analytics.player_team_stints (
          season, player_entity_id, player_id, team_id,
          observed_from, observed_to, source, source_player_id,
          jersey, position, membership_type
        ) VALUES (
          $1, $2::uuid, $3, $4, $5::date, NULL, $6, $7, $8, $9, NULL
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
        ]
      );
      opened += 1;
    } else if (m.type === 'close') {
      await client.query(
        `
        UPDATE analytics.player_team_stints
        SET observed_to = $2::date, updated_at = now()
        WHERE stint_id = $1 AND observed_to IS NULL AND season = $3
        `,
        [m.stintId, m.observedTo, ANALYTICS_SEASON]
      );
      closed += 1;
    }
  }

  return { opened, touched, closed, teamChanges };
}

async function main() {
  if (ROSTER_REFRESH_TOUCHES_OTHER_SEASONS) {
    throw new Error('Refresh must not touch other seasons');
  }

  const fetchPath = path.join(OUT, `${SEASON_LABEL}-nba-fetch.json`);
  if (!SKIP_FETCH) {
    console.log(`Fetching CommonTeamRoster for ${SEASON_LABEL}...`);
    runPythonFetch(SEASON_LABEL, fetchPath);
  } else if (!fs.existsSync(fetchPath)) {
    throw new Error(`Missing fetch JSON at ${fetchPath}; omit --skip-fetch`);
  }

  const fetch = JSON.parse(fs.readFileSync(fetchPath, 'utf8')) as FetchJson;
  const snapshotAt = new Date(fetch.fetched_at);
  const snapshotDate = fetch.fetched_at.slice(0, 10);

  const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });
  const client = await pool.connect();

  try {
    const fetchIntegrity = evaluateFetchIntegrity({
      teamsAttempted: fetch.teams_attempted,
      teamsSuccessful: fetch.teams_successful,
      teamsFailed: fetch.teams_failed ?? [],
      totalObservations: fetch.total_roster_players,
      playersPerTeam: fetch.players_per_team ?? {},
      duplicateNbaPlayerIds: fetch.duplicate_nba_player_ids ?? [],
      minTeamSize: fetch.roster_size_stats?.min ?? null,
    });

    const rawStats = await writeRawSnapshots(
      client,
      fetch,
      snapshotAt,
      snapshotDate,
      !APPLY
    );

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
    const existingRows = await client.query<{
      stint_id: number;
      player_entity_id: string;
      player_id: string | null;
      team_id: string;
      season: string;
      observed_from: string;
      jersey: string | null;
      position: string | null;
      source: string;
      source_player_id: string | null;
    }>(
      `
      SELECT stint_id, player_entity_id::text, player_id, team_id, season,
             observed_from::text, jersey, position, source, source_player_id
      FROM analytics.player_team_stints
      WHERE season = $1 AND observed_to IS NULL
      `,
      [ANALYTICS_SEASON]
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
      const o: RosterObservation = {
        nbaPlayerId: p.nba_player_id,
        fullName: p.player_name,
        teamAbbr: p.team_abbreviation,
        teamInternalId: p.analytics_team_id,
        jersey: p.jersey,
        position: p.position,
        season: SEASON_LABEL,
      };
      return resolveRosterToEntity(o, index);
    });

    const part = partitionResolveResults({
      results,
      teamIdByAbbr,
      analyticsPlayerIds: new Set(analyticsIds.rows.map((r) => r.player_id)),
    });

    const existingOpen: ExistingEntityOpenStint[] = existingRows.rows.map(
      (r) => ({
        stintId: r.stint_id,
        playerEntityId: r.player_entity_id,
        playerId: r.player_id,
        teamId: r.team_id,
        season: r.season,
        observedFrom: r.observed_from,
        jersey: r.jersey,
        position: r.position,
        source: r.source,
        sourcePlayerId: r.source_player_id,
      })
    );

    const plan = planEntityRosterRefresh({
      season: ANALYTICS_SEASON,
      observedOn: snapshotDate,
      resolvedObservations: part.resolved,
      existingOpenStints: existingOpen,
      protectedNbaPlayerIds: part.protectedNbaPlayerIds,
      allowsCloses: fetchIntegrity.allowsCloses,
    });

    assertSingleOpenPerEntitySeason(
      plan.mutations,
      existingOpen,
      ANALYTICS_SEASON
    );

    const massClose = evaluateMassCloseGuard({
      openCount: existingOpen.length,
      proposedCloseMissing: plan.counts.close_missing,
      allowLargeClose: ALLOW_LARGE_CLOSE,
    });

    const allMutations = [...part.skipMutations, ...plan.mutations];

    const safeToApply =
      fetchIntegrity.ok &&
      massClose.ok &&
      plan.duplicateEntities.length === 0 &&
      plan.multiTeamNbaIds.length === 0 &&
      plan.counts.conflict === 0;

    let applied = {
      opened: 0,
      touched: 0,
      closed: 0,
      teamChanges: 0,
    };
    let applyBlockedReason: string | null = null;

    if (APPLY) {
      if (!safeToApply) {
        applyBlockedReason = [
          ...fetchIntegrity.failures,
          massClose.reason,
          plan.duplicateEntities.length
            ? `duplicateEntities=${plan.duplicateEntities.length}`
            : null,
          plan.multiTeamNbaIds.length
            ? `multiTeamNbaIds=${plan.multiTeamNbaIds.join(',')}`
            : null,
          plan.counts.conflict ? `conflicts=${plan.counts.conflict}` : null,
        ]
          .filter(Boolean)
          .join('; ');
      } else {
        await client.query('BEGIN');
        try {
          // Raw already written outside; apply stint mutations
          applied = await applyMutations(client, plan.mutations);
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        }
      }
    }

    const openAfter = await client.query<{
      n: number;
      nba_only: number;
      bdl: number;
    }>(
      `
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE player_id IS NULL)::int AS nba_only,
             count(*) FILTER (WHERE player_id IS NOT NULL)::int AS bdl
      FROM analytics.player_team_stints
      WHERE season = $1 AND observed_to IS NULL
      `,
      [ANALYTICS_SEASON]
    );

    const hist2025 = await client.query<{
      total: number;
      open: number;
      closed: number;
    }>(
      `
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE observed_to IS NULL)::int AS open,
             count(*) FILTER (WHERE observed_to IS NOT NULL)::int AS closed
      FROM analytics.player_team_stints
      WHERE season = '2025'
      `
    );

    const classD = part.skipMutations
      .filter((m) => m.type === 'skip_ambiguous')
      .map((m) => ({
        nba_player_id: m.nbaPlayerId,
        name: m.fullName,
        team: m.teamAbbr,
        reason: m.reason,
      }));

    const report = {
      phase: '2.T.2E',
      mode: MODE,
      lineage: {
        snapshot_at: fetch.fetched_at,
        snapshot_date: snapshotDate,
        provider: ROSTER_REFRESH_SOURCE,
        provider_season: SEASON_LABEL,
        analytics_season: ANALYTICS_SEASON,
        teams_fetched: fetch.teams_successful,
        teams_attempted: fetch.teams_attempted,
        observations_fetched: fetch.total_roster_players,
        fetch_path: fetchPath,
        skip_fetch: SKIP_FETCH,
      },
      fetch_integrity: fetchIntegrity,
      raw_snapshots: rawStats,
      resolution: part.resolutionCounts,
      plan_counts: plan.counts,
      skip_counts: {
        ambiguous: part.resolutionCounts.ambiguous,
        unresolved: part.resolutionCounts.unresolved,
      },
      mass_close_guard: massClose,
      safe_to_apply: safeToApply,
      apply_blocked_reason: applyBlockedReason,
      applied: APPLY && !applyBlockedReason ? applied : null,
      open_stints_after: openAfter.rows[0],
      hist_2025: hist2025.rows[0],
      class_d: classD,
      expected_class_d: EXPECTED_CLASS_D_2026,
      view_semantics:
        'analytics.team_roster_current = all open stints (observed_to IS NULL). Always filter by season.',
      scheduling_recommendation: {
        offseason_training_camp: 'daily',
        active_season_trade_period: 'daily (higher frequency later if needed)',
        production_scheduler: 'not enabled in this phase',
      },
      out_of_scope: {
        no_team_roster_ui: true,
        no_production_config: true,
        no_class_d_auto_resolve: true,
        no_other_season_mutation: true,
      },
      trustworthy_for_ui:
        fetchIntegrity.ok &&
        (openAfter.rows[0]?.n ?? 0) >= 570 &&
        (hist2025.rows[0]?.total ?? 0) === 697,
      sample_mutations: allMutations
        .filter((m) => m.type !== 'touch')
        .slice(0, 40),
    };

    const reportName = `${SEASON_LABEL}-roster-refresh-${snapshotDate}.json`;
    writeJson(reportName, report);
    writeJson(
      MODE === 'apply'
        ? `${SEASON_LABEL}-roster-refresh-latest-apply.json`
        : `${SEASON_LABEL}-roster-refresh-latest-dry-run.json`,
      report
    );
    writeJson(`${SEASON_LABEL}-class-d-after-refresh.json`, {
      phase: '2.T.2E',
      count: classD.length,
      rows: classD,
    });

    console.log(
      JSON.stringify(
        {
          mode: MODE,
          fetch_ok: fetchIntegrity.ok,
          mass_close_ok: massClose.ok,
          plan_counts: plan.counts,
          resolution: part.resolutionCounts,
          applied: report.applied,
          apply_blocked_reason: applyBlockedReason,
          open_after: openAfter.rows[0],
          hist_2025: hist2025.rows[0],
          trustworthy_for_ui: report.trustworthy_for_ui,
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
