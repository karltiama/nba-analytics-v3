import { describe, expect, it } from 'vitest';
import { historicalModuleAvailability } from '@/lib/betting/historical-final';
import { shouldShowHistoricalTimeline, type NormalizedTimelineEvent } from '@/lib/betting/historical-timeline';
import {
  HISTORICAL_TIMELINE_VIEW_DEFAULT,
  HISTORICAL_TIMELINE_VIEW_FULL,
  HISTORICAL_TIMELINE_VIEW_KEY,
  TIMELINE_SCORE_MISMATCH_COPY,
  TIMELINE_UNAVAILABLE_COPY,
  formatSubstitutionCopy,
  gameFlowSummaryItems,
  shouldShowTimelineMismatchWarning,
  shouldShowTimelineScoreSummary,
  timelineEventHeadline,
  timelineEventsForView,
  toHistoricalTimelinePayload,
} from '@/lib/betting/historical-timeline-format';

function event(partial: Partial<NormalizedTimelineEvent> & Pick<NormalizedTimelineEvent, 'order'>): NormalizedTimelineEvent {
  return {
    gameId: 'g1',
    period: 1,
    periodLabel: 'Q1',
    clock: '11:00',
    clockSecondsRemaining: 660,
    category: 'other',
    rawType: 'Jump Shot',
    description: 'Ordinary play',
    teamId: '13',
    primaryPlayerId: null,
    secondaryPlayerId: null,
    primaryPlayerName: null,
    secondaryPlayerName: null,
    scoreHome: 0,
    scoreAway: 0,
    scoreValue: null,
    scoringPlay: false,
    substitutionPlayerIds: [],
    leadChange: false,
    becameTied: false,
    ...partial,
  };
}

describe('Timeline availability', () => {
  it('shows Timeline only from the Final contract flag', () => {
    expect(shouldShowHistoricalTimeline({ timeline: true })).toBe(true);
    expect(shouldShowHistoricalTimeline({ timeline: false })).toBe(false);
    expect(shouldShowHistoricalTimeline(undefined)).toBe(false);
    expect(historicalModuleAvailability(true, true, true, false, false).timeline).toBe(false);
    expect(historicalModuleAvailability(false, false, false, true, false).timeline).toBe(true);
  });

  it('hides Timeline for 2023, 2024, 2026, and truncated serving', () => {
    expect(shouldShowHistoricalTimeline({ timeline: false })).toBe(false);
    expect(shouldShowHistoricalTimeline({ timeline: false, rotationContext: false })).toBe(false);
  });
});

describe('Timeline modes', () => {
  it('defaults to Key Events, not Full Play-by-Play', () => {
    expect(HISTORICAL_TIMELINE_VIEW_DEFAULT).toBe(HISTORICAL_TIMELINE_VIEW_KEY);
    expect(HISTORICAL_TIMELINE_VIEW_DEFAULT).not.toBe(HISTORICAL_TIMELINE_VIEW_FULL);
  });
});

