/**
 * Future live market resolution boundary.
 * Phase 3: no BDL calls; do not fabricate MarketMatchStatus from historical data.
 */

import type { CanonicalBetSlip } from '@/lib/bet-slip/types';
import type {
  SportsbookHandoffProvider,
  SportsbookSlipResolution,
} from './types';

export interface LiveSportsbookResolver {
  resolveSlip(
    slip: CanonicalBetSlip,
    sportsbook: SportsbookHandoffProvider
  ): Promise<SportsbookSlipResolution>;
}

/**
 * Explicit unavailable resolver. Homepage handoff must not depend on this succeeding.
 */
export class UnavailableLiveSportsbookResolver implements LiveSportsbookResolver {
  async resolveSlip(
    _slip: CanonicalBetSlip,
    sportsbook: SportsbookHandoffProvider
  ): Promise<SportsbookSlipResolution> {
    return {
      status: 'unavailable',
      sportsbook,
      liveResolutionAvailable: false,
      message:
        'Live sportsbook market resolution is not available. Confirm current lines on the sportsbook.',
    };
  }
}

export const unavailableLiveSportsbookResolver = new UnavailableLiveSportsbookResolver();

export function isLiveSportsbookResolutionAvailable(): boolean {
  return false;
}
