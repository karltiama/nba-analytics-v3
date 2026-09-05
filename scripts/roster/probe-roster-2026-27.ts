/**
 * Phase 2.T.2D.1 — 2026–27 roster probe / dry-run (no canonical 2026 stint writes).
 *
 * 1) Fetch CommonTeamRoster via Python probe (fetch-only)
 * 2) Resolve identities fail-closed
 * 3) Compare vs open 2025 stints + last 2025 PGL
 * 4) Simulate 2026 seed plan
 *
 * Usage:
 *   npx tsx scripts/roster/probe-roster-2026-27.ts
 *   npx tsx scripts/roster/probe-roster-2026-27.ts --skip-fetch   # reuse existing fetch JSON
 */

import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { findDuplicateCanonicalAssignments } from '../../lib/roster/identity-integrity';
import {
  buildResolverIndex,
  resolveRosterIdentity,
  type AnalyticsPlayerCandidate,
  type ProviderMapRow,
  type ResolveResult,
  type RosterObservation,
} from '../../lib/roster/identity-resolver';
import {
  ROSTER_PROBE_WRITES_STINTS,
  compare2026VsOpen2025,
  plan2026StintSeedDryRun,
  summarizeResolution,
  verify2026SeasonSemantics,
  type LastPglTeam,
  type Open2025Stint,
} from '../../lib/roster/roster-season-probe';

const SEASON_LABEL = '2026-27';
const OUT_DIR = path.join(process.cwd(), 'reports', 'roster');
const FETCH_PATH = path.join(OUT_DIR, `${SEASON_LABEL}-nba-fetch.json`);
const OBSERVED_ON = new Date().toISOString().slice(0, 10);

const args = new Set(process.argv.slice(2));
const SKIP_FETCH = args.has('--skip-fetch');

