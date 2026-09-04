/**
 * Phase 2.T.2A — Resolve 2025–26 NBA.com roster identities.
 *
 * Reads public.player_team_rosters (season 2025-26) + provider_id_map + analytics.
 * Writes reports under reports/roster/.
 *
 * Usage:
 *   npx tsx scripts/roster/resolve-nba-roster-identities.ts
 *   npx tsx scripts/roster/resolve-nba-roster-identities.ts --backfill-dry-run
 *   npx tsx scripts/roster/resolve-nba-roster-identities.ts --backfill-apply
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import {
  buildResolverIndex,
  classifyGapCounts,
  resolveRosterIdentity,
  type AnalyticsPlayerCandidate,
  type ProviderMapRow,
  type ResolveResult,
  type RosterObservation,
} from '../../lib/roster/identity-resolver';
import { decideBdlBridgeBackfill } from '../../lib/roster/provider-map-backfill';
import { findDuplicateCanonicalAssignments } from '../../lib/roster/identity-integrity';

const SEASON_NBA = '2025-26';
const SEASON_ANALYTICS = '2025';
const OUT_DIR = path.join(process.cwd(), 'reports', 'roster');

const args = new Set(process.argv.slice(2));
const BACKFILL_DRY = args.has('--backfill-dry-run');
const BACKFILL_APPLY = args.has('--backfill-apply');

function writeJson(name: string, data: unknown) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Wrote ${p}`);
}

async function main() {
  const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

  const rosterRows = await pool.query<{
    player_id: string;
    full_name: string;
    team_id: string;
    abbreviation: string;
    jersey: string | null;
    position: string | null;
    active: boolean | null;
  }>(
    `
    SELECT ptr.player_id, p.full_name, ptr.team_id, t.abbreviation,
           ptr.jersey, p.position, ptr.active
    FROM player_team_rosters ptr
    JOIN players p ON p.player_id = ptr.player_id
    JOIN teams t ON t.team_id = ptr.team_id
    WHERE ptr.season = $1
    ORDER BY t.abbreviation, p.full_name
    `,
    [SEASON_NBA]
  );

  const maps = await pool.query<{
    provider: string;
    provider_id: string;
    internal_id: string;
  }>(
    `
    SELECT provider, provider_id, internal_id
    FROM provider_id_map
    WHERE entity_type = 'player'
      AND provider IN ('nba', 'balldontlie')
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
    WHERE pgl.season = $1
    `,
    [SEASON_ANALYTICS]
  );

  const pglByPlayer = new Map<string, string[]>();
  for (const row of pglTeams.rows) {
    const list = pglByPlayer.get(row.player_id) ?? [];
    list.push(row.abbreviation);
    pglByPlayer.set(row.player_id, list);
  }

  const providerMaps: ProviderMapRow[] = maps.rows
    .filter((r) => r.provider === 'nba' || r.provider === 'balldontlie')
    .map((r) => ({
      provider: r.provider as 'nba' | 'balldontlie',
      providerId: r.provider_id,
      internalId: r.internal_id,
    }));

  const analyticsPlayers: AnalyticsPlayerCandidate[] = analytics.rows.map((r) => ({
    playerId: r.player_id,
    fullName: r.full_name,
    position: r.position,
    pglTeamAbbrevs: pglByPlayer.get(r.player_id) ?? [],
  }));

  const index = buildResolverIndex({ providerMaps, analyticsPlayers });

  const observations: RosterObservation[] = rosterRows.rows.map((r) => ({
    nbaPlayerId: r.player_id,
    fullName: r.full_name,
    teamAbbr: r.abbreviation,
    teamInternalId: r.team_id,
    jersey: r.jersey,
    position: r.position,
    season: SEASON_NBA,
  }));

  const results: ResolveResult[] = observations.map((o) => resolveRosterIdentity(o, index));

  const resolvedAssignments = results
    .filter(
      (r) =>
        (r.status === 'provider_match' || r.status === 'safe_fallback_match') &&
        r.analyticsPlayerId
    )
    .map((r) => ({
      nbaPlayerId: r.nbaPlayerId,
      analyticsPlayerId: r.analyticsPlayerId!,
      fullName: r.fullName,
      teamAbbr: r.teamAbbr,
    }));
  const duplicateCanonicalAssignments =
    findDuplicateCanonicalAssignments(resolvedAssignments);

  const statusCounts = {
    provider_match: results.filter((r) => r.status === 'provider_match').length,
    safe_fallback_match: results.filter((r) => r.status === 'safe_fallback_match').length,
    unresolved: results.filter((r) => r.status === 'unresolved').length,
    ambiguous: results.filter((r) => r.status === 'ambiguous').length,
  };
  const resolved =
    statusCounts.provider_match + statusCounts.safe_fallback_match;
  const pct = observations.length
    ? Number(((resolved / observations.length) * 100).toFixed(2))
    : 0;

  const byTeam: Record<string, { total: number; resolved: number; unresolved: number; ambiguous: number }> = {};
  for (let i = 0; i < observations.length; i++) {
    const team = observations[i].teamAbbr;
    const r = results[i];
    if (!byTeam[team]) {
      byTeam[team] = { total: 0, resolved: 0, unresolved: 0, ambiguous: 0 };
    }
    byTeam[team].total += 1;
    if (r.status === 'provider_match' || r.status === 'safe_fallback_match') {
      byTeam[team].resolved += 1;
    } else if (r.status === 'unresolved') {
      byTeam[team].unresolved += 1;
    } else {
      byTeam[team].ambiguous += 1;
    }
  }

  const gapCounts = classifyGapCounts(results);

  const coverage = {
    season: SEASON_NBA,
    analytics_season_for_pgl: SEASON_ANALYTICS,
    snapshot_note:
      'CommonTeamRoster / player_team_rosters is a membership SNAPSHOT (player observed on team at fetch), not exact trade/signing transaction history.',
    total_roster_players: observations.length,
    teams: Object.keys(byTeam).length,
    status_counts: statusCounts,
    resolved,
    percent_resolved: pct,
    unique_analytics_players: new Set(
      resolvedAssignments.map((a) => a.analyticsPlayerId)
    ).size,
    duplicate_canonical_assignments: duplicateCanonicalAssignments,
    gap_counts: gapCounts,
    by_team: byTeam,
    players_per_team: Object.fromEntries(
      Object.entries(byTeam).map(([k, v]) => [k, v.total])
    ),
  };

  writeJson('2025-26-identity-coverage.json', coverage);
  writeJson(
    '2025-26-identity-results.json',
    results.map((r, i) => ({
      ...r,
      teamInternalId: observations[i].teamInternalId,
    }))
  );

  // Manual review queue
  const review = results
    .map((r, i) => ({ r, o: observations[i] }))
    .filter(({ r }) => r.status === 'unresolved' || r.status === 'ambiguous')
    .map(({ r, o }) => ({
      nba_player_id: r.nbaPlayerId,
      nba_name: r.fullName,
      team: r.teamAbbr,
      jersey: r.jersey,
      position: r.position,
      status: r.status,
      gap_cause: r.gapCause,
      reason: r.reason,
      candidates: r.candidates,
      recommended_next_action:
        r.status === 'ambiguous'
          ? 'Manual disambiguation — inspect candidates + game logs; do not auto-map'
          : r.gapCause === 'analytics_player_absent' || r.gapCause === 'rookie_or_new_player'
            ? 'Ensure player exists in analytics.players (BDL id), then add balldontlie bridge'
            : r.gapCause === 'shared_to_bdl_mapping_missing' ||
                r.gapCause === 'analytics_player_exists_bridge_missing'
              ? 'Add balldontlie provider_id_map bridge after confirming BDL id'
              : 'Inspect identity chain and add missing provider_id_map rows',
    }));

  writeJson('2025-26-manual-review-queue.json', {
    count: review.length,
    items: review,
  });

  // --- Backfill high-confidence bridges ---
  const existingMaps = providerMaps.map((m) => ({
    provider: m.provider,
    providerId: m.providerId,
    internalId: m.internalId,
  }));

  const decisions = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== 'safe_fallback_match' || !r.analyticsPlayerId || !r.method) continue;
    // Only backfill when provider path was incomplete (fallback used).
    const d = decideBdlBridgeBackfill({
      nbaPlayerId: r.nbaPlayerId,
      fullName: r.fullName,
      analyticsPlayerId: r.analyticsPlayerId,
      resolutionMethod: r.method,
      existingMaps,
    });
    decisions.push(d);
    if (d.action === 'insert') {
      // Optimistic local update so idempotency within batch works.
      existingMaps.push({
        provider: 'balldontlie',
        providerId: d.proposal.analyticsPlayerId,
        internalId: d.proposal.internalId,
      });
    }
  }

  const backfillPlan = {
    dry_run: !BACKFILL_APPLY,
    insert: decisions.filter((d) => d.action === 'insert'),
    skip_already_present: decisions.filter((d) => d.action === 'skip_already_present'),
    conflict: decisions.filter((d) => d.action === 'conflict'),
    reject: decisions.filter((d) => d.action === 'reject'),
  };
  writeJson('2025-26-backfill-plan.json', backfillPlan);

  if (BACKFILL_DRY || BACKFILL_APPLY) {
    console.log(
      `Backfill plan: insert=${backfillPlan.insert.length} skip=${backfillPlan.skip_already_present.length} conflict=${backfillPlan.conflict.length} reject=${backfillPlan.reject.length}`
    );
  }

  if (BACKFILL_APPLY) {
    let inserted = 0;
    let blocked = 0;
    for (const d of backfillPlan.insert) {
      if (d.action !== 'insert') continue;
      const meta = {
        source: 'phase2_t2a_roster_identity',
        method: d.proposal.reason,
        full_name: d.proposal.fullName,
        nba_player_id: d.proposal.nbaPlayerId,
        season: SEASON_NBA,
      };
      // Fail-closed per row: only insert if provider_id absent; never update existing.
      const existing = await pool.query(
        `
        SELECT internal_id FROM provider_id_map
        WHERE entity_type='player' AND provider='balldontlie' AND provider_id=$1
        `,
        [d.proposal.analyticsPlayerId]
      );
      if (existing.rows.length > 0) {
        if (existing.rows[0].internal_id !== d.proposal.internalId) {
          console.error(
            `Skip conflict BDL ${d.proposal.analyticsPlayerId}: maps to ${existing.rows[0].internal_id}, not ${d.proposal.internalId}`
          );
          blocked += 1;
          continue;
        }
        continue; // already present
      }
      const internalHit = await pool.query(
        `
        SELECT provider_id FROM provider_id_map
        WHERE entity_type='player' AND provider='balldontlie' AND internal_id=$1
        `,
        [d.proposal.internalId]
      );
      if (internalHit.rows.length > 0) {
        console.error(
          `Skip conflict internal ${d.proposal.internalId}: already bridged to ${internalHit.rows[0].provider_id}`
        );
        blocked += 1;
        continue;
      }

      const res = await pool.query(
        `
        INSERT INTO provider_id_map (
          entity_type, internal_id, provider, provider_id, metadata, fetched_at, created_at, updated_at
        ) VALUES (
          'player', $1, 'balldontlie', $2, $3::jsonb, now(), now(), now()
        )
        ON CONFLICT (entity_type, provider, provider_id) DO NOTHING
        `,
        [d.proposal.internalId, d.proposal.analyticsPlayerId, JSON.stringify(meta)]
      );
      inserted += res.rowCount ?? 0;
    }
    console.log(
      `Backfill applied: inserted=${inserted} blocked_conflicts=${blocked} plan_conflicts=${backfillPlan.conflict.length}`
    );
    if (blocked > 0 || backfillPlan.conflict.length > 0) {
      console.warn('Some identities remain conflicted — left untouched (fail-closed).');
    }
  }

  // --- PGL validation (not roster truth) ---
  const multiTeam = await pool.query<{
    player_id: string;
    full_name: string;
    teams: string;
    team_count: number;
  }>(
    `
    SELECT pgl.player_id, ap.full_name,
           string_agg(DISTINCT t.abbreviation, ',' ORDER BY t.abbreviation) AS teams,
           count(DISTINCT pgl.team_id)::int AS team_count
    FROM analytics.player_game_logs pgl
    JOIN analytics.players ap ON ap.player_id = pgl.player_id
    JOIN analytics.teams t ON t.team_id = pgl.team_id
    WHERE pgl.season = $1
    GROUP BY pgl.player_id, ap.full_name
    HAVING count(DISTINCT pgl.team_id) > 1
    ORDER BY team_count DESC, ap.full_name
    `,
    [SEASON_ANALYTICS]
  );

  const resolvedByAnalyticsId = new Map<string, ResolveResult>();
  for (const r of results) {
    if (r.analyticsPlayerId) resolvedByAnalyticsId.set(r.analyticsPlayerId, r);
  }

  const rosterNeverPlayed = results
    .filter((r) => r.analyticsPlayerId)
    .filter((r) => !(pglByPlayer.get(r.analyticsPlayerId!)?.length))
    .map((r) => ({
      nba_player_id: r.nbaPlayerId,
      name: r.fullName,
      roster_team: r.teamAbbr,
      analytics_player_id: r.analyticsPlayerId,
      note: 'On NBA.com snapshot roster but no 2025 analytics PGL',
    }));

  const pglNotOnRoster = await pool.query<{
    player_id: string;
    full_name: string;
    teams: string;
  }>(
    `
    WITH roster_analytics AS (
      SELECT DISTINCT unnest($1::text[]) AS player_id
    ),
    loggers AS (
      SELECT DISTINCT pgl.player_id, ap.full_name,
             string_agg(DISTINCT t.abbreviation, ',' ORDER BY t.abbreviation) AS teams
      FROM analytics.player_game_logs pgl
      JOIN analytics.players ap ON ap.player_id = pgl.player_id
      JOIN analytics.teams t ON t.team_id = pgl.team_id
      WHERE pgl.season = $2
      GROUP BY pgl.player_id, ap.full_name
    )
    SELECT l.player_id, l.full_name, l.teams
    FROM loggers l
    LEFT JOIN roster_analytics r ON r.player_id = l.player_id
    WHERE r.player_id IS NULL
    ORDER BY l.full_name
    `,
    [
      results.map((r) => r.analyticsPlayerId).filter(Boolean) as string[],
      SEASON_ANALYTICS,
    ]
  );

  writeJson('2025-26-pgl-validation.json', {
    note: 'PGL is validation/history evidence, not roster truth. No stints reconstructed.',
    multi_team_loggers: multiTeam.rows,
    multi_team_count: multiTeam.rows.length,
    roster_never_appeared_in_pgl: rosterNeverPlayed,
    roster_never_appeared_count: rosterNeverPlayed.length,
    pgl_not_on_nba_snapshot: pglNotOnRoster.rows.slice(0, 200),
    pgl_not_on_nba_snapshot_count: pglNotOnRoster.rows.length,
    likely_traded_or_temporary: multiTeam.rows.map((r) => ({
      ...r,
      on_final_snapshot: resolvedByAnalyticsId.has(r.player_id),
      snapshot_team: resolvedByAnalyticsId.get(r.player_id)?.teamAbbr ?? null,
      interpretation:
        'Appeared for multiple teams in 2025 PGL — candidate trade/temporary signing for stint model',
    })),
  });

  console.log(JSON.stringify(coverage, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
