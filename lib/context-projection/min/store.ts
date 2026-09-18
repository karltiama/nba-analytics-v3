/**
 * Append-only store for analytics.prospective_min_shadow_predictions.
 * Fail-closed: write errors must not affect Props Explorer / PTS serving.
 */

import type { SqlQueryable } from '@/lib/db/schema-capability';
import type { AuxMinBranch } from '@/lib/context-projection/min/protocol';
import type {
  MinCanonicalSnapshotStatus,
  MinPregameEligibilityStatus,
  ResolvedAppearanceClass,
} from '@/lib/context-projection/min/window';
import { runShadowIsolated } from '@/lib/context-projection/store';

export const INSERT_MIN_SHADOW_SQL = `
  INSERT INTO analytics.prospective_min_shadow_predictions (
    shadow_prediction_id,
    prospective_window_id,
    game_id,
    player_entity_id,
    team_id,
    game_start,
    prediction_created_at,
    target,
    b0_min,
    context_adjustment,
    shadow_min,
    branch,
    role_minutes_delta,
    injury_expected_missing_minutes,
    injury_rotation_players_out_count,
    role_context_version,
    availability_context_version,
    availability_completeness,
    model_id,
    model_artifact_sha,
    feature_manifest_sha,
    training_manifest_sha,
    context_integration_version,
    pregame_eligibility_status,
    canonical_snapshot_identity,
    canonical_snapshot_status,
    intended_cutoff_at,
    late,
    provenance
  ) VALUES (
    $1,$2,$3,$4,$5,$6,$7,'MIN',$8,$9,$10,
    $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
    $21,$22,$23,$24,$25,$26,$27,$28::jsonb
  )
  ON CONFLICT (prospective_window_id, player_entity_id, game_id, model_id)
  DO NOTHING
  RETURNING shadow_prediction_id
`;

export const UPSERT_MIN_OUTCOME_SQL = `
  INSERT INTO analytics.prospective_min_shadow_outcomes (
    shadow_prediction_id,
    outcome_resolved_at,
    resolved_appearance_class,
    realized_minutes,
    primary_scoring_eligible,
    primary_sequence_number,
    audit
  ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
  ON CONFLICT (shadow_prediction_id) DO UPDATE SET
    outcome_resolved_at = EXCLUDED.outcome_resolved_at,
    resolved_appearance_class = EXCLUDED.resolved_appearance_class,
    realized_minutes = EXCLUDED.realized_minutes,
    primary_scoring_eligible = EXCLUDED.primary_scoring_eligible,
    primary_sequence_number = EXCLUDED.primary_sequence_number,
    audit = EXCLUDED.audit
`;

export interface ProspectiveMinShadowRecord {
  shadowPredictionId: string;
  prospectiveWindowId: string;
  gameId: string;
  playerEntityId: string;
  teamId: string;
  gameStart: string;
  predictionCreatedAt: string;
  b0Min: number;
  contextAdjustment: number;
  shadowMin: number;
  branch: AuxMinBranch;
  roleMinutesDelta: number | null;
  injuryExpectedMissingMinutes: number | null;
  injuryRotationPlayersOutCount: number | null;
  roleContextVersion: string | null;
  availabilityContextVersion: string | null;
  availabilityCompleteness: string | null;
  modelId: string;
  modelArtifactSha: string;
  featureManifestSha: string;
  trainingManifestSha: string;
  contextIntegrationVersion: string;
  pregameEligibilityStatus: MinPregameEligibilityStatus;
  canonicalSnapshotIdentity: string;
  canonicalSnapshotStatus: MinCanonicalSnapshotStatus;
  intendedCutoffAt: string;
  late: boolean;
  provenance?: Record<string, unknown>;
}

export interface ProspectiveMinOutcomeRecord {
  shadowPredictionId: string;
  outcomeResolvedAt: string;
  resolvedAppearanceClass: ResolvedAppearanceClass;
  realizedMinutes: number | null;
  primaryScoringEligible: boolean;
  primarySequenceNumber: number | null;
  audit?: Record<string, unknown>;
}

export async function insertProspectiveMinShadowPrediction(
  client: SqlQueryable,
  row: ProspectiveMinShadowRecord
): Promise<{ inserted: boolean; shadowPredictionId: string }> {
  const res = await client.query(INSERT_MIN_SHADOW_SQL, [
    row.shadowPredictionId,
    row.prospectiveWindowId,
    row.gameId,
    row.playerEntityId,
    row.teamId,
    row.gameStart,
    row.predictionCreatedAt,
    row.b0Min,
    row.contextAdjustment,
    row.shadowMin,
    row.branch,
    row.roleMinutesDelta,
    row.injuryExpectedMissingMinutes,
    row.injuryRotationPlayersOutCount,
    row.roleContextVersion,
    row.availabilityContextVersion,
    row.availabilityCompleteness,
    row.modelId,
    row.modelArtifactSha,
    row.featureManifestSha,
    row.trainingManifestSha,
    row.contextIntegrationVersion,
    row.pregameEligibilityStatus,
    row.canonicalSnapshotIdentity,
    row.canonicalSnapshotStatus,
    row.intendedCutoffAt,
    row.late,
    JSON.stringify(row.provenance ?? {}),
  ]);
  return {
    inserted: (res.rows?.length ?? 0) > 0,
    shadowPredictionId: row.shadowPredictionId,
  };
}

export async function upsertProspectiveMinOutcome(
  client: SqlQueryable,
  row: ProspectiveMinOutcomeRecord
): Promise<void> {
  await client.query(UPSERT_MIN_OUTCOME_SQL, [
    row.shadowPredictionId,
    row.outcomeResolvedAt,
    row.resolvedAppearanceClass,
    row.realizedMinutes,
    row.primaryScoringEligible,
    row.primarySequenceNumber,
    JSON.stringify(row.audit ?? {}),
  ]);
}

export async function loadMinWindowRowsForAccounting(
  client: SqlQueryable,
  windowId: string
): Promise<
  Array<{
    shadow_prediction_id: string;
    prospective_window_id: string;
    prediction_created_at: string;
    branch: string;
    pregame_eligibility_status: string;
    resolved_appearance_class: string | null;
  }>
> {
  const res = await client.query(
    `
    SELECT
      p.shadow_prediction_id,
      p.prospective_window_id,
      p.prediction_created_at::text AS prediction_created_at,
      p.branch,
      p.pregame_eligibility_status,
      o.resolved_appearance_class
    FROM analytics.prospective_min_shadow_predictions p
    LEFT JOIN analytics.prospective_min_shadow_outcomes o
      ON o.shadow_prediction_id = p.shadow_prediction_id
    WHERE p.prospective_window_id = $1
    `,
    [windowId]
  );
  return res.rows as Array<{
    shadow_prediction_id: string;
    prospective_window_id: string;
    prediction_created_at: string;
    branch: string;
    pregame_eligibility_status: string;
    resolved_appearance_class: string | null;
  }>;
}

/** Isolated runner — shadow failures must not throw into serving paths. */
export function runMinShadowIsolated<T>(
  fn: () => T
): { ok: true; value: T } | { ok: false; error: unknown } {
  return runShadowIsolated(fn);
}