describe('Key Events vs Full Play-by-Play', () => {
  const events = [
    event({ order: 1, category: 'period', rawType: 'End Period', description: 'End of Q1', period: 1, periodLabel: 'Q1' }),
    event({ order: 2, category: 'shot_missed', description: 'Missed jumper', scoringPlay: false }),
    event({
      order: 3,
      category: 'scoring',
      scoringPlay: true,
      leadChange: true,
      description: 'Three that changes the lead',
    }),
    event({
      order: 4,
      category: 'scoring',
      scoringPlay: true,
      becameTied: true,
      description: 'Free throw ties it',
    }),
    event({
      order: 5,
      category: 'scoring',
      scoringPlay: true,
      period: 4,
      periodLabel: 'Q4',
      clock: '2:00',
      clockSecondsRemaining: 120,
      description: 'Late Q4 score',
    }),
    event({
      order: 6,
      category: 'scoring',
      scoringPlay: true,
      period: 5,
      periodLabel: 'OT',
      clock: '1:10',
      clockSecondsRemaining: 70,
      description: 'OT score',
    }),
    event({ order: 7, category: 'rebound', description: 'Defensive rebound' }),
  ];
  const payload = toHistoricalTimelinePayload({
    available: true,
    quality: {
      timelineAvailable: true,
      scoreReconciled: true,
      streamComplete: true,
      streamClass: 'complete',
      rotationContextAvailable: true,
      rotationFailureClass: null,
      qualityCode: 'TIMELINE_OK',
    },
    gameFlow: null,
    events,
    officialHomeScore: 99,
    officialAwayScore: 118,
  });

  it('includes period, lead change, tie, late Q4, and OT scoring in Key Events', () => {
    const key = timelineEventsForView(payload, HISTORICAL_TIMELINE_VIEW_KEY);
    expect(key.map((e) => e.order)).toEqual([1, 3, 4, 5, 6]);
    expect(key.some((e) => e.description === 'Missed jumper')).toBe(false);
  });

  it('keeps ordinary events in Full Play-by-Play only', () => {
    const full = timelineEventsForView(payload, HISTORICAL_TIMELINE_VIEW_FULL);
    expect(full.map((e) => e.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(full.find((e) => e.order === 2)?.description).toBe('Missed jumper');
  });
});

describe('ordering', () => {
  it('keeps same-clock events in certified order', () => {
    const events = [
      event({ order: 11, clock: '7:22', category: 'substitution', description: 'First' }),
      event({ order: 12, clock: '7:22', category: 'substitution', description: 'Second' }),
      event({ order: 13, period: 5, periodLabel: 'OT', clock: '4:00', category: 'scoring', scoringPlay: true }),
      event({ order: 14, period: 6, periodLabel: '2OT', clock: '3:00', category: 'period', rawType: 'End Game' }),
    ];
    const payload = toHistoricalTimelinePayload({
      available: true,
      quality: {
        timelineAvailable: true,
        scoreReconciled: true,
        streamComplete: true,
        streamClass: 'complete',
        rotationContextAvailable: true,
        rotationFailureClass: null,
        qualityCode: 'TIMELINE_OK',
      },
      gameFlow: null,
      events,
      officialHomeScore: 105,
      officialAwayScore: 102,
    });
    expect(payload.events.map((e) => e.order)).toEqual([11, 12, 13, 14]);
    expect(payload.events[0]?.clock).toBe('7:22');
    expect(payload.events[1]?.clock).toBe('7:22');
    expect(payload.events[2]?.periodLabel).toBe('OT');
    expect(payload.events[3]?.periodLabel).toBe('2OT');
  });
});

describe('score mismatch UX', () => {
  const mismatchQuality = {
    timelineAvailable: true,
    scoreReconciled: false,
    streamComplete: true,
    streamClass: 'complete' as const,
    rotationContextAvailable: true,
    rotationFailureClass: null,
    qualityCode: 'SCORE_MISMATCH' as const,
  };

  it('shows the mismatch warning and hides derived score summaries', () => {
    expect(shouldShowTimelineMismatchWarning(mismatchQuality)).toBe(true);
    expect(shouldShowTimelineScoreSummary(mismatchQuality)).toBe(false);
    expect(TIMELINE_SCORE_MISMATCH_COPY).toContain('official final');
    expect(TIMELINE_SCORE_MISMATCH_COPY.toLowerCase()).not.toContain('corrupt');
    expect(TIMELINE_SCORE_MISMATCH_COPY.toLowerCase()).not.toContain('broken');
  });

  it('shows derived summaries only when score is reconciled', () => {
    expect(
      shouldShowTimelineScoreSummary({ timelineAvailable: true, scoreReconciled: true })
    ).toBe(true);
    const items = gameFlowSummaryItems(
      {
        gameId: '18447937',
        season: '2025',
        source: 'bdl_plays_2025_canonical',
        timelineAvailable: true,
        scoreReconciled: true,
        streamComplete: true,
        streamClass: 'complete',
        qualityCode: 'TIMELINE_OK',
        playsFinalHome: 99,
        playsFinalAway: 118,
        eventCount: 467,
        periodCount: 4,
        overtimeCount: 0,
        leadChanges: 2,
        ties: 1,
        largestHomeLead: 3,
        largestAwayLead: 26,
        largestHomeRun: 7,
        largestAwayRun: 11,
        homePointsByPeriod: [25, 19, 34, 21],
        awayPointsByPeriod: [33, 35, 19, 31],
        rotationAvailable: true,
        rotationFailureClass: null,
      },
      'LAC',
      'SAS'
    );
    expect(items.map((i) => i.label)).toEqual([
      'Lead changes',
      'Ties',
      'Largest lead',
      'Largest unanswered run',
    ]);
    expect(items.some((i) => /possession/i.test(i.label))).toBe(false);
  });
});

describe('substitution copy', () => {
  it('does not invent IN/OUT direction', () => {
    const copy = formatSubstitutionCopy({
      category: 'substitution',
      primaryPlayerName: 'Obi Toppin',
      secondaryPlayerName: 'Jay Huff',
      substitutionPlayerIds: ['1', '2'],
    });
    expect(copy).toBe('Substitution — Obi Toppin / Jay Huff');
    expect(copy).not.toMatch(/\bIN\b/);
    expect(copy).not.toMatch(/\bOUT\b/);
    expect(
      timelineEventHeadline(
        event({
          order: 1,
          category: 'substitution',
          description: 'Obi Toppin enters the game for Jay Huff',
          primaryPlayerName: 'Obi Toppin',
          secondaryPlayerName: 'Jay Huff',
          substitutionPlayerIds: ['1', '2'],
        })
      )
    ).toBe('Substitution — Obi Toppin / Jay Huff');
  });
});

describe('isolated error copy', () => {
  it('keeps Timeline failure copy scoped', () => {
    expect(TIMELINE_UNAVAILABLE_COPY).toBe('Play-by-play timeline unavailable for this game.');
  });
});
