/**
 * Build + write V1.2 research packets (facts homework). No editorial.
 */

import { buildPreseasonTeamPacket } from './build-team-packet';
import { buildResearchPacketFromTeamPacket } from './build-research-packet';
import { loadElsewhereOpenRoster } from './roster-status-queries';
import {
  applyHumanRosterReviewFlags,
  classifyRosterStatuses,
  type ContinuityPlayerInput,
  type RosterStatusPlayer,
} from './roster-status';
import {
  writePreseasonPacket,
  writeResearchPacket,
} from './storage';
import type { PreseasonResearchPacket } from './research-packet-types';
import type { PreseasonTeamPacket } from './types';

export async function runResearchPacket(args: {
  team: string;
  season: string;
}): Promise<{
  teamPacket: PreseasonTeamPacket;
  research: PreseasonResearchPacket;
  rosterStatuses: RosterStatusPlayer[];
  researchPath: string;
  packetPath: string;
}> {
  const teamPacket = await buildPreseasonTeamPacket(args.team, args.season);
  const packetPath = await writePreseasonPacket(teamPacket);

  const previousInputs: ContinuityPlayerInput[] = teamPacket.previousRoster.map(
    (p) => ({
      playerEntityId: p.playerEntityId,
      displayName: p.displayName,
      playerId: p.playerId,
      position: p.position,
    })
  );
  const currentInputs: ContinuityPlayerInput[] = teamPacket.currentRoster.map(
    (p) => ({
      playerEntityId: p.playerEntityId,
      displayName: p.displayName,
      playerId: p.playerId,
      position: p.position,
    })
  );

  const prevIds = previousInputs.map((p) => p.playerEntityId);
  const currIds = currentInputs.map((p) => p.playerEntityId);

  const [elsewhereCurrent, elsewherePrevious] = await Promise.all([
    loadElsewhereOpenRoster({
      season: teamPacket.season,
      excludeTeamId: teamPacket.team.teamId,
      entityIds: prevIds,
    }),
    loadElsewhereOpenRoster({
      season: teamPacket.previousSeason,
      excludeTeamId: teamPacket.team.teamId,
      entityIds: currIds,
    }),
  ]);

  const classified = classifyRosterStatuses({
    season: teamPacket.season,
    previousSeason: teamPacket.previousSeason,
    teamId: teamPacket.team.teamId,
    teamAbbr: teamPacket.team.abbreviation,
    previous: previousInputs,
    current: currentInputs,
    elsewhereCurrentByEntity: elsewhereCurrent,
    elsewherePreviousByEntity: elsewherePrevious,
  });

  const statsByEntity = new Map(
    teamPacket.playerSeasonStats.map((s) => [
      s.playerEntityId,
      {
        playerEntityId: s.playerEntityId,
        mpg: s.mpg,
        ppg: s.ppg,
        usageAvg: s.usageAvg,
      },
    ])
  );

  const previousRosterStats = previousInputs.map(
    (p) =>
      statsByEntity.get(p.playerEntityId) ?? {
        playerEntityId: p.playerEntityId,
        mpg: null,
        ppg: null,
        usageAvg: null,
      }
  );
  const currentRosterStats = currentInputs.map(
    (p) =>
      statsByEntity.get(p.playerEntityId) ?? {
        playerEntityId: p.playerEntityId,
        mpg: null,
        ppg: null,
        usageAvg: null,
      }
  );

  const rosterStatuses = applyHumanRosterReviewFlags({
    rows: classified,
    previousRosterStats,
    currentRosterStats,
  });

  const research = buildResearchPacketFromTeamPacket({
    packet: teamPacket,
    rosterStatuses,
  });
  const researchPath = await writeResearchPacket(research);

  return {
    teamPacket,
    research,
    rosterStatuses,
    researchPath,
    packetPath,
  };
}
