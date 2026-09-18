/**
 * Phase 19 — Read-only prospective progress (no MAE / ΔMAE / CI).
 */

import type { SqlQueryable } from '@/lib/db/schema-capability';
import {
  PROSPECTIVE_REQUIRED_N,
  PROSPECTIVE_WINDOW_ID,
} from '@/lib/context-projection/protocol';
import {
  AUX_MIN_PROSPECTIVE_WINDOW,
  PROSPECTIVE_MIN_REQUIRED_N,
} from '@/lib/context-projection/min/protocol';
import {
  assignPrimarySequences,
  minCollectionStatus,
  type MinWindowCandidateRow,
  type ResolvedAppearanceClass,
} from '@/lib/context-projection/min/window';
import type { AuxMinBranch } from '@/lib/context-projection/min/protocol';
import type { MinPregameEligibilityStatus } from '@/lib/context-projection/min/window';

export type ProspectiveRuntimeStatus =
  | 'NOT_ACTIVATED'
  | 'DEPLOYED_NOT_ACTIVATED'
  | 'ARMED'
  | 'COLLECTING'
  | 'READY_FOR_READOUT';

export interface PtsProspectiveStatus {
  windowId: string;
  requiredN: number;
  eligibleN: number;
  resolvedN: number;
  unresolvedN: number;
  state: ProspectiveRuntimeStatus;
  writesEnabled: boolean;
  scheduleConfigured: boolean;
}

export interface MinProspectiveStatus {
  windowId: string;
  requiredN: number;
  pregameJointN: number;
  resolvedPlayedN: number;
  resolvedDnpN: number;
  unresolvedN: number;
  finalizedPrimaryN: number;
  state: ProspectiveRuntimeStatus;
  writesEnabled: boolean;
  scheduleConfigured: boolean;
  blockedByEarlierUnresolved: boolean;
}

export interface DualProspectiveStatus {
  pts: PtsProspectiveStatus;
  min: MinProspectiveStatus;
  generatedAt: string;
  note: 'NO_PERFORMANCE_METRICS';
}

function envFlag(env: Record<string, string | undefined>, key: string): boolean {
  return env[key] === '1' || env[key] === 'true';
}

export async function loadPtsProspectiveStatus(
  client: SqlQueryable,
  opts?: {
    env?: Record<string, string | undefined>;
    scheduleConfigured?: boolean;
  }
): Promise<PtsProspectiveStatus> {
  const env = opts?.env ?? process.env;
  const writesEnabled = envFlag(env, 'CONTEXT_PTS_SHADOW_WRITES');
  const scheduleConfigured =
    opts?.scheduleConfigured ?? envFlag(env, 'CONTEXT_PROSPECTIVE_SCHEDULE_CONFIGURED');

  const eligible = await client.query(
    `SELECT COUNT(*)::int AS n
       FROM analytics.prospective_shadow_predictions
      WHERE prospective_window_id = $1
        AND eligibility_status = 'PRIMARY_ELIGIBLE'`,
    [PROSPECTIVE_WINDOW_ID]
  );
  const eligibleN = Number(eligible.rows[0]?.n ?? 0);

  const resolved = await client.query(
    `SELECT COUNT(*)::int AS n
       FROM analytics.prospective_shadow_outcomes o
       JOIN analytics.prospective_shadow_predictions p
         ON p.shadow_prediction_id = o.shadow_prediction_id
      WHERE p.prospective_window_id = $1
        AND o.outcome_class IS DISTINCT FROM 'unresolved'`,
    [PROSPECTIVE_WINDOW_ID]
  );
  const resolvedN = Number(resolved.rows[0]?.n ?? 0);

  const unresolved = await client.query(
    `SELECT COUNT(*)::int AS n
       FROM analytics.prospective_shadow_predictions p
       LEFT JOIN analytics.prospective_shadow_outcomes o
         ON o.shadow_prediction_id = p.shadow_prediction_id
      WHERE p.prospective_window_id = $1
        AND p.eligibility_status = 'PRIMARY_ELIGIBLE'
        AND (o.shadow_prediction_id IS NULL OR o.outcome_class = 'unresolved')`,
    [PROSPECTIVE_WINDOW_ID]
  );
  const unresolvedN = Number(unresolved.rows[0]?.n ?? 0);

  let state: ProspectiveRuntimeStatus;
  if (eligibleN >= PROSPECTIVE_REQUIRED_N) state = 'READY_FOR_READOUT';
  else if (eligibleN > 0) state = 'COLLECTING';
  else if (writesEnabled && scheduleConfigured) state = 'ARMED';
  else if (envFlag(env, 'CONTEXT_PROSPECTIVE_ACTIVATION_READY')) state = 'DEPLOYED_NOT_ACTIVATED';
  else state = 'NOT_ACTIVATED';

  return {
    windowId: PROSPECTIVE_WINDOW_ID,
    requiredN: PROSPECTIVE_REQUIRED_N,
    eligibleN,
    resolvedN,
    unresolvedN,
    state,
    writesEnabled,
    scheduleConfigured,
  };
}

