import { planHistoricalReconstruction, type PglAppearance } from '@/lib/roster/historical-stint-reconstruct';

/**
 * Completed historical season: PGL-only closed stints. No nba_stats open roster
 * and no mutation of other seasons.
 */
export function planCompletedSeasonStintsFromLogs(args: {
  season: string;
  appearances: PglAppearance[];
}) {
  return planHistoricalReconstruction({
    season: args.season,
    appearances: args.appearances,
    finalOpenByPlayer: new Map(),
  });
}
