/**
 * 2023 persistent BDL player-point anomaly policy.
 * Fail-closed: unknown score mismatches never materialize.
 * Known IDs are allowed only when structure, expected deltas, and review evidence hold.
 * No generic ignoreScoreMismatch flag.
 */

import type { ServingGame, ServingLog } from './bdl-to-serving';

export const BDL_PLAYER_POINTS_SCORE_MISMATCH = 'BDL_PLAYER_POINTS_SCORE_MISMATCH' as const;

export const ANOMALY_SEMANTICS =
  "BALLDONTLIE's official game score is authoritative for the game record, but the sum of provider player pts is lower than that score. Targeted /v1/stats refetch and Box Scores independently reproduced the same provider data.";

export const QUALITY_TABLE = 'public.game_validation_results';

export const RESEARCH_EXCLUDE_UNRESOLVED_HIGH_SQL = `
  select game_id
  from game_validation_results
  where check_name = '${BDL_PLAYER_POINTS_SCORE_MISMATCH}'
    and status = 'fail'
    and severity = 'error'
`;

export type PersistentAnomalySpec = {
  gameId: string;
  official: { home: number; away: number };
  providerSum: { home: number; away: number };
  boxScoresEvidence: 'sampled_reproduced' | 'class_confirmed_by_sample';
};

/** Reviewed 2023-only allowlist. Deltas are pinned; drift fails closed. */
export const PERSISTENT_2023_ANOMALIES: readonly PersistentAnomalySpec[] = [
  { gameId: '1038319', official: { home: 104, away: 127 }, providerSum: { home: 104, away: 125 }, boxScoresEvidence: 'sampled_reproduced' },
  { gameId: '1038322', official: { home: 116, away: 104 }, providerSum: { home: 114, away: 104 }, boxScoresEvidence: 'sampled_reproduced' },
  { gameId: '1038342', official: { home: 123, away: 103 }, providerSum: { home: 123, away: 101 }, boxScoresEvidence: 'class_confirmed_by_sample' },
  { gameId: '1038362', official: { home: 100, away: 121 }, providerSum: { home: 96, away: 121 }, boxScoresEvidence: 'class_confirmed_by_sample' },
  { gameId: '1038379', official: { home: 116, away: 100 }, providerSum: { home: 111, away: 95 }, boxScoresEvidence: 'class_confirmed_by_sample' },
  { gameId: '1038433', official: { home: 112, away: 95 }, providerSum: { home: 110, away: 95 }, boxScoresEvidence: 'class_confirmed_by_sample' },
  { gameId: '1038439', official: { home: 117, away: 96 }, providerSum: { home: 114, away: 96 }, boxScoresEvidence: 'class_confirmed_by_sample' },
  { gameId: '1038453', official: { home: 92, away: 122 }, providerSum: { home: 89, away: 122 }, boxScoresEvidence: 'class_confirmed_by_sample' },
  { gameId: '1038491', official: { home: 125, away: 90 }, providerSum: { home: 122, away: 90 }, boxScoresEvidence: 'class_confirmed_by_sample' },
  { gameId: '1038504', official: { home: 98, away: 74 }, providerSum: { home: 98, away: 72 }, boxScoresEvidence: 'sampled_reproduced' },
];

export const PERSISTENT_2023_ANOMALY_IDS = PERSISTENT_2023_ANOMALIES.map((r) => r.gameId);

const ALLOWLIST = new Map(PERSISTENT_2023_ANOMALIES.map((r) => [r.gameId, r]));

export type RawStatRef = {
  id: string;
  playerId: string;
  teamId: string;
  gameId: string;
};

export type GameEvidence = {
  refetchIdentical: boolean;
  boxScores: 'sampled_reproduced' | 'class_confirmed_by_sample' | 'missing' | 'not_applicable';
};

export type GameInspection = {
  gameId: string;
  bothTeams: boolean;
  dupLogical: number;
  dupStatId: number;
  missingPlayer: number;
  missingTeam: number;
  missingGame: number;
  foreignTeams: number;
  officialHome: number | null;
  officialAway: number | null;
  summedHome: number;
  summedAway: number;
  deltaHome: number | null;
  deltaAway: number | null;
  scoreOk: boolean;
  structuralOk: boolean;
};

export type PolicyDecision =
  | 'ALLOW_STRICT'
  | 'ALLOW_PERSISTENT_ANOMALY'
  | 'REJECT';

