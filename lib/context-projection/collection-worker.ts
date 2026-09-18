/**
 * Phase 19 — Dual prospective context-projection collection + settlement cycle.
 * Isolated from Props Explorer. Fail-closed on freeze / writes disabled.
 * Does NOT compute MAE / ΔMAE.
 */

import { shouldSkipLiveMutations } from '@/lib/runtime/ingestion-mode';
import type { SqlQueryable } from '@/lib/db/schema-capability';
import { relationExists } from '@/lib/db/schema-capability';
import {
  buildProspectiveShadowRecord,
  loadFrozenBundle as loadPtsBundle,
} from '@/lib/context-projection/arm';
import {
  insertProspectiveShadowPrediction,
  insertProspectiveShadowOutcome,
  runShadowIsolated,
} from '@/lib/context-projection/store';
import {
  buildProspectiveMinShadowRecord,
  loadFrozenAuxMinBundle,
} from '@/lib/context-projection/min/arm';
import { insertProspectiveMinShadowPrediction } from '@/lib/context-projection/min/store';
import { resolveMinOutcomeAndRecompute } from '@/lib/context-projection/min/resolve';
import { intendedCutoffIso } from '@/lib/context-projection/window';
import {
  FROZEN_AUX_MIN_MODEL_ARTIFACT_SHA,
  AUX_MIN_PROSPECTIVE_WINDOW,
} from '@/lib/context-projection/min/protocol';
import {
  PROSPECTIVE_WINDOW_ID,
  PRODUCTION_BASELINE_VERSION,
} from '@/lib/context-projection/protocol';
import {
  buildCandidatesForGame,
  classifyContextProspectiveDue,
  loadProspectiveUpcomingGames,
} from '@/lib/context-projection/collection-candidates';
import { classifyWowyAppearance } from '@/lib/wowy/appearance';

const PTS_MODEL_SHA =
  '36f68abdab110ea13e78ac03d573aa3718b9ae7bb8b9bbd8a0d5983d83df478a';

