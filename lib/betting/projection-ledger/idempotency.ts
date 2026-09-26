/**
 * First official slot wins. A retry never rewrites the stored mean.
 */

import { isLedgerMarket } from '@/lib/betting/projection-ledger/protocol';
import { isProductionGitSha } from '@/lib/betting/projection-ledger/revision';
import type { LedgerTimingDecision } from '@/lib/betting/projection-ledger/timing';

export interface LedgerIdentity {
  gameId: string;
  playerId: string;
  market: string;
  snapshotPolicy: string;
  provenanceType: string;
  snapshotRevision: number;
}

export interface StoredBelief {
  identity: LedgerIdentity;
  projectionValue: number;
  codeRevision: string;
}

export type AttemptOutcome =
  | 'inserted'
  | 'duplicate_same'
  | 'duplicate_conflict'
  | 'skipped_no_inputs'
  | 'skipped_after_tip'
  | 'skipped_not_due'
  | 'skipped_missing_code_revision'
  | 'skipped_ineligible_game'
  | 'skipped_unsupported_market'
  | 'market_child_rejected'
  | 'error';

export function sameOfficialSlot(a: LedgerIdentity, b: LedgerIdentity): boolean {
  return (
    a.gameId === b.gameId &&
    a.playerId === b.playerId &&
    a.market === b.market &&
    a.snapshotPolicy === b.snapshotPolicy &&
    a.provenanceType === b.provenanceType &&
    a.snapshotRevision === b.snapshotRevision
  );
}

export function classifyDuplicate(existing: StoredBelief, nextProjection: number, nextCodeRevision: string): AttemptOutcome {
  if (existing.projectionValue === nextProjection) return 'duplicate_same';
  if (existing.codeRevision !== nextCodeRevision) return 'duplicate_conflict';
  return 'duplicate_conflict';
}

/** Writer gate. 'write' is the only path that inserts a prediction. */
export function decideLedgerWrite(args: {
  codeRevision: string;
  gameEligible: boolean;
  timing: LedgerTimingDecision;
  inputsPresent: boolean;
  market: string;
}): AttemptOutcome | 'write' {
  if (!isProductionGitSha(args.codeRevision)) return 'skipped_missing_code_revision';
  if (!args.gameEligible) return 'skipped_ineligible_game';
  if (!args.timing.accept) {
    return args.timing.reason === 'after_tip' ? 'skipped_after_tip' : 'skipped_not_due';
  }
  if (!isLedgerMarket(args.market)) return 'skipped_unsupported_market';
  if (!args.inputsPresent) return 'skipped_no_inputs';
  return 'write';
}
