import { describe, expect, it } from 'vitest';
import {
  classifyServingGame,
  etDateOfInstant,
  etDateOfProviderGame,
  isNbaCupChampionshipStage,
  partitionServingGames,
  providerSeasonTypesForWindow,
  regularSeasonOpenValuesSql,
  servingDateDecision,
} from '@/lib/games/season-eligibility';

const game = (over: Record<string, unknown> = {}) => ({
  id: 21717855,
  season: 2026,
  date: '2026-10-20',
  datetime: '2026-10-20T23:30:00.000Z',
  postseason: false,
  ...over,
});

describe('servingDateDecision (2026 opening night 2026-10-20 ET)', () => {
  it('Oct 19 is ineligible', () => {
    expect(servingDateDecision('2026', '2026-10-19')).toEqual({
      eligible: false,
      reason: 'before_regular_season_open',
    });
  });

  it('Oct 20 is eligible', () => {
    expect(servingDateDecision(2026, '2026-10-20')).toEqual({ eligible: true });
  });

  it('a late Oct 20 ET tip that is Oct 21 in UTC stays on Oct 20', () => {
    const tipUtc = '2026-10-21T02:30:00.000Z';
    expect(etDateOfInstant(tipUtc)).toBe('2026-10-20');
    expect(servingDateDecision('2026', etDateOfInstant(tipUtc))).toEqual({ eligible: true });
  });

  it('an evening Oct 19 ET tip that is Oct 20 in UTC is still preseason', () => {
    expect(etDateOfInstant('2026-10-20T00:00:00.000Z')).toBe('2026-10-19');
    expect(servingDateDecision('2026', etDateOfInstant('2026-10-20T00:00:00.000Z')).eligible).toBe(false);
  });

  it('unknown season fails closed', () => {
    expect(servingDateDecision('2027', '2027-11-01')).toEqual({ eligible: false, reason: 'season_open_unknown' });
    expect(servingDateDecision(null, '2026-11-01')).toEqual({ eligible: false, reason: 'season_open_unknown' });
  });

  it('missing or invalid date fails closed', () => {
    expect(servingDateDecision('2026', null)).toEqual({ eligible: false, reason: 'invalid_game_date' });
    expect(servingDateDecision('2026', 'Final')).toEqual({ eligible: false, reason: 'invalid_game_date' });
  });

  it('historical seasons keep their own opening nights', () => {
    expect(servingDateDecision('2025', '2025-10-20').eligible).toBe(false);
    expect(servingDateDecision('2025', '2025-10-21').eligible).toBe(true);
    expect(servingDateDecision('2024', '2024-10-22').eligible).toBe(true);
  });
});

describe('NBA Cup championship exclusion', () => {
  it('known final dates are ineligible; the days around them stay eligible', () => {
    expect(servingDateDecision('2025', '2025-12-16')).toEqual({ eligible: false, reason: 'nba_cup_final' });
    expect(servingDateDecision('2024', '2024-12-17')).toEqual({ eligible: false, reason: 'nba_cup_final' });
    expect(servingDateDecision('2023', '2023-12-09')).toEqual({ eligible: false, reason: 'nba_cup_final' });
    expect(servingDateDecision('2025', '2025-12-15').eligible).toBe(true);
    expect(servingDateDecision('2025', '2025-12-17').eligible).toBe(true);
    expect(servingDateDecision('2024', '2025-12-16').eligible).toBe(true);
  });

  it('only championship-named stages match', () => {
    for (const s of ['final', 'Final', 'Finals', 'Championship', ' championship ', 'NBA Cup Final']) {
      expect(isNbaCupChampionshipStage(s)).toBe(true);
    }
    for (const s of ['group', 'East Group A', 'quarterfinal', 'Quarterfinals', 'semifinal', 'Semi-Final', '', null, 3]) {
      expect(isNbaCupChampionshipStage(s)).toBe(false);
    }
  });

  it('a championship stage under a regular request is excluded regardless of date', () => {
    const final = game({ date: '2026-12-15', datetime: '2026-12-16T01:30:00.000Z', ist_stage: 'final' });
    expect(classifyServingGame({ game: final, requestedSeasonType: 'regular', expectedSeason: 2026 })).toEqual({
      eligible: false,
      reason: 'nba_cup_final',
    });
  });

  it('Cup group, quarterfinal and semifinal games under a regular request stay eligible', () => {
    for (const ist_stage of ['group', 'quarterfinal', 'semifinal']) {
      const g = game({ date: '2026-12-09', datetime: '2026-12-10T00:30:00.000Z', ist_stage });
      expect(classifyServingGame({ game: g, requestedSeasonType: 'regular', expectedSeason: 2026 })).toEqual({
        eligible: true,
      });
    }
  });

  it('partitionServingGames drops the 2025 final by date even without ist_stage', () => {
    const { eligible, ineligible } = partitionServingGames(
      [
        { requestedSeasonType: 'regular', game: game({ id: 20377171, season: 2025, date: '2025-12-16', datetime: null }) },
        { requestedSeasonType: 'regular', game: game({ id: 2, season: 2025, date: '2025-12-18', datetime: null }) },
      ],
      2025
    );
    expect(eligible.map((g) => g.id)).toEqual([2]);
    expect(ineligible.map((r) => [r.game.id, r.reason])).toEqual([[20377171, 'nba_cup_final']]);
  });
});

