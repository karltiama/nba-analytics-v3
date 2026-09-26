/**
 * T−60 classification. Uses the shadow due-window function so the ledger
 * cannot grow a competing 60/5 definition.
 */

import {
  classifyShadowDueWindow,
  intendedCutoff,
} from '@/lib/betting/player-projection-shadow-scoring';
import type { LedgerTimingStatus } from '@/lib/betting/projection-ledger/protocol';

export type LedgerTimingDecision =
  | { accept: false; reason: 'after_tip' | 'too_early' | 'unparseable' }
  | { accept: true; timingStatus: Extract<LedgerTimingStatus, 'ON_TIME' | 'LATE_BEFORE_TIP'>; intendedCutoffAt: string };

export function classifyLedgerCapture(args: { gameTipTime: string; generatedAt: string }): LedgerTimingDecision {
  const generatedMs = Date.parse(args.generatedAt);
  const tipMs = Date.parse(args.gameTipTime);
  if (Number.isFinite(generatedMs) && Number.isFinite(tipMs) && generatedMs >= tipMs) {
    return { accept: false, reason: 'after_tip' };
  }
  const due = classifyShadowDueWindow({
    scheduledTipoff: args.gameTipTime,
    now: args.generatedAt,
  });
  if (due === 'after_tip') return { accept: false, reason: 'after_tip' };
  if (due === 'too_early') return { accept: false, reason: 'too_early' };
  const cutoff = intendedCutoff(args.gameTipTime);
  if (!Number.isFinite(Date.parse(cutoff))) return { accept: false, reason: 'unparseable' };
  if (due === 'due') {
    return { accept: true, timingStatus: 'ON_TIME', intendedCutoffAt: cutoff };
  }
  return { accept: true, timingStatus: 'LATE_BEFORE_TIP', intendedCutoffAt: cutoff };
}

export function captureEligibleAtWrite(args: {
  provenanceType: string;
  timingStatus: string;
  snapshotRevision: number;
  generatedAt: string;
  gameTipTime: string;
}): boolean {
  return (
    args.provenanceType === 'PROSPECTIVE_LIVE' &&
    args.timingStatus === 'ON_TIME' &&
    args.snapshotRevision === 1 &&
    Date.parse(args.generatedAt) < Date.parse(args.gameTipTime)
  );
}
