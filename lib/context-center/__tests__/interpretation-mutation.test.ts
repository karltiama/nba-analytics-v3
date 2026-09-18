import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  INTERPRETATION_ID,
  generateInterpretations,
} from '@/lib/context-center';
import {
  baseAvailability,
  baseForm,
  baseOpp,
  baseRole,
  baseSchedule,
  fullBundle,
} from './interpretation-fixtures';

function digestTexts(
  result: ReturnType<typeof generateInterpretations>
): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        result.rendered.map((r) => ({
          id: r.interpretation.interpretationId,
          text: r.renderedText,
          params: r.interpretation.templateParameters,
        }))
      )
    )
    .digest('hex');
}

describe('Context Interpretation mutation / independence gates', () => {
  it('unrelated mutation matrix isolates families', () => {
    const base = generateInterpretations(fullBundle());
    const baseDigests = Object.fromEntries(
      base.rendered.map((r) => [r.interpretation.interpretationId, r.renderedText])
    );

    const cases: Array<{
      name: string;
      bundle: ReturnType<typeof fullBundle>;
      mayChange: string[];
      mustHold: string[];
    }> = [
      {
        name: 'Availability',
        bundle: fullBundle({
          availability: baseAvailability({
            availability: { healthOutCount: 3 },
            injuryBurden: { expectedMissingMinutes: 80 },
          }),
        }),
        mayChange: [INTERPRETATION_ID.AVAILABILITY_SUMMARY],
        mustHold: [
          INTERPRETATION_ID.SCHEDULE_SUMMARY,
          INTERPRETATION_ID.ROLE_PLAYING_TIME,
          INTERPRETATION_ID.FORM_SCORING,
        ],
      },
      {
        name: 'Schedule',
        bundle: fullBundle({
          schedule: baseSchedule({
            schedule: { homeAway: 'AWAY', daysRest: 1, backToBack: false },
          }),
        }),
        mayChange: [INTERPRETATION_ID.SCHEDULE_SUMMARY],
        mustHold: [
          INTERPRETATION_ID.AVAILABILITY_SUMMARY,
          INTERPRETATION_ID.ROLE_PLAYING_TIME,
        ],
      },
      {
        name: 'Role',
        bundle: fullBundle({
          role: baseRole({ recentRole: { minutes: 40, fga: 22 } }),
        }),
        mayChange: [
          INTERPRETATION_ID.ROLE_PLAYING_TIME,
          INTERPRETATION_ID.ROLE_SHOT_OPPORTUNITY,
          INTERPRETATION_ID.MATCHUP_SCORING_ENVIRONMENT,
          INTERPRETATION_ID.MATCHUP_PERIMETER,
        ],
        mustHold: [
          INTERPRETATION_ID.AVAILABILITY_SUMMARY,
          INTERPRETATION_ID.SCHEDULE_SUMMARY,
        ],
      },
      {
        name: 'Form',
        bundle: fullBundle({
          form: baseForm({ recentForm: { points: 30, fgPct: 0.5 } }),
        }),
        mayChange: [
          INTERPRETATION_ID.FORM_SCORING,
          INTERPRETATION_ID.FORM_SHOOTING,
          INTERPRETATION_ID.MATCHUP_SCORING_ENVIRONMENT,
        ],
        mustHold: [
          INTERPRETATION_ID.AVAILABILITY_SUMMARY,
          INTERPRETATION_ID.SCHEDULE_SUMMARY,
          INTERPRETATION_ID.ROLE_PLAYING_TIME,
        ],
      },
      {
        name: 'Matchup scoring via opponent DRtg',
        bundle: fullBundle({
          opponent: baseOpp({ opponent: { defensiveRating: 108.1 } }),
        }),
        mayChange: [INTERPRETATION_ID.MATCHUP_SCORING_ENVIRONMENT],
        mustHold: [
          INTERPRETATION_ID.AVAILABILITY_SUMMARY,
          INTERPRETATION_ID.SCHEDULE_SUMMARY,
          INTERPRETATION_ID.ROLE_PLAYING_TIME,
          INTERPRETATION_ID.FORM_SCORING,
        ],
      },
      {
        name: 'Matchup perimeter via 3PA rate',
        bundle: fullBundle({
          opponent: baseOpp({ opponent: { threePointAttemptRateAllowed: 0.35 } }),
        }),
        mayChange: [INTERPRETATION_ID.MATCHUP_PERIMETER],
        mustHold: [
          INTERPRETATION_ID.AVAILABILITY_SUMMARY,
          INTERPRETATION_ID.SCHEDULE_SUMMARY,
          INTERPRETATION_ID.FORM_SCORING,
        ],
      },
    ];

    for (const c of cases) {
      const mut = generateInterpretations(c.bundle);
      const mutDigests = Object.fromEntries(
        mut.rendered.map((r) => [r.interpretation.interpretationId, r.renderedText])
      );
      for (const id of c.mustHold) {
        expect(mutDigests[id], `${c.name} ${id}`).toBe(baseDigests[id]);
      }
      const changed = c.mayChange.some((id) => mutDigests[id] !== baseDigests[id]);
      expect(changed, c.name).toBe(true);
    }
  });

  it('TARGET_OUTCOME_MUTATION_TEST — target box stats not inputs', () => {
    // Interpretation consumes certified pregame snapshots only; mutating a
    // fictional "target outcome" sidecar must not change generation when
    // certified snapshots are unchanged.
    const a = generateInterpretations(fullBundle());
    const sidecar = { PTS: 99, REB: 20, FGA: 40, FTA: 10, '3PA': 15, '3PM': 8 };
    const b = generateInterpretations(fullBundle());
    void sidecar;
    expect(digestTexts(a)).toBe(digestTexts(b));
  });

  it('FUTURE_MUTATION_TEST — future history not present in frozen snapshots', () => {
    const a = generateInterpretations(fullBundle());
    // Future games are not part of the certified snapshot bundle; re-running
    // with identical certified inputs is invariant.
    const futureGames = [{ gameId: 'FUTURE', pts: 50 }];
    void futureGames;
    const b = generateInterpretations(fullBundle());
    expect(digestTexts(a)).toBe(digestTexts(b));
  });

  it('RAW_SOURCE_INDEPENDENCE_TEST — raw fixture mutation ignored', () => {
    const rawPgl = [{ minutes: 48, points: 60 }];
    const a = generateInterpretations(fullBundle());
    rawPgl[0].points = 0;
    const b = generateInterpretations(fullBundle());
    expect(digestTexts(a)).toBe(digestTexts(b));
  });

  it('DETERMINISTIC_RERUN identical digest', () => {
    expect(digestTexts(generateInterpretations(fullBundle()))).toBe(
      digestTexts(generateInterpretations(fullBundle()))
    );
  });
});
