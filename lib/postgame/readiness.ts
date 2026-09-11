/**
 * Ops aggregate readiness for a Final game. Product still uses per-capability flags.
 * No historical_complete boolean for Explorer.
 */

import { hasProvenFinalScores, isFinalStatus } from '@/lib/betting/normalize-game-status';
import {
  POSTGAME_STAGES,
  type GameReadinessGrade,
  type PostgameScanGame,
  type PostgameStage,
  type PostgameStageRow,
  type PostgameStageStatus,
  type PostgameServingEvidence,
} from './types';

const OPTIONAL_STAGES: PostgameStage[] = ['starters', 'advanced', 'plays', 'game_flow'];

export function isTerminalAbsenceOrReady(status: PostgameStageStatus): boolean {
  return status === 'READY' || status === 'EXPECTED_ABSENCE';
}

export function boxServingReady(evidence: PostgameServingEvidence | undefined): boolean {
  if (!evidence) return false;
  return evidence.boxHomeCount > 0 && evidence.boxAwayCount > 0;
}

export function startersServingReady(evidence: PostgameServingEvidence | undefined): boolean {
  if (!evidence) return false;
  return evidence.startersHomeCount === 5 && evidence.startersAwayCount === 5;
}

export function classifyGameReadiness(input: {
  game: PostgameScanGame;
  stages: Partial<Record<PostgameStage, PostgameStageRow>>;
}): GameReadinessGrade {
  if (!isFinalStatus(input.game.status)) return 'NOT_ELIGIBLE';
  if (!hasProvenFinalScores(input.game.homeScore, input.game.awayScore)) return 'NOT_ELIGIBLE';

  const box = input.stages.box?.status;
  if (box !== 'READY') return 'NOT_ELIGIBLE';

  const optional = OPTIONAL_STAGES.map((stage) => input.stages[stage]?.status ?? 'WAITING');
  const allSettled = optional.every((status) => status === 'READY' || status === 'EXPECTED_ABSENCE');
  if (allSettled) return 'COMPLETE';

  const anyEnrichment = optional.some((status) => status === 'READY');
  if (anyEnrichment) return 'ENRICHED';
  return 'MINIMUM_READY';
}

export function defaultStageRows(
  game: PostgameScanGame
): Record<PostgameStage, Pick<PostgameStageRow, 'gameId' | 'season' | 'stage' | 'status' | 'attempts' | 'reasonCode'>> {
  const rows = {} as Record<
    PostgameStage,
    Pick<PostgameStageRow, 'gameId' | 'season' | 'stage' | 'status' | 'attempts' | 'reasonCode'>
  >;
  for (const stage of POSTGAME_STAGES) {
    rows[stage] = {
      gameId: game.gameId,
      season: game.season,
      stage,
      status: 'WAITING',
      attempts: 0,
      reasonCode: null,
    };
  }
  return rows;
}
