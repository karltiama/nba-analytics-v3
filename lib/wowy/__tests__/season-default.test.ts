import { describe, expect, it } from 'vitest';
import {
  chooseWowyDefaultSeason,
  earlySeasonNotice,
  gamesPerTeam,
  resolveWowySeason,
  wowySeasonOptions,
} from '@/lib/wowy/season-default';

const label = (s: string) => `${s}–${String(Number(s) + 1).slice(2)}`;

describe('WOWY seasons', () => {
  it('lists the current season first, back to 2023', () => {
    expect(wowySeasonOptions('2026')).toEqual(['2026', '2025', '2024', '2023']);
    expect(wowySeasonOptions('2027')[0]).toBe('2027');
    expect(wowySeasonOptions('bad')).toEqual(['2023']);
  });

  it('opens last season until teams average 20 finished games', () => {
    expect(gamesPerTeam(107)).toBeCloseTo(7.13, 2);
    expect(chooseWowyDefaultSeason('2026', 107)).toBe('2025');
    expect(chooseWowyDefaultSeason('2026', 299)).toBe('2025');
    expect(chooseWowyDefaultSeason('2026', 300)).toBe('2026');
  });

  it('honours a requested season the page offers, like the teammates-out link', () => {
    const options = wowySeasonOptions('2026');
    expect(resolveWowySeason('2026', options, '2025')).toBe('2026');
    expect(resolveWowySeason('2019', options, '2025')).toBe('2025');
    expect(resolveWowySeason(undefined, options, '2025')).toBe('2025');
  });

  it('warns about thin samples only for an early current season', () => {
    const base = { currentSeason: '2026', seasonLabel: label };
    expect(earlySeasonNotice({ ...base, season: '2026', currentSeasonFinalGames: 107 })).toBe(
      '2026–27 is early: about 7 games per team so far, so most splits will be low support.'
    );
    expect(earlySeasonNotice({ ...base, season: '2025', currentSeasonFinalGames: 107 })).toBeNull();
    expect(earlySeasonNotice({ ...base, season: '2026', currentSeasonFinalGames: 400 })).toBeNull();
  });
});
