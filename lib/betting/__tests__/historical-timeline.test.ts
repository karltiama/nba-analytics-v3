import { describe, expect, it } from 'vitest';
import {
  PLAYS_2025_ROTATION_FAILURE_BY_GAME,
  PLAYS_2025_SCORE_MISMATCH_IDS,
  PLAYS_2025_STARTER_ANOMALY_IDS,
  buildGameFlowSummary,
  classifyScoreMismatchStream,
  isKeyTimelineEvent,
  mapTimelineEventCategory,
  normalizePlayEvent,
  normalizePlayEvents,
  parseClockToSeconds,
  periodLabel,
  rotationContextForGame,
  shouldShowHistoricalTimeline,
} from '@/lib/betting/historical-timeline';

function ev(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    game_id: 'g1',
    order: 1,
    period: 1,
    clock: '11:00',
    type: 'Jump Shot',
    text: 'Player makes jump shot',
    home_score: 0,
    away_score: 0,
    scoring_play: false,
    shooting_play: true,
    team: { id: '13' },
    participants: ['274'],
    ...overrides,
  };
}

describe('periodLabel', () => {
  it('labels regulation and overtime through period 6+', () => {
    expect(periodLabel(1)).toBe('Q1');
    expect(periodLabel(4)).toBe('Q4');
    expect(periodLabel(5)).toBe('OT');
    expect(periodLabel(6)).toBe('2OT');
    expect(periodLabel(7)).toBe('3OT');
    expect(periodLabel(null)).toBe('');
  });
});

describe('parseClockToSeconds', () => {
  it('parses M:SS, MM:SS, fractional, and sub-minute seconds', () => {
    expect(parseClockToSeconds('12:00')).toBe(720);
    expect(parseClockToSeconds('7:13')).toBe(433);
    expect(parseClockToSeconds('0:05.3')).toBeCloseTo(5.3);
    expect(parseClockToSeconds('5.3')).toBeCloseTo(5.3);
    expect(parseClockToSeconds('15.4')).toBeCloseTo(15.4);
    expect(parseClockToSeconds('not-a-clock')).toBeNull();
  });
});

describe('mapTimelineEventCategory', () => {
  it('maps known provider types conservatively', () => {
    expect(mapTimelineEventCategory('Jump Shot', true, true)).toBe('scoring');
    expect(mapTimelineEventCategory('Jump Shot', false, true)).toBe('shot_missed');
    expect(mapTimelineEventCategory('Defensive Rebound', false, false)).toBe('rebound');
    expect(mapTimelineEventCategory('Bad Pass\nTurnover', false, false)).toBe('turnover');
    expect(mapTimelineEventCategory('Personal Foul', false, false)).toBe('foul');
    expect(mapTimelineEventCategory('Free Throw - 1 of 2', true, true)).toBe('free_throw');
    expect(mapTimelineEventCategory('Substitution', false, false)).toBe('substitution');
    expect(mapTimelineEventCategory('Full Timeout', false, false)).toBe('timeout');
    expect(mapTimelineEventCategory('Jumpball', false, false)).toBe('jump_ball');
    expect(mapTimelineEventCategory("Coach's Challenge (Stands)", false, false)).toBe('review');
    expect(mapTimelineEventCategory('End Period', false, false)).toBe('period');
    expect(mapTimelineEventCategory('End Game', false, false)).toBe('period');
    expect(mapTimelineEventCategory('Brand New Provider Phrase 2099', false, false)).toBe('other');
  });
});

