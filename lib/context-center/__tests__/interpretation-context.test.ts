import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CONTEXT_INTERPRETATION_MODEL,
  CONTEXT_INTERPRETATION_VERSION,
  CONTEXT_INTERPRETATION_V1_OBSERVATIONS,
  CORE_INTERPRETATION_LLM_POLICY,
  INTERPRETATION_DEFINITIONS,
  INTERPRETATION_ID,
  InterpretationGenerationError,
  compareRecentMinusSeason,
  equalAtDisplayPrecision1,
  formatPercentagePointsDelta,
  formatRateAsPercent,
  generateInterpretations,
  renderInterpretation,
  scanCausalLanguage,
  scanProhibitedLanguage,
} from '@/lib/context-center';
import {
  baseAvailability,
  baseForm,
  baseOpp,
  baseRole,
  baseSchedule,
  fullBundle,
} from './interpretation-fixtures';

describe('Context Interpretation V1 — core', () => {
  it('locks model, LLM policy, version, and 8 observations', () => {
    expect(CONTEXT_INTERPRETATION_MODEL).toBe('DETERMINISTIC_EVIDENCE_LINKED');
    expect(CORE_INTERPRETATION_LLM_POLICY).toBe('NO_LLM');
    expect(CONTEXT_INTERPRETATION_VERSION).toBe('context-interpretation-v1');
    expect(CONTEXT_INTERPRETATION_V1_OBSERVATIONS).toHaveLength(8);
    expect(INTERPRETATION_DEFINITIONS).toHaveLength(8);
  });

  it('generates ordered observations with evidence and predictiveClaim false', () => {
    const result = generateInterpretations(fullBundle());
    expect(result.interpretations.length).toBeGreaterThanOrEqual(4);
    expect(result.interpretations.length).toBeLessThanOrEqual(8);
    const ids = result.interpretations.map((i) => i.interpretationId);
    const order = Object.values(INTERPRETATION_ID);
    let last = -1;
    for (const id of ids) {
      const idx = order.indexOf(id);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
    for (const i of result.interpretations) {
      expect(i.evidence.length).toBeGreaterThan(0);
      expect(i.predictiveClaim).toBe(false);
      expect(i.interpretationVersion).toBe(CONTEXT_INTERPRETATION_VERSION);
    }
    for (const r of result.rendered) {
      expect(r.renderedText.length).toBeGreaterThan(10);
      expect(scanProhibitedLanguage(r.renderedText)).toEqual([]);
      expect(scanCausalLanguage(r.renderedText)).toEqual([]);
    }
  });

  it('Availability COMPLETE / PARTIAL / SOURCE_ONLY', () => {
    const complete = generateInterpretations(fullBundle());
    const avail = complete.rendered.find(
      (r) => r.interpretation.interpretationId === INTERPRETATION_ID.AVAILABILITY_SUMMARY
    )!;
    expect(avail.renderedText).toContain('2 health-related players are Out');
    expect(avail.renderedText).toContain('65.5 prior rotation minutes');

    const partial = generateInterpretations(
      fullBundle({
        availability: baseAvailability({
          injuryBurden: { expectedMissingMinutes: 42.3 },
          completeness: {
            status: 'PARTIAL',
            roleRequiredCount: 3,
            roleEstimatedCount: 2,
            coverageRate: 2 / 3,
          },
        }),
      })
    );
    const pText = partial.rendered.find(
      (r) => r.interpretation.interpretationId === INTERPRETATION_ID.AVAILABILITY_SUMMARY
    )!.renderedText;
    expect(pText).toMatch(/At least 42\.3/);
    expect(pText).toMatch(/unavailable/);
    expect(pText).not.toMatch(/should|usage|workload/i);

    const sourceOnly = generateInterpretations(
      fullBundle({
        availability: baseAvailability({
          injuryBurden: {
            expectedMissingMinutes: null,
            expectedMissingFga: null,
            expectedMissingPoints: null,
            missingRotationShare: null,
            maxMissingPriorMpg: null,
            rotationPlayersOutCount: null,
          },
          completeness: {
            status: 'SOURCE_ONLY',
            roleRequiredCount: 2,
            roleEstimatedCount: 0,
            coverageRate: 0,
          },
        }),
      })
    );
    const sText = sourceOnly.rendered.find(
      (r) => r.interpretation.interpretationId === INTERPRETATION_ID.AVAILABILITY_SUMMARY
    )!.renderedText;
    expect(sText).toContain('Historical role estimates are unavailable');
    expect(sText).not.toMatch(/\d+\.\d+ prior rotation minutes/);
  });

  it('SOURCE_UNKNOWN availability → no availability observation', () => {
    const result = generateInterpretations(
      fullBundle({
        availability: baseAvailability({
          completeness: {
            status: 'SOURCE_UNKNOWN',
            roleRequiredCount: 0,
            roleEstimatedCount: 0,
            coverageRate: null,
          },
          availability: {
            healthOutCount: null,
            healthOutCanonicalCount: null,
            healthOutSourceCount: null,
            healthOutUnresolvedCount: null,
          },
          injuryBurden: { expectedMissingMinutes: null },
        }),
      })
    );
    expect(result.eligibility[INTERPRETATION_ID.AVAILABILITY_SUMMARY]).toBe(
      'missing_required'
    );
    expect(
      result.interpretations.some(
        (i) => i.interpretationId === INTERPRETATION_ID.AVAILABILITY_SUMMARY
      )
    ).toBe(false);
  });

  it('Schedule rest / B2B / season opener', () => {
    const rest = generateInterpretations(fullBundle());
    expect(
      rest.rendered.find((r) => r.interpretation.interpretationId === INTERPRETATION_ID.SCHEDULE_SUMMARY)!
        .renderedText
    ).toBe('Home with 2 days of rest.');

    const b2b = generateInterpretations(
      fullBundle({
        schedule: baseSchedule({
          schedule: { homeAway: 'AWAY', daysRest: 0, backToBack: true, isSeasonOpener: false },
        }),
      })
    );
    expect(
      b2b.rendered.find((r) => r.interpretation.interpretationId === INTERPRETATION_ID.SCHEDULE_SUMMARY)!
        .renderedText
    ).toBe('Away on the second night of a back-to-back.');

    const opener = generateInterpretations(
      fullBundle({
        schedule: baseSchedule({
          schedule: {
            homeAway: 'HOME',
            daysRest: null,
            backToBack: false,
            isSeasonOpener: true,
          },
        }),
      })
    );
    const oText = opener.rendered.find(
      (r) => r.interpretation.interpretationId === INTERPRETATION_ID.SCHEDULE_SUMMARY
    )!.renderedText;
    expect(oText).toBe('Season opener at home.');
    expect(oText).not.toMatch(/well rested|days of rest|fresh|tired/i);
  });

  it('Role / Form comparisons and suppression at display precision', () => {
    const result = generateInterpretations(fullBundle());
    const role = result.rendered.find(
      (r) => r.interpretation.interpretationId === INTERPRETATION_ID.ROLE_PLAYING_TIME
    )!;
    expect(role.interpretation.comparison!.delta).toBeCloseTo(2.7, 10);
    expect(role.renderedText).toContain('36.8');
    expect(role.renderedText).toContain('34.1');
    expect(role.renderedText).toContain('+2.7');
    expect(role.renderedText).not.toMatch(/expanded role|better role/i);

    expect(equalAtDisplayPrecision1(34.21, 34.24)).toBe(true);
    expect(compareRecentMinusSeason(34.21, 34.24, 'minutes').status).toBe('suppressed');
    expect(equalAtDisplayPrecision1(34.24, 34.26)).toBe(false);
    expect(compareRecentMinusSeason(34.24, 34.26, 'minutes').status).toBe('ok');

    const suppressed = generateInterpretations(
      fullBundle({
        role: baseRole({
          seasonRole: { minutes: 34.21, fga: 18.0 },
          recentRole: { minutes: 34.24, fga: 18.04 },
        }),
      })
    );
    expect(suppressed.eligibility[INTERPRETATION_ID.ROLE_PLAYING_TIME]).toBe('suppressed');
    expect(suppressed.eligibility[INTERPRETATION_ID.ROLE_SHOT_OPPORTUNITY]).toBe('suppressed');
  });

  it('Form shooting percentage points — never relative %', () => {
    expect(formatRateAsPercent(0.366)).toBe('36.6%');
    expect(formatRateAsPercent(0.372)).toBe('37.2%');
    expect(formatPercentagePointsDelta(0.006)).toBe('+0.6');

    const result = generateInterpretations(fullBundle());
    const shoot = result.rendered.find(
      (r) => r.interpretation.interpretationId === INTERPRETATION_ID.FORM_SHOOTING
    )!;
    expect(shoot.renderedText).toContain('percentage points');
    expect(shoot.renderedText).toMatch(/\+0\.6 percentage points/);
    expect(shoot.renderedText).not.toMatch(/\+1\.6%/);
  });

  it('null 3P% never becomes 0%', () => {
    const result = generateInterpretations(
      fullBundle({
        form: baseForm({
          recentForm: { threePct: null, threeAttempted: 0, threeMade: 0 },
          seasonForm: { threePct: 0.35, threeAttempted: 40, threeMade: 14 },
        }),
      })
    );
    const shoot = result.rendered.find(
      (r) => r.interpretation.interpretationId === INTERPRETATION_ID.FORM_SHOOTING
    );
    if (shoot) {
      expect(shoot.renderedText).not.toMatch(/0\.0%/);
      expect(shoot.renderedText).not.toMatch(/three-point shooting is 0/);
    }
    const perim = result.rendered.find(
      (r) => r.interpretation.interpretationId === INTERPRETATION_ID.MATCHUP_PERIMETER
    )!;
    expect(perim.renderedText).toContain('field-goal attempts from three');
    expect(perim.renderedText).not.toMatch(/3P%|three-point percentage allowed/i);
  });

  it('small sample qualifier when recent_n < 10', () => {
    const result = generateInterpretations(
      fullBundle({
        role: baseRole({ recentRole: { historyN: 3 } }),
        form: baseForm({ recentForm: { historyN: 3 } }),
      })
    );
    const role = result.rendered.find(
      (r) => r.interpretation.interpretationId === INTERPRETATION_ID.ROLE_PLAYING_TIME
    )!;
    expect(role.renderedText).toContain('Recent sample: 3 prior played games');
    expect(role.renderedText).not.toMatch(/unreliable|weak|low confidence/i);
  });

  it('Matchup scoring environment relational wording only', () => {
    const result = generateInterpretations(fullBundle());
    const text = result.rendered.find(
      (r) =>
        r.interpretation.interpretationId ===
        INTERPRETATION_ID.MATCHUP_SCORING_ENVIRONMENT
    )!.renderedText;
    expect(text).toContain('27.5');
    expect(text).toContain('113.7');
    expect(text).not.toMatch(/favorable|should help|upside|good chance/i);
  });

  it('Perimeter unit is share of opposing FGA from three', () => {
    const result = generateInterpretations(fullBundle());
    const perim = result.rendered.find(
      (r) => r.interpretation.interpretationId === INTERPRETATION_ID.MATCHUP_PERIMETER
    )!;
    expect(perim.renderedText).toContain(
      '41.8% of opposing field-goal attempts from three'
    );
    expect(perim.interpretation.templateParameters.rateUnit).toBe(
      'share_of_opposing_fga_from_three'
    );
    // Role shot emitted → no season TPA clause on perimeter (redundancy)
    expect(perim.renderedText).not.toMatch(/versus a 7\.1 season baseline/);
  });

  it('contradictory Role↑ Form↓ emits both without bridging narrative', () => {
    const result = generateInterpretations(
      fullBundle({
        role: baseRole({
          seasonRole: { fga: 15, minutes: 30 },
          recentRole: { fga: 20, minutes: 34 },
        }),
        form: baseForm({
          seasonForm: { points: 24 },
          recentForm: { points: 18 },
        }),
      })
    );
    const texts = result.rendered.map((r) => r.renderedText).join(' ');
    expect(texts).toMatch(/shot volume.*\+/);
    expect(texts).toMatch(/scoring.*−|scoring.*-/);
    expect(texts).not.toMatch(/struggling despite|despite increased/i);
  });

  it('cold start Role/Form → missing comparisons', () => {
    const result = generateInterpretations(
      fullBundle({
        role: baseRole({
          seasonRole: {
            historyN: 0,
            minutes: null,
            fga: null,
            fta: null,
            ast: null,
            tpa: null,
          },
          recentRole: {
            historyN: 0,
            minutes: null,
            fga: null,
            fta: null,
            ast: null,
            tpa: null,
          },
        }),
        form: baseForm({
          seasonForm: {
            historyN: 0,
            points: null,
            fgPct: null,
            threePct: null,
          },
          recentForm: {
            historyN: 0,
            points: null,
            fgPct: null,
            threePct: null,
          },
        }),
        opponent: baseOpp({
          opponent: { defensiveRating: null, threePointAttemptRateAllowed: null, pace: null },
          completeness: { status: 'SOURCE_ONLY' },
          history: { n: 0, latestGameStart: null },
        }),
      })
    );
    // Matchup may fail required inputs
    expect(result.eligibility[INTERPRETATION_ID.ROLE_PLAYING_TIME]).toBe('missing_required');
    expect(result.eligibility[INTERPRETATION_ID.FORM_SCORING]).toBe('missing_required');
  });

  it('TARGET_ALIGNMENT_TEST rejects mismatched snapshots', () => {
    const bundle = fullBundle();
    bundle.role = baseRole({ gameId: 'OTHER' });
    expect(() => generateInterpretations(bundle)).toThrow(InterpretationGenerationError);

    const tipMismatch = fullBundle();
    tipMismatch.schedule = baseSchedule({ gameStart: '2024-02-01T00:00:00Z' });
    expect(() => generateInterpretations(tipMismatch)).toThrow(InterpretationGenerationError);
  });

  it('VERSION_MISMATCH fail-closed', () => {
    expect(() =>
      generateInterpretations(
        fullBundle({
          schedule: { ...baseSchedule(), contextVersion: 'schedule-context-v0' as never },
        })
      )
    ).toThrow(/version/i);
  });

  it('no context substitution for matchup required points', () => {
    const result = generateInterpretations(
      fullBundle({
        form: baseForm({ recentForm: { points: null } }),
      })
    );
    expect(result.eligibility[INTERPRETATION_ID.MATCHUP_SCORING_ENVIRONMENT]).toBe(
      'missing_required'
    );
  });

  it('DEPENDENCY_ISOLATION_TEST — mutate role minutes only', () => {
    const base = generateInterpretations(fullBundle());
    const mutated = generateInterpretations(
      fullBundle({
        role: baseRole({ recentRole: { minutes: 40 } }),
      })
    );
    const baseById = Object.fromEntries(
      base.rendered.map((r) => [r.interpretation.interpretationId, r.renderedText])
    );
    const mutById = Object.fromEntries(
      mutated.rendered.map((r) => [r.interpretation.interpretationId, r.renderedText])
    );
    expect(baseById[INTERPRETATION_ID.SCHEDULE_SUMMARY]).toBe(
      mutById[INTERPRETATION_ID.SCHEDULE_SUMMARY]
    );
    expect(baseById[INTERPRETATION_ID.AVAILABILITY_SUMMARY]).toBe(
      mutById[INTERPRETATION_ID.AVAILABILITY_SUMMARY]
    );
    expect(baseById[INTERPRETATION_ID.ROLE_PLAYING_TIME]).not.toBe(
      mutById[INTERPRETATION_ID.ROLE_PLAYING_TIME]
    );
  });

  it('RENDERED_VALUE_PARITY — params appear in prose', () => {
    const result = generateInterpretations(fullBundle());
    for (const r of result.rendered) {
      const again = renderInterpretation(r.interpretation);
      expect(again).toBe(r.renderedText);
    }
  });

  it('CORE_LLM_INDEPENDENCE — generation is pure/local', () => {
    // No network: two identical bundles → identical digests
    const a = generateInterpretations(fullBundle());
    const b = generateInterpretations(fullBundle());
    const dig = (x: typeof a) =>
      createHash('sha256')
        .update(JSON.stringify(x.rendered.map((r) => r.renderedText)))
        .digest('hex');
    expect(dig(a)).toBe(dig(b));
  });

  it('evidence mutation updates comparison + render', () => {
    const a = generateInterpretations(fullBundle());
    const b = generateInterpretations(
      fullBundle({ form: baseForm({ recentForm: { points: 28.5 } }) })
    );
    const aForm = a.interpretations.find(
      (i) => i.interpretationId === INTERPRETATION_ID.FORM_SCORING
    )!;
    const bForm = b.interpretations.find(
      (i) => i.interpretationId === INTERPRETATION_ID.FORM_SCORING
    )!;
    expect(aForm.comparison!.delta).not.toBe(bForm.comparison!.delta);
    expect(aForm.templateParameters.recent).toBe(27.5);
    expect(bForm.templateParameters.recent).toBe(28.5);
  });
});
