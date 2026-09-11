import {
  certifyStarterGame,
  extractStarterCandidatesFromArchive,
  failStarterCertificationIfIdentityUnsafe,
  type GameStarterCandidate,
} from '@/lib/archive/game-starters-from-lineups';
import { selectArchiveRowsForServing, starterGameIdentityReason } from '@/lib/identity/archive-identity';
import type { PlayerIdentityIndex } from '@/lib/identity/player-identity-resolve';
import type { PostgameReasonCode, PostgameStageStatus } from './types';

export type StartersGameContext = {
  gameId: string;
  season: string;
  homeTeamId: string;
  awayTeamId: string;
};

export type StartersStageResult = {
  status: PostgameStageStatus;
  reasonCode: PostgameReasonCode | null;
  writes: GameStarterCandidate[];
  inputCount: number;
  outputCount: number;
  identitySkipped: number;
  httpStatus: number | null;
};

export function evaluateStartersStage(input: {
  game: StartersGameContext;
  payload: unknown;
  httpStatus: number | null;
  identityIndex: PlayerIdentityIndex;
  observedAt: string;
  attempt: number;
  maxAttempts: number;
}): StartersStageResult {
  const empty = (
    status: PostgameStageStatus,
    reasonCode: PostgameReasonCode | null
  ): StartersStageResult => ({
    status,
    reasonCode,
    writes: [],
    inputCount: 0,
    outputCount: 0,
    identitySkipped: 0,
    httpStatus: input.httpStatus,
  });

  if (input.httpStatus === 401 || input.httpStatus === 403) {
    return empty('BLOCKED', 'SUBSCRIPTION_BLOCKED');
  }
  if (input.httpStatus === 429) return empty('WAITING', 'PROVIDER_429');
  if (input.httpStatus != null && input.httpStatus >= 500) return empty('WAITING', 'PROVIDER_5XX');
  if (input.httpStatus === 0) return empty('WAITING', 'NETWORK_TIMEOUT');

  const extracted = extractStarterCandidatesFromArchive(input.game.gameId, input.payload, input.game.season);
  if (extracted.archiveRows === 0 && extracted.starterCandidates.length === 0) {
    return empty('WAITING', 'PROVIDER_NOT_READY');
  }

  const gated = selectArchiveRowsForServing(
    'LINEUP',
    extracted.starterCandidates,
    (row) => row.playerId,
    input.identityIndex,
    input.observedAt
  );
  const identityReason = starterGameIdentityReason(
    extracted.starterCandidates.map((row) => row.playerId),
    gated.gate
  );
  const cert = failStarterCertificationIfIdentityUnsafe(
    certifyStarterGame({
      gameId: input.game.gameId,
      homeTeamId: input.game.homeTeamId,
      awayTeamId: input.game.awayTeamId,
      starterCandidates: gated.keep,
      unknownIdentity: extracted.unknownIdentity,
    }),
    identityReason
  );

  if (cert.productEligible && cert.reason === 'valid_5_plus_5') {
    return {
      status: 'READY',
      reasonCode: null,
      writes: gated.keep,
      inputCount: extracted.starterCandidates.length,
      outputCount: gated.keep.length,
      identitySkipped: gated.skipped.length,
      httpStatus: input.httpStatus,
    };
  }

  const identityCode: PostgameReasonCode | null =
    identityReason === 'identity_conflict'
      ? 'IDENTITY_CONFLICT'
      : identityReason === 'ok'
        ? null
        : 'IDENTITY_NOT_SERVING';

  if (identityCode) {
    return {
      status: 'EXPECTED_ABSENCE',
      reasonCode: identityCode,
      writes: [],
      inputCount: extracted.starterCandidates.length,
      outputCount: 0,
      identitySkipped: gated.skipped.length || extracted.starterCandidates.length,
      httpStatus: input.httpStatus,
    };
  }

  const terminal = input.attempt >= input.maxAttempts;
  return {
    status: terminal ? 'EXPECTED_ABSENCE' : 'WAITING',
    reasonCode: cert.reason === 'duplicate_starter' || cert.reason === 'incomplete' || cert.reason === 'anomaly'
      ? 'QUALITY_FAILED'
      : 'QUALITY_FAILED',
    writes: [],
    inputCount: extracted.starterCandidates.length,
    outputCount: 0,
    identitySkipped: gated.skipped.length,
    httpStatus: input.httpStatus,
  };
}
