/**
 * Due-window shadow scoring + settlement cycle for frozen PTS C / REB C.
 * Isolated from Next.js. Production serving is unchanged.
 */

import { isPlayedGame } from '@/lib/betting/minutes-projection-eval';
import {
  SHADOW_FEATURE_ORDER,
  SHADOW_MODEL_VERSION,
  SHADOW_PROTOCOL_AMENDMENT,
  SHADOW_PROTOCOL_VERSION,
  SHADOW_SEASON,
} from '@/lib/betting/player-projection-shadow-protocol';
import {
  appendPredictionSnapshot,
  assertFeatureOrder,
  buildShadowCandidateRow,
  canWriteProductionSnapshots,
  classifyDelivery,
  classifyShadowDueWindow,
  featureVectorChecksum,
  generateShadowCandidates,
  intendedCutoff,
  logicalKey,
  predictionCoverage,
  type ShadowPredictionRecord,
  type ShadowRosterAppearance,
} from '@/lib/betting/player-projection-shadow-scoring';
import {
  countSettlementBacklog,
  insertPredictionSnapshot,
  insertSettlementRow,
  insertShadowRunRecord,
  insertWindowAnchor,
  latestFinalLogAt,
  loadCurrentWindowAnchor,
  loadPlayerLogs,
  loadTeamAppearances,
  loadTeamGameStats,
  loadUnresolvedPlayerIds,
  loadUnsettledFinalSnapshots,
  loadUpcomingGames,
  type ShadowRunRecordWrite,
} from '@/lib/betting/player-projection-shadow-store';
import {
  observeFirstRegularSeasonTipoff,
  type ShadowWindowAnchor,
} from '@/lib/betting/player-projection-shadow-timing';
import {
  assertSchemaReady,
  inspectShadowWriteSchema,
  readCollectionSchemaMode,
  type CollectionSchemaMode,
  type SqlQueryable,
} from '@/lib/db/schema-capability';
import { shouldSkipLiveMutations } from '@/lib/runtime/ingestion-mode';

export type ShadowScorerRow = {
  player_id: string;
  game_id: string;
  features_c: Record<string, number | null>;
};

export type ShadowScorerResult = {
  player_id: string;
  game_id: string;
  yhat_c_points: number;
  yhat_c_rebounds: number;
};

export type ShadowArtifacts = {
  modelChecksums: { points: string; rebounds: string };
  featureOrder: readonly string[];
};

export type ShadowWorkerPorts = {
  now: () => Date;
  db: SqlQueryable;
  scorer: (rows: ShadowScorerRow[]) => Promise<ShadowScorerResult[]>;
  loadArtifacts: () => Promise<ShadowArtifacts>;
  env?: Record<string, string | undefined>;
};

export type ShadowCycleResult = ShadowRunRecordWrite & {
  runId: number | null;
  skipped: boolean;
  windowAnchor: ShadowWindowAnchor | null;
};

function hoursSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / 3_600_000;
}

function schemaModeForWrites(
  env: Record<string, string | undefined>
): CollectionSchemaMode {
  if (env.SHADOW_SNAPSHOT_WRITES === '1') return 'required';
  return readCollectionSchemaMode(env);
}

