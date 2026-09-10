/**
 * Compact historical starter serving transform (Step 12C).
 * Archive top-level team.id is the game-context team. Never use player.team_id.
 * Product-eligible only when both sides have exactly 5 starter=true rows.
 */

import { extractLineupRows, nestedId, type LineupArchiveJson } from '@/lib/archive/lineups-2025';
import {
  isLineups2025StarterAnomaly,
  normalizeCertifiedPosition,
} from '@/lib/betting/historical-starters';

export const GAME_STARTERS_SOURCE = 'bdl_lineups_archive_2025';
export const GAME_STARTERS_SEASON = '2025';

export type GameStarterCandidate = {
  gameId: string;
  teamId: string;
  playerId: string;
  position: string | null;
  season: string;
  source: string;
};

export type GameStarterCertifyReason =
  | 'valid_5_plus_5'
  | 'anomaly'
  | 'incomplete'
  | 'unknown_identity'
  | 'duplicate_starter';

export function isArchiveStarterFlag(value: unknown): boolean {
  return value === true;
}

/**
 * Extract starter=true rows. Team comes from top-level team.id only.
 * Missing player/team IDs are flagged — never name-matched.
 */
export function extractStarterCandidatesFromArchive(
  gameId: string,
  body: unknown
): {
  archiveRows: number;
  starterCandidates: GameStarterCandidate[];
  unknownIdentity: number;
} {
  const rows = extractLineupRows(body);
  const starterCandidates: GameStarterCandidate[] = [];
  let unknownIdentity = 0;
  for (const row of rows) {
    if (!isArchiveStarterFlag(row.starter)) continue;
    const teamId = nestedId(row.team);
    const playerId = nestedId(row.player);
    if (!teamId || !playerId) {
      unknownIdentity += 1;
      continue;
    }
    starterCandidates.push({
      gameId,
      teamId,
      playerId,
      position: normalizeCertifiedPosition(row.position),
      season: GAME_STARTERS_SEASON,
      source: GAME_STARTERS_SOURCE,
    });
  }
  return { archiveRows: rows.length, starterCandidates, unknownIdentity };
}

export function starterNaturalKey(row: Pick<GameStarterCandidate, 'gameId' | 'teamId' | 'playerId'>): string {
  return `${row.gameId}|${row.teamId}|${row.playerId}`;
}

export function certifyStarterGame(input: {
  gameId: string;
  homeTeamId: string;
  awayTeamId: string;
  starterCandidates: GameStarterCandidate[];
  unknownIdentity?: number;
}): { productEligible: boolean; reason: GameStarterCertifyReason; homeCount: number; awayCount: number } {
  if (isLineups2025StarterAnomaly(input.gameId)) {
    return { productEligible: false, reason: 'anomaly', homeCount: 0, awayCount: 0 };
  }
  if ((input.unknownIdentity ?? 0) > 0) {
    return { productEligible: false, reason: 'unknown_identity', homeCount: 0, awayCount: 0 };
  }
  const keys = new Set<string>();
  for (const row of input.starterCandidates) {
    const k = starterNaturalKey(row);
    if (keys.has(k)) {
      return { productEligible: false, reason: 'duplicate_starter', homeCount: 0, awayCount: 0 };
    }
    keys.add(k);
  }
  const home = input.starterCandidates.filter((r) => r.teamId === input.homeTeamId);
  const away = input.starterCandidates.filter((r) => r.teamId === input.awayTeamId);
  if (home.length === 5 && away.length === 5) {
    return { productEligible: true, reason: 'valid_5_plus_5', homeCount: 5, awayCount: 5 };
  }
  return {
    productEligible: false,
    reason: 'incomplete',
    homeCount: home.length,
    awayCount: away.length,
  };
}

/** Nested player.team_id is current/provider roster — never a serving team. */
export function historicalTeamIdFromLineupRow(row: LineupArchiveJson): string | null {
  return nestedId(row.team);
}

export {
  emptyHistoricalStarters,
  groupCertifiedStarters,
  isLineups2025StarterAnomaly,
  shouldShowStartingFive,
} from '@/lib/betting/historical-starters';
export type { HistoricalStarterPlayer, HistoricalStarters } from '@/lib/betting/historical-starters';
