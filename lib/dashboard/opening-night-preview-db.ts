/**
 * Read-only loader for the opening-night dashboard preview.
 * The SQL selects schedule columns only.
 */

import { query } from '@/lib/db';
import {
  OPENING_NIGHT_GAMES_SQL,
  presentOpeningNightGames,
  type OpeningNightSourceRow,
} from '@/lib/dashboard/opening-night-preview';
import { applyStoredOdds } from '@/lib/dashboard/stored-odds';
import { loadStoredOdds } from '@/lib/dashboard/stored-odds-db';
import type { Game } from '@/components/betting/GameCard';

export async function loadOpeningNightPreview(now: Date): Promise<Game[]> {
  const rows = await query<OpeningNightSourceRow>(OPENING_NIGHT_GAMES_SQL);
  const games = presentOpeningNightGames(rows, now);
  const upcoming = games.filter((game) => !game.schedulePreview?.tipPassed).map((game) => game.id);
  const loaded = await loadStoredOdds(upcoming, now);
  return games.map((game) => applyStoredOdds(game, loaded.odds[game.id]));
}