describe('normalizePlayEvent', () => {
  it('normalizes a scoring event without coordinates', () => {
    const event = normalizePlayEvent(
      ev({
        scoring_play: true,
        shooting_play: true,
        score_value: 2,
        home_score: 2,
        away_score: 0,
        coordinate_x: 25,
        coordinate_y: 10,
      }),
      'g1'
    );
    expect(event?.category).toBe('scoring');
    expect(event?.scoreValue).toBe(2);
    expect(event?.primaryPlayerId).toBe('274');
    expect(JSON.stringify(event)).not.toMatch(/coordinate/i);
  });

  it('keeps null team on admin events', () => {
    const event = normalizePlayEvent(
      ev({
        type: 'End Period',
        team: null,
        team_id: null,
        participants: [],
        shooting_play: false,
        scoring_play: false,
      }),
      'g1'
    );
    expect(event?.category).toBe('period');
    expect(event?.teamId).toBeNull();
    expect(event?.primaryPlayerId).toBeNull();
  });

  it('preserves substitution participants without inventing IN/OUT', () => {
    const event = normalizePlayEvent(
      ev({
        type: 'Substitution',
        text: 'Obi Toppin enters the game for Jay Huff',
        participants: ['3547243', '17896103'],
        shooting_play: false,
      }),
      'g1'
    );
    expect(event?.category).toBe('substitution');
    expect(event?.substitutionPlayerIds).toEqual(['3547243', '17896103']);
    expect(event).not.toHaveProperty('substitutionInPlayerId');
    expect(event).not.toHaveProperty('substitutionOutPlayerId');
  });
});

describe('normalizePlayEvents ordering', () => {
  it('uses order as canonical chronology, including same-clock events', () => {
    const { events, orderMalformed } = normalizePlayEvents(
      [
        ev({ order: 12, clock: '7:22', type: 'Substitution', text: 'B' }),
        ev({ order: 11, clock: '7:22', type: 'Substitution', text: 'A' }),
        ev({ order: 13, period: 2, clock: '12:00', type: 'End Period', text: 'End Q1' }),
        ev({ order: 14, period: 5, clock: '5:00', type: 'Jump Shot', scoring_play: true, shooting_play: true }),
      ],
      'g1'
    );
    expect(orderMalformed).toBe(false);
    expect(events.map((e) => e.order)).toEqual([11, 12, 13, 14]);
    expect(events[0]?.clock).toBe('7:22');
    expect(events[1]?.clock).toBe('7:22');
    expect(events[2]?.periodLabel).toBe('Q2');
    expect(events[3]?.periodLabel).toBe('OT');
  });

  it('labels 2OT and counts overtime periods on the flow summary', () => {
    const { events, orderMalformed } = normalizePlayEvents(
      [
        ev({ order: 1, period: 4, scoring_play: true, home_score: 100, away_score: 100 }),
        ev({ order: 2, period: 5, scoring_play: true, home_score: 102, away_score: 100 }),
        ev({
          order: 3,
          period: 6,
          type: 'End Game',
          scoring_play: false,
          shooting_play: false,
          home_score: 105,
          away_score: 102,
        }),
      ],
      'g-ot'
    );
    const flow = buildGameFlowSummary({
      gameId: 'g-ot',
      events,
      orderMalformed,
      officialHome: 105,
      officialAway: 102,
    });
    expect(events[2]?.periodLabel).toBe('2OT');
    expect(flow.overtimeCount).toBe(2);
    expect(flow.periodCount).toBe(6);
    expect(flow.homePointsByPeriod).toHaveLength(6);
  });

  it('flags order gaps without repairing them', () => {
    const { orderMalformed } = normalizePlayEvents([ev({ order: 1 }), ev({ order: 3 })], 'g1');
    expect(orderMalformed).toBe(true);
  });
});

