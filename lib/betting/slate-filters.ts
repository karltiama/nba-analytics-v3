/**
 * Client-side slate filters for the betting dashboard.
 */

export type SlateTeamRef = {
  id: string;
  name: string;
  abbreviation: string;
};

export type SlateGameRef = {
  homeTeam: SlateTeamRef;
  awayTeam: SlateTeamRef;
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** True when the game involves a profile favorite team (abbr, id, or full name). */
export function gameInvolvesFavoriteTeam(
  game: SlateGameRef,
  favoriteTeams: readonly string[]
): boolean {
  const tokens = favoriteTeams.map(norm).filter(Boolean);
  if (tokens.length === 0) return false;
  const fields = [
    game.homeTeam.abbreviation,
    game.awayTeam.abbreviation,
    game.homeTeam.name,
    game.awayTeam.name,
    game.homeTeam.id,
    game.awayTeam.id,
  ].map(norm);
  return tokens.some((t) => fields.includes(t));
}

export function filterSlateGames<T extends SlateGameRef>(args: {
  games: T[];
  searchValue: string;
  showCloseMatchups: boolean;
  isClose: (game: T) => boolean;
  showFavoritesOnly: boolean;
  favoriteTeams: readonly string[];
}): T[] {
  const q = args.searchValue.trim().toLowerCase();
  return args.games.filter((game) => {
    const matchesSearch =
      q === '' ||
      game.homeTeam.name.toLowerCase().includes(q) ||
      game.awayTeam.name.toLowerCase().includes(q) ||
      game.homeTeam.abbreviation.toLowerCase().includes(q) ||
      game.awayTeam.abbreviation.toLowerCase().includes(q);
    const matchesClose = !args.showCloseMatchups || args.isClose(game);
    const matchesFav =
      !args.showFavoritesOnly || gameInvolvesFavoriteTeam(game, args.favoriteTeams);
    return matchesSearch && matchesClose && matchesFav;
  });
}
