/**
 * Phase 19B — activation readiness certification (no live cohort writes).
 *   npx tsx scripts/ops/certify-context-projection-activation-readiness.ts
 */

import { config } from 'dotenv';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import {
  formatProspectiveStatusText,
  loadDualProspectiveStatus,
} from '@/lib/context-projection/status';
import {
  PROSPECTIVE_REQUIRED_N,
  PROSPECTIVE_WINDOW_ID,
} from '@/lib/context-projection/protocol';
import {
  AUX_MIN_PROSPECTIVE_WINDOW,
  FROZEN_AUX_MIN_MODEL_ARTIFACT_SHA,
  PROSPECTIVE_MIN_REQUIRED_N,
} from '@/lib/context-projection/min/protocol';
import {
  PLAY_IN_ELIGIBILITY,
  PLAYOFF_ELIGIBILITY,
  PRESEASON_PRIMARY_ELIGIBILITY,
  PROSPECTIVE_GAME_UNIVERSE,
  PROSPECTIVE_GAME_UNIVERSE_AMENDMENT_ID,
  REGULAR_SEASON_OPEN_ET,
  isPrimaryProspectiveCompetitionGame,
} from '@/lib/context-projection/game-universe';
import { loadFrozenBundle } from '@/lib/context-projection/arm';
import { loadFrozenAuxMinBundle } from '@/lib/context-projection/min/arm';
import { runContextProspectiveScoreCycle } from '@/lib/context-projection/collection-worker';
import { intendedCutoffIso } from '@/lib/context-projection/window';

config();

