import { describe, expect, it } from 'vitest';
import { filterSlateGames, gameInvolvesFavoriteTeam } from '@/lib/betting/slate-filters';

const atlVsBos = {
  homeTeam: { id: '1', name: 'Atlanta Hawks', abbreviation: 'ATL' },
  awayTeam: { id: '2', name: 'Boston Celtics', abbreviation: 'BOS' },
  isClose: false,
};
const nykVsMia = {
  homeTeam: { id: '3', name: 'New York Knicks', abbreviation: 'NYK' },
  awayTeam: { id: '4', name: 'Miami Heat', abbreviation: 'MIA' },
  isClose: true,
};

describe('gameInvolvesFavoriteTeam', () => {
  it('matches favorite abbreviation', () => {
    expect(gameInvolvesFavoriteTeam(atlVsBos, ['ATL'])).toBe(true);
    expect(gameInvolvesFavoriteTeam(atlVsBos, ['NYK'])).toBe(false);
  });
});

describe('filterSlateGames favorites toggle', () => {
  it('does not filter when Favorites is off', () => {
    const out = filterSlateGames({
      games: [atlVsBos, nykVsMia],
      searchValue: '',
      showCloseMatchups: false,
      isClose: (g) => g.isClose,
      showFavoritesOnly: false,
      favoriteTeams: ['ATL'],
    });
    expect(out).toHaveLength(2);
  });

  it('keeps only games involving favorite teams when Favorites is on', () => {
    const out = filterSlateGames({
      games: [atlVsBos, nykVsMia],
      searchValue: '',
      showCloseMatchups: false,
      isClose: (g) => g.isClose,
      showFavoritesOnly: true,
      favoriteTeams: ['ATL'],
    });
    expect(out).toEqual([atlVsBos]);
  });
});
