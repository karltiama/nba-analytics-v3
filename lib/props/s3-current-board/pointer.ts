export const BASE_SCHEDULE_FRESHNESS_MS = 30 * 60 * 1000;

export type CurrentPointer = {
  schemaVersion: 1;
  gameId: string;
  archiveKey: string;
  manifestKey: string;
  pullRunId: number;
  observedAt: string;
  controllerEnqueuedAt: string;
  gameStartTime: string;
  envelopeChecksum: string;
  manifestChecksum: string;
  previousArchiveKey: string | null;
};

/** Pointer address for one game. The game id is not an object key. */
export function pointerKey(gameId: string): string {
  return `current/source=balldontlie/league=nba/entity=player_prop_current/game_id=${gameId}/pointer.json`;
}

export function isCurrentBoardGameId(gameId: string): boolean {
  return /^\d+$/.test(gameId);
}
