/**
 * True when BBRef/COUNT season stats represent at least one completed game.
 * Postgres COUNT often arrives as a string "0", which is truthy in JS.
 */
export function hasCompletedSeasonStats(gamesPlayed: unknown): boolean {
  return (Number(gamesPlayed) || 0) > 0;
}
