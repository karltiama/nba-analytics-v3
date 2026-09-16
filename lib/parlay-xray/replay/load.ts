import { PLAYER_PROP_V1_VENDORS } from '@/lib/betting/market-movement';
import { HISTORICAL_REPLAY_LOOKUP_SQL, assertReplaySqlIsOutcomeFree } from './sql';
import type { HistoricalMovementRow } from './types';

export type ReplayQuery = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

export async function loadHistoricalMovementRows(
  query: ReplayQuery,
  input: { gameId: string; playerId: string; propType: string }
): Promise<HistoricalMovementRow[]> {
  assertReplaySqlIsOutcomeFree(HISTORICAL_REPLAY_LOOKUP_SQL);
  return query<HistoricalMovementRow>(HISTORICAL_REPLAY_LOOKUP_SQL, [
    input.gameId,
    input.playerId,
    input.propType,
    [...PLAYER_PROP_V1_VENDORS],
  ]);
}