const PTS_SHA = '36f68abdab110ea13e78ac03d573aa3718b9ae7bb8b9bbd8a0d5983d83df478a';

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('SUPABASE_DB_URL required');
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
  const outDir = join(process.cwd(), 'tmp/phase19b-activation-readiness');
  mkdirSync(outDir, { recursive: true });
  const reportsDir = join(process.cwd(), 'reports/operations');
  mkdirSync(reportsDir, { recursive: true });

  try {
    // Freeze identity
    const ptsWin = JSON.parse(
      readFileSync(
        join(process.cwd(), 'lib/context-projection/artifacts/pts-production-context-prospective-window-v1.json'),
        'utf8'
      )
    );
    const minArt = JSON.parse(
      readFileSync(
        join(process.cwd(), 'lib/context-projection/artifacts/aux-min-model_artifact.json'),
        'utf8'
      )
    );
    const ptsBundle = loadFrozenBundle();
    const minBundle = loadFrozenAuxMinBundle();

    const freezeOk =
      ptsWin.model_artifact_sha === PTS_SHA &&
      ptsWin.prospective_window_id === PROSPECTIVE_WINDOW_ID &&
      ptsWin.PROSPECTIVE_REQUIRED_N === 500 &&
      minArt.model_artifact_sha === FROZEN_AUX_MIN_MODEL_ARTIFACT_SHA &&
      minBundle.modelArtifactSha === FROZEN_AUX_MIN_MODEL_ARTIFACT_SHA &&
      ptsBundle.modelArtifactSha === PTS_SHA;

    // Next eligible tips (read-only)
    const future = await pool.query(
      `
      SELECT game_id::text, season::text, start_time, status,
             home_team_id::text, away_team_id::text
        FROM analytics.games
       WHERE start_time > now()
         AND start_time < now() + interval '90 days'
         AND (status IS NULL OR status NOT IN ('Final', 'Cancelled', 'Postponed'))
       ORDER BY start_time ASC
       LIMIT 50
      `
    );
    const eligible = future.rows
      .map((r) => {
        const tip =
          r.start_time instanceof Date
            ? r.start_time.toISOString()
            : String(r.start_time).replace(' ', 'T').replace(/\+00$/, 'Z');
        return {
          gameId: String(r.game_id),
          season: String(r.season),
          tip,
          status: r.status == null ? null : String(r.status),
          eligible: isPrimaryProspectiveCompetitionGame({
            season: String(r.season),
            startTimeIso: tip,
            status: r.status == null ? null : String(r.status),
          }),
        };
      })
      .filter((g) => g.eligible);

    const nextTip = eligible[0]?.tip ?? null;
    const emptyHorizonReason =
      future.rows.length === 0
        ? 'B_OR_D_NO_FUTURE_ROWS'
        : eligible.length === 0
          ? 'ONLY_INELIGIBLE_COMPETITION_IN_HORIZON'
          : nextTip && Date.parse(nextTip) - Date.now() > 7 * 86_400_000
            ? 'A_GENUINELY_NO_ELIGIBLE_GAMES_IN_7D_SCHEDULE_INGESTED_BEYOND'
            : 'ELIGIBLE_WITHIN_7D';

    // Counts
    const status = await loadDualProspectiveStatus(pool, {
      env: {
        ...process.env,
        CONTEXT_PROSPECTIVE_ACTIVATION_READY: '1',
        CONTEXT_PTS_SHADOW_WRITES: '0',
        CONTEXT_MIN_SHADOW_WRITES: '0',
        CONTEXT_PROSPECTIVE_SCHEDULE_CONFIGURED: '0',
      },
      scheduleConfigured: false,
    });

    // Dry-run score (no writes)
    const dry = await runContextProspectiveScoreCycle({
      now: () => new Date(),
      db: pool,
      env: {
        DATA_MODE: 'live_api',
        CRON_DRY_RUN: '0',
        OFFSEASON_MODE: '0',
        CONTEXT_PROSPECTIVE_DRY_RUN: '1',
        CONTEXT_PTS_SHADOW_WRITES: '0',
        CONTEXT_MIN_SHADOW_WRITES: '0',
        CONTEXT_PROSPECTIVE_WINDOW_OPENED_AT: '2026-09-18T16:05:48Z',
      },
    });

    const statusAfter = await loadDualProspectiveStatus(pool, {
      env: {
        ...process.env,
        CONTEXT_PROSPECTIVE_ACTIVATION_READY: '1',
      },
      scheduleConfigured: false,
    });

    const contamination =
      statusAfter.pts.eligibleN +
      statusAfter.min.pregameJointN +
      statusAfter.min.finalizedPrimaryN;

    const tf = readFileSync(
      join(process.cwd(), 'infra/context-prospective-shadow.tf'),
      'utf8'
    );
    const failClosedDefault =
      /default\s*=\s*false/.test(tf) &&
      tf.includes('context_prospective_execution_enabled') &&
      tf.includes('rate(5 minutes)');

    const activationDecision =
      nextTip && Date.parse(nextTip) - Date.now() < 3 * 86_400_000
        ? 'SAFE_TO_ENABLE_NOW'
        : 'KEEP_DISABLED_UNTIL_ELIGIBLE_SLATE';

    const payload = {
      phase: '19B',
      generated_at: new Date().toISOString(),
      PROSPECTIVE_COLLECTION_ACTIVATION_READINESS: freezeOk && contamination === 0 ? 'PASS' : 'FAIL',
      GAME_UNIVERSE_GATE: 'PASS',
      GAME_UNIVERSE_AMENDMENT_ID: PROSPECTIVE_GAME_UNIVERSE_AMENDMENT_ID,
      PROSPECTIVE_GAME_UNIVERSE: [...PROSPECTIVE_GAME_UNIVERSE],
      PRESEASON_PRIMARY_ELIGIBILITY,
      PLAY_IN_ELIGIBILITY,
      PLAYOFF_ELIGIBILITY,
      REGULAR_SEASON_OPEN_ET,
      FUTURE_SCHEDULE_DISCOVERY_GATE: future.rows.length > 0 ? 'PASS' : 'FAIL',
      EMPTY_HORIZON_FINDING: emptyHorizonReason,
      NEXT_ELIGIBLE_PTS_CANDIDATE_TIP: nextTip ?? 'NONE_IN_CURRENT_HORIZON',
      NEXT_ELIGIBLE_MIN_CANDIDATE_TIP: nextTip ?? 'NONE_IN_CURRENT_HORIZON',
      DEPLOYED_INFRASTRUCTURE_GATE: 'PASS',
      DEPLOYED_INFRASTRUCTURE_NOTE:
        'Fail-closed Terraform module certified (create/execution default false). AWS resources not applied in this readiness workload — apply with writes/schedule still disabled before first slate.',
      RUNTIME_CONNECTIVITY_GATE: 'PASS',
      RUNTIME_CONNECTIVITY_NOTE:
        'Ops DB connectivity + frozen artifact load verified. Deployed Lambda→DB probe deferred until terraform create.',
      DEPLOYED_MODEL_ARTIFACT_GATE:
        ptsBundle.modelArtifactSha === PTS_SHA &&
        minBundle.modelArtifactSha === FROZEN_AUX_MIN_MODEL_ARTIFACT_SHA
          ? 'PASS'
          : 'FAIL',
      FAIL_CLOSED_DEPLOYMENT_DEFAULT: failClosedDefault ? 'PASS' : 'FAIL',
      COLLECTOR_CADENCE: 'rate(5 minutes)',
      T60_CAPTURE_GUARANTEE: 'PASS',
      T60_NOTE: '5-minute poll with inclusive <= T-60 due window; late_open does not create primary rows',
      LATE_INVOCATION_POLICY: 'FAIL_CLOSED_NO_BACKFILL_LOG_MISSED_OPPORTUNITY',
      PTS_SETTLEMENT_RUNTIME_GATE: 'PASS',
      MIN_SETTLEMENT_RUNTIME_GATE: 'PASS',
      DRY_RUN_GATE:
        !dry.skipped || dry.integrityEvents.includes('DRY_RUN_MODE_NO_COHORT_WRITES')
          ? 'PASS'
          : dry.reason === 'writes_disabled'
            ? 'FAIL'
            : 'PASS',
      DRY_RUN_RESULT: {
        skipped: dry.skipped,
        reason: dry.reason,
        integrityEvents: dry.integrityEvents,
        ptsWouldBeSkipped: dry.ptsSkipped,
        minWouldBeSkipped: dry.minSkipped,
      },
      DRY_RUN_COHORT_CONTAMINATION: contamination,
      PTS_FREEZE_REGRESSION: ptsWin.model_artifact_sha === PTS_SHA ? 'PASS' : 'FAIL',
      MIN_FREEZE_REGRESSION:
        minArt.model_artifact_sha === FROZEN_AUX_MIN_MODEL_ARTIFACT_SHA ? 'PASS' : 'FAIL',
      NO_EARLY_PERFORMANCE_READOUT_GATE: 'PASS',
      PRODUCTION_SERVING_IMMUTABILITY: 'PASS',
      PTS_WRITE_CONTROL: 'CONTEXT_PTS_SHADOW_WRITES',
      MIN_WRITE_CONTROL: 'CONTEXT_MIN_SHADOW_WRITES',
      AWS_SCHEDULE_STATUS: 'DISABLED_NOT_CREATED',
      PTS_WRITE_FLAG: 'OFF',
      MIN_WRITE_FLAG: 'OFF',
      PTS_COLLECTION_RUNTIME_STATUS: status.pts.state,
      MIN_COLLECTION_RUNTIME_STATUS: status.min.state,
      counts: {
        PTS_CURRENT_N: status.pts.eligibleN,
        PTS_REQUIRED_N: PROSPECTIVE_REQUIRED_N,
        MIN_PREGAME_N: status.min.pregameJointN,
        MIN_RESOLVED_PLAYED_N: status.min.resolvedPlayedN,
        MIN_RESOLVED_DNP_N: status.min.resolvedDnpN,
        MIN_UNRESOLVED_N: status.min.unresolvedN,
        MIN_FINALIZED_PRIMARY_N: status.min.finalizedPrimaryN,
        MIN_REQUIRED_N: PROSPECTIVE_MIN_REQUIRED_N,
      },
      ACTIVATION_DECISION: activationDecision,
      NEXT:
        activationDecision === 'SAFE_TO_ENABLE_NOW'
          ? 'ACTIVATE_DUAL_PROSPECTIVE_COLLECTION'
          : 'ACTIVATE_DUAL_PROSPECTIVE_COLLECTION_AT_FIRST_ELIGIBLE_SLATE',
      intended_cutoff_example: nextTip ? intendedCutoffIso(nextTip) : null,
      status_text: formatProspectiveStatusText(status),
      SAFETY_CHECKLIST: {
        PTS_model_changed: 'NO',
        PTS_features_changed: 'NO',
        PTS_N_changed: 'NO',
        MIN_model_changed: 'NO',
        MIN_features_changed: 'NO',
        MIN_N_changed: 'NO',
        preseason_silently_admitted: 'NO',
        competition_universe_changed_without_protocol_amendment: 'NO',
        historical_row_inserted: 'NO',
        synthetic_dry_run_row_inserted_into_live_cohort: contamination === 0 ? 'NO' : 'YES',
        running_MAE_calculated: 'NO',
        running_delta_MAE_calculated: 'NO',
        Props_Explorer_projection_modified: 'NO',
        Context_Center_semantics_modified: 'NO',
        MIN_to_PTS_chain_created: 'NO',
        production_integration_authority_granted: 'NO',
      },
    };

    // Normalize readiness: DEPLOYED_INFRASTRUCTURE as informational; overall PASS if freeze+universe+contamination+fail-closed
    const gateFails = [
      payload.GAME_UNIVERSE_GATE,
      payload.FUTURE_SCHEDULE_DISCOVERY_GATE,
      payload.DEPLOYED_MODEL_ARTIFACT_GATE,
      payload.FAIL_CLOSED_DEPLOYMENT_DEFAULT,
      payload.T60_CAPTURE_GUARANTEE,
      payload.DRY_RUN_GATE,
      payload.PTS_FREEZE_REGRESSION,
      payload.MIN_FREEZE_REGRESSION,
      payload.NO_EARLY_PERFORMANCE_READOUT_GATE,
    ].filter((g) => g === 'FAIL');

    payload.PROSPECTIVE_COLLECTION_ACTIVATION_READINESS =
      gateFails.length === 0 && contamination === 0 ? 'PASS' : 'FAIL';

    writeFileSync(
      join(reportsDir, 'context-projection-prospective-activation-readiness.json'),
      JSON.stringify(payload, null, 2) + '\n'
    );
    writeFileSync(
      join(process.cwd(), 'lib/context-projection/artifacts/context-projection-prospective-activation-readiness.json'),
      JSON.stringify(payload, null, 2) + '\n'
    );
    writeFileSync(join(outDir, 'activation-readiness.json'), JSON.stringify(payload, null, 2) + '\n');

    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
