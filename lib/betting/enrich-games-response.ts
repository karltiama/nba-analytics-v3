/**
 * Pure helpers for betting games API enrichment (nullable odds / team analytics).
 */

import type { GameOdds } from '@/lib/betting/queries';
import { normalizeGameStatus, type NormalizedGameStatus } from '@/lib/betting/normalize-game-status';

export type NullableOddsSide = {
  moneyline: number | null;
  spread: number | null;
  spreadOdds: number | null;
};

export type NullableGameOddsPayload = {
  home: NullableOddsSide;
  away: NullableOddsSide;
  overUnder: number | null;
  overOdds: number | null;
  underOdds: number | null;
  bookmaker: string | null;
};

export type TeamRatingsLike = {
  wins?: number;
  losses?: number;
  offensive_rating?: number;
  defensive_rating?: number;
  pace?: number;
  avg_points?: number;
};

export type EnrichedTeamSide = {
  id: string;
  name: string;
  abbreviation: string;
  /** null when no active-season ratings row */
  record: string | null;
  offensiveRating: number | null;
  defensiveRating: number | null;
  defensiveRank: number | null;
  pace: number | null;
  avgPoints: number | null;
  recentForm: unknown[];
  /** True when active-season team_season_averages row was present. */
  hasSeasonAnalytics: boolean;
};

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Pass through market fields; never fabricate 0 / -110. */
export function toNullableGameOdds(gameOdds: GameOdds | null | undefined): NullableGameOddsPayload {
  const empty: NullableGameOddsPayload = {
    home: { moneyline: null, spread: null, spreadOdds: null },
    away: { moneyline: null, spread: null, spreadOdds: null },
    overUnder: null,
    overOdds: null,
    underOdds: null,
    bookmaker: null,
  };
  if (!gameOdds) return empty;
  return {
    home: {
      moneyline: numOrNull(gameOdds.home?.moneyline),
      spread: numOrNull(gameOdds.home?.spread),
      spreadOdds: numOrNull(gameOdds.home?.spreadOdds),
    },
    away: {
      moneyline: numOrNull(gameOdds.away?.moneyline),
      spread: numOrNull(gameOdds.away?.spread),
      spreadOdds: numOrNull(gameOdds.away?.spreadOdds),
    },
    overUnder: numOrNull(gameOdds.overUnder),
    overOdds: numOrNull(gameOdds.overOdds),
    underOdds: numOrNull(gameOdds.underOdds),
    bookmaker: gameOdds.bookmaker ?? null,
  };
}

export function hasAnyMarket(odds: NullableGameOddsPayload): boolean {
  return (
    odds.home.moneyline != null ||
    odds.away.moneyline != null ||
    odds.home.spread != null ||
    odds.away.spread != null ||
    odds.overUnder != null
  );
}

export function buildEnrichedTeamSide(input: {
  id: string;
  name: string;
  abbreviation: string;
  ratings: TeamRatingsLike | undefined;
  defensiveRank: number | undefined;
  recentForm: unknown[];
}): EnrichedTeamSide {
  const r = input.ratings;
  const has =
    r != null &&
    (r.wins != null ||
      r.losses != null ||
      r.offensive_rating != null ||
      r.defensive_rating != null ||
      r.pace != null ||
      r.avg_points != null);

  if (!has) {
    return {
      id: input.id,
      name: input.name,
      abbreviation: input.abbreviation,
      record: null,
      offensiveRating: null,
      defensiveRating: null,
      defensiveRank: null,
      pace: null,
      avgPoints: null,
      recentForm: input.recentForm,
      hasSeasonAnalytics: false,
    };
  }

  const wins = r!.wins ?? 0;
  const losses = r!.losses ?? 0;

  return {
    id: input.id,
    name: input.name,
    abbreviation: input.abbreviation,
    record: `${wins}-${losses}`,
    offensiveRating: numOrNull(r!.offensive_rating),
    defensiveRating: numOrNull(r!.defensive_rating),
    defensiveRank: input.defensiveRank != null && input.defensiveRank > 0 ? input.defensiveRank : null,
    pace: numOrNull(r!.pace),
    avgPoints: numOrNull(r!.avg_points),
    recentForm: input.recentForm,
    hasSeasonAnalytics: true,
  };
}

export function enrichGameStatus(raw: string | null | undefined): {
  status: NormalizedGameStatus;
  statusRaw: string | null;
} {
  return {
    status: normalizeGameStatus(raw),
    statusRaw: raw == null ? null : String(raw),
  };
}
