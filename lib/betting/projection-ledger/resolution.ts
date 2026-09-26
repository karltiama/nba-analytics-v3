/**
 * Evaluation states. Uses the existing appearance classifier and status normalizer.
 * Does not change how production averages treat DNP logs.
 */

import { classifyAppearance, type EvalGameLog } from '@/lib/betting/minutes-projection-eval';
import { normalizeGameStatus } from '@/lib/betting/normalize-game-status';

export const LEDGER_RESOLUTION = ['PLAYED', 'DNP_VOID', 'POSTPONED', 'CANCELED', 'UNRESOLVED'] as const;
export type LedgerResolution = (typeof LEDGER_RESOLUTION)[number];

export function classifyLedgerResolution(args: {
  statusRaw: string | null | undefined;
  gameLogCount: number;
  playerLog: EvalGameLog | null;
}): LedgerResolution {
  const status = normalizeGameStatus(args.statusRaw);
  if (status === 'Postponed') return 'POSTPONED';
  if (status === 'Canceled') return 'CANCELED';
  if (status !== 'Final') return 'UNRESOLVED';
  if (args.gameLogCount <= 0) return 'UNRESOLVED';
  if (!args.playerLog) return 'DNP_VOID';
  const appearance = classifyAppearance(args.playerLog);
  if (appearance.class === 'played') return 'PLAYED';
  if (appearance.class === 'dnp') return 'DNP_VOID';
  return 'UNRESOLVED';
}

export function includedInPrimaryAccuracy(state: LedgerResolution): boolean {
  return state === 'PLAYED';
}
