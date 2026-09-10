/**
 * Historical Final-game contract helpers (Step 12B).
 * Status is authoritative — do not infer Final from date alone.
 * Availability flags mean product-module-ready, not “archive exists on S3”.
 */

import type { HistoricalPlayerAdvanced } from '@/lib/betting/historical-advanced';
import type { HistoricalPlayerRoleProfile } from '@/lib/betting/historical-role-profile';
import { isFinalStatus } from '@/lib/betting/normalize-game-status';

export const HISTORICAL_VIEW_MODE_FINAL = 'final' as const;
export const HISTORICAL_VIEW_MODE_LIVE = 'live' as const;

export type HistoricalViewMode =
  | typeof HISTORICAL_VIEW_MODE_FINAL
  | typeof HISTORICAL_VIEW_MODE_LIVE;

export type HistoricalModuleAvailability = {
  starters: boolean;
  advanced: boolean;
  roleProfile: boolean;
  timeline: boolean;
  rotationContext: boolean;
};

export type HistoricalBoxPlayer = {
  playerId: string;
  playerName: string;
  teamId: string;
  minutes: string | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  /** Present on the details contract for 12E. Null when this box player has no serving row. */
  advanced?: HistoricalPlayerAdvanced | null;
  /** Season Role Profile for the game's season. Null when this box player has no serving row. */
  roleProfile?: HistoricalPlayerRoleProfile | null;
};

export type HistoricalBoxScore = {
  available: boolean;
  home: HistoricalBoxPlayer[];
  away: HistoricalBoxPlayer[];
};

export type HistoricalBoxLogRow = {
  player_id: unknown;
  player_name?: unknown;
  team_id: unknown;
  minutes?: unknown;
  points?: unknown;
  rebounds?: unknown;
  assists?: unknown;
  steals?: unknown;
  blocks?: unknown;
};

/** Product Final research mode from authoritative game status (not calendar date). */
export function isHistoricalFinalView(status: string | null | undefined): boolean {
  return isFinalStatus(status);
}

/** Client/server: skip live matchup-analysis / BDL lineup fetches when details already resolved Final. */
export function shouldFetchLiveMatchupAnalysis(
  viewMode: string | null | undefined
): boolean {
  return viewMode !== HISTORICAL_VIEW_MODE_FINAL;
}

/** Default: later modules are not product-ready. Flags become true only from certified serving. */
export function historicalModuleAvailability(
  starters = false,
  advanced = false,
  roleProfile = false,
  timeline = false,
  rotationContext = false
): HistoricalModuleAvailability {
  return {
    starters,
    advanced,
    roleProfile,
    timeline,
    rotationContext,
  };
}

/**
 * Enrich box-score players with Advanced serving rows.
 * Advanced-only identities (no PGL) are not added as box rows.
 */
export function attachAdvancedToBox(
  box: HistoricalBoxScore,
  byPlayerId: ReadonlyMap<string, HistoricalPlayerAdvanced>
): HistoricalBoxScore {
  const enrich = (player: HistoricalBoxPlayer): HistoricalBoxPlayer => ({
    ...player,
    advanced: byPlayerId.get(player.playerId) ?? null,
  });
  return {
    available: box.available,
    home: box.home.map(enrich),
    away: box.away.map(enrich),
  };
}

/**
 * Enrich box-score players with season Role Profile rows for the game season.
 * Does not add players who are not already in the box.
 */
export function attachRoleProfileToBox(
  box: HistoricalBoxScore,
  byPlayerId: ReadonlyMap<string, HistoricalPlayerRoleProfile>
): HistoricalBoxScore {
  const enrich = (player: HistoricalBoxPlayer): HistoricalBoxPlayer => ({
    ...player,
    roleProfile: byPlayerId.get(player.playerId) ?? null,
  });
  return {
    available: box.available,
    home: box.home.map(enrich),
    away: box.away.map(enrich),
  };
}

function numOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function mapBoxLogRow(row: HistoricalBoxLogRow): HistoricalBoxPlayer {
  const minutesRaw = row.minutes;
  const minutes =
    minutesRaw == null || String(minutesRaw).trim() === '' ? null : String(minutesRaw);
  return {
    playerId: String(row.player_id ?? ''),
    playerName: String(row.player_name ?? ''),
    teamId: String(row.team_id ?? ''),
    minutes,
    points: numOrNull(row.points),
    rebounds: numOrNull(row.rebounds),
    assists: numOrNull(row.assists),
    steals: numOrNull(row.steals),
    blocks: numOrNull(row.blocks),
  };
}

/**
 * Group logs by the game's home/away team IDs (game-night team, not current roster).
 * Rows whose team_id matches neither side are dropped — never reassigned.
 */
export function groupBoxScoreByTeam(
  rows: HistoricalBoxLogRow[],
  homeTeamId: string,
  awayTeamId: string
): HistoricalBoxScore {
  const home: HistoricalBoxPlayer[] = [];
  const away: HistoricalBoxPlayer[] = [];
  for (const row of rows) {
    const mapped = mapBoxLogRow(row);
    if (!mapped.playerId) continue;
    if (mapped.teamId === homeTeamId) home.push(mapped);
    else if (mapped.teamId === awayTeamId) away.push(mapped);
  }
  return {
    available: home.length + away.length > 0,
    home,
    away,
  };
}

/** Sticky nav for historical Finals. Starting Five lives in Overview, not as its own pill. */
export type HistoricalFinalNavId =
  | 'section-box'
  | 'section-context'
  | 'section-timeline'
  | 'section-odds';

export function historicalFinalNavIds(input: {
  roleProfile: boolean;
  timeline: boolean;
  storedOdds: boolean;
}): HistoricalFinalNavId[] {
  const ids: HistoricalFinalNavId[] = ['section-box'];
  if (input.roleProfile) ids.push('section-context');
  if (input.timeline) ids.push('section-timeline');
  if (input.storedOdds) ids.push('section-odds');
  return ids;
}

/**
 * Present-only coverage labels. Do not list absent 2023/2024 modules as errors.
 * Order matches page hierarchy: Overview starters, then Players, Context, Timeline.
 */
export function historicalCoverageLabels(input: {
  boxAvailable: boolean;
  startersAvailable: boolean;
  advancedAvailable: boolean;
  roleProfileAvailable: boolean;
  timelineAvailable: boolean;
}): string[] {
  const labels: string[] = [];
  if (input.startersAvailable) labels.push('Starting Five');
  if (input.boxAvailable) labels.push('Box');
  if (input.advancedAvailable) labels.push('Advanced');
  if (input.roleProfileAvailable) labels.push('Season Role');
  if (input.timelineAvailable) labels.push('Timeline');
  return labels;
}

export function formatHistoricalCoverageLine(labels: string[]): string {
  if (labels.length === 0) return 'Completed game';
  return `Completed game · ${labels.join(' · ')}`;
}
