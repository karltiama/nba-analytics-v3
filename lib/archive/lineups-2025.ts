/**
 * Season 2025 lineups archive plan. Reuses lib/balldontlie/lineups.ts.
 * Raw S3 only. Target is the certified BDL 2025 inventory (1,322), not local 1,323.
 */

import { readFileSync } from 'node:fs';
import { LINEUPS_PATH } from '@/lib/balldontlie/lineups';
import { DO_NOT_TOUCH_LOCAL_ONLY_ID } from '@/lib/ingestion/goat-stats-repair-queue';
import { parseExecuteFlag, rawEntityPrefix, type TrialArchivePlan } from './trial-archive-plan';

export const LINEUPS_2025_ENTITY = 'lineups';
export const LINEUPS_2025_EXPECTED_TARGET = 1322;
export const LINEUPS_2025_CACHE_PATH = 'reports/trial/bdl-games-2025.json';
export const LINEUPS_2025_LOCAL_ONLY_ID = String(DO_NOT_TOUCH_LOCAL_ONLY_ID);
export const LINEUPS_2025_MAX_CRAWL_MS = 6 * 60 * 60 * 1000;
export const LINEUPS_2025_AVAILABILITY_LIMITATION =
  'The lineup endpoint does NOT reliably distinguish active bench, DNP, inactive, or absent roster members. Certified product signal is starter vs listed non-starter only.';

/** Fallback SQL — archive target is the cached BDL inventory, not this query. */
export const LINEUPS_SEASON_GAMES_SQL = `
  select game_id
  from analytics.games
  where season = '2025'
    and game_id <> '${LINEUPS_2025_LOCAL_ONLY_ID}'
  order by start_time, game_id
`;

export type LineupArchiveJson = Record<string, unknown>;

export type Bdl2025InventoryGame = {
  id: string;
  date: string | null;
  postseason: boolean;
  datetime: string | null;
};

export type AuthoritativeLineups2025Inventory = {
  cachePath: string;
  gameIds: string[];
  games: Bdl2025InventoryGame[];
  regularSeason: number;
  postseason: number;
  dateMin: string | null;
  dateMax: string | null;
};

export function lineups2025CanonicalPrefix(): string {
  return rawEntityPrefix(process.env.NBA_RAW_PREFIX ?? 'raw', 2025, LINEUPS_2025_ENTITY);
}

export function lineups2025CharacterizationPrefix(): string {
  return `${lineups2025CanonicalPrefix()}/_characterization_25game`;
}

export function lineups2025GameObjectKey(prefix: string, gameId: string): string {
  return `${prefix}/game_id=${gameId}.json`;
}

function sid(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'object') return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

export function nestedId(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== 'object') return sid(v);
  return sid((v as LineupArchiveJson).id);
}

export function extractLineupRows(body: unknown): LineupArchiveJson[] {
  if (!body || typeof body !== 'object') return [];
  const obj = body as LineupArchiveJson;
  if (Array.isArray(obj.data)) return obj.data as LineupArchiveJson[];
  if (Array.isArray(obj.pages)) {
    const rows: LineupArchiveJson[] = [];
    for (const p of obj.pages as unknown[]) {
      if (p && typeof p === 'object' && Array.isArray((p as LineupArchiveJson).data)) {
        rows.push(...((p as LineupArchiveJson).data as LineupArchiveJson[]));
      }
    }
    return rows;
  }
  return [];
}

/** Characterization/canonical objects must preserve raw pages and top-level team.id. */
export function validateLineupArchiveBody(gameId: string, body: unknown): { ok: boolean; reason: string } {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'not_object' };
  const obj = body as LineupArchiveJson;
  const labeled = sid(obj.game_id);
  if (labeled && labeled !== String(gameId)) return { ok: false, reason: 'game_id_mismatch' };
  if (!Array.isArray(obj.pages) && !Array.isArray(obj.data)) {
    return { ok: false, reason: 'missing_pages_or_data' };
  }
  const rows = extractLineupRows(body);
  for (const r of rows) {
    const rowGame = sid(r.game_id);
    if (rowGame && rowGame !== String(gameId)) return { ok: false, reason: 'row_game_id_mismatch' };
    if (!r.player || typeof r.player !== 'object') return { ok: false, reason: 'missing_player' };
    if (!r.team || typeof r.team !== 'object') return { ok: false, reason: 'missing_team' };
    if (nestedId(r.team) == null) return { ok: false, reason: 'missing_team_id' };
    if (nestedId(r.player) == null) return { ok: false, reason: 'missing_player_id' };
  }
  return { ok: true, reason: 'ok' };
}

