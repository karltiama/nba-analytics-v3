/**
 * Historical Timeline v1 presentation helpers (Step 12H).
 * Client-safe. Key Events use the certified domain helper — do not reimplement.
 */
import {
  isKeyTimelineEvent,
  type GameFlowSummary,
  type HistoricalGameTimeline,
  type NormalizedTimelineEvent,
  type TimelineEventCategory,
  type TimelineQuality,
} from '@/lib/betting/historical-timeline';

export const HISTORICAL_TIMELINE_VIEW_KEY = 'key' as const;
export const HISTORICAL_TIMELINE_VIEW_FULL = 'full' as const;
export const HISTORICAL_TIMELINE_VIEW_DEFAULT = HISTORICAL_TIMELINE_VIEW_KEY;

export type HistoricalTimelineView =
  | typeof HISTORICAL_TIMELINE_VIEW_KEY
  | typeof HISTORICAL_TIMELINE_VIEW_FULL;

export const TIMELINE_SCORE_MISMATCH_COPY =
  'Play-by-play scoring differs from the official final. Event order is preserved; the final score above remains authoritative.';

export const TIMELINE_UNAVAILABLE_COPY = 'Play-by-play timeline unavailable for this game.';

export const TIMELINE_CATEGORY_LABEL: Record<TimelineEventCategory, string> = {
  scoring: 'Score',
  shot_missed: 'Miss',
  free_throw: 'Free throw',
  rebound: 'Rebound',
  turnover: 'Turnover',
  foul: 'Foul',
  substitution: 'Substitution',
  timeout: 'Timeout',
  jump_ball: 'Jump ball',
  review: 'Review',
  period: 'Period',
  other: 'Play',
};

export type HistoricalTimelinePayload = HistoricalGameTimeline & {
  keyEvents: NormalizedTimelineEvent[];
};

export function toHistoricalTimelinePayload(
  timeline: HistoricalGameTimeline
): HistoricalTimelinePayload {
  return {
    ...timeline,
    keyEvents: timeline.events.filter(isKeyTimelineEvent),
  };
}

export function timelineEventsForView(
  payload: Pick<HistoricalTimelinePayload, 'events' | 'keyEvents'>,
  view: HistoricalTimelineView
): NormalizedTimelineEvent[] {
  if (view === HISTORICAL_TIMELINE_VIEW_KEY) return payload.keyEvents;
  return payload.events;
}

export function shouldShowTimelineScoreSummary(
  quality: Pick<TimelineQuality, 'timelineAvailable' | 'scoreReconciled'> | null | undefined
): boolean {
  return quality?.timelineAvailable === true && quality.scoreReconciled === true;
}

export function shouldShowTimelineMismatchWarning(
  quality: Pick<TimelineQuality, 'timelineAvailable' | 'scoreReconciled'> | null | undefined
): boolean {
  return quality?.timelineAvailable === true && quality.scoreReconciled === false;
}

export function formatTimelineClock(clock: string | null | undefined): string {
  if (!clock) return '';
  return clock;
}

export function formatTimelineRunningScore(
  home: number | null | undefined,
  away: number | null | undefined
): string | null {
  if (home == null || away == null) return null;
  return `${away}–${home}`;
}

export function formatSubstitutionCopy(event: Pick<
  NormalizedTimelineEvent,
  'category' | 'primaryPlayerName' | 'secondaryPlayerName' | 'substitutionPlayerIds'
>): string {
  const a = event.primaryPlayerName?.trim() || null;
  const b = event.secondaryPlayerName?.trim() || null;
  if (a && b) return `Substitution — ${a} / ${b}`;
  if (a) return `Substitution — ${a}`;
  if (event.substitutionPlayerIds.length >= 2) return 'Substitution';
  return 'Substitution';
}

export function timelineEventHeadline(event: NormalizedTimelineEvent): string {
  if (event.category === 'substitution') return formatSubstitutionCopy(event);
  const text = event.description?.replace(/\s+/g, ' ').trim();
  if (text) return text;
  return TIMELINE_CATEGORY_LABEL[event.category];
}

export function timelineTeamAbbr(
  teamId: string | null | undefined,
  homeTeamId: string,
  awayTeamId: string,
  homeAbbr: string,
  awayAbbr: string
): string | null {
  if (!teamId) return null;
  if (teamId === homeTeamId) return homeAbbr;
  if (teamId === awayTeamId) return awayAbbr;
  return null;
}

export function gameFlowSummaryItems(
  flow: GameFlowSummary | null | undefined,
  homeAbbr: string,
  awayAbbr: string
): { label: string; value: string }[] {
  if (!flow) return [];
  const items: { label: string; value: string }[] = [];
  if (flow.leadChanges != null) {
    items.push({ label: 'Lead changes', value: String(flow.leadChanges) });
  }
  if (flow.ties != null) {
    items.push({ label: 'Ties', value: String(flow.ties) });
  }
  if (flow.largestHomeLead != null || flow.largestAwayLead != null) {
    const home = flow.largestHomeLead ?? 0;
    const away = flow.largestAwayLead ?? 0;
    items.push({
      label: 'Largest lead',
      value: `${homeAbbr} ${home} · ${awayAbbr} ${away}`,
    });
  }
  if (flow.largestHomeRun != null || flow.largestAwayRun != null) {
    const home = flow.largestHomeRun ?? 0;
    const away = flow.largestAwayRun ?? 0;
    items.push({
      label: 'Largest unanswered run',
      value: `${homeAbbr} ${home} · ${awayAbbr} ${away}`,
    });
  }
  return items.slice(0, 4);
}
