/**
 * Prospective shadow scoring helpers for frozen PTS C / REB C.
 * Isolated from the Next.js request path. CatBoost stays in Python batch inference.
 */

import {
  FEATURE_C_ALLOWLIST,
  buildLearnedFeatureVector,
  selectLearnedPriors,
  type FeatureVector,
  type LearnedEvalLog,
  type TeamGameContextRow,
} from '@/lib/betting/player-projection-learned-features';
import { isPlayedGame } from '@/lib/betting/minutes-projection-eval';
import {
  FEATURE_DEFINITION,
  conditionalMinutesAdjustedProjection,
  reconstructFromPrior,
  type ProjectionV1Log,
} from '@/lib/betting/player-projection-v1-research';
import { selectPriorGames, trackAProjection } from '@/lib/betting/player-projection-eval';
import { buildPlayedOnlyAsOfModelInputs } from '@/lib/betting/shadow-projection-eval';
import { buildPredictionSnapshot, intendedCutoffFromTip } from '@/lib/context/collection-asof';
import { shouldSkipLiveMutations } from '@/lib/runtime/ingestion-mode';
import {
  SHADOW_DUE_LOOKAHEAD_MINUTES,
  SHADOW_FEATURE_ORDER,
  SHADOW_MINUTES_BEFORE_TIP,
  SHADOW_MODEL_VERSION,
  SHADOW_FEATURE_SPEC_VERSION,
  type ShadowTarget,
} from '@/lib/betting/player-projection-shadow-protocol';
import { createHash } from 'crypto';

export const SHADOW_ELIGIBILITY = [
  'ok',
  'insufficient_history',
  'unresolved_identity',
  'missing_live_source',
  'after_tip',
  'not_due',
] as const;
export type ShadowEligibility = (typeof SHADOW_ELIGIBILITY)[number];

export const PREDICTION_DELIVERY = ['on_time', 'late', 'failed', 'missing'] as const;
export type PredictionDelivery = (typeof PREDICTION_DELIVERY)[number];

export const SETTLEMENT_OUTCOME = ['played', 'dnp', 'postponed', 'cancelled', 'unresolved'] as const;
export type SettlementOutcome = (typeof SETTLEMENT_OUTCOME)[number];

export type ScheduledShadowGame = {
  gameId: string;
  season: string;
  scheduledTipoff: string;
  homeTeamId: string;
  awayTeamId: string;
  status?: string | null;
};

export type ShadowRosterAppearance = {
  playerId: string;
  teamId: string;
  startTime: string;
  played: boolean;
};

export type LogicalPredictionKey = {
  playerId: string;
  gameId: string;
  modelVersion: string;
  intendedCutoffAt: string;
};

export type ShadowPredictionRecord = {
  logicalKey: string;
  playerId: string;
  gameId: string;
  scheduledTipoff: string;
  intendedCutoffAt: string;
  generatedAt: string;
  late: boolean;
  delivery: Exclude<PredictionDelivery, 'missing'>;
  modelVersion: string;
  featureSpecVersion: string;
  featureOrder: readonly string[];
  featureValues: FeatureVector;
  featureChecksum: string;
  modelChecksums: { points: string; rebounds: string };
  predA: Record<ShadowTarget, number | null>;
  predB: Record<ShadowTarget, number | null>;
  predC: Record<ShadowTarget, number | null>;
  eligibility: ShadowEligibility;
  sourceFreshness: Record<string, unknown>;
  tipoffRevision: number;
};

export type SettlementRecord = {
  logicalKey: string;
  settledAt: string;
  outcome: SettlementOutcome;
  actualPts: number | null;
  actualReb: number | null;
};

export function logicalKey(parts: LogicalPredictionKey): string {
  return `${parts.playerId}|${parts.gameId}|${parts.modelVersion}|${parts.intendedCutoffAt}`;
}

export function assertFeatureOrder(actual: readonly string[], expected: readonly string[] = SHADOW_FEATURE_ORDER): void {
  if (actual.length !== expected.length || actual.some((name, i) => name !== expected[i])) {
    throw new Error(
      `Feature ordering/artifact mismatch. expected=${expected.join(',')} actual=${actual.join(',')}`
    );
  }
}

