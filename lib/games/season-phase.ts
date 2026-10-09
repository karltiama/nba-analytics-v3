/**
 * Season-phase classification for /v1/games observations (DATA1 §8.4).
 *
 * Precedence (first match wins):
 *   0. ist_stage naming the NBA Cup championship → UNCLASSIFIED for every request. The final does
 *      not count toward the regular season and has no serving phase.
 *   1. Explicit request season_type (highest confidence). Exception: a `regular` request whose
 *      row has a non-null ist_stage is IST (NBA Cup games are a labelled subset of the regular season).
 *   2. Provider ist_stage non-null → IST.
 *   3. Provider postseason=true without an explicit request → UNCLASSIFIED
 *      (PLAYOFFS vs PLAYIN cannot be told apart from the flag alone).
 *   4. Otherwise UNCLASSIFIED. An unparameterized response is never assumed REGULAR.
 */

import { isNbaCupChampionshipStage } from './season-eligibility';

export const SEASON_PHASES = ['PRESEASON', 'REGULAR', 'IST', 'PLAYIN', 'PLAYOFFS', 'UNCLASSIFIED'] as const;
export type SeasonPhase = (typeof SEASON_PHASES)[number];

export const SEASON_PHASE_SOURCES = [
  'request_season_type',
  'provider_ist_stage',
  'provider_postseason_flag',
  'none',
] as const;
export type SeasonPhaseSource = (typeof SEASON_PHASE_SOURCES)[number];

export type SeasonPhaseClassification = {
  phase: SeasonPhase;
  source: SeasonPhaseSource;
};

/** Provider season_type request values (sent verbatim) → phase. */
export const REQUEST_SEASON_TYPE_TO_PHASE: Readonly<Record<string, SeasonPhase>> = {
  preseason: 'PRESEASON',
  regular: 'REGULAR',
  ist: 'IST',
  playin: 'PLAYIN',
  playoffs: 'PLAYOFFS',
};

export type SeasonPhaseGameFields = {
  ist_stage?: unknown;
  postseason?: unknown;
};

export function classifySeasonPhase(input: {
  requestSeasonType?: string | null;
  game?: SeasonPhaseGameFields | null;
}): SeasonPhaseClassification {
  const requested = (input.requestSeasonType ?? '').trim().toLowerCase();
  const fromRequest = requested ? REQUEST_SEASON_TYPE_TO_PHASE[requested] : undefined;
  const ist = input.game?.ist_stage;
  if (isNbaCupChampionshipStage(ist)) return { phase: 'UNCLASSIFIED', source: 'provider_ist_stage' };
  const hasIstStage = ist != null && !(typeof ist === 'string' && ist.trim() === '');
  if (fromRequest === 'REGULAR' && hasIstStage) return { phase: 'IST', source: 'provider_ist_stage' };
  if (fromRequest) return { phase: fromRequest, source: 'request_season_type' };

  if (hasIstStage) {
    return { phase: 'IST', source: 'provider_ist_stage' };
  }
  if (input.game?.postseason === true) {
    return { phase: 'UNCLASSIFIED', source: 'provider_postseason_flag' };
  }
  return { phase: 'UNCLASSIFIED', source: 'none' };
}

/** Request-scoped classifications outrank provider-field ones; UNCLASSIFIED never replaces a phase. */
export function strongerSeasonPhase(
  a: SeasonPhaseClassification,
  b: SeasonPhaseClassification
): SeasonPhaseClassification {
  if (a.phase === 'UNCLASSIFIED') return b.phase === 'UNCLASSIFIED' ? a : b;
  if (b.phase === 'UNCLASSIFIED') return a;
  if (a.source !== 'request_season_type' && b.source === 'request_season_type') return b;
  return a;
}
