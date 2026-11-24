/**
 * Admin-only evidence check for one current-board pointer.
 * Removal: delete this module, app/api/admin/current-board-diagnostic/route.ts,
 * and their tests after the production OIDC read is recorded.
 * Do not keep the route as a product API, and do not use it to enable public reads.
 */
import { pointerKey } from '@/lib/props/s3-current-board/pointer';
import {
  parsePointer,
  readCurrentBoard,
  readVerifiedEnvelope,
  type CurrentBoardStore,
} from '@/lib/props/s3-current-board/read';

export type CurrentBoardDiagnostic = {
  gameId: string;
  pointer: 'present' | 'missing' | 'unavailable';
  evidence: 'verified' | 'unavailable';
  identityMatch: boolean;
  checksumMatch: boolean;
  observationClock: 'RESPONSE_RECEIVED' | null;
  pullRunId: number | null;
  observedAt: string | null;
  classification: 'fresh' | 'stale' | 'expired' | 'missing' | 'unavailable';
};

export async function diagnoseCurrentBoard(args: {
  store: CurrentBoardStore;
  gameId: string;
  now: string;
}): Promise<CurrentBoardDiagnostic> {
  const classified = await readCurrentBoard(args);
  const classification = classified.available ? 'fresh' : classified.reason;
  const base: CurrentBoardDiagnostic = {
    gameId: args.gameId,
    pointer: 'unavailable',
    evidence: 'unavailable',
    identityMatch: false,
    checksumMatch: false,
    observationClock: null,
    pullRunId: null,
    observedAt: null,
    classification,
  };
  let object: Awaited<ReturnType<CurrentBoardStore['get']>>;
  try {
    object = await args.store.get(pointerKey(args.gameId));
  } catch {
    return base;
  }
  if (!object) return { ...base, pointer: 'missing' };
  const pointer = parsePointer(object.body);
  if (!pointer || pointer.gameId !== args.gameId) return { ...base, pointer: 'present' };
  let verified: Awaited<ReturnType<typeof readVerifiedEnvelope>>;
  try {
    verified = await readVerifiedEnvelope(args.store, pointer);
  } catch {
    return { ...base, pointer: 'present' };
  }
  if (!verified || verified.envelope.observation_clock !== 'RESPONSE_RECEIVED') {
    return { ...base, pointer: 'present' };
  }
  const identityMatch = verified.envelope.game_id === args.gameId
    && verified.envelope.pull_run_id === pointer.pullRunId
    && verified.envelope.checksum === pointer.envelopeChecksum
    && verified.manifest.manifestChecksum === pointer.manifestChecksum;
  return {
    ...base,
    pointer: 'present',
    evidence: 'verified',
    identityMatch,
    checksumMatch: identityMatch,
    observationClock: 'RESPONSE_RECEIVED',
    pullRunId: pointer.pullRunId,
    observedAt: pointer.observedAt,
  };
}
