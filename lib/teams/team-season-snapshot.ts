/**
 * Pure helpers for current-season team snapshot (Phase 2.T.3D).
 *
 * Semantics: analytics.team_season_averages is aggregated from ALL
 * analytics.team_game_stats rows for (team, season) — no regular/postseason
 * split. GP > 82 means postseason games are included. Never label as
 * "regular-season record" without qualification.
 */

import { assertAnalyticsSeason } from '@/lib/teams/team-roster-presentation';
import type { TeamSeasonAverages } from '@/lib/teams/types';

export const TEAM_SEASON_SNAPSHOT_SQL = `
  SELECT team_id, season, games_played,
         wins, losses,
         avg_points,
         avg_offensive_rating, avg_defensive_rating, avg_pace
  FROM analytics.team_season_averages
  WHERE team_id = $1
    AND season = $2
  LIMIT 1
`;

export type SampleSizeBand = 'none' | 'very_small' | 'early' | 'normal';

export type TeamSeasonSnapshot = {
  season: string;
  /** Always season-scoped; never falls back to another season. */
  hasData: boolean;
  gamesPlayed: number;
  wins: number | null;
  losses: number | null;
  ppg: number | null;
  ortg: number | null;
  drtg: number | null;
  /** ORTG − DRTG when both present; otherwise null. */
  netRating: number | null;
  pace: number | null;
  sampleBand: SampleSizeBand;
  sampleLabel: string | null;
  /**
   * Honest scope: TSA mixes all logged games for the season.
   * When GP > 82, postseason is included.
   */
  metricsScope: 'all_games';
  includesPostseason: boolean;
  scopeNote: string | null;
};

export function assertSnapshotSeason(season: string): string {
  assertAnalyticsSeason(season);
  return season;
}

export function deriveNetRating(
  ortg: number | null | undefined,
  drtg: number | null | undefined
): number | null {
  if (ortg == null || drtg == null) return null;
  if (Number.isNaN(ortg) || Number.isNaN(drtg)) return null;
  return ortg - drtg;
}

export function sampleSizeBand(gamesPlayed: number): SampleSizeBand {
  if (!Number.isFinite(gamesPlayed) || gamesPlayed <= 0) return 'none';
  if (gamesPlayed <= 4) return 'very_small';
  if (gamesPlayed <= 9) return 'early';
  return 'normal';
}

export function sampleSizeLabel(gamesPlayed: number): string | null {
  const band = sampleSizeBand(gamesPlayed);
  if (band === 'none') return null;
  if (band === 'very_small') return `Very small sample · ${gamesPlayed} GP`;
  if (band === 'early') return `Early season · ${gamesPlayed} GP`;
  return null;
}

export function scopeNoteForGamesPlayed(gamesPlayed: number): string | null {
  if (gamesPlayed > 82) return 'Includes postseason';
  return null;
}

export function emptyTeamSeasonSnapshot(season: string): TeamSeasonSnapshot {
  return {
    season,
    hasData: false,
    gamesPlayed: 0,
    wins: null,
    losses: null,
    ppg: null,
    ortg: null,
    drtg: null,
    netRating: null,
    pace: null,
    sampleBand: 'none',
    sampleLabel: null,
    metricsScope: 'all_games',
    includesPostseason: false,
    scopeNote: null,
  };
}

export function mapTeamSeasonSnapshot(
  season: string,
  row: TeamSeasonAverages | null | undefined
): TeamSeasonSnapshot {
  if (!row || row.season !== season) {
    // Fail closed: wrong-season or missing row → empty for requested season.
    return emptyTeamSeasonSnapshot(season);
  }

  const gamesPlayed = Number(row.games_played) || 0;
  if (gamesPlayed <= 0) {
    return emptyTeamSeasonSnapshot(season);
  }

  const ortg =
    row.avg_offensive_rating != null ? Number(row.avg_offensive_rating) : null;
  const drtg =
    row.avg_defensive_rating != null ? Number(row.avg_defensive_rating) : null;

  return {
    season,
    hasData: true,
    gamesPlayed,
    wins: row.wins != null ? Number(row.wins) : null,
    losses: row.losses != null ? Number(row.losses) : null,
    ppg: row.avg_points != null ? Number(row.avg_points) : null,
    ortg,
    drtg,
    netRating: deriveNetRating(ortg, drtg),
    pace: row.avg_pace != null ? Number(row.avg_pace) : null,
    sampleBand: sampleSizeBand(gamesPlayed),
    sampleLabel: sampleSizeLabel(gamesPlayed),
    metricsScope: 'all_games',
    includesPostseason: gamesPlayed > 82,
    scopeNote: scopeNoteForGamesPlayed(gamesPlayed),
  };
}

export function formatNetRating(net: number | null): string {
  if (net == null || Number.isNaN(net)) return '—';
  const rounded = Math.round(net * 10) / 10;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(1)}`;
}

export function formatMetric(value: number | null, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}
