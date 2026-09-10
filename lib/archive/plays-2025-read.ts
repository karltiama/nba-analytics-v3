/**
 * Server-only: one canonical 2025 Plays object by game ID.
 * Does not acquire from BDL. Does not list the lake. Read-only GetObject.
 */
import {
  extractPlayRows,
  plays2025CanonicalPrefix,
  plays2025GameObjectKey,
  validatePlaysArchiveBody,
  type PlaysArchiveJson,
} from '@/lib/archive/plays';

export type CanonicalPlaysRead = {
  key: string;
  found: boolean;
  ok: boolean;
  reason: string;
  rows: PlaysArchiveJson[];
};

export function canonicalPlaysObjectKey(gameId: string): string {
  return plays2025GameObjectKey(plays2025CanonicalPrefix(), String(gameId));
}

export function isCanonicalPlaysGameKey(key: string): boolean {
  if (key.includes('_characterization')) return false;
  return /\/entity=plays\/game_id=\d+\.json$/.test(key);
}

export function gameIdFromCanonicalPlaysKey(key: string): string | null {
  if (!isCanonicalPlaysGameKey(key)) return null;
  const match = key.match(/\/game_id=(\d+)\.json$/);
  return match?.[1] ?? null;
}

export type CanonicalPlaysStore = {
  getJson: (key: string) => Promise<unknown | null>;
};

export async function readCanonicalPlaysObject(
  store: CanonicalPlaysStore,
  gameId: string
): Promise<CanonicalPlaysRead> {
  const key = canonicalPlaysObjectKey(gameId);
  let body: unknown;
  try {
    body = await store.getJson(key);
  } catch {
    return { key, found: false, ok: false, reason: 'read_error', rows: [] };
  }
  if (body == null) return { key, found: false, ok: false, reason: 'missing', rows: [] };
  const valid = validatePlaysArchiveBody(gameId, body);
  if (!valid.ok) {
    return { key, found: true, ok: false, reason: valid.reason, rows: [] };
  }
  return { key, found: true, ok: true, reason: 'ok', rows: extractPlayRows(body) };
}