describe('score flow', () => {
  it('counts lead changes and ties with documented semantics', () => {
    const { events, orderMalformed } = normalizePlayEvents(
      [
        ev({ order: 1, home_score: 0, away_score: 0, type: 'End Period', scoring_play: false, shooting_play: false }),
        ev({
          order: 2,
          scoring_play: true,
          shooting_play: true,
          home_score: 2,
          away_score: 0,
          score_value: 2,
        }),
        ev({
          order: 3,
          scoring_play: true,
          shooting_play: true,
          home_score: 2,
          away_score: 3,
          score_value: 3,
          team: { id: '27' },
        }),
        ev({
          order: 4,
          scoring_play: true,
          shooting_play: true,
          home_score: 4,
          away_score: 3,
          score_value: 2,
        }),
        ev({
          order: 5,
          scoring_play: true,
          shooting_play: true,
          home_score: 4,
          away_score: 4,
          score_value: 1,
          type: 'Free Throw - 1 of 1',
        }),
        ev({ order: 6, type: 'End Game', period: 4, home_score: 4, away_score: 4, shooting_play: false }),
      ],
      'g1'
    );
    const flow = buildGameFlowSummary({
      gameId: 'g1',
      events,
      orderMalformed,
      officialHome: 4,
      officialAway: 4,
    });
    expect(flow.scoreReconciled).toBe(true);
    expect(flow.leadChanges).toBe(2);
    expect(flow.ties).toBe(1);
    expect(flow.largestHomeLead).toBe(2);
    expect(flow.largestAwayLead).toBe(1);
    expect(events.filter((e) => e.leadChange).map((e) => e.order)).toEqual([3, 4]);
    expect(events.find((e) => e.becameTied)?.order).toBe(5);
  });

  it('derives unanswered scoring runs without possessions', () => {
    const { events, orderMalformed } = normalizePlayEvents(
      [
        ev({ order: 1, scoring_play: true, home_score: 3, away_score: 0, score_value: 3 }),
        ev({ order: 2, scoring_play: true, home_score: 5, away_score: 0, score_value: 2 }),
        ev({ order: 3, scoring_play: true, home_score: 5, away_score: 2, score_value: 2, team: { id: '27' } }),
        ev({ order: 4, type: 'End Game', period: 4, home_score: 5, away_score: 2, shooting_play: false, scoring_play: false }),
      ],
      'g1'
    );
    const flow = buildGameFlowSummary({
      gameId: 'g1',
      events,
      orderMalformed,
      officialHome: 5,
      officialAway: 2,
    });
    expect(flow.largestHomeRun).toBe(5);
    expect(flow.largestAwayRun).toBe(2);
    expect(flow.homePointsByPeriod[0]).toBe(5);
    expect(flow.awayPointsByPeriod[0]).toBe(2);
  });

  it('keeps official header scores independent of Plays totals', () => {
    const { events, orderMalformed } = normalizePlayEvents(
      [
        ev({ order: 1, scoring_play: true, home_score: 121, away_score: 110, period: 4 }),
        ev({ order: 2, type: 'End Game', period: 4, home_score: 121, away_score: 110, shooting_play: false }),
      ],
      '18446874'
    );
    const flow = buildGameFlowSummary({
      gameId: '18446874',
      events,
      orderMalformed,
      officialHome: 121,
      officialAway: 111,
    });
    expect(flow.playsFinalHome).toBe(121);
    expect(flow.playsFinalAway).toBe(110);
    expect(flow.scoreReconciled).toBe(false);
    expect(flow.qualityCode).toBe('SCORE_MISMATCH');
  });
});