export async function runShadowScoreCycle(ports: ShadowWorkerPorts): Promise<ShadowCycleResult> {
  const env = ports.env ?? process.env;
  const now = ports.now();
  const runAt = now.toISOString();
  const base: ShadowRunRecordWrite = {
    runAt,
    finishedAt: runAt,
    action: 'score',
    status: 'skipped',
    dueCount: 0,
    onTimeCount: 0,
    lateCount: 0,
    failedCount: 0,
    missingCount: 0,
    ineligibleCount: 0,
    settledCount: 0,
    settlementBacklog: null,
    schemaMode: schemaModeForWrites(env),
    schemaEnrichment: null,
    featureInputAgeHours: null,
    details: {
      protocol: SHADOW_PROTOCOL_VERSION,
      amendment: SHADOW_PROTOCOL_AMENDMENT,
    },
  };

  if (shouldSkipLiveMutations(env) || !canWriteProductionSnapshots(env)) {
    const finished = { ...base, finishedAt: ports.now().toISOString(), details: { ...base.details, skip: 'freeze_or_writes_disabled' } };
    return { ...finished, runId: await insertShadowRunRecord(ports.db, finished).catch(() => null), skipped: true, windowAnchor: null };
  }

  const schema = await inspectShadowWriteSchema(ports.db);
  try {
    assertSchemaReady({ mode: base.schemaMode!, ready: schema.ready, missing: schema.missing });
  } catch (error) {
    const finished: ShadowRunRecordWrite = {
      ...base,
      status: 'preflight_failed',
      schemaEnrichment: 'unavailable',
      finishedAt: ports.now().toISOString(),
      details: { ...base.details, missing: schema.missing, error: error instanceof Error ? error.message : String(error) },
    };
    return { ...finished, runId: await insertShadowRunRecord(ports.db, finished).catch(() => null), skipped: false, windowAnchor: null };
  }

  const artifacts = await ports.loadArtifacts();
  assertFeatureOrder(artifacts.featureOrder, SHADOW_FEATURE_ORDER);

  const games = await loadUpcomingGames(ports.db, SHADOW_SEASON);
  const previousAnchor = schema.shadowWindowAnchors
    ? await loadCurrentWindowAnchor(ports.db, SHADOW_SEASON)
    : null;
  const windowAnchor = observeFirstRegularSeasonTipoff({
    games: games.map((g) => ({ gameId: g.gameId, startTime: g.scheduledTipoff, season: g.season })),
    observedAt: runAt,
    previous: previousAnchor,
  });
  if (windowAnchor && schema.shadowWindowAnchors && windowAnchor !== previousAnchor) {
    await insertWindowAnchor(ports.db, windowAnchor);
  }

  const dueGames = games.filter((g) => {
    const cls = classifyShadowDueWindow({ scheduledTipoff: g.scheduledTipoff, now: runAt });
    return cls === 'due' || cls === 'late_open';
  });

  const lastBox = await latestFinalLogAt(ports.db);
  const featureInputAgeHours = hoursSince(lastBox, now);
  const liveSourceAvailableByCutoff = lastBox != null;

  const intended: Array<{ playerId: string; gameId: string }> = [];
  const scoreRows: ShadowScorerRow[] = [];
  const pending: Array<Omit<ShadowPredictionRecord, 'logicalKey' | 'late' | 'delivery'> & { predC: ShadowPredictionRecord['predC'] }> = [];
  let ineligible = 0;
  let failed = 0;

  for (const game of dueGames) {
    const cutoff = intendedCutoff(game.scheduledTipoff);
    const rosterLogs = await loadTeamAppearances(
      ports.db,
      [game.homeTeamId, game.awayTeamId],
      cutoff
    );
    const appearances: ShadowRosterAppearance[] = rosterLogs
      .filter((row) => row.team_id === game.homeTeamId || row.team_id === game.awayTeamId)
      .map((row) => ({
        playerId: row.player_id,
        teamId: row.team_id ?? '',
        startTime: row.start_time,
        played: isPlayedGame(row),
      }));
    const candidates = generateShadowCandidates({ game, appearances });
    const unresolved = await loadUnresolvedPlayerIds(
      ports.db,
      candidates.map((c) => c.playerId)
    );
    const playerIds = candidates.map((c) => c.playerId);
    const playerLogs = await loadPlayerLogs(ports.db, playerIds, game.scheduledTipoff);
    const logsByPlayer = new Map<string, typeof playerLogs>();
    for (const row of playerLogs) {
      const list = logsByPlayer.get(row.player_id) ?? [];
      list.push(row);
      logsByPlayer.set(row.player_id, list);
    }
    const tgs = await loadTeamGameStats(ports.db, cutoff, game.season);
    const tgsByGameTeam = new Map(tgs.map((row) => [`${row.game_id}|${row.team_id}`, row]));
    const teamGamesByTeam = new Map<string, typeof tgs>();
    for (const row of tgs) {
      const list = teamGamesByTeam.get(row.team_id) ?? [];
      list.push(row);
      teamGamesByTeam.set(row.team_id, list);
    }

    for (const cand of candidates) {
      intended.push({ playerId: cand.playerId, gameId: game.gameId });
      const built = buildShadowCandidateRow({
        playerId: cand.playerId,
        teamId: cand.teamId,
        game,
        allPlayerGames: logsByPlayer.get(cand.playerId) ?? [],
        tgsByGameTeam,
        teamGamesByTeam,
        liveSourceAvailableByCutoff,
        unresolved: unresolved.has(cand.playerId),
      });
      if (built.eligibility !== 'ok' || !built.featuresC) {
        ineligible += 1;
        continue;
      }
      scoreRows.push({
        player_id: cand.playerId,
        game_id: game.gameId,
        features_c: built.featuresC,
      });
      pending.push({
        playerId: cand.playerId,
        gameId: game.gameId,
        scheduledTipoff: game.scheduledTipoff,
        intendedCutoffAt: cutoff,
        generatedAt: runAt,
        modelVersion: SHADOW_MODEL_VERSION,
        featureSpecVersion: built.featuresC ? 'player-projection-learned-features-r1' : '',
        featureOrder: SHADOW_FEATURE_ORDER,
        featureValues: built.featuresC,
        featureChecksum: featureVectorChecksum(built.featuresC),
        modelChecksums: artifacts.modelChecksums,
        predA: built.predA,
        predB: built.predB,
        predC: { points: null, rebounds: null },
        eligibility: 'ok',
        sourceFreshness: {
          last_final_log_at: lastBox,
          feature_input_age_hours: featureInputAgeHours,
          live_source_available_by_cutoff: liveSourceAvailableByCutoff,
        },
        tipoffRevision: windowAnchor?.revision ?? 0,
      });
    }
  }

  let scored: ShadowScorerResult[] = [];
  try {
    if (scoreRows.length > 0) scored = await ports.scorer(scoreRows);
  } catch (error) {
    failed += scoreRows.length;
    pending.length = 0;
    base.details = { ...base.details, scorer_error: error instanceof Error ? error.message : String(error) };
  }

  const predByKey = new Map(scored.map((row) => [`${row.player_id}|${row.game_id}`, row]));
  let records: ShadowPredictionRecord[] = [];
  for (const cand of pending) {
    const hit = predByKey.get(`${cand.playerId}|${cand.gameId}`);
    if (!hit) {
      failed += 1;
      continue;
    }
    const generatedAt = ports.now().toISOString();
    const appended = appendPredictionSnapshot({
      existing: records,
      candidate: {
        ...cand,
        generatedAt,
        predC: { points: hit.yhat_c_points, rebounds: hit.yhat_c_rebounds },
        delivery: classifyDelivery(generatedAt, cand.intendedCutoffAt),
      },
    });
    records = appended.records;
    if (appended.accepted) {
      await insertPredictionSnapshot(ports.db, appended.records[appended.records.length - 1]);
    }
  }

  const coverage = predictionCoverage({ intendedPopulation: intended, records });
  const missingDue = dueGames.flatMap((g) => {
    const cls = classifyShadowDueWindow({ scheduledTipoff: g.scheduledTipoff, now: runAt });
    if (cls !== 'late_open') return [];
    return intended.filter((p) => p.gameId === g.gameId && !records.some((r) => r.playerId === p.playerId && r.gameId === p.gameId));
  });

  const finished: ShadowRunRecordWrite = {
    ...base,
    finishedAt: ports.now().toISOString(),
    status: 'success',
    schemaEnrichment: schema.ready ? 'available' : 'unavailable',
    dueCount: dueGames.length,
    onTimeCount: coverage.onTime,
    lateCount: coverage.late,
    failedCount: failed + coverage.failed,
    missingCount: missingDue.length,
    ineligibleCount: ineligible,
    featureInputAgeHours,
    settlementBacklog: schema.predictionSettlements ? await countSettlementBacklog(ports.db) : null,
    details: {
      ...base.details,
      window_start: windowAnchor?.firstRegularSeasonTipoff ?? null,
      window_revision: windowAnchor?.revision ?? null,
      intended: intended.length,
      written: records.length,
      logical_key: 'player_id|game_id|model_version|intended_cutoff_at',
    },
  };
  return {
    ...finished,
    runId: await insertShadowRunRecord(ports.db, finished),
    skipped: false,
    windowAnchor,
  };
}

