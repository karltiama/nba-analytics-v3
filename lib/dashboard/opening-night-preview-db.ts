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
import type { Game } from '@/components/betting/GameCard';

export async function loadOpeningNightPreview(now: Date): Promise<Game[]> {
  const rows = await query<OpeningNightSourceRow>(OPENING_NIGHT_GAMES_SQL);
  return presentOpeningNightGames(rows, now);
}
