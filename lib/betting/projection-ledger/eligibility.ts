/**
 * Game eligibility uses tip time and the competition-universe classifier.
 * It does not require raw status = 'Scheduled'. ISO tip strings stay eligible
 * when normalizeGameStatus treats them as scheduled and the date is in-season.
 */

import { isPrimaryProspectiveCompetitionGame } from '@/lib/context-projection/game-universe';
import { isFinalStatus, normalizeGameStatus } from '@/lib/betting/normalize-game-status';
import { passesAuthoritativeEvaluation } from '@/lib/betting/projection-ledger/evaluation';

export interface LedgerGameCandidate {
  gameId: string;
  season: string;
  startTime: string;
  status: string | null;
  homeTeamId: string;
  awayTeamId: string;
}

export function gameEligibleForLedgerPublish(game: LedgerGameCandidate): boolean {
  if (!game.startTime || !Number.isFinite(Date.parse(game.startTime))) return false;
  const status = normalizeGameStatus(game.status);
  if (status === 'Postponed' || status === 'Canceled' || isFinalStatus(game.status)) return false;
  return isPrimaryProspectiveCompetitionGame({
    season: game.season,
    startTimeIso: game.startTime,
    status: game.status,
  });
}

/**
 * A 2026 game scored from 2025 production inputs remains an official prospective
 * prediction when timing and provenance pass. The two season fields stay distinct.
 */
export function crossSeasonProspectiveRemainsEligible(args: {
  gameSeason: string;
  inputSeasonKey: string;
  provenanceType: string;
  timingStatus: string;
  snapshotRevision: number;
  generatedAt: string;
  storedGameTipTime: string;
  currentGameStartTime: string;
  captureEligibleAtWrite: boolean;
}): boolean {
  if (!args.gameSeason.trim() || !args.inputSeasonKey.trim()) return false;
  return passesAuthoritativeEvaluation(args);
}
