/**
 * Phase 18B — Outcome resolution + first-N PLAYED accounting for auxiliary MIN.
 * Never rewrites pregame prediction fields. Never computes MAE.
 */

import { classifyWowyAppearance } from '@/lib/wowy/appearance';
import type { SqlQueryable } from '@/lib/db/schema-capability';
import {
  assignPrimarySequences,
  minCollectionStatus,
  type MinWindowCandidateRow,
  type ResolvedAppearanceClass,
} from '@/lib/context-projection/min/window';
import {
  loadMinWindowRowsForAccounting,
  upsertProspectiveMinOutcome,
} from '@/lib/context-projection/min/store';
import {
  AUX_MIN_PROSPECTIVE_WINDOW,
  PROSPECTIVE_MIN_REQUIRED_N,
  type AuxMinBranch,
} from '@/lib/context-projection/min/protocol';
import type { MinPregameEligibilityStatus } from '@/lib/context-projection/min/window';

export interface MinPglOutcomeInput {
  minutes: string | number | null;
  points?: number | null;
  rebounds?: number | null;
  assists?: number | null;
  three_pointers_made?: number | null;
  field_goals_attempted?: number | null;
  free_throws_attempted?: number | null;
}

export function resolveAppearanceFromPgl(
  pgl: MinPglOutcomeInput | null | undefined
): {
  resolvedAppearanceClass: ResolvedAppearanceClass;
  realizedMinutes: number | null;
} {
  if (pgl == null) {
    return { resolvedAppearanceClass: 'no_pgl', realizedMinutes: null };
  }
  const c = classifyWowyAppearance(pgl);
  if (c.class === 'played') {
    return { resolvedAppearanceClass: 'played', realizedMinutes: c.minutes };
  }
  if (c.class === 'dnp') {
    // Diagnostic only — do not treat as primary 0-minute target.
    return { resolvedAppearanceClass: 'dnp', realizedMinutes: null };
  }
  return { resolvedAppearanceClass: 'malformed', realizedMinutes: null };
}

function mapDbRows(
  rows: Awaited<ReturnType<typeof loadMinWindowRowsForAccounting>>
): MinWindowCandidateRow[] {
  return rows.map((r) => ({
    shadowPredictionId: String(r.shadow_prediction_id),
    prospectiveWindowId: String(r.prospective_window_id),
    predictionCreatedAt: String(r.prediction_created_at).replace(' ', 'T').replace(/\+00$/, 'Z'),
    branch: r.branch as AuxMinBranch,
    pregameEligibilityStatus: r.pregame_eligibility_status as MinPregameEligibilityStatus,
    resolvedAppearanceClass: (r.resolved_appearance_class as ResolvedAppearanceClass | null) ?? null,
  }));
}

/**
 * Upsert one outcome appearance, then recompute primary sequences for the window.
 * Idempotent: repeated calls with same appearance yield same sequences.
 */
export async function resolveMinOutcomeAndRecompute(
  client: SqlQueryable,
  opts: {
    shadowPredictionId: string;
    pgl: MinPglOutcomeInput | null;
    outcomeResolvedAt?: string;
    windowId?: string;
    appearanceOverride?: ResolvedAppearanceClass;
  }
): Promise<{
  resolvedAppearanceClass: ResolvedAppearanceClass;
  realizedMinutes: number | null;
  counters: ReturnType<typeof assignPrimarySequences>['counters'];
}> {
  const windowId = opts.windowId ?? AUX_MIN_PROSPECTIVE_WINDOW;
  const resolved =
    opts.appearanceOverride != null
      ? {
          resolvedAppearanceClass: opts.appearanceOverride,
          realizedMinutes: null as number | null,
        }
      : resolveAppearanceFromPgl(opts.pgl);

  const resolvedAt = opts.outcomeResolvedAt ?? new Date().toISOString();

  await upsertProspectiveMinOutcome(client, {
    shadowPredictionId: opts.shadowPredictionId,
    outcomeResolvedAt: resolvedAt,
    resolvedAppearanceClass: resolved.resolvedAppearanceClass,
    realizedMinutes: resolved.realizedMinutes,
    primaryScoringEligible: false,
    primarySequenceNumber: null,
    audit: { source: 'resolve-aux-min-outcome' },
  });

  const counters = await recomputeMinPrimarySequences(client, windowId);
  return {
    resolvedAppearanceClass: resolved.resolvedAppearanceClass,
    realizedMinutes: resolved.realizedMinutes,
    counters,
  };
}

/** Recompute primary_sequence_number from prediction_created_at order (not arrival order). */
export async function recomputeMinPrimarySequences(
  client: SqlQueryable,
  windowId: string = AUX_MIN_PROSPECTIVE_WINDOW
): Promise<ReturnType<typeof assignPrimarySequences>['counters']> {
  const dbRows = await loadMinWindowRowsForAccounting(client, windowId);
  const { assignments, counters } = assignPrimarySequences(mapDbRows(dbRows));

  await client.query(
    `
    UPDATE analytics.prospective_min_shadow_outcomes o
       SET primary_scoring_eligible = v.eligible,
           primary_sequence_number = v.seq
      FROM (
        SELECT * FROM jsonb_to_recordset($1::jsonb)
          AS x(shadow_prediction_id text, eligible boolean, seq int)
      ) v
     WHERE o.shadow_prediction_id = v.shadow_prediction_id
    `,
    [
      JSON.stringify(
        assignments.map((a) => ({
          shadow_prediction_id: a.shadowPredictionId,
          eligible: a.primaryScoringEligible,
          seq: a.primarySequenceNumber,
        }))
      ),
    ]
  );

  return counters;
}

export function statusFromCounters(
  counters: ReturnType<typeof assignPrimarySequences>['counters'],
  armed: boolean
) {
  return minCollectionStatus({
    armed,
    pregameJointN: counters.PREGAME_JOINT_PREDICTIONS_N,
    finalizedPrimaryN: counters.FINALIZED_PRIMARY_N,
    requiredN: counters.PROSPECTIVE_MIN_REQUIRED_N ?? PROSPECTIVE_MIN_REQUIRED_N,
    blockedByEarlierUnresolved: counters.blockedByEarlierUnresolved,
  });
}
