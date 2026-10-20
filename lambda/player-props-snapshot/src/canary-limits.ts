/**
 * Opening-night player-props canary.
 * Active only when PLAYER_PROPS_CANARY_ONLY=1.
 * The named game must be one of the three opening-night ids.
 */

export const PLAYER_PROPS_CANARY_ONLY_ENV = 'PLAYER_PROPS_CANARY_ONLY';
export const PLAYER_PROPS_CANARY_GAME_ID_ENV = 'PLAYER_PROPS_CANARY_GAME_ID';
export const OPENING_NIGHT_PROP_GAME_IDS = ['21717855', '21717856', '21717857'] as const;
export const OPENING_NIGHT_PROP_DATE = '2026-10-20';
export const OPENING_NIGHT_PROP_SEASON = '2026';
export const OPENING_NIGHT_PROP_PHASE = 'REGULAR';
export const CANARY_MAX_PAGES = 2;

const CANARY_EVENT_ERROR = 'player props canary accepts exactly one approved SQS record';

export type CanaryGameId = (typeof OPENING_NIGHT_PROP_GAME_IDS)[number];

export type CanaryMessage = {
  runId: 0;
  gameId: CanaryGameId;
  bdlGameId: number;
  date: typeof OPENING_NIGHT_PROP_DATE;
};

export type CanarySqsEvent = {
  Records?: Array<{ body?: string }>;
};

export function isPlayerPropsCanaryOnly(env: Record<string, string | undefined>): boolean {
  return env[PLAYER_PROPS_CANARY_ONLY_ENV] === '1';
}

export function assertCanaryLimiter(env: Record<string, string | undefined>): void {
  const expected: Record<string, string> = {
    BDL_RATE_LIMIT_INTERVAL_MS: '13000',
    BDL_RATE_LIMIT_MAX_REQUESTS: '1',
    BDL_RATE_LIMIT_BURST: '1',
    BDL_RATE_LIMIT_MAX_RETRIES: '0',
  };
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => env[key] !== value)
    .map(([key]) => key);
  if (mismatches.length > 0) {
    throw new Error(`player props canary limiter refused: ${mismatches.join(', ')}`);
  }
}

function approvedGameId(env: Record<string, string | undefined>): CanaryGameId {
  const gameId = env[PLAYER_PROPS_CANARY_GAME_ID_ENV];
  if (!OPENING_NIGHT_PROP_GAME_IDS.includes(gameId as CanaryGameId)) {
    throw new Error('player props canary game id is not an opening-night game');
  }
  return gameId as CanaryGameId;
}

/** One SQS record, one approved game, no controller run id. */
export function assertCanaryRecord(
  event: CanarySqsEvent,
  env: Record<string, string | undefined>
): CanaryMessage {
  const records = event.Records;
  if (!Array.isArray(records) || records.length !== 1 || typeof records[0]?.body !== 'string') {
    throw new Error(CANARY_EVENT_ERROR);
  }
  let body: {
    runId?: unknown;
    gameId?: unknown;
    bdlGameId?: unknown;
    date?: unknown;
    universe?: unknown;
  };
  try {
    body = JSON.parse(records[0].body) as typeof body;
  } catch {
    throw new Error(CANARY_EVENT_ERROR);
  }
  const gameId = approvedGameId(env);
  if (
    body.runId !== 0
    || body.gameId !== gameId
    || body.bdlGameId !== Number(gameId)
    || body.date !== OPENING_NIGHT_PROP_DATE
    || body.universe != null
  ) {
    throw new Error(CANARY_EVENT_ERROR);
  }
  return {
    runId: 0,
    gameId,
    bdlGameId: Number(gameId),
    date: OPENING_NIGHT_PROP_DATE,
  };
}

export function assertCanaryGameRow(row: {
  gameId: string | null;
  season: string | null;
  seasonPhase: string | null;
} | null): void {
  if (
    row == null
    || row.gameId == null
    || row.season !== OPENING_NIGHT_PROP_SEASON
    || row.seasonPhase !== OPENING_NIGHT_PROP_PHASE
  ) {
    throw new Error('player props canary game is not season 2026 regular');
  }
}
