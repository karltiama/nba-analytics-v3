import type { XRayAvailabilityContext, XrayCurrentAvailabilitySource } from './types';

/**
 * Historical replay: raw.player_injuries is a BDL tape keyed by provider player id.
 * analytics.game_starters is post-tip confirmed. Minutes = "00" is not injury.
 * X3C does not reconstruct availability from the target box.
 *
 * Current mode: the served injury report as of now (same freshness and freeze rules
 * as the scoreboard card). A frozen or stale feed is unavailable, never "nobody is out".
 */
export function assembleAvailabilityContext(
  current?: XrayCurrentAvailabilitySource | null
): XRayAvailabilityContext {
  if (!current) {
    return {
      status: 'UNAVAILABLE',
      reason: 'NO_HISTORICAL_INJURY_SNAPSHOT',
    };
  }
  if (current.status !== 'ok') {
    return {
      status: 'UNAVAILABLE',
      reason: 'CURRENT_INJURY_REPORT_UNAVAILABLE',
    };
  }
  return {
    status: 'AVAILABLE',
    reason: null,
    asOfLabel: current.asOfLabel,
    playerStatus: current.playerStatus,
    teammatesOut: current.teammatesOut,
  };
}
