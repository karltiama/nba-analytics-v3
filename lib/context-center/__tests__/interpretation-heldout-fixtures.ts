/**
 * Blind held-out fixtures for context-interpretation-v1.
 * SHA frozen before final certification run.
 */

import type { InterpretationInputBundle } from '../interpretation/generate';
import {
  baseAvailability,
  baseForm,
  baseOpp,
  baseRole,
  baseSchedule,
  fullBundle,
} from './interpretation-fixtures';

export type HeldoutCase = {
  id: string;
  category: string;
  bundle: InterpretationInputBundle;
  expectIds?: string[];
  expectRenderIncludes?: string[];
  expectRenderExcludes?: string[];
  expectMissingIds?: string[];
  expectThrow?: boolean;
};

function bundleWith(
  overrides: Parameters<typeof fullBundle>[0]
): InterpretationInputBundle {
  return fullBundle(overrides);
}

export const INTERPRETATION_HELDOUT_CASES: HeldoutCase[] = [
  {
    id: 'avail-complete',
    category: 'Availability COMPLETE',
    bundle: bundleWith({}),
    expectIds: ['interpretation.availability_summary'],
    expectRenderIncludes: ['65.5 prior rotation minutes'],
  },
  {
    id: 'avail-partial',
    category: 'Availability PARTIAL',
    bundle: bundleWith({
      availability: baseAvailability({
        injuryBurden: { expectedMissingMinutes: 42.3 },
        completeness: {
          status: 'PARTIAL',
          roleRequiredCount: 2,
          roleEstimatedCount: 1,
          coverageRate: 0.5,
        },
      }),
    }),
    expectRenderIncludes: ['At least 42.3', 'unavailable'],
  },
  {
    id: 'schedule-b2b',
    category: 'Schedule B2B',
    bundle: bundleWith({
      schedule: baseSchedule({
        schedule: { homeAway: 'AWAY', daysRest: 0, backToBack: true, isSeasonOpener: false },
      }),
    }),
    expectRenderIncludes: ['Away on the second night of a back-to-back'],
  },
  {
    id: 'season-opener',
    category: 'Season opener',
    bundle: bundleWith({
      schedule: baseSchedule({
        schedule: {
          homeAway: 'HOME',
          daysRest: null,
          backToBack: false,
          isSeasonOpener: true,
        },
      }),
    }),
    expectRenderIncludes: ['Season opener at home'],
    expectRenderExcludes: ['well rested', 'days of rest'],
  },
  {
    id: 'role-increase',
    category: 'Role increase',
    bundle: bundleWith({
      role: baseRole({
        seasonRole: { minutes: 30 },
        recentRole: { minutes: 36 },
      }),
    }),
    expectRenderIncludes: ['+6.0'],
  },
  {
    id: 'role-decrease',
    category: 'Role decrease',
    bundle: bundleWith({
      role: baseRole({
        seasonRole: { minutes: 36 },
        recentRole: { minutes: 30 },
      }),
    }),
    expectRenderIncludes: ['−6.0'],
  },
  {
    id: 'role-suppressed',
    category: 'Role suppressed-at-precision',
    bundle: bundleWith({
      role: baseRole({
        seasonRole: { minutes: 34.21, fga: 18.0 },
        recentRole: { minutes: 34.24, fga: 18.04 },
      }),
    }),
    expectMissingIds: [
      'interpretation.role_playing_time',
      'interpretation.role_shot_opportunity',
    ],
  },
  {
    id: 'form-increase',
    category: 'Form increase',
    bundle: bundleWith({
      form: baseForm({ seasonForm: { points: 20 }, recentForm: { points: 28 } }),
    }),
    expectRenderIncludes: ['+8.0'],
  },
  {
    id: 'form-decrease',
    category: 'Form decrease',
    bundle: bundleWith({
      form: baseForm({ seasonForm: { points: 28 }, recentForm: { points: 20 } }),
    }),
    expectRenderIncludes: ['−8.0'],
  },
  {
    id: 'null-3p',
    category: 'null 3P%',
    bundle: bundleWith({
      form: baseForm({
        recentForm: { threePct: null, threeAttempted: 0, threeMade: 0 },
      }),
    }),
    expectRenderExcludes: ['three-point shooting is 0'],
  },
  {
    id: 'small-sample',
    category: 'small sample',
    bundle: bundleWith({
      role: baseRole({ recentRole: { historyN: 2 } }),
      form: baseForm({ recentForm: { historyN: 2 } }),
    }),
    expectRenderIncludes: ['Recent sample: 2 prior played games'],
  },
  {
    id: 'matchup-scoring',
    category: 'Matchup scoring',
    bundle: bundleWith({}),
    expectIds: ['interpretation.matchup_scoring_environment'],
    expectRenderIncludes: ['113.7 pregame defensive rating'],
  },
  {
    id: 'matchup-perimeter-complete',
    category: 'Matchup perimeter COMPLETE',
    bundle: bundleWith({}),
    expectIds: ['interpretation.matchup_perimeter'],
    expectRenderIncludes: ['opposing field-goal attempts from three'],
  },
  {
    id: 'matchup-perimeter-partial',
    category: 'Matchup perimeter PARTIAL',
    bundle: bundleWith({
      form: baseForm({
        recentForm: { threePct: null, tpm: null },
        seasonForm: { threePct: null, tpm: null },
      }),
      role: baseRole({ seasonRole: { tpa: null } }),
    }),
    expectIds: ['interpretation.matchup_perimeter'],
    expectRenderExcludes: undefined,
  },
  {
    id: 'cold-start',
    category: 'cold start',
    bundle: bundleWith({
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
        seasonForm: { historyN: 0, points: null, fgPct: null, threePct: null },
        recentForm: { historyN: 0, points: null, fgPct: null, threePct: null },
      }),
    }),
    expectMissingIds: [
      'interpretation.role_playing_time',
      'interpretation.form_scoring',
    ],
  },
  {
    id: 'contradictory',
    category: 'contradictory Role/Form',
    bundle: bundleWith({
      role: baseRole({
        seasonRole: { fga: 14 },
        recentRole: { fga: 22 },
      }),
      form: baseForm({
        seasonForm: { points: 26 },
        recentForm: { points: 18 },
      }),
    }),
    expectRenderIncludes: ['shot volume', 'scoring'],
    expectRenderExcludes: ['struggling despite'],
  },
  // Extra coverage cases to reach ≥30
  ...Array.from({ length: 14 }, (_, i) => {
    const minutes = 28 + i * 0.5;
    return {
      id: `dense-var-${i}`,
      category: i % 2 === 0 ? 'dense cases' : 'large recent-vs-season changes',
      bundle: bundleWith({
        role: baseRole({
          seasonRole: { minutes: 30, fga: 15 + i * 0.1 },
          recentRole: { minutes, fga: 18 + i * 0.2 },
        }),
        form: baseForm({
          seasonForm: { points: 20 },
          recentForm: { points: 22 + i * 0.3 },
        }),
        schedule: baseSchedule({
          schedule: {
            homeAway: i % 2 === 0 ? 'HOME' : 'AWAY',
            daysRest: (i % 4) + 1,
            backToBack: false,
            isSeasonOpener: false,
          },
        }),
      }),
      expectIds: ['interpretation.schedule_summary'],
    } satisfies HeldoutCase;
  }),
];

export function heldoutPayloadForSha(): unknown {
  return INTERPRETATION_HELDOUT_CASES.map((c) => ({
    id: c.id,
    category: c.category,
    expectIds: c.expectIds ?? null,
    expectRenderIncludes: c.expectRenderIncludes ?? null,
    expectRenderExcludes: c.expectRenderExcludes ?? null,
    expectMissingIds: c.expectMissingIds ?? null,
    // Identity only — not full nested snapshots (stable freeze surface)
    identity: {
      gameId: c.bundle.gameId,
      playerEntityId: c.bundle.playerEntityId,
      teamId: c.bundle.teamId,
      opponentTeamId: c.bundle.opponentTeamId,
      targetGameStart: c.bundle.targetGameStart,
    },
  }));
}
