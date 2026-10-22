/**
 * Presentation for the matchup overview. Reads the existing pregame model only.
 * It does not rank, blend, or recompute ratings.
 *
 * V1 categories are historical and matchup_interaction.
 * A later phase can add current_season, recent_form, or roster without a new page.
 */

import type { ComparisonRow } from './compose';
import { SAMPLE_LABEL } from './compose';
import { formatRosterObservationLabel, type RosterPresentation, type TeamContinuity } from './roster';
import { ROSTER_LIMITATION, type MatchupInsight } from './signals';

export const COMPACT_COMPARISON_LABELS = [
  'Net rating',
  'Estimated possessions / game',
  'eFG%',
  '3PA rate',
] as const;

export const RATINGS_SCOPE =
  'Team ratings on this page are 2025–26 regular-season figures, not 2026–27 performance.';

/** V1 emits the first two. The others are reserved so a later window can use the same card. */
export type OverviewInsightCategory =
  | 'historical'
  | 'matchup_interaction'
  | 'current_season'
  | 'recent_form'
  | 'roster';

export type OverviewStory = {
  headline: string;
  lede: string;
  sampleLabel: string | null;
  caveat: string | null;
};

export type OverviewFinding = {
  id: MatchupInsight['id'];
  category: OverviewInsightCategory;
  title: string;
  evidence: string;
  summary: string;
  sampleLabel: string;
  destination: '#section-comparison';
};

export type OverviewPersonnelShare = {
  abbr: string;
  minutesShare: number | null;
  concentration: string | null;
};

export type OverviewPersonnel = {
  status: 'shown' | 'hidden';
  shares: OverviewPersonnelShare[];
  note: string;
};

export type MatchupOverviewPresentation = {
  story: OverviewStory;
  findings: OverviewFinding[];
  comparison: {
    available: boolean;
    label: string | null;
    possessionNote: string | null;
    rows: ComparisonRow[];
    emptyNote: string | null;
  };
  personnel: OverviewPersonnel;
};

export type MatchupOverviewSource = {
  awayAbbr: string;
  homeAbbr: string;
  history: { label: string; possessionNote: string; rows: ComparisonRow[] } | null;
  historyNote: string | null;
  insights: MatchupInsight[];
  roster: RosterPresentation;
};

const SIGNIFICANCE = /gap stands out|stylistic contrast|profiles differ|wide relative to other|not official NBA pace/;

/** Names the existing insight. It is not a new statistic and not the card headline. */
const INSIGHT_SUBJECT: Record<MatchupInsight['id'], string> = {
  efficiency: 'scoring versus defense',
  three_point_rate: 'three-point volume',
  offensive_rebounding: 'second-chance rebounding',
  turnover_rate: 'turnover rate',
  estimated_possessions: 'estimated possession count',
};

export function findingCategory(id: MatchupInsight['id']): OverviewInsightCategory {
  if (id === 'efficiency' || id === 'offensive_rebounding') return 'matchup_interaction';
  return 'historical';
}

function sentences(body: string): string[] {
  return body.split(/(?<=\.)\s+/).map((sentence) => sentence.trim()).filter(Boolean);
}

/** One interpretive sentence already present in the insight body. */
export function findingSummary(body: string): string {
  const parts = sentences(body);
  return parts.find((sentence) => SIGNIFICANCE.test(sentence)) ?? parts[parts.length - 1] ?? body;
}

/** Boundary sentences that follow the interpretation. Empty when the body has none. */
export function findingExplanation(body: string): string {
  const parts = sentences(body);
  const index = parts.findIndex((sentence) => SIGNIFICANCE.test(sentence));
  if (index < 0) return '';
  return parts.slice(index + 1).join(' ');
}

function alsoSentence(rest: MatchupInsight[]): string | null {
  if (rest.length === 0) return null;
  const subjects = rest.map((item) => INSIGHT_SUBJECT[item.id]);
  if (subjects.length === 1) return `The same selection threshold also marks a contrast in ${subjects[0]}.`;
  const earlier = subjects.slice(0, -1).join(', ');
  return `The same selection threshold also marks contrasts in ${earlier} and ${subjects[subjects.length - 1]}.`;
}

function compactRows(rows: ComparisonRow[]): ComparisonRow[] {
  return COMPACT_COMPARISON_LABELS.flatMap((label) => {
    const row = rows.find((candidate) => candidate.label === label);
    return row ? [row] : [];
  });
}

function rosterStoryLine(roster: RosterPresentation): string | null {
  if (roster.status !== 'shown' || !roster.observationDate) return null;
  const label = formatRosterObservationLabel(roster.observationDate);
  const age = roster.freshness === 'informative'
    ? ` This observation is older than a week, so it describes ${label}, not tonight.`
    : '';
  return `Roster observation: ${label}. A listing is not confirmation that a player is available, active, or starting.${age}`;
}

function ratingsCaveat(roster: RosterPresentation, hasRatings: boolean): string | null {
  const parts: string[] = [];
  if (hasRatings && roster.status !== 'shown') parts.push(ROSTER_LIMITATION);
  if (hasRatings) parts.push(RATINGS_SCOPE);
  const rosterLine = rosterStoryLine(roster);
  if (rosterLine) parts.push(rosterLine);
  return parts.length > 0 ? parts.join(' ') : null;
}

function personnel(roster: RosterPresentation): OverviewPersonnel {
  if (roster.status !== 'shown' || !roster.teams || roster.teams.length === 0) {
    return { status: 'hidden', shares: [], note: roster.note };
  }
  return {
    status: 'shown',
    shares: roster.teams.map((team: TeamContinuity) => ({
      abbr: team.abbr,
      minutesShare: team.minutesShare,
      concentration: team.concentration,
    })),
    note: roster.note,
  };
}

export function presentMatchupOverview(input: MatchupOverviewSource): MatchupOverviewPresentation {
  const ranked = input.history ? input.insights : [];
  const top = ranked[0] ?? null;
  const rows = input.history ? compactRows(input.history.rows) : [];
  const hasRatings = input.history != null;
  const story: OverviewStory = !input.history
    ? {
        headline: '2025–26 team comparison unavailable',
        lede: input.historyNote ?? 'Team and player comparisons are hidden.',
        sampleLabel: null,
        caveat: null,
      }
    : top
      ? {
          headline: `The clearest 2025–26 contrast is ${INSIGHT_SUBJECT[top.id]}`,
          lede: [findingSummary(top.body), alsoSentence(ranked.slice(1))].filter(Boolean).join(' '),
          sampleLabel: input.history.label,
          caveat: ratingsCaveat(input.roster, true),
        }
      : {
          headline: 'No standout 2025–26 contrast',
          lede: 'None of the checked 2025–26 team differences cleared the one-standard-deviation selection threshold, so this matchup has no key finding.',
          sampleLabel: input.history.label,
          caveat: ratingsCaveat(input.roster, hasRatings),
        };

  return {
    story,
    findings: ranked.map((insight) => ({
      id: insight.id,
      category: findingCategory(insight.id),
      title: insight.headline,
      evidence: insight.evidence,
      summary: findingExplanation(insight.body),
      sampleLabel: input.history?.label ?? SAMPLE_LABEL,
      destination: '#section-comparison' as const,
    })),
    comparison: {
      available: rows.length > 0,
      label: input.history?.label ?? null,
      possessionNote: input.history?.possessionNote ?? null,
      rows,
      emptyNote: input.history
        ? rows.length > 0
          ? null
          : 'The compact comparison is unavailable for this sample.'
        : input.historyNote,
    },
    personnel: personnel(input.roster),
  };
}