export async function runShadowSettleCycle(ports: ShadowWorkerPorts): Promise<ShadowCycleResult> {
  const env = ports.env ?? process.env;
  const now = ports.now();
  const runAt = now.toISOString();
  const base: ShadowRunRecordWrite = {
    runAt,
    finishedAt: runAt,
    action: 'settle',
    status: 'skipped',
    dueCount: 0,
    onTimeCount: 0,
    lateCount: 0,
    failedCount: 0,
    missingCount: 0,
    ineligibleCount: 0,
    settledCount: 0,
    settlementBacklog: null,
    schemaMode: schemaModeForWrites(env),
    schemaEnrichment: null,
    featureInputAgeHours: hoursSince(await latestFinalLogAt(ports.db).catch(() => null), now),
    details: { protocol: SHADOW_PROTOCOL_VERSION, amendment: SHADOW_PROTOCOL_AMENDMENT },
  };

  if (shouldSkipLiveMutations(env) || !canWriteProductionSnapshots(env)) {
    const finished = { ...base, finishedAt: ports.now().toISOString(), details: { ...base.details, skip: 'freeze_or_writes_disabled' } };
    return { ...finished, runId: await insertShadowRunRecord(ports.db, finished).catch(() => null), skipped: true, windowAnchor: null };
  }

  const schema = await inspectShadowWriteSchema(ports.db);
  try {
    assertSchemaReady({ mode: base.schemaMode!, ready: schema.ready, missing: schema.missing });
  } catch (error) {
    const finished: ShadowRunRecordWrite = {
      ...base,
      status: 'preflight_failed',
      schemaEnrichment: 'unavailable',
      finishedAt: ports.now().toISOString(),
      details: { ...base.details, missing: schema.missing, error: error instanceof Error ? error.message : String(error) },
    };
    return { ...finished, runId: await insertShadowRunRecord(ports.db, finished).catch(() => null), skipped: false, windowAnchor: null };
  }

  const rows = await loadUnsettledFinalSnapshots(ports.db);
  let settled = 0;
  let failed = 0;
  for (const row of rows) {
    const status = (row.status || '').toLowerCase();
    let outcome: 'played' | 'dnp' | 'postponed' | 'cancelled' | 'unresolved' = 'unresolved';
    if (status === 'postponed') outcome = 'postponed';
    else if (status === 'cancelled') outcome = 'cancelled';
    else if (row.minutes != null && isPlayedGame({
      game_id: row.gameId,
      player_id: row.playerId,
      start_time: runAt,
      season: SHADOW_SEASON,
      minutes: row.minutes,
      points: row.actualPts,
      rebounds: row.actualReb,
      assists: null,
      three_pointers_made: null,
    })) {
      outcome = 'played';
    } else if (row.minutes != null) {
      outcome = 'dnp';
    }
    try {
      const ok = await insertSettlementRow(ports.db, {
        snapshotId: row.snapshotId,
        settledAt: ports.now().toISOString(),
        outcome,
        actualPts: row.actualPts,
        actualReb: row.actualReb,
      });
      if (ok) settled += 1;
    } catch {
      failed += 1;
    }
  }

  const finished: ShadowRunRecordWrite = {
    ...base,
    finishedAt: ports.now().toISOString(),
    status: 'success',
    schemaEnrichment: schema.ready ? 'available' : 'unavailable',
    settledCount: settled,
    failedCount: failed,
    settlementBacklog: await countSettlementBacklog(ports.db),
    details: { ...base.details, examined: rows.length },
  };
  return {
    ...finished,
    runId: await insertShadowRunRecord(ports.db, finished),
    skipped: false,
    windowAnchor: schema.shadowWindowAnchors ? await loadCurrentWindowAnchor(ports.db) : null,
  };
}

export function shadowLogicalKey(playerId: string, gameId: string, intendedCutoffAt: string): string {
  return logicalKey({
    playerId,
    gameId,
    modelVersion: SHADOW_MODEL_VERSION,
    intendedCutoffAt,
  });
}
