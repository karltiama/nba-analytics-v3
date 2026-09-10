/**
 * Certified targeted Season Averages archive → compact player-season Role Profile (Step 12F).
 * Read-only S3 pages. Selected fields only. IDs, never names.
 * Duplicate player+season+category with conflicting values is a hard fail.
 */

import {
  PLAYER_ROLE_PROFILE_SEASONS,
  PLAYER_ROLE_PROFILE_SOURCE,
  emptyPlayerRoleProfile,
  type HistoricalPlayerRoleProfile,
} from '@/lib/betting/historical-role-profile';
import {
  PLAYER_SEASON_AVERAGES_CANONICAL_PREFIX,
  TARGETED_PLAYER_ALLOWLIST,
} from '@/lib/archive/season-averages';

export { PLAYER_ROLE_PROFILE_SEASONS, PLAYER_ROLE_PROFILE_SOURCE, TARGETED_PLAYER_ALLOWLIST };

export const APPROVED_ROLE_CATEGORIES = [
  'isolation',
  'prballhandler',
  'prrollman',
  'drives',
  'passing',
  'by_zone',
] as const;

export type ApprovedRoleCategory = (typeof APPROVED_ROLE_CATEGORIES)[number];

export const EXCLUDED_ROLE_CATEGORIES = [
  'spotup',
  'transition',
  'catchshoot',
  'pullupshot',
  'hustle',
  'clutch',
  'defense',
  'advanced',
  'overall',
] as const;

type Json = Record<string, unknown>;

export type RoleProfileMetrics = Omit<HistoricalPlayerRoleProfile, 'season'>;

export type PlayerRoleProfileCandidate = {
  playerId: string;
  season: string;
  source: string;
  metrics: RoleProfileMetrics;
};

export type RoleGrainReport = {
  archiveRows: number;
  validCategoryRows: number;
  skippedUnsupportedSeason: number;
  skippedUnsupportedCategory: number;
  skippedNullIdentity: number;
  skippedNullStats: number;
  skippedSeasonMismatch: number;
  duplicateIdentical: number;
  uniquePlayers: number;
};

export type RoleIdentityAudit = {
  mapped: number;
  unmappedPlayers: number;
  unsupportedSeason: number;
  unmappedPlayerSamples: string[];
};

export class DuplicateRoleCategoryError extends Error {
  readonly keys: string[];
  constructor(keys: string[]) {
    super(`Conflicting Role Profile category duplicates: ${keys.slice(0, 8).join(', ')}`);
    this.name = 'DuplicateRoleCategoryError';
    this.keys = keys;
  }
}

export class RoleProfileIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleProfileIdentityError';
  }
}

export function roleProfileKey(playerId: string, season: string): string {
  return `${playerId}|${season}`;
}

export function categoryKey(playerId: string, season: string, category: string): string {
  return `${playerId}|${season}|${category}`;
}

export function emptyRoleGrainReport(): RoleGrainReport {
  return {
    archiveRows: 0,
    validCategoryRows: 0,
    skippedUnsupportedSeason: 0,
    skippedUnsupportedCategory: 0,
    skippedNullIdentity: 0,
    skippedNullStats: 0,
    skippedSeasonMismatch: 0,
    duplicateIdentical: 0,
    uniquePlayers: 0,
  };
}

export function emptyRoleMetrics(): RoleProfileMetrics {
  const empty = emptyPlayerRoleProfile();
  const { season: _season, ...metrics } = empty;
  return metrics;
}

export function isApprovedRoleCategory(value: string): value is ApprovedRoleCategory {
  return (APPROVED_ROLE_CATEGORIES as readonly string[]).includes(value);
}

export function isRoleProfileArchivePageKey(key: string): boolean {
  if (!key.startsWith(`${PLAYER_SEASON_AVERAGES_CANONICAL_PREFIX}/`)) return false;
  if (key.includes('team_season_averages')) return false;
  if (!key.endsWith('.json')) return false;
  if (key.includes('_manifest') || key.includes('_run') || key.includes('_characterization')) {
    return false;
  }
  return key.includes('/page=');
}

