/**
 * Which seasons the WOWY page offers, and which one it opens on. Client-safe (no db).
 *
 * The current season is listed from day one so links (e.g. the Props Explorer teammates-out panel)
 * open the season they ask for. It becomes the default only once teams average
 * WOWY_DEFAULT_MIN_GAMES_PER_TEAM finished games; before that, a bare /wowy opens last season.
 */

/** Earliest season with WOWY-ready game logs. */
export const WOWY_FIRST_SEASON = 2023;
export const WOWY_DEFAULT_MIN_GAMES_PER_TEAM = 20;
const NBA_TEAMS = 30;

/** Newest first: the current season down to WOWY_FIRST_SEASON. */
export function wowySeasonOptions(currentSeason: string): string[] {
  const current = Number(currentSeason);
  if (!Number.isInteger(current) || current < WOWY_FIRST_SEASON) return [String(WOWY_FIRST_SEASON)];
  const out: string[] = [];
  for (let y = current; y >= WOWY_FIRST_SEASON; y--) out.push(String(y));
  return out;
}

/** Average finished games per team (each game counts for two teams). */
export function gamesPerTeam(finalGames: number): number {
  return finalGames > 0 ? (finalGames * 2) / NBA_TEAMS : 0;
}

export function chooseWowyDefaultSeason(currentSeason: string, finalGamesInCurrentSeason: number): string {
  const options = wowySeasonOptions(currentSeason);
  if (gamesPerTeam(finalGamesInCurrentSeason) >= WOWY_DEFAULT_MIN_GAMES_PER_TEAM) return options[0];
  return options[1] ?? options[0];
}

/** The season shown on load: the requested one when offered, otherwise the default. */
export function resolveWowySeason(requested: string | null | undefined, options: string[], fallback: string): string {
  const r = (requested ?? '').trim();
  return options.includes(r) ? r : fallback;
}

/** Notice under the season picker while the current season is still thin. Null otherwise. */
export function earlySeasonNotice(args: {
  season: string;
  currentSeason: string;
  currentSeasonFinalGames: number;
  seasonLabel: (s: string) => string;
}): string | null {
  if (args.season !== args.currentSeason) return null;
  const perTeam = gamesPerTeam(args.currentSeasonFinalGames);
  if (perTeam >= WOWY_DEFAULT_MIN_GAMES_PER_TEAM) return null;
  const n = Math.max(0, Math.round(perTeam));
  return `${args.seasonLabel(args.season)} is early: about ${n} game${n === 1 ? '' : 's'} per team so far, so most splits will be low support.`;
}