export function featureVectorChecksum(vector: FeatureVector, order: readonly string[] = SHADOW_FEATURE_ORDER): string {
  assertFeatureOrder(order);
  const payload = order.map((name) => [name, vector[name] ?? null]);
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function orderedFeatureValues(
  vector: FeatureVector,
  order: readonly string[] = SHADOW_FEATURE_ORDER
): Array<number | null> {
  assertFeatureOrder(order);
  return order.map((name) => {
    const v = vector[name];
    return v == null || !Number.isFinite(v) ? null : v;
  });
}

export function intendedCutoff(scheduledTipoff: string): string {
  return intendedCutoffFromTip(scheduledTipoff, SHADOW_MINUTES_BEFORE_TIP);
}

export type ShadowDueClass = 'too_early' | 'due' | 'late_open' | 'after_tip';

/** Per-game due windows so mixed tipoff times are not forced into one batch. */
export function classifyShadowDueWindow(args: {
  scheduledTipoff: string;
  now: string;
  lookaheadMinutes?: number;
}): ShadowDueClass {
  const tip = Date.parse(args.scheduledTipoff);
  const now = Date.parse(args.now);
  const cutoff = Date.parse(intendedCutoff(args.scheduledTipoff));
  if (![tip, now, cutoff].every(Number.isFinite)) return 'after_tip';
  if (now > tip) return 'after_tip';
  if (now <= cutoff) {
    const lookaheadMs = (args.lookaheadMinutes ?? SHADOW_DUE_LOOKAHEAD_MINUTES) * 60_000;
    return now >= cutoff - lookaheadMs ? 'due' : 'too_early';
  }
  return 'late_open';
}

export function classifyDelivery(generatedAt: string, intendedCutoffAt: string): Exclude<PredictionDelivery, 'missing' | 'failed'> {
  const g = Date.parse(generatedAt);
  const c = Date.parse(intendedCutoffAt);
  if (Number.isFinite(g) && Number.isFinite(c) && g <= c) return 'on_time';
  return 'late';
}

export function applyTipoffRevision(previousTipoff: string, nextTipoff: string): {
  changed: boolean;
  previousIntendedCutoffAt: string;
  nextIntendedCutoffAt: string;
} {
  return {
    changed: previousTipoff !== nextTipoff,
    previousIntendedCutoffAt: intendedCutoff(previousTipoff),
    nextIntendedCutoffAt: intendedCutoff(nextTipoff),
  };
}

/**
 * Last observed team appearance before cutoff. Does not invent trade dates.
 */
export function observedRosterForTeam(args: {
  teamId: string;
  cutoffAt: string;
  appearances: ShadowRosterAppearance[];
}): string[] {
  const cutoffMs = Date.parse(args.cutoffAt);
  const last = new Map<string, ShadowRosterAppearance>();
  for (const row of args.appearances) {
    if (!row.played) continue;
    const t = Date.parse(row.startTime);
    if (!Number.isFinite(t) || t >= cutoffMs) continue;
    const prev = last.get(row.playerId);
    if (!prev || Date.parse(prev.startTime) < t) last.set(row.playerId, row);
  }
  return [...last.values()]
    .filter((row) => row.teamId === args.teamId)
    .map((row) => row.playerId)
    .sort();
}

export function generateShadowCandidates(args: {
  game: ScheduledShadowGame;
  appearances: ShadowRosterAppearance[];
  unresolvedPlayerIds?: Iterable<string>;
}): Array<{ playerId: string; teamId: string; eligibility: ShadowEligibility }> {
  const cutoff = intendedCutoff(args.game.scheduledTipoff);
  const unresolved = new Set(Array.from(args.unresolvedPlayerIds ?? []).map(String));
  const out: Array<{ playerId: string; teamId: string; eligibility: ShadowEligibility }> = [];
  for (const teamId of [args.game.homeTeamId, args.game.awayTeamId]) {
    for (const playerId of observedRosterForTeam({ teamId, cutoffAt: cutoff, appearances: args.appearances })) {
      out.push({
        playerId,
        teamId,
        eligibility: !playerId || unresolved.has(playerId) ? 'unresolved_identity' : 'ok',
      });
    }
  }
  return out;
}

export function observationUsableByCutoff(observedAt: string | null | undefined, cutoffAt: string): boolean {
  if (!observedAt) return false;
  const o = Date.parse(observedAt);
  const c = Date.parse(cutoffAt);
  return Number.isFinite(o) && Number.isFinite(c) && o <= c;
}

export function buildShadowCandidateRow(args: {
  playerId: string;
  teamId: string;
  game: ScheduledShadowGame;
  allPlayerGames: LearnedEvalLog[];
  tgsByGameTeam: Map<string, TeamGameContextRow>;
  teamGamesByTeam: Map<string, TeamGameContextRow[]>;
  liveSourceAvailableByCutoff: boolean;
  unresolved?: boolean;
}): {
  eligibility: ShadowEligibility;
  featuresC: FeatureVector | null;
  predA: Record<ShadowTarget, number | null>;
  predB: Record<ShadowTarget, number | null>;
} {
  const emptyPred = { points: null, rebounds: null };
  if (args.unresolved) {
    return { eligibility: 'unresolved_identity', featuresC: null, predA: emptyPred, predB: emptyPred };
  }
  if (!args.liveSourceAvailableByCutoff) {
    return { eligibility: 'missing_live_source', featuresC: null, predA: emptyPred, predB: emptyPred };
  }
  const target: LearnedEvalLog = {
    player_id: args.playerId,
    game_id: args.game.gameId,
    team_id: args.teamId,
    home_team_id: args.game.homeTeamId,
    away_team_id: args.game.awayTeamId,
    start_time: args.game.scheduledTipoff,
    season: args.game.season,
    minutes: null,
    points: null,
    rebounds: null,
    assists: null,
    three_pointers_made: null,
    started: 'unknown',
  };
  const abPrior = selectPriorGames(
    args.allPlayerGames,
    target.start_time,
    target.season,
    FEATURE_DEFINITION
  ) as LearnedEvalLog[];
  const abPlayed = abPrior.filter(isPlayedGame);
  if (abPlayed.length === 0) {
    return { eligibility: 'insufficient_history', featuresC: null, predA: emptyPred, predB: emptyPred };
  }
  const cdPrior = selectLearnedPriors(args.allPlayerGames, target.start_time, target.season);
  const minutesFeatures = reconstructFromPrior(abPrior as ProjectionV1Log[], target as ProjectionV1Log);
  const playedInputs = buildPlayedOnlyAsOfModelInputs(abPrior, 'research');
  const predA = {
    points: trackAProjection(playedInputs, 'points'),
    rebounds: trackAProjection(playedInputs, 'rebounds'),
  };
  const predB = {
    points:
      minutesFeatures && predA.points != null
        ? conditionalMinutesAdjustedProjection({
            trackA: predA.points,
            features: minutesFeatures,
            propType: 'points',
          })
        : predA.points,
    rebounds:
      minutesFeatures && predA.rebounds != null
        ? conditionalMinutesAdjustedProjection({
            trackA: predA.rebounds,
            features: minutesFeatures,
            propType: 'rebounds',
          })
        : predA.rebounds,
  };
  const vectors = buildLearnedFeatureVector({
    cdPrior,
    target,
    tgsByGameTeam: args.tgsByGameTeam,
    teamGamesByTeam: args.teamGamesByTeam,
    predTrackA: {
      points: predA.points,
      rebounds: predA.rebounds,
      assists: trackAProjection(playedInputs, 'assists'),
      threes: trackAProjection(playedInputs, 'threes'),
    },
  });
  return { eligibility: 'ok', featuresC: vectors.c, predA, predB };
}

export function appendPredictionSnapshot(args: {
  existing: ShadowPredictionRecord[];
  candidate: Omit<ShadowPredictionRecord, 'logicalKey' | 'late' | 'delivery'> & {
    delivery?: Exclude<PredictionDelivery, 'missing'>;
  };
}): { records: ShadowPredictionRecord[]; accepted: boolean; reason: 'written' | 'duplicate_logical' } {
  const key = logicalKey({
    playerId: args.candidate.playerId,
    gameId: args.candidate.gameId,
    modelVersion: args.candidate.modelVersion,
    intendedCutoffAt: args.candidate.intendedCutoffAt,
  });
  if (args.existing.some((row) => row.logicalKey === key)) {
    return { records: args.existing, accepted: false, reason: 'duplicate_logical' };
  }
  const snap = buildPredictionSnapshot({
    playerId: args.candidate.playerId,
    gameId: args.candidate.gameId,
    scheduledTipoff: args.candidate.scheduledTipoff,
    intendedCutoffAt: args.candidate.intendedCutoffAt,
    generatedAt: args.candidate.generatedAt,
    modelVersion: args.candidate.modelVersion,
    featureSpecVersion: args.candidate.featureSpecVersion,
    featureValues: args.candidate.featureValues,
    predictions: args.candidate.predC,
  });
  const delivery = args.candidate.delivery ?? classifyDelivery(args.candidate.generatedAt, args.candidate.intendedCutoffAt);
  const record: ShadowPredictionRecord = {
    ...args.candidate,
    logicalKey: key,
    late: snap.late,
    delivery,
    modelVersion: SHADOW_MODEL_VERSION,
    featureSpecVersion: SHADOW_FEATURE_SPEC_VERSION,
    featureOrder: SHADOW_FEATURE_ORDER,
  };
  return { records: [...args.existing, record], accepted: true, reason: 'written' };
}

export function settlePrediction(args: {
  prediction: ShadowPredictionRecord;
  settlements: SettlementRecord[];
  settledAt: string;
  outcome: SettlementOutcome;
  actualPts?: number | null;
  actualReb?: number | null;
}): { settlements: SettlementRecord[]; accepted: boolean; prediction: ShadowPredictionRecord } {
  if (args.settlements.some((row) => row.logicalKey === args.prediction.logicalKey)) {
    return { settlements: args.settlements, accepted: false, prediction: args.prediction };
  }
  return {
    prediction: args.prediction,
    accepted: true,
    settlements: [
      ...args.settlements,
      {
        logicalKey: args.prediction.logicalKey,
        settledAt: args.settledAt,
        outcome: args.outcome,
        actualPts: args.actualPts ?? null,
        actualReb: args.actualReb ?? null,
      },
    ],
  };
}

export function predictionCoverage(args: {
  intendedPopulation: Array<{ playerId: string; gameId: string }>;
  records: ShadowPredictionRecord[];
}): {
  intended: number;
  onTime: number;
  late: number;
  failed: number;
  missing: number;
} {
  const seen = new Set(args.records.map((r) => `${r.playerId}|${r.gameId}`));
  let onTime = 0;
  let late = 0;
  let failed = 0;
  for (const row of args.records) {
    if (row.delivery === 'on_time') onTime += 1;
    else if (row.delivery === 'late') late += 1;
    else failed += 1;
  }
  return {
    intended: args.intendedPopulation.length,
    onTime,
    late,
    failed,
    missing: args.intendedPopulation.filter((p) => !seen.has(`${p.playerId}|${p.gameId}`)).length,
  };
}

export function conditionalOnPlayingMetrics(
  pairs: Array<{ y: number | null; p: number | null; played: boolean }>
): { n: number; mae: number | null } {
  const xs = pairs.filter((row) => row.played && row.y != null && row.p != null && Number.isFinite(row.y) && Number.isFinite(row.p));
  if (xs.length === 0) return { n: 0, mae: null };
  const mae = xs.reduce((s, row) => s + Math.abs((row.p as number) - (row.y as number)), 0) / xs.length;
  return { n: xs.length, mae };
}

export function canWriteProductionSnapshots(
  env: Record<string, string | undefined> = process.env
): boolean {
  return !shouldSkipLiveMutations(env) && env.SHADOW_SNAPSHOT_WRITES === '1';
}

export { FEATURE_C_ALLOWLIST };