export function parseRoleArchivePageKey(key: string): {
  season: string | null;
  category: string | null;
  type: string | null;
} {
  const season = key.match(/\/season=(\d{4})\//)?.[1] ?? null;
  const category = key.match(/\/category=([^/]+)\//)?.[1] ?? null;
  const type = key.match(/\/type=([^/]+)\//)?.[1] ?? null;
  return { season, category, type };
}

export function extractSeasonAverageRows(body: unknown): Json[] {
  if (!body) return [];
  if (Array.isArray(body)) return body as Json[];
  if (typeof body !== 'object') return [];
  const obj = body as Json;
  if (Array.isArray(obj.data)) return obj.data as Json[];
  const nested = obj.body;
  if (nested && typeof nested === 'object' && !Array.isArray(nested) && Array.isArray((nested as Json).data)) {
    return (nested as Json).data as Json[];
  }
  if (Array.isArray(obj.pages)) {
    const rows: Json[] = [];
    for (const page of obj.pages as unknown[]) {
      if (Array.isArray(page)) rows.push(...(page as Json[]));
      else if (page && typeof page === 'object' && Array.isArray((page as Json).data)) {
        rows.push(...((page as Json).data as Json[]));
      }
    }
    return rows;
  }
  return [];
}

function sid(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'object') {
    const id = (v as Json).id;
    if (id == null) return null;
    const s = String(id).trim();
    return s.length ? s : null;
  }
  const s = String(v).trim();
  return s.length ? s : null;
}

function finiteOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function statsObject(row: Json): Json | null {
  const stats = row.stats;
  if (stats && typeof stats === 'object' && !Array.isArray(stats)) return stats as Json;
  return null;
}

function playerIdFromRow(row: Json): string | null {
  return sid(row.player) ?? sid(row.player_id);
}

function seasonFromRow(row: Json): string | null {
  if (row.season == null || row.season === '') return null;
  const s = String(row.season).trim();
  return s.length ? s : null;
}

export const ZONE_ARCHIVE_FIELDS = {
  restrictedAreaFga: 'restricted_area_fga',
  restrictedAreaFgPct: 'restricted_area_fg_pct',
  paintNonRaFga: 'in_the_paint_(non-ra)_fga',
  paintNonRaFgPct: 'in_the_paint_(non-ra)_fg_pct',
  midrangeFga: 'mid-range_fga',
  midrangeFgPct: 'mid-range_fg_pct',
  cornerThreeFga: 'corner_3_fga',
  cornerThreeFgPct: 'corner_3_fg_pct',
  aboveBreakThreeFga: 'above_the_break_3_fga',
  aboveBreakThreeFgPct: 'above_the_break_3_fg_pct',
} as const;

export function selectedFieldsFromStats(
  type: ApprovedRoleCategory,
  stats: Json
): Partial<RoleProfileMetrics> {
  if (type === 'isolation') {
    return {
      isolationPossPct: finiteOrNull(stats.poss_pct),
      isolationPpp: finiteOrNull(stats.ppp),
    };
  }
  if (type === 'prballhandler') {
    return {
      pnrBallHandlerPossPct: finiteOrNull(stats.poss_pct),
      pnrBallHandlerPpp: finiteOrNull(stats.ppp),
    };
  }
  if (type === 'prrollman') {
    return {
      pnrRollManPossPct: finiteOrNull(stats.poss_pct),
      pnrRollManPpp: finiteOrNull(stats.ppp),
    };
  }
  if (type === 'drives') {
    return {
      drivesPerGame: finiteOrNull(stats.drives),
      drivePointsPerGame: finiteOrNull(stats.drive_pts),
    };
  }
  if (type === 'passing') {
    return {
      passesPerGame: finiteOrNull(stats.passes_made),
      potentialAssistsPerGame: finiteOrNull(stats.potential_ast),
    };
  }
  return {
    restrictedAreaFga: finiteOrNull(stats[ZONE_ARCHIVE_FIELDS.restrictedAreaFga]),
    restrictedAreaFgPct: finiteOrNull(stats[ZONE_ARCHIVE_FIELDS.restrictedAreaFgPct]),
    paintNonRaFga: finiteOrNull(stats[ZONE_ARCHIVE_FIELDS.paintNonRaFga]),
    paintNonRaFgPct: finiteOrNull(stats[ZONE_ARCHIVE_FIELDS.paintNonRaFgPct]),
    midrangeFga: finiteOrNull(stats[ZONE_ARCHIVE_FIELDS.midrangeFga]),
    midrangeFgPct: finiteOrNull(stats[ZONE_ARCHIVE_FIELDS.midrangeFgPct]),
    cornerThreeFga: finiteOrNull(stats[ZONE_ARCHIVE_FIELDS.cornerThreeFga]),
    cornerThreeFgPct: finiteOrNull(stats[ZONE_ARCHIVE_FIELDS.cornerThreeFgPct]),
    aboveBreakThreeFga: finiteOrNull(stats[ZONE_ARCHIVE_FIELDS.aboveBreakThreeFga]),
    aboveBreakThreeFgPct: finiteOrNull(stats[ZONE_ARCHIVE_FIELDS.aboveBreakThreeFgPct]),
  };
}

export function fingerprintCategoryFields(
  type: ApprovedRoleCategory,
  patch: Partial<RoleProfileMetrics>
): string {
  return JSON.stringify(patch);
}

export function mergeRoleMetrics(
  current: RoleProfileMetrics,
  patch: Partial<RoleProfileMetrics>
): RoleProfileMetrics {
  return { ...current, ...patch };
}

export function hasAnyRoleCategory(metrics: RoleProfileMetrics): boolean {
  return Object.values(metrics).some((value) => value != null);
}

export type RoleIngestState = {
  byKey: Map<string, PlayerRoleProfileCandidate>;
  fingerprints: Map<string, string>;
  grain: RoleGrainReport;
};

export function createRoleIngestState(): RoleIngestState {
  return {
    byKey: new Map(),
    fingerprints: new Map(),
    grain: emptyRoleGrainReport(),
  };
}

export function ingestSeasonAverageRow(args: {
  row: Json;
  archiveSeason: string;
  type: string;
  state: RoleIngestState;
}): void {
  const { row, archiveSeason, type, state } = args;
  state.grain.archiveRows += 1;

  if (!PLAYER_ROLE_PROFILE_SEASONS.includes(archiveSeason as (typeof PLAYER_ROLE_PROFILE_SEASONS)[number])) {
    state.grain.skippedUnsupportedSeason += 1;
    return;
  }
  if (!isApprovedRoleCategory(type)) {
    state.grain.skippedUnsupportedCategory += 1;
    return;
  }

  const playerId = playerIdFromRow(row);
  if (!playerId) {
    state.grain.skippedNullIdentity += 1;
    return;
  }
  const stats = statsObject(row);
  if (!stats) {
    state.grain.skippedNullStats += 1;
    return;
  }
  const rowSeason = seasonFromRow(row);
  if (rowSeason && rowSeason !== archiveSeason) {
    state.grain.skippedSeasonMismatch += 1;
    return;
  }

  const patch = selectedFieldsFromStats(type, stats);
  const fp = fingerprintCategoryFields(type, patch);
  const catKey = categoryKey(playerId, archiveSeason, type);
  const priorFp = state.fingerprints.get(catKey);
  if (priorFp) {
    if (priorFp !== fp) {
      throw new DuplicateRoleCategoryError([catKey]);
    }
    state.grain.duplicateIdentical += 1;
    return;
  }
  state.fingerprints.set(catKey, fp);

  const key = roleProfileKey(playerId, archiveSeason);
  const existing = state.byKey.get(key);
  if (existing) {
    existing.metrics = mergeRoleMetrics(existing.metrics, patch);
  } else {
    state.byKey.set(key, {
      playerId,
      season: archiveSeason,
      source: PLAYER_ROLE_PROFILE_SOURCE,
      metrics: mergeRoleMetrics(emptyRoleMetrics(), patch),
    });
  }
  state.grain.validCategoryRows += 1;
}

export function finalizeRoleCandidates(state: RoleIngestState): PlayerRoleProfileCandidate[] {
  const rows = [...state.byKey.values()].filter((row) => hasAnyRoleCategory(row.metrics));
  state.grain.uniquePlayers = new Set(rows.map((r) => r.playerId)).size;
  rows.sort((a, b) => {
    if (a.season !== b.season) return a.season.localeCompare(b.season);
    const na = Number(a.playerId);
    const nb = Number(b.playerId);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.playerId.localeCompare(b.playerId);
  });
  return rows;
}

export function auditRoleIdentity(args: {
  candidates: PlayerRoleProfileCandidate[];
  playerIds: ReadonlySet<string>;
}): { candidates: PlayerRoleProfileCandidate[]; audit: RoleIdentityAudit } {
  const mapped: PlayerRoleProfileCandidate[] = [];
  const unmappedPlayerSamples: string[] = [];
  let unmappedPlayers = 0;
  let unsupportedSeason = 0;
  for (const row of args.candidates) {
    if (!PLAYER_ROLE_PROFILE_SEASONS.includes(row.season as (typeof PLAYER_ROLE_PROFILE_SEASONS)[number])) {
      unsupportedSeason += 1;
      continue;
    }
    if (!args.playerIds.has(row.playerId)) {
      unmappedPlayers += 1;
      if (unmappedPlayerSamples.length < 12) {
        unmappedPlayerSamples.push(roleProfileKey(row.playerId, row.season));
      }
      continue;
    }
    mapped.push(row);
  }
  return {
    candidates: mapped,
    audit: {
      mapped: mapped.length,
      unmappedPlayers,
      unsupportedSeason,
      unmappedPlayerSamples,
    },
  };
}

export function assertNoConflictingDuplicates(state: RoleIngestState): void {
  void state;
}

export function coverageFlags(metrics: RoleProfileMetrics): {
  isolation: boolean;
  pnrBallHandler: boolean;
  pnrRollMan: boolean;
  drives: boolean;
  passing: boolean;
  zone: boolean;
} {
  return {
    isolation: metrics.isolationPossPct != null || metrics.isolationPpp != null,
    pnrBallHandler: metrics.pnrBallHandlerPossPct != null || metrics.pnrBallHandlerPpp != null,
    pnrRollMan: metrics.pnrRollManPossPct != null || metrics.pnrRollManPpp != null,
    drives: metrics.drivesPerGame != null || metrics.drivePointsPerGame != null,
    passing: metrics.passesPerGame != null || metrics.potentialAssistsPerGame != null,
    zone:
      metrics.restrictedAreaFga != null ||
      metrics.paintNonRaFga != null ||
      metrics.midrangeFga != null ||
      metrics.cornerThreeFga != null ||
      metrics.aboveBreakThreeFga != null,
  };
}

/** Conservative: never emit a primary-role archetype from three incomplete playtypes. */
export function derivePrimaryRoleLabel(_metrics: RoleProfileMetrics): null {
  return null;
}