export type GamePolicyResult = {
  gameId: string;
  decision: PolicyDecision;
  reason: string;
  inspection: GameInspection;
  qualityFlag: boolean;
};

export function specForGame(gameId: string): PersistentAnomalySpec | undefined {
  return ALLOWLIST.get(gameId);
}

export function inspectMappedGame(args: {
  game: ServingGame;
  logs: ServingLog[];
  rawStats: RawStatRef[];
}): GameInspection {
  const g = args.game;
  const pair = new Map<string, number>();
  const statDup = new Map<string, number>();
  let summedHome = 0;
  let summedAway = 0;
  let homeN = 0;
  let awayN = 0;
  let missingPlayer = 0;
  let missingTeam = 0;
  let missingGame = 0;
  let foreignTeams = 0;
  for (const log of args.logs) {
    if (!log.player_id) missingPlayer += 1;
    if (!log.team_id) missingTeam += 1;
    if (!log.game_id) missingGame += 1;
    const k = `${log.game_id}|${log.player_id}`;
    pair.set(k, (pair.get(k) ?? 0) + 1);
    if (log.team_id === g.home_team_id) {
      summedHome += Number(log.points ?? 0);
      homeN += 1;
    } else if (log.team_id === g.away_team_id) {
      summedAway += Number(log.points ?? 0);
      awayN += 1;
    } else if (log.team_id) {
      foreignTeams += 1;
    }
  }
  for (const s of args.rawStats) {
    if (s.id) statDup.set(s.id, (statDup.get(s.id) ?? 0) + 1);
    if (!s.playerId) missingPlayer += 1;
    if (!s.teamId) missingTeam += 1;
    if (!s.gameId) missingGame += 1;
  }
  const dupLogical = [...pair.values()].filter((n) => n > 1).length;
  const dupStatId = [...statDup.values()].filter((n) => n > 1).length;
  const officialHome = g.home_score;
  const officialAway = g.away_score;
  const scoreOk =
    officialHome != null && officialAway != null && summedHome === officialHome && summedAway === officialAway;
  const bothTeams = homeN > 0 && awayN > 0;
  const metadataOk = Boolean(g.home_team_id && g.away_team_id && g.home_team_id !== g.away_team_id);
  const structuralOk =
    bothTeams &&
    metadataOk &&
    dupLogical === 0 &&
    dupStatId === 0 &&
    missingPlayer === 0 &&
    missingTeam === 0 &&
    missingGame === 0 &&
    foreignTeams === 0;
  return {
    gameId: g.game_id,
    bothTeams,
    dupLogical,
    dupStatId,
    missingPlayer,
    missingTeam,
    missingGame,
    foreignTeams,
    officialHome,
    officialAway,
    summedHome,
    summedAway,
    deltaHome: officialHome == null ? null : summedHome - officialHome,
    deltaAway: officialAway == null ? null : summedAway - officialAway,
    scoreOk,
    structuralOk,
  };
}

export function evaluateMappedGame(args: {
  season: string;
  game: ServingGame;
  logs: ServingLog[];
  rawStats: RawStatRef[];
  evidence: GameEvidence;
}): GamePolicyResult {
  const inspection = inspectMappedGame(args);
  const spec = args.season === '2023' ? specForGame(args.game.game_id) : undefined;

  if (!inspection.structuralOk) {
    return {
      gameId: args.game.game_id,
      decision: 'REJECT',
      reason: spec
        ? 'known anomaly id has a new structural defect; fail closed'
        : 'structural validation failed',
      inspection,
      qualityFlag: false,
    };
  }

  if (inspection.scoreOk) {
    if (spec) {
      return {
        gameId: args.game.game_id,
        decision: 'REJECT',
        reason: 'known anomaly id no longer mismatches; requires review',
        inspection,
        qualityFlag: false,
      };
    }
    return {
      gameId: args.game.game_id,
      decision: 'ALLOW_STRICT',
      reason: 'score reconciliation PASS',
      inspection,
      qualityFlag: false,
    };
  }

  if (!spec) {
    return {
      gameId: args.game.game_id,
      decision: 'REJECT',
      reason: 'unknown score mismatch; fail closed',
      inspection,
      qualityFlag: false,
    };
  }

  if (inspection.officialHome !== spec.official.home || inspection.officialAway !== spec.official.away) {
    return {
      gameId: args.game.game_id,
      decision: 'REJECT',
      reason: 'official score drifted from reviewed allowlist; fail closed',
      inspection,
      qualityFlag: false,
    };
  }
  if (inspection.summedHome !== spec.providerSum.home || inspection.summedAway !== spec.providerSum.away) {
    return {
      gameId: args.game.game_id,
      decision: 'REJECT',
      reason: 'provider point sum drifted from reviewed allowlist; fail closed',
      inspection,
      qualityFlag: false,
    };
  }
  if (!args.evidence.refetchIdentical) {
    return {
      gameId: args.game.game_id,
      decision: 'REJECT',
      reason: 'targeted /v1/stats refetch was not identical; fail closed',
      inspection,
      qualityFlag: false,
    };
  }
  if (spec.boxScoresEvidence === 'sampled_reproduced' && args.evidence.boxScores !== 'sampled_reproduced') {
    return {
      gameId: args.game.game_id,
      decision: 'REJECT',
      reason: 'sampled Box Scores evidence missing or did not reproduce anomaly',
      inspection,
      qualityFlag: false,
    };
  }
  if (args.evidence.boxScores === 'missing') {
    return {
      gameId: args.game.game_id,
      decision: 'REJECT',
      reason: 'Box Scores class evidence missing; fail closed',
      inspection,
      qualityFlag: false,
    };
  }

  return {
    gameId: args.game.game_id,
    decision: 'ALLOW_PERSISTENT_ANOMALY',
    reason: 'explicit reviewed provider anomaly; player pts stored as provided',
    inspection,
    qualityFlag: true,
  };
}

