import { normalizePlayerIdForLookup } from '@/lib/research/player-display-name-lookup-builder';

/**
 * Optional S3 JSON used to enrich Research Lab player rows with display names.
 * Does not participate in strategy computation — view-layer only.
 *
 * Supported shapes (first match wins when parsing):
 * - `{ "by_player_id": { "<id>": "Name", ... } }` (also `byPlayerId` camelCase)
 * - `{ "players": { "<id>": "Name", ... } }`
 * - `{ "entries": [{ "player_id"|"id": "...", "display_name"|"full_name"|"player_name": "..." }] }`
 */

export function playerIdDisplayNameLookupS3Keys(seasonsTag: string): readonly string[] {
  const tag = seasonsTag.trim() || '2023-2024-2025';
  return [
    `research/dimensions/league=nba/player_id_to_display_name.json`,
    `research/strategy-sweeps/league=nba/target=score_above_season_avg/comparison/seasons=${tag}/dimensions/player_id_to_display_name.json`,
  ] as const;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

function trimName(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const t = String(v).trim();
    return t.length > 0 ? t : null;
  }
  return null;
}

/**
 * Parse lookup JSON into a player_id → display name map (later keys in merge should override earlier).
 */
export function parsePlayerIdDisplayNameLookupJson(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!isRecord(raw)) return out;

  const fromRecord = (rec: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(rec)) {
      const name = trimName(v);
      if (!name) continue;
      const key = normalizePlayerIdForLookup(k) ?? String(k).trim();
      if (!key) continue;
      out.set(key, name);
      // Match breakdown ids that normalize to plain digits (e.g. "000123" vs "123").
      if (/^\d+$/.test(key)) {
        const canon = String(Number(key));
        if (canon !== key) out.set(canon, name);
      }
    }
  };

  const byId = raw.by_player_id;
  if (isRecord(byId)) fromRecord(byId);

  const byIdCamel = raw.byPlayerId;
  if (isRecord(byIdCamel)) fromRecord(byIdCamel);

  const players = raw.players;
  if (isRecord(players)) fromRecord(players);

  const entries = raw.entries;
  if (Array.isArray(entries)) {
    for (const e of entries) {
      if (!isRecord(e)) continue;
      const pid = normalizePlayerIdForLookup(e.player_id ?? e.id);
      if (!pid) continue;
      const name =
        trimName(e.display_name) ??
        trimName(e.full_name) ??
        trimName(e.player_name) ??
        trimName(e.name);
      if (!name) continue;
      out.set(pid, name);
      if (/^\d+$/.test(pid)) {
        const canon = String(Number(pid));
        if (canon !== pid) out.set(canon, name);
      }
    }
  }

  return out;
}

/** Merge maps left-to-right; later maps overwrite earlier keys. */
export function mergePlayerDisplayNameMaps(maps: readonly ReadonlyMap<string, string>[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of maps) {
    for (const [k, v] of m) {
      const kt = k.trim();
      const vt =
        typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v).trim() : '';
      if (kt && vt) out.set(kt, vt);
    }
  }
  return out;
}
