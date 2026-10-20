/**
 * Read-only DraftKings rows already stored for dashboard cards.
 * Does not call a provider and does not write.
 */

import { query } from '@/lib/db';
import {
  STORED_ODDS_SQL,
  collectStoredOdds,
  type StoredOddsPatch,
  type StoredOddsSourceRow,
} from '@/lib/dashboard/stored-odds';

export async function loadStoredOdds(
  gameIds: readonly string[],
  now: Date
): Promise<{ odds: Record<string, StoredOddsPatch>; withheld: Record<string, 'unknown'> }> {
  const ids = [...new Set(gameIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return { odds: {}, withheld: {} };
  const rows = await query<StoredOddsSourceRow>(STORED_ODDS_SQL, [ids, now.toISOString()]);
  return collectStoredOdds(rows, now);
}
