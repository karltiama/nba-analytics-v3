/**
 * Pure eligibility for the research Matchup overview.
 * The 2025–26 regular season is a completed baseline. A game on an earlier
 * Eastern date must not receive that full-season sample.
 */

import type { GameLifecycleState } from '@/lib/betting/normalize-game-status';
import { POSTSEASON_START_ET } from '@/lib/games/season-eligibility';
import type { HistoricalContributor } from './aggregate';
import type { ComparisonRow, PregameMatchupModel } from './compose';
import type { RosterPresentation } from './roster';
import type { MatchupInsight } from './signals';
import { HISTORICAL_SEASON } from './window';

const EASTERN_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** First Eastern date that is outside the 2025–26 regular-season sample. */
export const RESEARCH_OVERVIEW_BASELINE_COMPLETE_ET = POSTSEASON_START_ET[HISTORICAL_SEASON];

export type ResearchHistoricalOverview = {
  awayAbbr: string;
  homeAbbr: string;
  history: { label: string; possessionNote: string; rows: ComparisonRow[] } | null;
  historyNote: string | null;
  insights: MatchupInsight[];
  contributors: { label: string; away: HistoricalContributor[]; home: HistoricalContributor[] } | null;
  roster: RosterPresentation;
};

export type ResearchOverviewTemporalDecision =
  | { eligible: true; gameEtDate: string }
  | { eligible: false; reason: 'missing_date' | 'baseline_unknown' | 'during_or_before_baseline' };

export function etCalendarDate(value: Date): string | null {
  if (Number.isNaN(value.getTime())) return null;
  const text = value.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return EASTERN_DATE.test(text) ? text : null;
}

export function researchOverviewTemporalDecision(
  gameEtDate: string | null | undefined
): ResearchOverviewTemporalDecision {
  if (!gameEtDate || !EASTERN_DATE.test(gameEtDate)) return { eligible: false, reason: 'missing_date' };
  const floor = RESEARCH_OVERVIEW_BASELINE_COMPLETE_ET;
  if (!floor || !EASTERN_DATE.test(floor)) return { eligible: false, reason: 'baseline_unknown' };
  if (gameEtDate < floor) return { eligible: false, reason: 'during_or_before_baseline' };
  return { eligible: true, gameEtDate };
}

/** Scheduled and in-progress games can show labeled historical context. Final and unclear states cannot. */
export function researchOverviewAllowsLifecycle(state: GameLifecycleState): boolean {
  return state === 'scheduled' || state === 'live' || state === 'halftime' || state === 'overtime';
}

export function researchOverviewFromModel(
  model: Pick<
    PregameMatchupModel,
    'awayAbbr' | 'homeAbbr' | 'history' | 'historyNote' | 'insights' | 'contributors' | 'roster'
  >
): ResearchHistoricalOverview {
  return {
    awayAbbr: model.awayAbbr,
    homeAbbr: model.homeAbbr,
    history: model.history,
    historyNote: model.historyNote,
    insights: model.insights,
    contributors: model.contributors,
    roster: model.roster,
  };
}
