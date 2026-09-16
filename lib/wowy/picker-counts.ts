import { classifyWowyGames } from './eligibility';
import type { WowyLoadedGame, WowyPairQuery } from './types';

/**
 * Picker WITH/WITHOUT counts must use the pair classifier, not a looser
 * season-wide box join. SQL in queries.ts mirrors these buckets.
 */
export function teammatePickerCountsFromGames(
  games: WowyLoadedGame[],
  query: WowyPairQuery
): { withGames: number; withoutGames: number } {
  if (!query.teammatePlayerId) {
    return { withGames: 0, withoutGames: 0 };
  }
  const classified = classifyWowyGames(games, query);
  return {
    withGames: classified.filter((g) => g.bucket === 'with').length,
    withoutGames: classified.filter((g) => g.bucket === 'without').length,
  };
}
