/**
 * Pure helpers to build `player_id_to_display_name.json` payloads consumed by
 * {@link parsePlayerIdDisplayNameLookupJson}. Does not touch strategy artifacts.
 */

export type PlayerDisplayNameInputRow = {
  player_id: unknown;
  player_name?: unknown;
};

export type BuildPlayerDisplayNameLookupArgs = {
  rows: readonly PlayerDisplayNameInputRow[];
  /** e.g. `player_game_features` */
  source: string;
  league?: string;
  /** ISO-8601; defaults to `new Date().toISOString()` */
  generatedAt?: string;
};

export type PlayerDisplayNameLookupJson = {
  league: string;
  generated_at: string;
  source: string;
  by_player_id: Record<string, string>;
  entry_count: number;
};

/** Normalize `player_id` to a non-empty string, or `null` if missing/invalid. */
export function normalizePlayerIdForLookup(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return String(Math.trunc(value));
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t.length) return null;
    /** BallDontLie ids are numeric; canonicalize so "000123" matches lookup key "123". */
    if (/^\d+$/.test(t) && t.length <= 15) return String(Number(t));
    return t;
  }
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

/** Trimmed non-empty display name, or `null` if absent/blank/non-string. */
export function trimPlayerDisplayName(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/**
 * Build a JSON-serializable lookup object. Duplicate `player_id` values: later
 * rows in `rows` overwrite earlier ones (callers should order rows so "latest"
 * names appear last).
 */
export function buildPlayerDisplayNameLookupPayload(
  args: BuildPlayerDisplayNameLookupArgs
): PlayerDisplayNameLookupJson {
  const league = args.league ?? 'nba';
  const generated_at = args.generatedAt ?? new Date().toISOString();
  const by_player_id: Record<string, string> = {};

  for (const row of args.rows) {
    const id = normalizePlayerIdForLookup(row.player_id);
    if (!id) continue;
    const name = trimPlayerDisplayName(row.player_name);
    if (!name) continue;
    by_player_id[id] = name;
  }

  const entry_count = Object.keys(by_player_id).length;
  return {
    league,
    generated_at,
    source: args.source,
    by_player_id,
    entry_count,
  };
}