export function evaluateSeason(args: {
  season: string;
  games: ServingGame[];
  logsByGame: Map<string, ServingLog[]>;
  rawStatsByGame: Map<string, RawStatRef[]>;
  evidenceByGame: Map<string, GameEvidence>;
}): {
  results: GamePolicyResult[];
  allowStrict: number;
  allowAnomaly: number;
  reject: number;
  qualityFlags: number;
  canMaterialize: boolean;
} {
  const results = args.games.map((game) =>
    evaluateMappedGame({
      season: args.season,
      game,
      logs: args.logsByGame.get(game.game_id) ?? [],
      rawStats: args.rawStatsByGame.get(game.game_id) ?? [],
      evidence: args.evidenceByGame.get(game.game_id) ?? { refetchIdentical: false, boxScores: 'missing' },
    })
  );
  const allowStrict = results.filter((r) => r.decision === 'ALLOW_STRICT').length;
  const allowAnomaly = results.filter((r) => r.decision === 'ALLOW_PERSISTENT_ANOMALY').length;
  const reject = results.filter((r) => r.decision === 'REJECT').length;
  return {
    results,
    allowStrict,
    allowAnomaly,
    reject,
    qualityFlags: results.filter((r) => r.qualityFlag).length,
    canMaterialize: reject === 0 && args.games.length > 0,
  };
}

export function projectedValidationRow(args: {
  result: GamePolicyResult;
  season: string;
  detectedAt: string;
  evidence?: GameEvidence;
}): {
  game_id: string;
  check_name: typeof BDL_PLAYER_POINTS_SCORE_MISMATCH;
  status: 'fail';
  severity: 'error';
  details: Record<string, unknown>;
  validated_at: string;
} {
  const i = args.result.inspection;
  return {
    game_id: args.result.gameId,
    check_name: BDL_PLAYER_POINTS_SCORE_MISMATCH,
    status: 'fail',
    severity: 'error',
    details: {
      season: args.season,
      source: 'balldontlie',
      provider: 'BallDontLie',
      issue: BDL_PLAYER_POINTS_SCORE_MISMATCH,
      official: { home: i.officialHome, away: i.officialAway },
      providerSum: { home: i.summedHome, away: i.summedAway },
      delta: { home: i.deltaHome, away: i.deltaAway },
      evidence: {
        targetedStatsRefetchIdentical: args.evidence?.refetchIdentical ?? null,
        boxScores: args.evidence?.boxScores ?? null,
      },
      reviewStatus: 'persistent_reviewed_provider_anomaly',
      notes: ANOMALY_SEMANTICS,
    },
    validated_at: args.detectedAt,
  };
}

export function isUnresolvedHighSeverityProviderScoreMismatch(row: {
  check_name: string;
  status: string;
  severity: string;
}): boolean {
  return (
    row.check_name === BDL_PLAYER_POINTS_SCORE_MISMATCH &&
    row.status === 'fail' &&
    row.severity === 'error'
  );
}