export function classifyStarterReliability(valid5plus5: number, targetGames: number): {
  classification: 'EXCELLENT' | 'GOOD' | 'MIXED' | 'POOR';
  pct: number | null;
} {
  const pct = targetGames > 0 ? Math.round((10000 * valid5plus5) / targetGames) / 100 : null;
  if (pct == null) return { classification: 'POOR', pct };
  if (pct >= 99) return { classification: 'EXCELLENT', pct };
  if (pct >= 95) return { classification: 'GOOD', pct };
  if (pct >= 90) return { classification: 'MIXED', pct };
  return { classification: 'POOR', pct };
}

export function loadAuthoritativeBdl2025GameInventory(
  cachePath = LINEUPS_2025_CACHE_PATH
): AuthoritativeLineups2025Inventory {
  const raw = JSON.parse(readFileSync(cachePath, 'utf8')) as {
    count?: number;
    games?: Array<{
      id?: number | string;
      date?: string | null;
      postseason?: boolean;
      datetime?: string | null;
    }>;
  };
  const games: Bdl2025InventoryGame[] = (raw.games ?? []).map((g) => ({
    id: String(g.id),
    date: g.date ?? null,
    postseason: g.postseason === true,
    datetime: g.datetime ?? null,
  }));
  const gameIds = games.map((g) => g.id);
  const unique = new Set(gameIds);
  if (unique.has(LINEUPS_2025_LOCAL_ONLY_ID)) {
    throw new Error(
      `Safety stop: cached BDL inventory includes local-only ${LINEUPS_2025_LOCAL_ONLY_ID}`
    );
  }
  if (gameIds.length !== LINEUPS_2025_EXPECTED_TARGET) {
    throw new Error(
      `Safety stop: cached BDL 2025 inventory has ${gameIds.length} games, expected ${LINEUPS_2025_EXPECTED_TARGET}`
    );
  }
  if (unique.size !== gameIds.length) {
    throw new Error('Safety stop: cached BDL 2025 inventory has duplicate game ids');
  }
  const dates = games.map((g) => g.date).filter((d): d is string => !!d).sort();
  return {
    cachePath,
    gameIds,
    games,
    regularSeason: games.filter((g) => !g.postseason).length,
    postseason: games.filter((g) => g.postseason).length,
    dateMin: dates[0] ?? null,
    dateMax: dates[dates.length - 1] ?? null,
  };
}

export function planLineups2025Archive(gameIds: string[]): TrialArchivePlan {
  const prefix = lineups2025CanonicalPrefix();
  const newRequests = Math.max(0, gameIds.length);
  return {
    kind: 'lineups_2025',
    dryRun: true,
    season: 2025,
    endpoint: `${LINEUPS_PATH}?game_ids[]=<id>`,
    s3Prefix: prefix,
    pagination: 'one game_id per request via BdlArchiveClient + LINEUPS_PATH',
    skipExisting: true,
    postgresMaterialize: false,
    estimatedRequests: newRequests,
    notes: [
      `Authoritative target is cached BDL 2025 inventory (${LINEUPS_2025_EXPECTED_TARGET}), excluding ${LINEUPS_2025_LOCAL_ONLY_ID}.`,
      'Reuse valid Step 8A characterization objects; do not refetch them.',
      'Raw archive only; no Postgres lineup table.',
      'Requires BDL_TRIAL_MODE=1 and acquisition lock on --execute.',
      LINEUPS_2025_AVAILABILITY_LIMITATION,
    ],
  };
}

export function planLineups2025ArchiveFromArgv(argv: string[], gameIds: string[]): TrialArchivePlan {
  const { dryRun } = parseExecuteFlag(argv);
  return { ...planLineups2025Archive(gameIds), dryRun };
}
