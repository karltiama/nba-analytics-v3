import { describe, expect, it } from 'vitest';
import { assemblePlayerForm } from '../player-form';
import { assembleXrayLegContext } from '../assemble';
import { CUTOFF, TARGET_GAME, PLAYER, matchedPoints, priorLogs, resolution } from './fixtures';

describe('X3C player-form matrix', () => {
  it('uses 10+ prior games as AVAILABLE season-to-date sample', () => {
    const form = assemblePlayerForm({
      logs: priorLogs(12),
      playerId: PLAYER,
      cutoffAt: CUTOFF,
      targetGameId: TARGET_GAME,
      season: '2026',
      market: 'points',
      requestedLine: 11.5,
    });
    expect(form.status).toBe('AVAILABLE');
    expect(form.seasonToDate.gameCount).toBe(12);
    expect(form.last5.gameCount).toBe(5);
    expect(form.last10.gameCount).toBe(10);
    expect(form.lineRelative.sampleCount).toBe(10);
    expect(form.lineRelative.aboveRequestedLine + form.lineRelative.belowRequestedLine + form.lineRelative.equalRequestedLine).toBe(10);
  });

  it('marks 5–9 prior games LIMITED', () => {
    const form = assemblePlayerForm({
      logs: priorLogs(7),
      playerId: PLAYER,
      cutoffAt: CUTOFF,
      targetGameId: TARGET_GAME,
      season: '2026',
      market: 'points',
      requestedLine: 11.5,
    });
    expect(form.status).toBe('LIMITED');
    expect(form.reason).toBe('SMALL_PRIOR_SAMPLE');
    expect(form.last10.gameCount).toBe(7);
  });

  it('marks 1–4 prior games LIMITED', () => {
    const form = assemblePlayerForm({
      logs: priorLogs(3),
      playerId: PLAYER,
      cutoffAt: CUTOFF,
      targetGameId: TARGET_GAME,
      season: '2026',
      market: 'points',
      requestedLine: 11.5,
    });
    expect(form.status).toBe('LIMITED');
    expect(form.last5.gameCount).toBe(3);
    expect(form.last10.gameCount).toBe(3);
  });

  it('returns UNAVAILABLE with zero prior games', () => {
    const form = assemblePlayerForm({
      logs: [],
      playerId: PLAYER,
      cutoffAt: CUTOFF,
      targetGameId: TARGET_GAME,
      season: '2026',
      market: 'points',
      requestedLine: 11.5,
    });
    expect(form.status).toBe('UNAVAILABLE');
    expect(form.reason).toBe('NO_PRIOR_GAMES');
    expect(form.seasonToDate).toEqual({ gameCount: 0, average: null });
  });

  it('computes combo PRA from component stats', () => {
    const form = assemblePlayerForm({
      logs: priorLogs(10),
      playerId: PLAYER,
      cutoffAt: CUTOFF,
      targetGameId: TARGET_GAME,
      season: '2026',
      market: 'points_rebounds_assists',
      requestedLine: 20.5,
    });
    expect(form.status).toBe('AVAILABLE');
    expect(form.seasonToDate.average).not.toBeNull();
    const packet = assembleXrayLegContext({
      resolution: resolution({ market: 'points_rebounds_assists', line: 20.5 }),
      match: matchedPoints(),
      contextCutoffAt: CUTOFF,
      season: '2026',
      sources: { priorPlayerLogs: priorLogs(10), priorTeamStats: [], projectionSnapshots: [] },
    });
    expect(packet.playerForm.market).toBe('points_rebounds_assists');
    expect(packet.playerForm.seasonToDate.gameCount).toBe(10);
  });
});