describe('quality gates', () => {
  it('allows Timeline when score is exact and rotation succeeded', () => {
    const { events, orderMalformed } = normalizePlayEvents(
      [
        ev({ order: 1, scoring_play: true, home_score: 99, away_score: 118, period: 4 }),
        ev({ order: 2, type: 'End Game', period: 4, home_score: 99, away_score: 118, shooting_play: false }),
      ],
      '18447937'
    );
    const flow = buildGameFlowSummary({
      gameId: '18447937',
      events,
      orderMalformed,
      officialHome: 99,
      officialAway: 118,
    });
    expect(flow.timelineAvailable).toBe(true);
    expect(flow.scoreReconciled).toBe(true);
    expect(flow.rotationAvailable).toBe(true);
  });

  it('keeps Timeline independent of rotation failure', () => {
    const { events, orderMalformed } = normalizePlayEvents(
      [
        ev({ order: 1, scoring_play: true, home_score: 100, away_score: 100, period: 4 }),
        ev({ order: 2, type: 'End Game', period: 4, home_score: 100, away_score: 100, shooting_play: false }),
      ],
      '18446930'
    );
    const flow = buildGameFlowSummary({
      gameId: '18446930',
      events,
      orderMalformed,
      officialHome: 100,
      officialAway: 100,
    });
    expect(flow.timelineAvailable).toBe(true);
    expect(flow.rotationAvailable).toBe(false);
    expect(flow.rotationFailureClass).toBe('MISSING_PARTICIPANT');
  });

  it('fail-closes Timeline on truncated score-mismatch streams', () => {
    const { events, orderMalformed } = normalizePlayEvents(
      [
        ev({ order: 1, period: 1, scoring_play: true, home_score: 12, away_score: 8 }),
        ev({ order: 2, period: 1, type: 'Substitution', home_score: 12, away_score: 8, shooting_play: false }),
      ],
      '18447390'
    );
    const flow = buildGameFlowSummary({
      gameId: '18447390',
      events,
      orderMalformed,
      officialHome: 112,
      officialAway: 101,
    });
    expect(flow.streamClass).toBe('truncated');
    expect(flow.timelineAvailable).toBe(false);
    expect(flow.scoreReconciled).toBe(false);
    expect(flow.largestHomeLead).toBeNull();
    expect(classifyScoreMismatchStream(flow.streamClass)).toBe('truncated');
  });

  it('keeps Timeline on starter anomalies while rotation stays unavailable', () => {
    const { events, orderMalformed } = normalizePlayEvents(
      [
        ev({ order: 1, scoring_play: true, home_score: 110, away_score: 108, period: 4 }),
        ev({ order: 2, type: 'End Game', period: 4, home_score: 110, away_score: 108, shooting_play: false }),
      ],
      '18447931'
    );
    const flow = buildGameFlowSummary({
      gameId: '18447931',
      events,
      orderMalformed,
      officialHome: 110,
      officialAway: 108,
    });
    expect(flow.timelineAvailable).toBe(true);
    expect(flow.rotationAvailable).toBe(false);
    expect(flow.rotationFailureClass).toBe('STARTER_ANOMALY');
  });

  it('does not infer Timeline from season number', () => {
    expect(shouldShowHistoricalTimeline({ timeline: false })).toBe(false);
    expect(shouldShowHistoricalTimeline({ timeline: true })).toBe(true);
    expect(rotationContextForGame('15905067', { inPlays2025Archive: false }).available).toBe(false);
  });
});

describe('certified lists', () => {
  it('preserves the 20 mismatch and 36 rotation-failure identities', () => {
    expect(PLAYS_2025_SCORE_MISMATCH_IDS).toHaveLength(20);
    expect(Object.keys(PLAYS_2025_ROTATION_FAILURE_BY_GAME)).toHaveLength(36);
    expect(PLAYS_2025_STARTER_ANOMALY_IDS).toEqual(['18447931', '18447988']);
    const classes = Object.values(PLAYS_2025_ROTATION_FAILURE_BY_GAME);
    expect(classes.filter((c) => c === 'MISSING_PARTICIPANT')).toHaveLength(27);
    expect(classes.filter((c) => c === 'BOTH_OFF_COURT')).toHaveLength(5);
    expect(classes.filter((c) => c === 'BOTH_ON_COURT')).toHaveLength(4);
  });
});

describe('key events', () => {
  it('uses period, lead-change, tie, and final-five-minutes scoring filters', () => {
    const period = normalizePlayEvent(ev({ type: 'End Period', shooting_play: false }), 'g1')!;
    const late = normalizePlayEvent(
      ev({
        order: 9,
        period: 4,
        clock: '2:00',
        scoring_play: true,
        shooting_play: true,
        home_score: 100,
        away_score: 99,
      }),
      'g1'
    )!;
    late.leadChange = true;
    expect(isKeyTimelineEvent(period)).toBe(true);
    expect(isKeyTimelineEvent(late)).toBe(true);
    const earlyMiss = normalizePlayEvent(
      ev({ order: 2, period: 1, clock: '11:00', scoring_play: false, shooting_play: true }),
      'g1'
    )!;
    expect(isKeyTimelineEvent(earlyMiss)).toBe(false);
  });
});