function writeJson(name: string, data: unknown) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Wrote ${p}`);
}

type FetchPlayer = {
  nba_player_id: string;
  player_name: string;
  team_abbreviation: string;
  analytics_team_id: string;
  jersey: string | null;
  position: string | null;
  experience?: string | number | null;
  school?: string | null;
  roster_status?: string | null;
  api_season_field?: string | null;
  height?: string | null;
  weight?: string | null;
};

type FetchReport = {
  teams_attempted: number;
  teams_successful: number;
  teams_failed: unknown[];
  total_roster_players: number;
  players_per_team: Record<string, number>;
  roster_size_stats: { min: number | null; median: number | null; max: number | null };
  suspicious_roster_sizes: Record<string, number>;
  duplicate_nba_player_ids: unknown[];
  schema: Record<string, unknown>;
  players: FetchPlayer[];
  writes: Record<string, boolean>;
};

function runFetchProbe(): void {
  const py = process.env.PYTHON || 'python';
  const script = path.join(
    process.cwd(),
    'scripts',
    'roster',
    'probe_commonteamroster.py'
  );
  console.log(`Running fetch-only probe: ${py} ${script} --season ${SEASON_LABEL}`);
  const res = spawnSync(
    py,
    [script, '--season', SEASON_LABEL, '--out', FETCH_PATH],
    {
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
    }
  );
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  if (res.status !== 0) {
    throw new Error(`Fetch probe failed with exit ${res.status}`);
  }
}

async function main() {
  if (ROSTER_PROBE_WRITES_STINTS) {
    throw new Error('Probe must not write stints');
  }

  const seasonSemantics = verify2026SeasonSemantics();
  console.log('Season semantics', seasonSemantics);

  if (!SKIP_FETCH) {
    runFetchProbe();
  } else if (!fs.existsSync(FETCH_PATH)) {
    throw new Error(`--skip-fetch but missing ${FETCH_PATH}`);
  }

  const fetch = JSON.parse(fs.readFileSync(FETCH_PATH, 'utf8')) as FetchReport;

  const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });
  try {
    const maps = await pool.query<{
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
    const analytics = await pool.query<{
      player_id: string;
      full_name: string;
      position: string | null;
    }>(`SELECT player_id, full_name, position FROM analytics.players`);

    const pglTeams = await pool.query<{
      player_id: string;
      abbreviation: string;
    }>(
      `
      SELECT DISTINCT pgl.player_id, t.abbreviation
      FROM analytics.player_game_logs pgl
      JOIN analytics.teams t ON t.team_id = pgl.team_id
      WHERE pgl.season = '2025'
      `
    );
    const pglByPlayer = new Map<string, string[]>();
    for (const r of pglTeams.rows) {
      const list = pglByPlayer.get(r.player_id) ?? [];
      list.push(r.abbreviation);
      pglByPlayer.set(r.player_id, list);
    }

    const lastPgl = await pool.query<{
      player_id: string;
      abbreviation: string;
      last_game: string;
    }>(
      `
      SELECT DISTINCT ON (pgl.player_id)
        pgl.player_id,
        t.abbreviation,
        pgl.game_date::text AS last_game
      FROM analytics.player_game_logs pgl
      JOIN analytics.teams t ON t.team_id = pgl.team_id
      WHERE pgl.season = '2025'
      ORDER BY pgl.player_id, pgl.game_date DESC, pgl.game_id DESC
      `
    );
    const lastPgl2025ByPlayer = new Map<string, LastPglTeam>();
    for (const r of lastPgl.rows) {
      lastPgl2025ByPlayer.set(r.player_id, {
        playerId: r.player_id,
        teamAbbr: r.abbreviation,
        lastGameDate: r.last_game.slice(0, 10),
      });
    }

    const open2025 = await pool.query<{
      player_id: string;
      team_id: string;
      abbreviation: string;
    }>(
      `
      SELECT s.player_id, s.team_id, t.abbreviation
      FROM analytics.player_team_stints s
      JOIN analytics.teams t ON t.team_id = s.team_id
      WHERE s.season = '2025' AND s.observed_to IS NULL
      `
    );
    const open2025ByPlayer = new Map<string, Open2025Stint>();
    for (const r of open2025.rows) {
      open2025ByPlayer.set(r.player_id, {
        playerId: r.player_id,
        teamId: r.team_id,
        teamAbbr: r.abbreviation,
      });
    }

    // Confirm zero existing 2026 stints (read-only check)
    const existing2026 = await pool.query<{ n: number }>(
      `
      SELECT count(*)::int AS n
      FROM analytics.player_team_stints
      WHERE season = '2026'
      `
    );

    const index = buildResolverIndex({
      providerMaps: maps.rows.map(
        (r): ProviderMapRow => ({
          provider: r.provider as 'nba' | 'balldontlie',
          providerId: r.provider_id,
          internalId: r.internal_id,
        })
      ),
      analyticsPlayers: analytics.rows.map(
        (r): AnalyticsPlayerCandidate => ({
          playerId: r.player_id,
          fullName: r.full_name,
          position: r.position,
          pglTeamAbbrevs: pglByPlayer.get(r.player_id) ?? [],
        })
      ),
    });

    const results: ResolveResult[] = [];
    for (const p of fetch.players) {
      const obs: RosterObservation = {
        nbaPlayerId: p.nba_player_id,
        fullName: p.player_name,
        teamAbbr: p.team_abbreviation,
        teamInternalId: p.analytics_team_id,
        jersey: p.jersey,
        position: p.position,
        season: SEASON_LABEL,
      };
      results.push(resolveRosterIdentity(obs, index));
    }

    const resolution = summarizeResolution(results);
    const seedPlan = plan2026StintSeedDryRun({
      observedOn: OBSERVED_ON,
      results,
    });

    const offseason = compare2026VsOpen2025({
      results,
      open2025ByPlayer,
      lastPgl2025ByPlayer,
    });

    const offseasonCounts = offseason.reduce(
      (acc, row) => {
        acc[row.classification] = (acc[row.classification] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    // Focus gaps: rookies / new / bridges / name issues / wrong historic
    const gapRows = results
      .filter(
        (r) =>
          r.status === 'unresolved' ||
          r.status === 'ambiguous' ||
          r.gapCause === 'rookie_or_new_player' ||
          r.gapCause === 'analytics_player_absent' ||
          r.gapCause === 'shared_to_bdl_mapping_missing' ||
          r.gapCause === 'analytics_player_exists_bridge_missing' ||
          r.gapCause === 'diacritic_mismatch' ||
          r.gapCause === 'suffix_mismatch' ||
          r.gapCause === 'duplicate_name_ambiguity'
      )
      .map((r) => {
        const lastPgl = r.analyticsPlayerId
          ? lastPgl2025ByPlayer.get(r.analyticsPlayerId)
          : undefined;
        const open = r.analyticsPlayerId
          ? open2025ByPlayer.get(r.analyticsPlayerId)
          : undefined;
        const bdlCandidates = maps.rows
          .filter(
            (m) =>
              m.provider === 'balldontlie' &&
              (m.internal_id === r.nbaPlayerId ||
                r.candidates.some((c) => c.playerId === m.provider_id))
          )
          .map((m) => m.provider_id);
        return {
          nba_player_id: r.nbaPlayerId,
          name: r.fullName,
          team: r.teamAbbr,
          jersey: r.jersey,
          position: r.position,
          status: r.status,
          gap_cause: r.gapCause,
          reason: r.reason,
          analytics_player_id: r.analyticsPlayerId,
          candidate_analytics_ids: r.candidates.map((c) => c.playerId),
          candidate_bdl_ids: [...new Set(bdlCandidates)],
          open_2025_team: open?.teamAbbr ?? null,
          last_pgl_2025_team: lastPgl?.teamAbbr ?? null,
          recommended_next_action:
            r.gapCause === 'rookie_or_new_player' ||
            r.gapCause === 'analytics_player_absent'
              ? 'canonical_player_upsert_then_provider_bridge'
              : r.gapCause === 'shared_to_bdl_mapping_missing' ||
                  r.gapCause === 'analytics_player_exists_bridge_missing'
                ? 'safe_provider_bridge_backfill'
                : r.status === 'ambiguous'
                  ? 'manual_identity_disambiguation'
                  : 'manual_review',
        };
      });

    const actionCounts = seedPlan.actions.reduce(
      (acc, a) => {
        acc[a.action] = (acc[a.action] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const wouldOpen = seedPlan.actions.filter(
      (a) => a.action === 'open_new_2026_stint'
    );
    const openPlayerDupes = findDuplicateCanonicalAssignments(
      wouldOpen.map((a) => ({
        nbaPlayerId: a.nbaPlayerId,
        analyticsPlayerId: a.analyticsPlayerId!,
        fullName: a.fullName,
        teamAbbr: a.teamAbbr,
      }))
    );

    const needsCanonicalUpsert = gapRows.some(
      (g) =>
        g.recommended_next_action ===
        'canonical_player_upsert_then_provider_bridge'
    );

    const ready =
      fetch.teams_successful === 30 &&
      fetch.teams_failed.length === 0 &&
      Object.keys(fetch.suspicious_roster_sizes || {}).length === 0 &&
      (fetch.duplicate_nba_player_ids?.length ?? 0) === 0 &&
      seedPlan.duplicateCanonical.length === 0 &&
      seedPlan.multiTeamNbaIds.length === 0 &&
      openPlayerDupes.length === 0 &&
      existing2026.rows[0]!.n === 0 &&
      resolution.resolution_pct >= 90 &&
      seasonSemantics.analyticsSeason === '2026';

    const recommendation = ready
      ? needsCanonicalUpsert
        ? 'do_not_proceed_until_canonical_player_upsert_narrow_step'
        : 'proceed_to_2T2D2_with_fail_closed_queue'
      : 'do_not_proceed';

    const manualQueue = gapRows.filter(
      (g) => g.status === 'unresolved' || g.status === 'ambiguous'
    );

    const report = {
      phase: '2.T.2D.1',
      mode: 'dry_run_probe',
      observed_on: OBSERVED_ON,
      season_semantics: seasonSemantics,
      writes_confirmed_none: {
        ...fetch.writes,
        analytics_player_team_stints_2026: false,
        team_roster_ui: false,
        production_config: false,
        existing_2026_stint_rows_before_probe: existing2026.rows[0]!.n,
      },
      fetch_summary: {
        teams_attempted: fetch.teams_attempted,
        teams_successful: fetch.teams_successful,
        teams_failed: fetch.teams_failed,
        total_roster_players: fetch.total_roster_players,
        players_per_team: fetch.players_per_team,
        roster_size_stats: fetch.roster_size_stats,
        suspicious_roster_sizes: fetch.suspicious_roster_sizes,
        duplicate_nba_player_ids: fetch.duplicate_nba_player_ids,
        schema: fetch.schema,
      },
      identity_resolution: resolution,
      offseason_preview: {
        counts: offseasonCounts,
        sample_team_changes: offseason
          .filter((r) => r.classification === 'offseason_team_change')
          .slice(0, 40),
        sample_no_prior_open: offseason
          .filter((r) => r.classification === 'no_prior_open_stint')
          .slice(0, 40),
      },
      rookie_new_player_gaps: gapRows,
      simulated_seed: {
        action_counts: actionCounts,
        open_new_2026_stint: wouldOpen.length,
        duplicate_canonical: seedPlan.duplicateCanonical,
        multi_team_nba_ids: seedPlan.multiTeamNbaIds,
        open_player_dupes_after_filter: openPlayerDupes,
        sample_actions: seedPlan.actions.slice(0, 25),
      },
      canonical_player_upsert_needed: needsCanonicalUpsert,
      readiness: {
        ready_for_2T2D2: ready && !needsCanonicalUpsert,
        recommendation,
        criteria: {
          teams_30_30: fetch.teams_successful === 30,
          realistic_roster_sizes:
            Object.keys(fetch.suspicious_roster_sizes || {}).length === 0,
          no_duplicate_nba_ids:
            (fetch.duplicate_nba_player_ids?.length ?? 0) === 0,
          no_duplicate_canonical: seedPlan.duplicateCanonical.length === 0,
          no_cross_team_collisions: seedPlan.multiTeamNbaIds.length === 0,
          resolution_pct: resolution.resolution_pct,
          unresolved_queued: manualQueue.length,
          season_normalization_ok: seasonSemantics.analyticsSeason === '2026',
          no_existing_2026_stints: existing2026.rows[0]!.n === 0,
        },
      },
    };

    writeJson('2026-27-roster-probe-summary.json', report);
    writeJson('2026-27-manual-review-queue.json', {
      note: 'Separate from 2025–26 identity queue. Fail-closed; do not auto-resolve.',
      season: SEASON_LABEL,
      count: manualQueue.length,
      rows: manualQueue,
    });
    writeJson('2026-27-simulated-stint-seed-plan.json', {
      note: 'DRY RUN ONLY — not applied. season must be analytics start-year 2026.',
      observed_on: OBSERVED_ON,
      action_counts: actionCounts,
      actions: seedPlan.actions,
    });
    writeJson('2026-27-offseason-compare.json', {
      counts: offseasonCounts,
      rows: offseason,
    });
    writeJson('2026-27-rookie-new-player-gaps.json', { rows: gapRows });

    console.log(
      JSON.stringify(
        {
          teams: `${fetch.teams_successful}/${fetch.teams_attempted}`,
          players: fetch.total_roster_players,
          resolution_pct: resolution.resolution_pct,
          unresolved: resolution.unresolved,
          ambiguous: resolution.ambiguous,
          action_counts: actionCounts,
          offseason_counts: offseasonCounts,
          canonical_upsert_needed: needsCanonicalUpsert,
          recommendation,
          existing_2026_stints: existing2026.rows[0]!.n,
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
