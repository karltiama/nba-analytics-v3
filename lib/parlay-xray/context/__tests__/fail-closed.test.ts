import { describe, expect, it } from 'vitest';
import { assembleXrayLegContext } from '../assemble';
import { assembleAvailabilityContext } from '../availability';
import { assembleWowyContext } from '../wowy';
import { archivedProjection, CUTOFF, matchedPoints, priorLogs, resolution, TARGET_GAME } from './fixtures';

describe('X3C WOWY / projection / availability fail-closed', () => {
  it('returns WOWY UNAVAILABLE instead of using retrospective summaries', () => {
    expect(assembleWowyContext()).toEqual({
      status: 'UNAVAILABLE',
      reason: 'NO_AS_OF_SAFE_WOWY_SOURCE',
    });
    const packet = assembleXrayLegContext({
      resolution: resolution(),
      match: matchedPoints(),
      contextCutoffAt: CUTOFF,
      season: '2026',
      sources: { priorPlayerLogs: priorLogs(10), priorTeamStats: [], projectionSnapshots: [] },
    });
    expect(packet.wowy.status).toBe('UNAVAILABLE');
    expect(packet.wowy.reason).toBe('NO_AS_OF_SAFE_WOWY_SOURCE');
  });

  it('returns availability UNAVAILABLE instead of reconstructing from minutes or injuries', () => {
    expect(assembleAvailabilityContext()).toEqual({
      status: 'UNAVAILABLE',
      reason: 'NO_HISTORICAL_INJURY_SNAPSHOT',
    });
    const packet = assembleXrayLegContext({
      resolution: resolution(),
      match: matchedPoints(),
      contextCutoffAt: CUTOFF,
      season: '2026',
      sources: { priorPlayerLogs: priorLogs(10), priorTeamStats: [], projectionSnapshots: [] },
    });
    expect(packet.availability.status).toBe('UNAVAILABLE');
    expect(packet.role.startersPregame).toEqual({
      status: 'UNAVAILABLE',
      reason: 'STARTERS_POSTGAME_CONFIRMED',
    });
  });

  it('ignores archived projections generated at or after cutoff', () => {
    const packet = assembleXrayLegContext({
      resolution: resolution(),
      match: matchedPoints(),
      contextCutoffAt: CUTOFF,
      season: '2026',
      sources: {
        priorPlayerLogs: priorLogs(5),
        priorTeamStats: [],
        projectionSnapshots: [
          archivedProjection({ generatedAt: CUTOFF, intendedCutoffAt: '2026-04-03T00:00:00.000Z' }),
          archivedProjection({ generatedAt: '2026-04-03T02:00:00.000Z', intendedCutoffAt: CUTOFF }),
        ],
      },
    });
    expect(packet.projection.status).toBe('UNAVAILABLE');
    expect(packet.projection.reason).toBe('NO_ARCHIVED_PREGAME_PROJECTION');
  });

  it('includes a projection only when generated before cutoff for the target game', () => {
    const packet = assembleXrayLegContext({
      resolution: resolution(),
      match: matchedPoints(),
      contextCutoffAt: CUTOFF,
      season: '2026',
      sources: {
        priorPlayerLogs: priorLogs(5),
        priorTeamStats: [],
        projectionSnapshots: [
          archivedProjection({
            generatedAt: '2026-04-03T00:20:00.000Z',
            intendedCutoffAt: '2026-04-03T00:30:00.000Z',
            predictions: { pts: 12.4 },
          }),
        ],
      },
    });
    expect(packet.projection.status).toBe('AVAILABLE');
    expect(packet.projection.modelVersion).toBe('player-projection-learned-r1-pts-reb-c');
    expect(packet.projection.projectedStat).toBe(12.4);
    expect(packet.projection.requestedLine).toBe(11.5);
    expect(packet.projection.difference).toBe(0.9);
    expect(JSON.stringify(packet.projection)).not.toMatch(/edge|confidence|pick|expected value/i);
  });

  it('does not use a projection for a different game', () => {
    const packet = assembleXrayLegContext({
      resolution: resolution(),
      match: matchedPoints(),
      contextCutoffAt: CUTOFF,
      season: '2026',
      sources: {
        priorPlayerLogs: priorLogs(5),
        priorTeamStats: [],
        projectionSnapshots: [archivedProjection({ gameId: 'other-game' })],
      },
    });
    expect(packet.projection.status).toBe('UNAVAILABLE');
    expect(packet.identity.gameId).toBe(TARGET_GAME);
  });
});
