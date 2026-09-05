/**
 * Previous-season baseline query: one getTeamSeasonSnapshot(teamId, season−1).
 * Shared SQL/mapper with current Team Snapshot — no duplicate metric logic.
 */

import { getTeamSeasonSnapshot } from '@/lib/teams/team-season-snapshot-queries';
import {
  buildPreviousSeasonBaseline,
  emptyPreviousSeasonBaseline,
  resolveBaselineSeason,
  type PreviousSeasonBaseline,
} from '@/lib/teams/team-previous-season-baseline';
import { assertSnapshotSeason } from '@/lib/teams/team-season-snapshot';

export type { PreviousSeasonBaseline } from '@/lib/teams/team-previous-season-baseline';

export async function getPreviousSeasonBaseline(
  teamId: string,
  viewedSeason: string
): Promise<PreviousSeasonBaseline> {
  const season = assertSnapshotSeason(viewedSeason);
  const baselineSeason = resolveBaselineSeason(season);

  const priorSnapshot = await getTeamSeasonSnapshot(teamId, baselineSeason);
  return buildPreviousSeasonBaseline({
    viewedSeason: season,
    priorSnapshot,
  });
}

export { emptyPreviousSeasonBaseline, resolveBaselineSeason };
