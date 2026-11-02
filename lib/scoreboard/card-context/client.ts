/**
 * Browser reader for GET /api/scoreboard/context.
 * The scoreboard list renders first. A failed context read leaves the card fallback in place.
 */

export const CARD_CONTEXT_SCHEMA_VERSION = 'card-context.v1' as const;
export const CARD_CONTEXT_REFRESH_MS = 5 * 60 * 1000;

export type PregameCardContext = {
  schedule: string;
  injuries: string;
};

export function cardContextApiUrl(date: string): string {
  return `/api/scoreboard/context?date=${encodeURIComponent(date)}`;
}

/** 5 minutes while any game is still pregame. Null once every game is live, final, or otherwise not scheduled. */
export function cardContextPollDelayMs(
  games: Array<{ lifecycle?: string | null }> | null | undefined
): number | null {
  if (!games?.some((game) => game.lifecycle === 'scheduled')) return null;
  return CARD_CONTEXT_REFRESH_MS;
}

/**
 * Null keeps the card fallback: wrong schema, a documented store error, or a game entry
 * that is missing either line. An empty games map is a real empty slate.
 */
export function readCardContextPayload(body: unknown): Record<string, PregameCardContext> | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as { schema_version?: unknown; games?: unknown; error?: unknown };
  if (record.schema_version !== CARD_CONTEXT_SCHEMA_VERSION) return null;
  if (record.error != null) return null;
  if (!record.games || typeof record.games !== 'object' || Array.isArray(record.games)) return null;
  const out: Record<string, PregameCardContext> = {};
  for (const [id, value] of Object.entries(record.games as Record<string, unknown>)) {
    if (!id || !value || typeof value !== 'object') return null;
    const schedule = (value as { schedule?: { text?: unknown } }).schedule?.text;
    const injuries = (value as { injuries?: { text?: unknown } }).injuries?.text;
    if (typeof schedule !== 'string' || schedule.trim() === '') return null;
    if (typeof injuries !== 'string' || injuries.trim() === '') return null;
    out[id] = { schedule, injuries };
  }
  return out;
}
