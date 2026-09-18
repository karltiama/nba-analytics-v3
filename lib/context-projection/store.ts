/**
 * Append-only store for analytics.prospective_shadow_predictions.
 * Fail-closed: write errors must not affect Props Explorer serving.
 */

import type { SqlQueryable } from '@/lib/db/schema-capability';
import type { EligibilityStatus, ShadowBranch } from '@/lib/context-projection/protocol';

export const INSERT_PROSPECTIVE_SHADOW_SQL = `
  INSERT INTO analytics.prospective_shadow_predictions (
    shadow_prediction_id,
    prospective_window_id,
    game_id,
    player_entity_id,
    team_id,
    game_start,
    prediction_created_at,
    production_baseline_id,
    production_baseline_version,
    production_baseline_pts,
    context_integration_version,
    context_model_version,
    shadow_context_pts,
    context_adjustment,
    branch,
    role_fga_delta,
    form_points_delta,
    role_context_version,
    form_context_version,
    feature_manifest_sha,
    training_manifest_sha,
    model_artifact_sha,
    eligibility_status,
    canonical_snapshot_identity,
    intended_cutoff_at,
    late,
    provenance
  ) VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
    $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
    $21,$22,$23,$24,$25,$26,$27::jsonb
  )
  ON CONFLICT (prospective_window_id, player_entity_id, game_id, context_model_version)
  DO NOTHING
  RETURNING shadow_prediction_id
`;

export const INSERT_PROSPECTIVE_OUTCOME_SQL = `
  INSERT INTO analytics.prospective_shadow_outcomes (
    shadow_prediction_id, joined_at, actual_pts, outcome_class, audit
  ) VALUES ($1, $2, $3, $4, $5::jsonb)
  ON CONFLICT (shadow_prediction_id) DO NOTHING
`;

export interface ProspectiveShadowRecord {
  shadowPredictionId: string;
  prospectiveWindowId: string;
  gameId: string;
  playerEntityId: string;
  teamId: string;
  gameStart: string;
  predictionCreatedAt: string;
  productionBaselineId: string;
  productionBaselineVersion: string;
  productionBaselinePts: number;
  contextIntegrationVersion: string;
  contextModelVersion: string;
  shadowContextPts: number;
  contextAdjustment: number;
  branch: ShadowBranch;
  roleFgaDelta: number | null;
  formPointsDelta: number | null;
  roleContextVersion: string | null;
  formContextVersion: string | null;
  featureManifestSha: string;
  trainingManifestSha: string;
  modelArtifactSha: string;
  eligibilityStatus: EligibilityStatus;
  canonicalSnapshotIdentity: string;
  intendedCutoffAt: string;
  late: boolean;
  provenance?: Record<string, unknown>;
}

export async function insertProspectiveShadowPrediction(
  client: SqlQueryable,
  row: ProspectiveShadowRecord
): Promise<{ inserted: boolean; shadowPredictionId: string }> {
  try {
    const res = await client.query(INSERT_PROSPECTIVE_SHADOW_SQL, [
      row.shadowPredictionId,
      row.prospectiveWindowId,
      row.gameId,
      row.playerEntityId,
      row.teamId,
      row.gameStart,
      row.predictionCreatedAt,
      row.productionBaselineId,
      row.productionBaselineVersion,
      row.productionBaselinePts,
      row.contextIntegrationVersion,
      row.contextModelVersion,
      row.shadowContextPts,
      row.contextAdjustment,
      row.branch,
      row.roleFgaDelta,
      row.formPointsDelta,
      row.roleContextVersion,
      row.formContextVersion,
      row.featureManifestSha,
      row.trainingManifestSha,
      row.modelArtifactSha,
      row.eligibilityStatus,
      row.canonicalSnapshotIdentity,
      row.intendedCutoffAt,
      row.late,
      JSON.stringify(row.provenance ?? {}),
    ]);
    const inserted = (res.rows?.length ?? 0) > 0;
    return { inserted, shadowPredictionId: row.shadowPredictionId };
  } catch (err) {
    // Fail closed — caller must not block production serving.
    throw err;
  }
}

export async function countPrimaryEligible(
  client: SqlQueryable,
  windowId: string
): Promise<number> {
  const res = await client.query(
    `SELECT COUNT(*)::int AS n
       FROM analytics.prospective_shadow_predictions
      WHERE prospective_window_id = $1
        AND eligibility_status = 'PRIMARY_ELIGIBLE'`,
    [windowId]
  );
  return Number(res.rows[0]?.n ?? 0);
}

export async function insertProspectiveShadowOutcome(
  client: SqlQueryable,
  row: {
    shadowPredictionId: string;
    joinedAt: string;
    actualPts: number | null;
    outcomeClass: string;
    audit?: Record<string, unknown>;
  }
): Promise<{ inserted: boolean }> {
  const res = await client.query(INSERT_PROSPECTIVE_OUTCOME_SQL, [
    row.shadowPredictionId,
    row.joinedAt,
    row.actualPts,
    row.outcomeClass,
    JSON.stringify(row.audit ?? {}),
  ]);
  return { inserted: (res.rows?.length ?? 0) > 0 };
}

/**
 * Shadow failure isolation helper: runs fn; on error returns null without throwing to serving path.
 */
export function runShadowIsolated<T>(fn: () => T): { ok: true; value: T } | { ok: false; error: unknown } {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return { ok: false, error };
  }
}
