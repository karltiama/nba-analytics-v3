import { describe, expect, it } from 'vitest';
import {
  intendedCutoffIso,
  selectKnownOutObservation,
  uniqueGameForTeamEtDate,
  WOWY_R1_OBS_FRESHNESS_MAX_HOURS,
  WOWY_R1_PREDICTION_CUTOFF_MINUTES_BEFORE_TIP,
} from '../known-out-association';

const tip = '2026-04-01T23:00:00.000Z';

describe('known-Out association', () => {
  it('uses tip minus 60 minutes as cutoff', () => {
    expect(WOWY_R1_PREDICTION_CUTOFF_MINUTES_BEFORE_TIP).toBe(60);
    expect(intendedCutoffIso(tip)).toBe('2026-04-01T22:00:00.000Z');
  });

  it('treats a unique team ET date as an unambiguous game join', () => {
    const games = [
      { gameId: 'g1', teamId: '8', startTime: '2026-04-01T23:00:00.000Z' },
      { gameId: 'g2', teamId: '8', startTime: '2026-04-02T23:00:00.000Z' },
    ];
    expect(uniqueGameForTeamEtDate(games, '8', tip)).toEqual({ gameId: 'g1' });
  });

  it('rejects two Final games for the same team on the same ET date', () => {
    const games = [
      { gameId: 'g1', teamId: '8', startTime: '2026-04-01T23:00:00.000Z' },
      { gameId: 'g2', teamId: '8', startTime: '2026-04-02T02:00:00.000Z' },
    ];
    expect(uniqueGameForTeamEtDate(games, '8', tip)).toEqual({ ambiguous: true, count: 2 });
  });

  it('does not use a later status change that is still before cutoff', () => {
    const cutoff = intendedCutoffIso(tip)!;
    const result = selectKnownOutObservation({
      teammatePlayerId: 'B',
      teamId: '8',
      cutoffStartTime: cutoff,
      observations: [
        { playerId: 'B', teamId: '8', status: 'Out', snapshotAt: '2026-04-01T12:00:00.000Z' },
        { playerId: 'B', teamId: '8', status: 'Questionable', snapshotAt: '2026-04-01T20:00:00.000Z' },
      ],
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('status_not_explicit_out');
    expect(result.usedStatus).toBe('Questionable');
  });

  it('ignores observations at or after cutoff', () => {
    const cutoff = intendedCutoffIso(tip)!;
    const result = selectKnownOutObservation({
      teammatePlayerId: 'B',
      teamId: '8',
      cutoffStartTime: cutoff,
      observations: [{ playerId: 'B', teamId: '8', status: 'Out', snapshotAt: cutoff }],
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('no_precutoff_observation');
  });

  it('does not match a listed Out on a different team_id', () => {
    const cutoff = intendedCutoffIso(tip)!;
    const result = selectKnownOutObservation({
      teammatePlayerId: 'B',
      teamId: '8',
      cutoffStartTime: cutoff,
      observations: [{ playerId: 'B', teamId: '14', status: 'Out', snapshotAt: '2026-04-01T12:00:00.000Z' }],
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('no_precutoff_observation');
  });

  it('rejects stale Out observations older than the freshness window', () => {
    const cutoff = intendedCutoffIso(tip)!;
    const staleHours = WOWY_R1_OBS_FRESHNESS_MAX_HOURS + 1;
    const snapshot = new Date(Date.parse(cutoff) - staleHours * 3600_000).toISOString();
    const result = selectKnownOutObservation({
      teammatePlayerId: 'B',
      teamId: '8',
      cutoffStartTime: cutoff,
      observations: [{ playerId: 'B', teamId: '8', status: 'Out', snapshotAt: snapshot }],
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('observation_stale');
  });

  it('accepts a fresh explicit Out before cutoff', () => {
    const cutoff = intendedCutoffIso(tip)!;
    const result = selectKnownOutObservation({
      teammatePlayerId: 'B',
      teamId: '8',
      cutoffStartTime: cutoff,
      observations: [{ playerId: 'B', teamId: '8', status: 'Out', snapshotAt: '2026-04-01T12:00:00.000Z' }],
    });
    expect(result.eligible).toBe(true);
    expect(result.usedStatus).toBe('Out');
  });

  it('does not treat RemovedFromReport as Out or Available', () => {
    const cutoff = intendedCutoffIso(tip)!;
    const result = selectKnownOutObservation({
      teammatePlayerId: 'B',
      teamId: '8',
      cutoffStartTime: cutoff,
      observations: [
        { playerId: 'B', teamId: '8', status: 'RemovedFromReport', snapshotAt: '2026-04-01T12:00:00.000Z' },
      ],
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('status_not_explicit_out');
  });

  it('treats a later unchanged Out pull as a fresh observation, not a stale change-row', () => {
    const cutoff = intendedCutoffIso(tip)!;
    const staleChange = new Date(Date.parse(cutoff) - 72 * 3600_000).toISOString();
    const laterPull = new Date(Date.parse(cutoff) - 6 * 3600_000).toISOString();
    const result = selectKnownOutObservation({
      teammatePlayerId: 'B',
      teamId: '8',
      cutoffStartTime: cutoff,
      observations: [
        { playerId: 'B', teamId: '8', status: 'Out', snapshotAt: staleChange },
        { playerId: 'B', teamId: '8', status: 'Out', snapshotAt: laterPull },
      ],
    });
    expect(result.eligible).toBe(true);
    expect(result.usedSnapshotAt).toBe(laterPull);
  });
});
