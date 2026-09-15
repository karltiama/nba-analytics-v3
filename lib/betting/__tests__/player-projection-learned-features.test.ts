import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { isPlayedGame } from '@/lib/betting/minutes-projection-eval';
import { selectPriorGames } from '@/lib/betting/player-projection-eval';
import {
  FEATURE_C_ALLOWLIST,
  FEATURE_D_ALLOWLIST,
  LABEL_FIELDS,
  POSSESSION_FTA_WEIGHT,
  RATE_MINUTES_FLOOR,
  assertNoLabelLeak,
  basketballDateEt,
  bootstrapMaeDifferenceGrouped,
  buildLearnedRow,
  countDateCutoffLeakage,
  isUsableLearnedPrior,
  reconstructTeamMeasures,
  selectLearnedPriors,
  type LearnedEvalLog,
  type TeamGameContextRow,
} from '@/lib/betting/player-projection-learned-features';
import { playedOnlyTrackA } from '@/lib/betting/player-projection-v1-research';

function log(
  partial: Partial<LearnedEvalLog> & Pick<LearnedEvalLog, 'game_id' | 'start_time'>
): LearnedEvalLog {
  return {
    player_id: 'p1',
    team_id: '1',
    home_team_id: '1',
    away_team_id: '2',
    season: '2023',
    minutes: 30,
    points: 20,
    rebounds: 5,
    assists: 4,
    three_pointers_made: 2,
    field_goals_attempted: 16,
    three_pointers_attempted: 6,
    free_throws_attempted: 4,
    started: 'unknown',
    ...partial,
  };
}

function tgs(partial: Partial<TeamGameContextRow> & Pick<TeamGameContextRow, 'game_id' | 'team_id' | 'start_time'>): TeamGameContextRow {
  return {
    opponent_team_id: partial.team_id === '1' ? '2' : '1',
    season: '2023',
    team_points: 110,
    team_fga: 90,
    team_3pa: 35,
    team_fta: 20,
    team_turnovers: 14,
    offensive_rebounds: 10,
    points_allowed: 105,
    opponent_fga: 88,
    opponent_fta: 22,
    opponent_turnovers: 13,
    opponent_offensive_rebounds: 9,
    ...partial,
  };
}

describe('learned cutoff policy', () => {
  it('uses America/New_York basketball dates', () => {
    expect(basketballDateEt('2024-01-16T03:30:00.000Z')).toBe('2024-01-15');
    expect(basketballDateEt('2024-01-16T05:00:00.000Z')).toBe('2024-01-16');
  });

  it('excludes same ET date even when start_time is strictly before tipoff', () => {
    const earlier = '2026-01-15T00:00:00.000Z'; // 19:00 ET Jan 14? 00:00Z Jan 15 = 19:00 ET Jan 14
    const later = '2026-01-15T03:00:00.000Z'; // 22:00 ET Jan 14
    expect(isUsableLearnedPrior(earlier, later)).toBe(false);
    expect(selectPriorGames([log({ game_id: 'early', start_time: earlier })], later, '2023', 'active_season')).toHaveLength(
      1
    );
  });

  it('keeps previous ET dates and drops the target game', () => {
    const target = log({ game_id: 't', start_time: '2026-01-16T00:00:00.000Z' });
    const prior = log({ game_id: 'p', start_time: '2026-01-14T00:00:00.000Z' });
    const same = log({ game_id: 's', start_time: '2026-01-15T23:00:00.000Z', season: '2023' });
    const selected = selectLearnedPriors([target, prior, same], target.start_time, '2023');
    expect(selected.map((g) => g.game_id)).toEqual(['p']);
    expect(countDateCutoffLeakage(selected, target.start_time)).toBe(0);
  });
});

describe('played semantics and missing history', () => {
  it('does not treat DNP 00 as a C/D prior appearance', () => {
    const dnp = log({ game_id: 'dnp', start_time: '2026-01-10T00:00:00.000Z', minutes: '00', points: 0 });
    const played = log({ game_id: 'ok', start_time: '2026-01-08T00:00:00.000Z' });
    expect(isPlayedGame(dnp)).toBe(false);
    const target = log({ game_id: 't', start_time: '2026-01-16T00:00:00.000Z' });
    const row = buildLearnedRow({
      allPlayerGames: [target, dnp, played],
      target,
      tgsByGameTeam: new Map(),
      teamGamesByTeam: new Map(),
    });
    expect(row?.meta.cd_prior_played_count).toBe(1);
    expect(row?.featuresC.prior_played_count).toBe(1);
  });

  it('returns null features for empty windows rather than zeros', () => {
    const only = log({ game_id: 'first', start_time: '2026-01-16T00:00:00.000Z' });
    expect(
      buildLearnedRow({
        allPlayerGames: [only],
        target: only,
        tgsByGameTeam: new Map(),
        teamGamesByTeam: new Map(),
      })
    ).toBeNull();
  });
});

