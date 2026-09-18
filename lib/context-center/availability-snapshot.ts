/**
 * Build TEAM_GAME availability snapshot from classified rows + PGL history.
 */

import { estimatePlayerRole, type RoleHistoryGame } from './role-expectation';
import {
  computeTeamGameAvailability,
  type HealthOutContributor,
  type TeamGameAvailabilitySnapshot,
  type TeamInjuryBurdenInput,
} from './team-injury-burden';

export type ClassifiedPlayerRow = {
  sourceKey: string;
  statusRaw: string;
  healthRelation: 'HEALTH_RELATED' | 'NON_HEALTH_RELATED' | 'UNCLASSIFIED';
  playerEntityId: string | null;
  canonicalModelEligible: boolean;
};

export type TeamGameAvailabilityBuildInput = {
  gameId: string;
  teamId: string;
  season: string;
  gameStart: string;
  asOf: string;
  injuryReportPublishedAt: string | null;
  teamState: string;
  /** All selected player rows for this team-game (any status). */
  playerRows: readonly ClassifiedPlayerRow[];
  /** PGL history keyed by playerEntityId (any season/team; filter applied in role estimate). */
  pglByEntity: ReadonlyMap<string, readonly RoleHistoryGame[]>;
  displayStatus?: 'RESEARCH' | 'DISPLAYABLE';
};

export function buildTeamGameAvailabilitySnapshot(
  input: TeamGameAvailabilityBuildInput
): TeamGameAvailabilitySnapshot {
  const healthOutContributors: HealthOutContributor[] = [];
  let healthQuestionableCount = 0;
  let healthDoubtfulCount = 0;
  let healthProbableCount = 0;
  let nonHealthOutCount = 0;

  for (const row of input.playerRows) {
    if (row.statusRaw === 'Out' && row.healthRelation === 'NON_HEALTH_RELATED') {
      nonHealthOutCount += 1;
      continue;
    }
    if (row.healthRelation !== 'HEALTH_RELATED') continue;

    if (row.statusRaw === 'Questionable') {
      healthQuestionableCount += 1;
      continue;
    }
    if (row.statusRaw === 'Doubtful') {
      healthDoubtfulCount += 1;
      continue;
    }
    if (row.statusRaw === 'Probable') {
      healthProbableCount += 1;
      continue;
    }
    if (row.statusRaw !== 'Out') continue;

    const canonical = Boolean(row.canonicalModelEligible && row.playerEntityId);
    let roleEstimate = null;
    if (canonical && row.playerEntityId) {
      const hist = input.pglByEntity.get(row.playerEntityId) ?? [];
      const result = estimatePlayerRole({
        playerEntityId: row.playerEntityId,
        season: input.season,
        teamId: input.teamId,
        targetGameStart: input.gameStart,
        history: hist,
      });
      if (result.status === 'OK') roleEstimate = result.estimate;
    }

    healthOutContributors.push({
      sourceKey: row.sourceKey,
      playerEntityId: row.playerEntityId,
      canonical,
      roleEstimate,
    });
  }

  const burdenInput: TeamInjuryBurdenInput = {
    gameId: input.gameId,
    teamId: input.teamId,
    season: input.season,
    gameStart: input.gameStart,
    asOf: input.asOf,
    injuryReportPublishedAt: input.injuryReportPublishedAt,
    teamState: input.teamState,
    healthOutContributors,
    healthQuestionableCount,
    healthDoubtfulCount,
    healthProbableCount,
    nonHealthOutCount,
  };

  return computeTeamGameAvailability(burdenInput, {
    displayStatus: input.displayStatus ?? 'RESEARCH',
  });
}
