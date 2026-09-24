/**
 * Server-only bet-slip exports (requires SUPABASE_DB_URL).
 * Client code must import from `@/lib/bet-slip` instead.
 */

export {
  SHARED_SLIP_LEG_CAP,
  createSharedBetSlip,
  generateShareId,
  getSharedBetSlipByShareId,
  parseCanonicalBetLeg,
  parseLegsSnapshot,
  sharedSlipPath,
} from './shared-slip-service';
export type {
  CreateSharedBetSlipFailureCode,
  CreateSharedBetSlipInput,
  CreateSharedBetSlipResult,
  GetSharedBetSlipResult,
} from './shared-slip-service';

export {
  BET_SLIP_SPORT_NBA,
  CANONICAL_BET_SLIP_SOURCES,
  SHARED_BET_SLIP_SNAPSHOT_VERSION,
} from './types';
export type {
  CanonicalBetLeg,
  CanonicalBetSlip,
  CanonicalBetSlipSource,
  PublicSharedBetSlip,
} from './types';
