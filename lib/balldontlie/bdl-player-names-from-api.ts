import { normalizePlayerIdForLookup, trimPlayerDisplayName } from '@/lib/research/player-display-name-lookup-builder';

const BDL_PLAYERS_BASE = 'https://api.balldontlie.io/v1/players';

function displayNameFromBdlPlayerRow(row: Record<string, unknown>): string | null {
  const fn = trimPlayerDisplayName(row.first_name);
  const ln = trimPlayerDisplayName(row.last_name);
  const combined = [fn, ln].filter(Boolean).join(' ').trim();
  return combined.length > 0 ? combined : null;
}

/**
 * Batch-resolve BallDontLie `player_id` → display name via the public NBA API.
 * Server-only; requires `BALLDONTLIE_API_KEY` (or legacy `BALDONTLIE_API_KEY`).
 */
export async function fetchBdlPlayerNamesByIds(args: {
  playerIds: readonly string[];
  apiKey: string;
  /** Hard cap to respect free-tier rate limits (default 100). */
  maxIds?: number;
}): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const key = args.apiKey.trim();
  if (!key) return out;

  const unique = new Set<string>();
  for (const raw of args.playerIds) {
    const id = normalizePlayerIdForLookup(raw);
    if (id) unique.add(id);
  }

  const max = Math.min(args.maxIds ?? 100, 100);
  const ids = [...unique].slice(0, max);
  if (ids.length === 0) return out;

  const params = new URLSearchParams();
  for (const id of ids) params.append('player_ids[]', id);
  params.set('per_page', String(Math.min(100, ids.length)));

  const url = `${BDL_PLAYERS_BASE}?${params.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: key },
      next: { revalidate: 86_400 },
    });
  } catch {
    return out;
  }
  if (!res.ok) return out;

  let body: unknown;
  try {
    body = (await res.json()) as unknown;
  } catch {
    return out;
  }
  if (typeof body !== 'object' || body === null) return out;
  const rows = (body as { data?: unknown }).data;
  if (!Array.isArray(rows)) return out;

  for (const item of rows) {
    if (typeof item !== 'object' || item === null) continue;
    const row = item as Record<string, unknown>;
    const id = normalizePlayerIdForLookup(row.id);
    const name = displayNameFromBdlPlayerRow(row);
    if (id && name) out.set(id, name);
  }
  return out;
}

export function getBalldontlieApiKeyFromEnv(): string | null {
  const k =
    process.env.BALLDONTLIE_API_KEY?.trim() ||
    process.env.BALDONTLIE_API_KEY?.trim() ||
    process.env.balldontlie_api_key?.trim();
  return k && k.length > 0 ? k : null;
}