export interface ContextProspectivePorts {
  now: () => Date;
  db: SqlQueryable;
  env?: Record<string, string | undefined>;
  /** When false, score cycle is a no-op (schedule not live). */
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface ContextProspectiveCycleResult {
  skipped: boolean;
  reason?: string;
  ptsInserted: number;
  ptsSkipped: number;
  ptsErrors: number;
  minInserted: number;
  minSkipped: number;
  minErrors: number;
  ptsSettled: number;
  minSettled: number;
  integrityEvents: string[];
}

function envOn(env: Record<string, string | undefined>, key: string): boolean {
  return env[key] === '1' || env[key] === 'true';
}

function logIntegrity(
  events: string[],
  code: string,
  detail?: string,
  log?: ContextProspectivePorts['log']
) {
  const msg = detail ? `${code}: ${detail}` : code;
  events.push(msg);
  log?.(msg);
}

export async function runContextProspectiveScoreCycle(
  ports: ContextProspectivePorts
): Promise<ContextProspectiveCycleResult> {
  const env = ports.env ?? process.env;
  const integrityEvents: string[] = [];
  const base: ContextProspectiveCycleResult = {
    skipped: false,
    ptsInserted: 0,
    ptsSkipped: 0,
    ptsErrors: 0,
    minInserted: 0,
    minSkipped: 0,
    minErrors: 0,
    ptsSettled: 0,
    minSettled: 0,
    integrityEvents,
  };

  if (shouldSkipLiveMutations(env)) {
    return { ...base, skipped: true, reason: 'freeze_or_dry_run' };
  }

  const ptsWrites = envOn(env, 'CONTEXT_PTS_SHADOW_WRITES');
  const minWrites = envOn(env, 'CONTEXT_MIN_SHADOW_WRITES');
  const dryRun = envOn(env, 'CONTEXT_PROSPECTIVE_DRY_RUN');
  if (!ptsWrites && !minWrites && !dryRun) {
    return { ...base, skipped: true, reason: 'writes_disabled' };
  }

  const ptsSchema = await relationExists(ports.db, 'analytics.prospective_shadow_predictions');
  const minSchema = await relationExists(ports.db, 'analytics.prospective_min_shadow_predictions');
  if (ptsWrites && !ptsSchema) {
    logIntegrity(integrityEvents, 'PTS_SCHEMA_MISSING');
    return { ...base, skipped: true, reason: 'pts_schema_missing' };
  }
  if (minWrites && !minSchema) {
    logIntegrity(integrityEvents, 'MIN_SCHEMA_MISSING');
    return { ...base, skipped: true, reason: 'min_schema_missing' };
  }

  let ptsBundle: ReturnType<typeof loadPtsBundle> | null = null;
  let minBundle: ReturnType<typeof loadFrozenAuxMinBundle> | null = null;
  try {
    if (ptsWrites || dryRun) {
      ptsBundle = loadPtsBundle();
      if (ptsBundle.modelArtifactSha !== PTS_MODEL_SHA) {
        logIntegrity(
          integrityEvents,
          'PTS_MODEL_SHA_MISMATCH',
          ptsBundle.modelArtifactSha
        );
        return { ...base, skipped: true, reason: 'pts_model_sha_mismatch' };
      }
      if (ptsBundle.productionBaselineVersion !== PRODUCTION_BASELINE_VERSION) {
        logIntegrity(
          integrityEvents,
          'PTS_BASELINE_VERSION_MISMATCH',
          ptsBundle.productionBaselineVersion
        );
        // Fail closed for primary collection
        return { ...base, skipped: true, reason: 'pts_baseline_version_mismatch' };
      }
    }
    if (minWrites || dryRun) {
      minBundle = loadFrozenAuxMinBundle();
      if (minBundle.modelArtifactSha !== FROZEN_AUX_MIN_MODEL_ARTIFACT_SHA) {
        logIntegrity(
          integrityEvents,
          'MIN_MODEL_SHA_MISMATCH',
          minBundle.modelArtifactSha
        );
        return { ...base, skipped: true, reason: 'min_model_sha_mismatch' };
      }
    }
  } catch (err) {
    logIntegrity(
      integrityEvents,
      'ARTIFACT_LOAD_FAILURE',
      err instanceof Error ? err.message : String(err)
    );
    return { ...base, skipped: true, reason: 'artifact_load_failure' };
  }

  if (dryRun) {
    integrityEvents.push('DRY_RUN_MODE_NO_COHORT_WRITES');
  }

  const now = ports.now();
  const nowIso = now.toISOString();
  const windowOpenedAt =
    env.CONTEXT_PROSPECTIVE_WINDOW_OPENED_AT ?? '2026-09-18T16:05:48Z';

  const games = await loadProspectiveUpcomingGames(ports.db, nowIso, 48);
  for (const game of games) {
    const cutoff = intendedCutoffIso(game.scheduledTipoff);
    const due = classifyContextProspectiveDue({
      tipIso: game.scheduledTipoff,
      nowIso,
      cutoffIso: cutoff,
    });
    // Collect only on-time due window (not late_open — late rows are not primary)
    if (due !== 'due') continue;

    const isolated = runShadowIsolated(() => null);
    void isolated;

    let candidates;
    try {
      candidates = await buildCandidatesForGame(ports.db, game, nowIso);
    } catch (err) {
      logIntegrity(
        integrityEvents,
        'CANDIDATE_BUILD_FAILURE',
        `${game.gameId}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    for (const c of candidates) {
      if ((ptsWrites || dryRun) && ptsBundle) {
        try {
          const row = buildProspectiveShadowRecord(
            {
              gameId: c.game.gameId,
              playerEntityId: c.playerId,
              teamId: c.teamId,
              gameStart: c.game.scheduledTipoff,
              predictionCreatedAt: nowIso,
              last10Avg: c.last10Avg,
              seasonAvg: c.seasonAvg,
              last5Avg: c.last5Avg,
              roleRecentFga: c.roleRecentFga,
              roleSeasonFga: c.roleSeasonFga,
              formRecentPoints: c.formRecentPoints,
              formSeasonPoints: c.formSeasonPoints,
            },
            ptsBundle
          );
          if (row.prospectiveWindowId !== PROSPECTIVE_WINDOW_ID) {
            logIntegrity(integrityEvents, 'PTS_WRONG_WINDOW_ID', row.prospectiveWindowId);
            base.ptsErrors += 1;
            continue;
          }
          if (dryRun || !ptsWrites) {
            base.ptsSkipped += 1;
          } else {
            const { inserted } = await insertProspectiveShadowPrediction(ports.db, row);
            if (inserted) base.ptsInserted += 1;
            else base.ptsSkipped += 1;
          }
        } catch (err) {
          base.ptsErrors += 1;
          logIntegrity(
            integrityEvents,
            'PTS_WRITE_FAILURE',
            err instanceof Error ? err.message : String(err)
          );
        }
      }

      if ((minWrites || dryRun) && minBundle) {
        try {
          const row = buildProspectiveMinShadowRecord(
            {
              gameId: c.game.gameId,
              playerEntityId: c.playerId,
              teamId: c.teamId,
              season: c.game.season,
              gameStart: c.game.scheduledTipoff,
              predictionCreatedAt: nowIso,
              windowOpenedAt,
              priors: c.b0Priors,
              contexts: {
                roleRecentMinutes: c.roleRecentMinutes,
                roleSeasonMinutes: c.roleSeasonMinutes,
                expectedMissingMinutes: c.expectedMissingMinutes,
                rotationPlayersOutCount: c.rotationPlayersOutCount,
                availCompleteness: c.availCompleteness,
                roleContextVersion: 'player-role-context-v1',
                availContextVersion: 'team-injury-context-v2',
              },
            },
            minBundle
          );
          if (row.prospectiveWindowId !== AUX_MIN_PROSPECTIVE_WINDOW) {
            logIntegrity(integrityEvents, 'MIN_WRONG_WINDOW_ID', row.prospectiveWindowId);
            base.minErrors += 1;
            continue;
          }
          if (dryRun || !minWrites) {
            base.minSkipped += 1;
          } else {
            const { inserted } = await insertProspectiveMinShadowPrediction(ports.db, row);
            if (inserted) base.minInserted += 1;
            else base.minSkipped += 1;
          }
        } catch (err) {
          base.minErrors += 1;
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes('B0_MIN_UNAVAILABLE') && !msg.includes('HISTORICAL_ROWS')) {
            logIntegrity(integrityEvents, 'MIN_WRITE_FAILURE', msg);
          }
        }
      }
    }
  }

  return base;
}

export async function runContextProspectiveSettleCycle(
  ports: ContextProspectivePorts
): Promise<ContextProspectiveCycleResult> {
  const env = ports.env ?? process.env;
  const integrityEvents: string[] = [];
  const base: ContextProspectiveCycleResult = {
    skipped: false,
    ptsInserted: 0,
    ptsSkipped: 0,
    ptsErrors: 0,
    minInserted: 0,
    minSkipped: 0,
    minErrors: 0,
    ptsSettled: 0,
    minSettled: 0,
    integrityEvents,
  };

  if (shouldSkipLiveMutations(env)) {
    return { ...base, skipped: true, reason: 'freeze_or_dry_run' };
  }

  if (envOn(env, 'CONTEXT_PROSPECTIVE_DRY_RUN')) {
    return { ...base, skipped: true, reason: 'dry_run_no_settle_writes' };
  }

  const ptsWrites = envOn(env, 'CONTEXT_PTS_SHADOW_WRITES');
  const minWrites = envOn(env, 'CONTEXT_MIN_SHADOW_WRITES');
  const nowIso = ports.now().toISOString();

  if (ptsWrites) {
    const pending = await ports.db.query(
      `
      SELECT p.shadow_prediction_id, p.player_entity_id, p.game_id
        FROM analytics.prospective_shadow_predictions p
        JOIN analytics.games g ON g.game_id = p.game_id
        LEFT JOIN analytics.prospective_shadow_outcomes o
          ON o.shadow_prediction_id = p.shadow_prediction_id
       WHERE p.prospective_window_id = $1
         AND g.status = 'Final'
         AND o.shadow_prediction_id IS NULL
       LIMIT 500
      `,
      [PROSPECTIVE_WINDOW_ID]
    );
    for (const row of pending.rows) {
      try {
        const pgl = await ports.db.query(
          `
          SELECT minutes, points, rebounds, assists
            FROM analytics.player_game_logs
           WHERE game_id = $1 AND player_id = $2
           LIMIT 1
          `,
          [row.game_id, row.player_entity_id]
        );
        if (pgl.rows.length === 0) {
          await insertProspectiveShadowOutcome(ports.db, {
            shadowPredictionId: String(row.shadow_prediction_id),
            joinedAt: nowIso,
            actualPts: null,
            outcomeClass: 'unresolved',
            audit: { reason: 'no_pgl' },
          });
          base.ptsSettled += 1;
          continue;
        }
        const r = pgl.rows[0]!;
        const appearance = classifyWowyAppearance({
          minutes: r.minutes as string | number | null,
          points: r.points == null ? null : Number(r.points),
          rebounds: r.rebounds == null ? null : Number(r.rebounds),
          assists: r.assists == null ? null : Number(r.assists),
        });
        // PTS primary is DNP-inclusive production population
        const outcomeClass =
          appearance.class === 'played'
            ? 'played'
            : appearance.class === 'dnp'
              ? 'dnp'
              : 'unresolved';
        await insertProspectiveShadowOutcome(ports.db, {
          shadowPredictionId: String(row.shadow_prediction_id),
          joinedAt: nowIso,
          actualPts: appearance.class === 'dnp' ? 0 : Number(r.points ?? 0),
          outcomeClass,
          audit: { appearance: appearance.class },
        });
        base.ptsSettled += 1;
      } catch (err) {
        base.ptsErrors += 1;
        logIntegrity(
          integrityEvents,
          'PTS_SETTLE_FAILURE',
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  if (minWrites) {
    const pending = await ports.db.query(
      `
      SELECT p.shadow_prediction_id, p.player_entity_id, p.game_id
        FROM analytics.prospective_min_shadow_predictions p
        JOIN analytics.games g ON g.game_id = p.game_id
        LEFT JOIN analytics.prospective_min_shadow_outcomes o
          ON o.shadow_prediction_id = p.shadow_prediction_id
       WHERE p.prospective_window_id = $1
         AND g.status = 'Final'
         AND o.shadow_prediction_id IS NULL
       LIMIT 500
      `,
      [AUX_MIN_PROSPECTIVE_WINDOW]
    );
    for (const row of pending.rows) {
      try {
        const pgl = await ports.db.query(
          `
          SELECT minutes, points, rebounds, assists,
                 three_pointers_made, field_goals_attempted, free_throws_attempted
            FROM analytics.player_game_logs
           WHERE game_id = $1 AND player_id = $2
           LIMIT 1
          `,
          [row.game_id, row.player_entity_id]
        );
        if (pgl.rows.length === 0) {
          await resolveMinOutcomeAndRecompute(ports.db, {
            shadowPredictionId: String(row.shadow_prediction_id),
            pgl: null,
            outcomeResolvedAt: nowIso,
          });
          base.minSettled += 1;
          continue;
        }
        const r = pgl.rows[0]!;
        await resolveMinOutcomeAndRecompute(ports.db, {
          shadowPredictionId: String(row.shadow_prediction_id),
          pgl: {
            minutes: r.minutes as string | number | null,
            points: r.points == null ? null : Number(r.points),
            rebounds: r.rebounds == null ? null : Number(r.rebounds),
            assists: r.assists == null ? null : Number(r.assists),
            three_pointers_made:
              r.three_pointers_made == null ? null : Number(r.three_pointers_made),
            field_goals_attempted:
              r.field_goals_attempted == null ? null : Number(r.field_goals_attempted),
            free_throws_attempted:
              r.free_throws_attempted == null ? null : Number(r.free_throws_attempted),
          },
          outcomeResolvedAt: nowIso,
        });
        base.minSettled += 1;
      } catch (err) {
        base.minErrors += 1;
        logIntegrity(
          integrityEvents,
          'MIN_SETTLE_FAILURE',
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  return base;
}

/** Full cycle: score then settle. Each side isolated from the other. */
export async function runContextProspectiveCycle(
  ports: ContextProspectivePorts
): Promise<{ score: ContextProspectiveCycleResult; settle: ContextProspectiveCycleResult }> {
  let score: ContextProspectiveCycleResult;
  try {
    score = await runContextProspectiveScoreCycle(ports);
  } catch (err) {
    score = {
      skipped: true,
      reason: 'pts_or_min_score_threw',
      ptsInserted: 0,
      ptsSkipped: 0,
      ptsErrors: 1,
      minInserted: 0,
      minSkipped: 0,
      minErrors: 1,
      ptsSettled: 0,
      minSettled: 0,
      integrityEvents: [err instanceof Error ? err.message : String(err)],
    };
  }

  let settle: ContextProspectiveCycleResult;
  try {
    settle = await runContextProspectiveSettleCycle(ports);
  } catch (err) {
    settle = {
      skipped: true,
      reason: 'settle_threw',
      ptsInserted: 0,
      ptsSkipped: 0,
      ptsErrors: 1,
      minInserted: 0,
      minSkipped: 0,
      minErrors: 1,
      ptsSettled: 0,
      minSettled: 0,
      integrityEvents: [err instanceof Error ? err.message : String(err)],
    };
  }

  return { score, settle };
}
