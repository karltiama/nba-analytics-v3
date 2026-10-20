/**
 * Read-only DraftKings rows already stored for dashboard cards.
 * Does not call a provider and does not write.
 */

import { query } from '@/lib/db';
import {
  STORED_ODDS_SQL,
  draftKingsPatch,
  type StoredOddsPatch,
  type StoredOddsSourceRow,
} from '@/lib/dashboard/stored-odds';

export async function loadStoredOdds(gameIds: readonly string[], now: Date): Promise<Record<string, StoredOddsPatch>> {
  const ids = [...new Set(gameIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return {};
  const rows = await query<StoredOddsSourceRow>(STORED_ODDS_SQL, [ids, now.toISOString()]);
  const patches: Record<string, StoredOddsPatch> = {};
  for (const row of rows) {
    const patch = draftKingsPatch(row, now);
    if (patch) patches[String(row.game_id)] = patch;
  }
  return patches;
}