describe('A/B vs C/D eligibility', () => {
  it('keeps A/B priors that C/D drop on the same basketball date', () => {
    const target = log({
      game_id: 't',
      start_time: '2026-01-15T03:00:00.000Z',
      points: 18,
    });
    const sameDay = log({
      game_id: 'same',
      start_time: '2026-01-15T00:00:00.000Z',
      minutes: 28,
      points: 12,
    });
    const row = buildLearnedRow({
      allPlayerGames: [target, sameDay],
      target,
      tgsByGameTeam: new Map(),
      teamGamesByTeam: new Map(),
    });
    expect(row).not.toBeNull();
    expect(row!.meta.ab_prior_played_count).toBe(1);
    expect(row!.meta.cd_prior_played_count).toBe(0);
    expect(row!.commonEligible).toBe(false);
    expect(playedOnlyTrackA([sameDay], 'points')).toBeCloseTo(12, 10);
    expect(row!.predA.points).toBeCloseTo(12, 10);
  });
});

describe('team reconstruction', () => {
  it('uses the nightly possession formula and does not read stored pace', () => {
    const row = tgs({
      game_id: 'g',
      team_id: '1',
      start_time: '2026-01-10T00:00:00.000Z',
      team_fga: 80,
      team_fta: 20,
      offensive_rebounds: 10,
      team_turnovers: 12,
      opponent_fga: 80,
      opponent_fta: 20,
      opponent_offensive_rebounds: 10,
      opponent_turnovers: 12,
      team_points: 100,
      points_allowed: 90,
    });
    const teamPoss = 80 + POSSESSION_FTA_WEIGHT * 20 - 10 + 12;
    const measures = reconstructTeamMeasures(row);
    expect(measures.estPossessions).toBeCloseTo(teamPoss, 8);
    expect(measures.offRating).toBeCloseTo((100 * 100) / teamPoss, 6);
    expect(measures.defRating).toBeCloseTo((100 * 90) / teamPoss, 6);
  });

  it('does not use target-date team games in D context', () => {
    const target = log({ game_id: 't', start_time: '2026-01-16T00:00:00.000Z', points: 10 });
    const priorPlayer = log({ game_id: 'p', start_time: '2026-01-14T00:00:00.000Z', points: 10 });
    const sameNightTeam = tgs({
      game_id: 'other',
      team_id: '1',
      start_time: '2026-01-15T20:00:00.000Z',
      team_points: 200,
    });
    const prevTeam = tgs({
      game_id: 'prev',
      team_id: '1',
      start_time: '2026-01-13T00:00:00.000Z',
      team_points: 80,
    });
    const row = buildLearnedRow({
      allPlayerGames: [target, priorPlayer],
      target,
      tgsByGameTeam: new Map([['p|1', prevTeam]]),
      teamGamesByTeam: new Map([
        ['1', [sameNightTeam, prevTeam]],
        ['2', []],
      ]),
    });
    expect(row?.featuresD.team_pts_l10).toBe(80);
    expect(row?.featuresD.team_pts_season).toBe(80);
  });
});

describe('safeguards', () => {
  it('withholds per-minute rates when minutes sum is below the floor', () => {
    expect(RATE_MINUTES_FLOOR).toBe(5);
    const target = log({ game_id: 't', start_time: '2026-01-16T00:00:00.000Z' });
    const tiny = log({
      game_id: 'tiny',
      start_time: '2026-01-14T00:00:00.000Z',
      minutes: 2,
      points: 6,
    });
    const row = buildLearnedRow({
      allPlayerGames: [target, tiny],
      target,
      tgsByGameTeam: new Map(),
      teamGamesByTeam: new Map(),
    });
    expect(row?.featuresC.pts_per_min_l10).toBeNull();
    expect(row?.featuresC.pts_l5).toBe(6);
  });

  it('keeps labels off the model allowlists', () => {
    expect(() => assertNoLabelLeak(FEATURE_C_ALLOWLIST)).not.toThrow();
    expect(() => assertNoLabelLeak(FEATURE_D_ALLOWLIST)).not.toThrow();
    for (const label of LABEL_FIELDS) {
      expect(FEATURE_C_ALLOWLIST).not.toContain(label);
      expect(FEATURE_D_ALLOWLIST).not.toContain(label);
    }
    expect(FEATURE_C_ALLOWLIST.join(' ')).not.toMatch(/starter|start_rate/i);
  });
});

describe('grouped bootstrap', () => {
  it('resamples whole dates together', () => {
    const errA = [1, 1, 10];
    const errB = [2, 2, 0];
    const groups = ['d1', 'd1', 'd2'];
    const once = bootstrapMaeDifferenceGrouped(errA, errB, groups, 50, 1);
    const twice = bootstrapMaeDifferenceGrouped(errA, errB, groups, 50, 1);
    expect(once).toEqual(twice);
    expect(once.nGroups).toBe(2);
    expect(once.delta).not.toBeNull();
  });
});
