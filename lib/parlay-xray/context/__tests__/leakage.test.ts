import { describe, expect, it } from 'vitest';
import { assembleXrayLegContext } from '../assemble';
import { CUTOFF, FUTURE_LOG, TARGET_GAME, TARGET_LOG, matchedPoints, priorLogs, resolution, teamStat } from './fixtures';

function formSlice(packet: ReturnType<typeof assembleXrayLegContext>) {
  return {
    playerForm: packet.playerForm,
    role: packet.role,
    matchup: packet.matchup,
    projection: packet.projection,
    wowy: packet.wowy,
    availability: packet.availability,
  };
}

describe('X3C target-game and future-game exclusion', () => {
  const baseLogs = priorLogs(12);
  const baseTeams = [
    teamStat({ teamId: 'okc', gameId: 't-okc-1', startTime: '2026-03-20T01:00:00.000Z' }),
    teamStat({ teamId: 'den', gameId: 't-den-1', startTime: '2026-03-21T01:00:00.000Z', pointsAllowed: 108 }),
  ];

  it('does not change the packet when the target-game final row is added or mutated', () => {
    const request = {
      resolution: resolution(),
      match: matchedPoints(),
      contextCutoffAt: CUTOFF,
      season: '2026',
      sources: {
        priorPlayerLogs: baseLogs,
        priorTeamStats: baseTeams,
        projectionSnapshots: [],
      },
    };
    const before = formSlice(assembleXrayLegContext(request));
    const mutatedTarget = { ...TARGET_LOG, points: 0, rebounds: 0, assists: 0, minutes: 0 };
    const afterInsert = formSlice(
      assembleXrayLegContext({
        ...request,
        sources: { ...request.sources, priorPlayerLogs: [...baseLogs, TARGET_LOG] },
      })
    );
    const afterMutate = formSlice(
      assembleXrayLegContext({
        ...request,
        sources: { ...request.sources, priorPlayerLogs: [...baseLogs, mutatedTarget] },
      })
    );
    expect(afterInsert).toEqual(before);
    expect(afterMutate).toEqual(before);
    expect(before.playerForm.seasonToDate.average).not.toBe(99);
  });

  it('does not change the packet when future games are added or mutated', () => {
    const request = {
      resolution: resolution(),
      match: matchedPoints(),
      contextCutoffAt: CUTOFF,
      season: '2026',
      sources: {
        priorPlayerLogs: baseLogs,
        priorTeamStats: baseTeams,
        projectionSnapshots: [],
      },
    };
    const before = formSlice(assembleXrayLegContext(request));
    const after = formSlice(
      assembleXrayLegContext({
        ...request,
        sources: { ...request.sources, priorPlayerLogs: [...baseLogs, FUTURE_LOG] },
      })
    );
    const mutatedFuture = { ...FUTURE_LOG, points: 1 };
    const afterMutate = formSlice(
      assembleXrayLegContext({
        ...request,
        sources: { ...request.sources, priorPlayerLogs: [...baseLogs, mutatedFuture] },
      })
    );
    expect(after).toEqual(before);
    expect(afterMutate).toEqual(before);
  });

  it('excludes target and future team games from matchup windows', () => {
    const request = {
      resolution: resolution(),
      match: matchedPoints(),
      contextCutoffAt: CUTOFF,
      season: '2026',
      sources: {
        priorPlayerLogs: baseLogs,
        priorTeamStats: [
          ...baseTeams,
          teamStat({ teamId: 'okc', gameId: TARGET_GAME, startTime: CUTOFF, pace: 140, teamPoints: 200 }),
          teamStat({ teamId: 'den', gameId: 'future-team', startTime: '2026-04-10T01:00:00.000Z', pointsAllowed: 70 }),
        ],
        projectionSnapshots: [],
      },
    };
    const packet = assembleXrayLegContext(request);
    expect(packet.matchup.teamPace.average).toBe(100);
    expect(packet.matchup.opponentPointsAllowed.average).toBe(108);
  });
});