export async function loadMinProspectiveStatus(
  client: SqlQueryable,
  opts?: {
    env?: Record<string, string | undefined>;
    scheduleConfigured?: boolean;
  }
): Promise<MinProspectiveStatus> {
  const env = opts?.env ?? process.env;
  const writesEnabled = envFlag(env, 'CONTEXT_MIN_SHADOW_WRITES');
  const scheduleConfigured =
    opts?.scheduleConfigured ?? envFlag(env, 'CONTEXT_PROSPECTIVE_SCHEDULE_CONFIGURED');

  const res = await client.query(
    `
    SELECT
      p.shadow_prediction_id,
      p.prospective_window_id,
      p.prediction_created_at::text AS prediction_created_at,
      p.branch,
      p.pregame_eligibility_status,
      o.resolved_appearance_class,
      o.primary_sequence_number
    FROM analytics.prospective_min_shadow_predictions p
    LEFT JOIN analytics.prospective_min_shadow_outcomes o
      ON o.shadow_prediction_id = p.shadow_prediction_id
    WHERE p.prospective_window_id = $1
    `,
    [AUX_MIN_PROSPECTIVE_WINDOW]
  );

  const rows: MinWindowCandidateRow[] = res.rows.map((r) => ({
    shadowPredictionId: String(r.shadow_prediction_id),
    prospectiveWindowId: String(r.prospective_window_id),
    predictionCreatedAt: String(r.prediction_created_at).replace(' ', 'T').replace(/\+00$/, 'Z'),
    branch: r.branch as AuxMinBranch,
    pregameEligibilityStatus: r.pregame_eligibility_status as MinPregameEligibilityStatus,
    resolvedAppearanceClass: (r.resolved_appearance_class as ResolvedAppearanceClass | null) ?? null,
  }));

  const { counters } = assignPrimarySequences(rows, PROSPECTIVE_MIN_REQUIRED_N);
  const protocolState = minCollectionStatus({
    armed: writesEnabled && scheduleConfigured,
    pregameJointN: counters.PREGAME_JOINT_PREDICTIONS_N,
    finalizedPrimaryN: counters.FINALIZED_PRIMARY_N,
    requiredN: PROSPECTIVE_MIN_REQUIRED_N,
    blockedByEarlierUnresolved: counters.blockedByEarlierUnresolved,
  });

  let state: ProspectiveRuntimeStatus;
  if (protocolState === 'READY_FOR_READOUT') state = 'READY_FOR_READOUT';
  else if (protocolState === 'COLLECTING') state = 'COLLECTING';
  else if (writesEnabled && scheduleConfigured) state = 'ARMED';
  else if (envFlag(env, 'CONTEXT_PROSPECTIVE_ACTIVATION_READY')) state = 'DEPLOYED_NOT_ACTIVATED';
  else state = 'NOT_ACTIVATED';

  if ((!writesEnabled || !scheduleConfigured) && counters.PREGAME_JOINT_PREDICTIONS_N === 0) {
    if (envFlag(env, 'CONTEXT_PROSPECTIVE_ACTIVATION_READY')) state = 'DEPLOYED_NOT_ACTIVATED';
    else state = 'NOT_ACTIVATED';
  }

  return {
    windowId: AUX_MIN_PROSPECTIVE_WINDOW,
    requiredN: PROSPECTIVE_MIN_REQUIRED_N,
    pregameJointN: counters.PREGAME_JOINT_PREDICTIONS_N,
    resolvedPlayedN: counters.RESOLVED_PLAYED_N,
    resolvedDnpN: counters.RESOLVED_DNP_N,
    unresolvedN: counters.UNRESOLVED_N,
    finalizedPrimaryN: counters.FINALIZED_PRIMARY_N,
    state,
    writesEnabled,
    scheduleConfigured,
    blockedByEarlierUnresolved: counters.blockedByEarlierUnresolved,
  };
}

export async function loadDualProspectiveStatus(
  client: SqlQueryable,
  opts?: {
    env?: Record<string, string | undefined>;
    scheduleConfigured?: boolean;
  }
): Promise<DualProspectiveStatus> {
  const [pts, min] = await Promise.all([
    loadPtsProspectiveStatus(client, opts),
    loadMinProspectiveStatus(client, opts),
  ]);
  return {
    pts,
    min,
    generatedAt: new Date().toISOString(),
    note: 'NO_PERFORMANCE_METRICS',
  };
}

export function formatProspectiveStatusText(s: DualProspectiveStatus): string {
  return [
    'PTS',
    `state: ${s.pts.state}`,
    `eligible: ${s.pts.eligibleN} / ${s.pts.requiredN}`,
    `resolved: ${s.pts.resolvedN}`,
    `unresolved: ${s.pts.unresolvedN}`,
    `writes: ${s.pts.writesEnabled ? 'ON' : 'OFF'} schedule: ${s.pts.scheduleConfigured ? 'ON' : 'OFF'}`,
    '',
    'MIN',
    `state: ${s.min.state}`,
    `pregame joint: ${s.min.pregameJointN}`,
    `played resolved: ${s.min.resolvedPlayedN}`,
    `dnp resolved: ${s.min.resolvedDnpN}`,
    `unresolved: ${s.min.unresolvedN}`,
    `finalized primary: ${s.min.finalizedPrimaryN} / ${s.min.requiredN}`,
    `writes: ${s.min.writesEnabled ? 'ON' : 'OFF'} schedule: ${s.min.scheduleConfigured ? 'ON' : 'OFF'}`,
  ].join('\n');
}
