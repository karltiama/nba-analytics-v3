/**
 * Projection ledger protocol. Timing numbers are the existing shadow T−60
 * constants, not a second schedule.
 */

import {
  SHADOW_DUE_LOOKAHEAD_MINUTES,
  SHADOW_MINUTES_BEFORE_TIP,
  SHADOW_SCHEDULER_INTERVAL_MINUTES,
} from '@/lib/betting/player-projection-shadow-protocol';

export const LEDGER_MINUTES_BEFORE_TIP = SHADOW_MINUTES_BEFORE_TIP;
export const LEDGER_DUE_LOOKAHEAD_MINUTES = SHADOW_DUE_LOOKAHEAD_MINUTES;
export const LEDGER_SCHEDULER_INTERVAL_MINUTES = SHADOW_SCHEDULER_INTERVAL_MINUTES;

export const LEDGER_MARKETS = [
  'points',
  'rebounds',
  'assists',
  'threes',
  'points_assists',
  'points_rebounds',
  'rebounds_assists',
  'points_rebounds_assists',
] as const;

export type LedgerMarket = (typeof LEDGER_MARKETS)[number];

export const LEDGER_SNAPSHOT_POLICIES = [
  'T_MINUS_60',
  'T_MINUS_24H',
  'T_MINUS_6H',
  'T_MINUS_15',
  'ON_CHANGE',
] as const;

export type LedgerSnapshotPolicy = (typeof LEDGER_SNAPSHOT_POLICIES)[number];

export const LEDGER_PROVENANCE = ['PROSPECTIVE_LIVE', 'RECONSTRUCTED_BACKFILL', 'TEST'] as const;
export type LedgerProvenance = (typeof LEDGER_PROVENANCE)[number];

export const LEDGER_TIMING = ['ON_TIME', 'LATE_BEFORE_TIP', 'NOT_APPLICABLE'] as const;
export type LedgerTimingStatus = (typeof LEDGER_TIMING)[number];

export const LEDGER_MODEL_ID = 'production_70_30';
export const LEDGER_MODEL_VERSION = 'trackB.1';
export const LEDGER_V1_POLICY: LedgerSnapshotPolicy = 'T_MINUS_60';
export const LEDGER_V1_REVISION = 1;

export const PROJECTION_LEDGER_GIT_SHA_ENV = 'PROJECTION_LEDGER_GIT_SHA';
export const PROJECTION_LEDGER_WRITES_ENV = 'PROJECTION_LEDGER_WRITES';

export function isLedgerMarket(value: string): value is LedgerMarket {
  return (LEDGER_MARKETS as readonly string[]).includes(value);
}
