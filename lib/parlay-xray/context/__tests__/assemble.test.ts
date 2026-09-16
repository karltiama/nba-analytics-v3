import { describe, expect, it } from 'vitest';
import { assembleXrayLegContext } from '../assemble';
import { CUTOFF, matchedPoints, priorLogs, resolution, teamStat } from './fixtures';

describe('assembleXrayLegContext', () => {
  it('carries canonical identity and explicit data-quality flags', () => {
    const packet = assembleXrayLegContext({
      resolution: resolution(),
      match: matchedPoints(),
      contextCutoffAt: CUTOFF,
      season: '2026',
      sources: {
        priorPlayerLogs: priorLogs(12),
        priorTeamStats: [
          teamStat({ teamId: 'okc', gameId: 't1', startTime: '2026-03-10T01:00:00.000Z' }),
          teamStat({ teamId: 'den', gameId: 't2', startTime: '2026-03-11T01:00:00.000Z' }),
        ],
        projectionSnapshots: [],
      },
    });
    expect(packet.identity.playerDisplayName).toBe('Ajay Mitchell');
    expect(packet.identity.gameId).toBe('18447934');
    expect(packet.identity.contextCutoffAt).toBe(CUTOFF);
    expect(packet.identity.line).toBe(11.5);
    expect(packet.identity.side).toBe('over');
    expect(packet.dataQuality.canonicalPlayerResolved).toBe(true);
    expect(packet.dataQuality.canonicalGameResolved).toBe(true);
    expect(packet.dataQuality.exactLineMatch).toBe(true);
    expect(packet.dataQuality.sameBookMatch).toBe(true);
    expect(packet.dataQuality.threeHourSnapshotAvailable).toBe(true);
    expect(packet.dataQuality.closeSnapshotAvailable).toBe(true);
    expect(packet.dataQuality.playerPriorSampleCount).toBe(12);
    expect(packet.dataQuality.last5AvailableCount).toBe(5);
    expect(packet.dataQuality.last10AvailableCount).toBe(10);
    expect(packet.dataQuality.wowy).toBe('UNAVAILABLE');
    expect(packet.dataQuality.availability).toBe('UNAVAILABLE');
    expect(packet.dataQuality.projection).toBe('UNAVAILABLE');
  });
});
