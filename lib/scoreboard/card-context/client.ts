/**
 * Browser reader for GET /api/scoreboard/context.
 * The scoreboard list renders first. A failed context read leaves the card fallback in place.
 */

export const CARD_CONTEXT_SCHEMA_VERSION = 'card-context.v1' as const;
export const CARD_CONTEXT_REFRESH_MS = 5 * 60 * 1000;

export type CardInjuryPlayer = {
  name: string;
  status: 'Out' | 'Doubtful' | 'Q';
};

export type CardInjuryTeam = {
  abbr: string;
  players: CardInjuryPlayer[];
  extra: number;
};

export type PregameCardContext = {
  schedule: string;
  injuries: string;
  /** Null on a text-only payload, or when the optional teams field is absent or unusable. */
  injuryTeams: CardInjuryTeam[] | null;
  /** Null when the payload has no separate caption. The injuries text still stands alone. */
  asOfLabel: string | null;
};

const INJURY_STATUSES = new Set<CardInjuryPlayer['status']>(['Out', 'Doubtful', 'Q']);

function readInjuryTeams(value: unknown): CardInjuryTeam[] | null {
  if (!Array.isArray(value)) return null;
  const teams: CardInjuryTeam[] = [];
  for (const team of value) {
    if (!team || typeof team !== 'object') return null;
    const abbr = (team as { abbr?: unknown }).abbr;
    const players = (team as { players?: unknown }).players;
    const extra = (team as { extra?: unknown }).extra;
    if (typeof abbr !== 'string' || abbr.trim() === '') return null;
    if (!Array.isArray(players)) return null;
    if (typeof extra !== 'number' || !Number.isInteger(extra) || extra < 0) return null;
    const parsed: CardInjuryPlayer[] = [];
    for (const player of players) {
      if (!player || typeof player !== 'object') return null;
      const name = (player as { name?: unknown }).name;
      const status = (player as { status?: unknown }).status;
      if (typeof name !== 'string' || name.trim() === '') return null;
      if (typeof status !== 'string' || !INJURY_STATUSES.has(status as CardInjuryPlayer['status'])) return null;
      parsed.push({ name, status: status as CardInjuryPlayer['status'] });
    }
    teams.push({ abbr, players: parsed, extra });
  }
  return teams;
}

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
    const injuryRecord = (value as { injuries?: { text?: unknown; teams?: unknown; as_of_label?: unknown } }).injuries;
    const injuries = injuryRecord?.text;
    if (typeof schedule !== 'string' || schedule.trim() === '') return null;
    if (typeof injuries !== 'string' || injuries.trim() === '') return null;
    const asOfRaw = injuryRecord?.as_of_label;
    out[id] = {
      schedule,
      injuries,
      injuryTeams: readInjuryTeams(injuryRecord?.teams),
      asOfLabel: typeof asOfRaw === 'string' && asOfRaw.trim() !== '' ? asOfRaw : null,
    };
  }
  return out;
}
