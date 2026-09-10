/**
 * Postgres accessors for certified Market Movement v1.
 */

import { query, queryOne } from '@/lib/db';
import {
  GAME_ODDS_COMPARISON_KIND,
  GAME_ODDS_REFERENCE_KIND,
  PLAYER_PROP_V1_VENDORS,
  canonicalizePropType,
  isPlayerPropV1PropType,
} from '@/lib/betting/market-movement';
import {
  GAME_ODDS_MARKET_MOVEMENT_TABLE,
  emptyPlayerMarketMovement,
  gameOddsMarketMovementSql,
  mapServingRowsToPlayerMarketMovement,
  playerMarketMovementSql,
  type PlayerMarketMovementResponse,
  type ServingJoinRow,
} from '@/lib/betting/market-movement-api';

export * from '@/lib/betting/market-movement-api';

export async function getPlayerMarketMovement(input: {
  gameId: string;
  playerId: string;
  propType: string;
}): Promise<PlayerMarketMovementResponse> {
  const gameId = input.gameId.trim();
  const playerId = input.playerId.trim();
  const canonical = canonicalizePropType(input.propType);

  if (!gameId || !playerId || !canonical || !isPlayerPropV1PropType(canonical)) {
    return emptyPlayerMarketMovement({
      gameId,
      playerId,
      playerName: null,
      propType: canonical ?? input.propType.trim(),
      status: 'unsupported_prop',
      reason: 'unsupported_prop',
    });
  }

  const rows = await query<ServingJoinRow>(playerMarketMovementSql(), [
    gameId,
    playerId,
    canonical,
    [...PLAYER_PROP_V1_VENDORS],
  ]);

  let playerNameFallback: string | null = null;
  if (rows.length === 0) {
    const player = await queryOne<{ full_name: string }>(
      `SELECT full_name FROM analytics.players WHERE player_id = $1 LIMIT 1`,
      [playerId]
    );
    playerNameFallback = player?.full_name ?? null;
  }

  return mapServingRowsToPlayerMarketMovement({
    gameId,
    playerId,
    propType: canonical,
    rows,
    playerNameFallback,
  });
}

/** Future game-odds endpoint helper. Not a public route in 11D. */
export async function getGameOddsMarketMovementMeta(gameId: string): Promise<{
  sourceTable: typeof GAME_ODDS_MARKET_MOVEMENT_TABLE;
  gameId: string;
  referenceKind: typeof GAME_ODDS_REFERENCE_KIND;
  comparisonKind: typeof GAME_ODDS_COMPARISON_KIND;
  vendorCount: number;
}> {
  const rows = await query<{ vendor: string }>(gameOddsMarketMovementSql(), [gameId.trim()]);
  return {
    sourceTable: GAME_ODDS_MARKET_MOVEMENT_TABLE,
    gameId: gameId.trim(),
    referenceKind: GAME_ODDS_REFERENCE_KIND,
    comparisonKind: GAME_ODDS_COMPARISON_KIND,
    vendorCount: rows.length,
  };
}