describe('etDateOfProviderGame', () => {
  it('prefers the BDL date (ET day) over the UTC datetime', () => {
    expect(etDateOfProviderGame({ date: '2026-10-20', datetime: '2026-10-21T02:30:00.000Z' })).toBe('2026-10-20');
  });

  it('falls back to the ET day of datetime', () => {
    expect(etDateOfProviderGame({ date: null, datetime: '2026-10-21T02:30:00.000Z' })).toBe('2026-10-20');
  });
});

describe('classifyServingGame', () => {
  it('regular request on opening night is eligible', () => {
    expect(classifyServingGame({ game: game(), requestedSeasonType: 'regular', expectedSeason: 2026 })).toEqual({
      eligible: true,
    });
  });

  it('rows from an unparameterized query are never eligible, even with postseason=false', () => {
    expect(classifyServingGame({ game: game(), requestedSeasonType: null, expectedSeason: 2026 })).toEqual({
      eligible: false,
      reason: 'season_type_not_requested',
    });
  });

  it('preseason request is never eligible, even on or after opening night', () => {
    expect(classifyServingGame({ game: game(), requestedSeasonType: 'preseason', expectedSeason: 2026 })).toEqual({
      eligible: false,
      reason: 'season_type_not_serving',
    });
  });

  it('a regular-labelled row before opening night is fenced by date', () => {
    expect(
      classifyServingGame({ game: game({ date: '2026-10-09' }), requestedSeasonType: 'regular', expectedSeason: 2026 })
    ).toEqual({ eligible: false, reason: 'before_regular_season_open' });
  });

  it('game id magnitude is never used to classify', () => {
    const small = classifyServingGame({ game: game({ id: 1 }), requestedSeasonType: 'regular', expectedSeason: 2026 });
    const large = classifyServingGame({ game: game({ id: 99999999 }), requestedSeasonType: 'regular', expectedSeason: 2026 });
    expect(small).toEqual(large);
  });

  it('season mismatch is ineligible', () => {
    expect(
      classifyServingGame({ game: game({ season: 2025 }), requestedSeasonType: 'regular', expectedSeason: 2026 })
    ).toEqual({ eligible: false, reason: 'season_mismatch' });
  });

  it('historical postseason rows remain eligible', () => {
    const playoff = game({ season: 2025, date: '2026-04-20', postseason: true });
    expect(classifyServingGame({ game: playoff, requestedSeasonType: 'playoffs', expectedSeason: 2025 })).toEqual({
      eligible: true,
    });
    expect(classifyServingGame({ game: playoff, requestedSeasonType: 'playin', expectedSeason: 2025 })).toEqual({
      eligible: true,
    });
  });
});

describe('providerSeasonTypesForWindow', () => {
  it('2026 opening week queries regular only', () => {
    expect(providerSeasonTypesForWindow(2026, '2026-10-21')).toEqual(['regular']);
  });

  it('2025 window before the postseason floor is regular only', () => {
    expect(providerSeasonTypesForWindow('2025', '2026-04-13')).toEqual(['regular']);
  });

  it('2025 window reaching 2026-04-14 adds playin and playoffs', () => {
    expect(providerSeasonTypesForWindow('2025', '2026-04-14')).toEqual(['regular', 'playin', 'playoffs']);
  });

  it('never requests preseason', () => {
    expect(providerSeasonTypesForWindow('2025', '9999-12-31')).not.toContain('preseason');
  });
});

describe('partitionServingGames', () => {
  it('keeps eligible rows, reports fenced rows with reasons, and drops duplicate ids', () => {
    const { eligible, ineligible } = partitionServingGames(
      [
        { game: game({ id: 1 }), requestedSeasonType: 'regular' },
        { game: game({ id: 2, date: '2026-10-19' }), requestedSeasonType: 'regular' },
        { game: game({ id: 3 }), requestedSeasonType: 'preseason' },
        { game: game({ id: 1 }), requestedSeasonType: 'playoffs' },
      ],
      2026
    );
    expect(eligible.map((g) => g.id)).toEqual([1]);
    expect(ineligible.map((r) => [r.game.id, r.reason])).toEqual([
      [2, 'before_regular_season_open'],
      [3, 'season_type_not_serving'],
    ]);
  });
});

describe('regularSeasonOpenValuesSql', () => {
  it('emits one typed row per known season', () => {
    const sql = regularSeasonOpenValuesSql();
    expect(sql).toContain("('2026', date '2026-10-20')");
    expect(sql).toContain("('2025', date '2025-10-21')");
  });
});
