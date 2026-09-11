import { hasProvenFinalScores, isFinalStatus } from '@/lib/betting/normalize-game-status';
import { selectBoxRowsForPgl } from '@/lib/identity/box-identity';
import type { PlayerIdentityIndex } from '@/lib/identity/player-identity-resolve';
import { parseBdlStatsPayload, toPlayerGameLogWrite, type PlayerGameLogWrite } from './box-transform';
import type { PostgameReasonCode, PostgameStageStatus } from './types';

export type BoxGameContext = {
  gameId: string;
  season: string;
  status: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
};

export type BoxStageResult = {
  status: PostgameStageStatus;
  reasonCode: PostgameReasonCode | null;
  writes: PlayerGameLogWrite[];
  inputCount: number;
  outputCount: number;
  identitySkipped: number;
  httpStatus: number | null;
  pages: number;
};

export function evaluateBoxStage(input: {
  game: BoxGameContext;
  payload: unknown;
  httpStatus: number | null;
  pages: number;
  identityIndex: PlayerIdentityIndex;
  observedAt: string;
  attempt: number;
}): BoxStageResult {
  const empty = (status: PostgameStageStatus, reasonCode: PostgameReasonCode | null): BoxStageResult => ({
    status,
    reasonCode,
    writes: [],
    inputCount: 0,
    outputCount: 0,
    identitySkipped: 0,
    httpStatus: input.httpStatus,
    pages: input.pages,
  });

  if (!isFinalStatus(input.game.status) || !hasProvenFinalScores(input.game.homeScore, input.game.awayScore)) {
    return empty('WAITING', 'PROVIDER_NOT_READY');
  }
  if (input.httpStatus === 401 || input.httpStatus === 403) {
    return empty('BLOCKED', 'SUBSCRIPTION_BLOCKED');
  }
  if (input.httpStatus === 429) return empty('WAITING', 'PROVIDER_429');
  if (input.httpStatus != null && input.httpStatus >= 500) return empty('WAITING', 'PROVIDER_5XX');
  if (input.httpStatus === 0) return empty('WAITING', 'NETWORK_TIMEOUT');

  const parsed = parseBdlStatsPayload(input.payload);
  if (parsed.malformed) return empty('FAILED', 'MALFORMED_SOURCE');
  if (parsed.rows.length === 0) {
    if (input.attempt >= 3) return empty('WAITING', 'VOLUME_UNEXPECTED_ZERO');
    return empty('WAITING', 'PROVIDER_NOT_READY');
  }

  const gated = selectBoxRowsForPgl(parsed.rows, (row) => row.playerId, input.identityIndex, input.observedAt);
  const writes = gated.keep.map((row) =>
    toPlayerGameLogWrite({
      row,
      gameId: input.game.gameId,
      season: input.game.season,
      homeTeamId: input.game.homeTeamId,
      awayTeamId: input.game.awayTeamId,
    })
  );
  const homeCount = writes.filter((row) => row.teamId === input.game.homeTeamId).length;
  const awayCount = writes.filter((row) => row.teamId === input.game.awayTeamId).length;
  const identitySkipped = gated.skipped.length;
  const conflict = [...gated.gate.byId.values()].some((d) => d.event === 'identity_conflict');
  const ready = writes.length > 0 && homeCount > 0 && awayCount > 0 && identitySkipped === 0;

  let status: PostgameStageStatus = 'WAITING';
  let reasonCode: PostgameReasonCode | null = 'IDENTITY_NOT_SERVING';
  if (ready) {
    status = 'READY';
    reasonCode = null;
  } else if (conflict) {
    reasonCode = 'IDENTITY_CONFLICT';
  } else if (writes.length === 0) {
    reasonCode = identitySkipped > 0 ? 'IDENTITY_NOT_SERVING' : 'VOLUME_UNEXPECTED_ZERO';
  }

  return {
    status,
    reasonCode,
    writes,
    inputCount: parsed.rows.length,
    outputCount: writes.length,
    identitySkipped,
    httpStatus: input.httpStatus,
    pages: input.pages,
  };
}
