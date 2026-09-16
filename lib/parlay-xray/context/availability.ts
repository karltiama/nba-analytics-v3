import type { XRayAvailabilityContext } from './types';

/**
 * raw.player_injuries is a BDL tape keyed by provider player id.
 * analytics.game_starters is post-tip confirmed. Minutes = "00" is not injury.
 * X3C does not reconstruct availability from the target box.
 */
export function assembleAvailabilityContext(): XRayAvailabilityContext {
  return {
    status: 'UNAVAILABLE',
    reason: 'NO_HISTORICAL_INJURY_SNAPSHOT',
  };
}
