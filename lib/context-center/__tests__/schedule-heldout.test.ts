import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assertScheduleInvariants,
  computeTeamGameSchedule,
} from '@/lib/context-center';
import { SCHEDULE_HELDOUT_CASES } from './schedule-heldout-fixtures';

function fixtureDigest(): string {
  const payload = JSON.stringify(SCHEDULE_HELDOUT_CASES);
  return createHash('sha256').update(payload).digest('hex');
}

export const SCHEDULE_HELDOUT_FIXTURE_SHA256 =
  '96131ae159c732368146d86d0a324778e27d0af7959fed1830afad43286277f2';

describe('Blind held-out Schedule Context', () => {
  it('covers required categories with exact outputs', () => {
    expect(SCHEDULE_HELDOUT_CASES.length).toBeGreaterThanOrEqual(15);
    const cats = new Set(SCHEDULE_HELDOUT_CASES.map((c) => c.category));
    for (const need of [
      'HOME',
      'AWAY',
      '0_rest',
      '1_rest',
      '2+_rest',
      'season_opener',
      'long_break',
      'ET_UTC_boundary',
      'same_tip_exclusion',
      'postponed_prior',
      'month_boundary',
      'year_boundary',
    ]) {
      expect(cats.has(need), need).toBe(true);
    }

    for (const c of SCHEDULE_HELDOUT_CASES) {
      const snap = computeTeamGameSchedule({
        teamId: c.teamId,
        target: c.target,
        history: [...c.history, c.target],
      });
      assertScheduleInvariants(snap);
      expect(snap.schedule.homeAway, c.id).toBe(c.expected.homeAway);
      expect(snap.schedule.daysRest, c.id).toBe(c.expected.daysRest);
      expect(snap.schedule.backToBack, c.id).toBe(c.expected.backToBack);
      expect(snap.schedule.isSeasonOpener, c.id).toBe(c.expected.isSeasonOpener);
      expect(snap.provenance.previousGameId, c.id).toBe(c.expected.previousGameId);
      expect(snap.predictiveStatus).toBe('NOT_TESTED');
      expect(snap.displayStatus).toBe('DISPLAYABLE');
    }
  });

  it('records held-out fixture SHA', () => {
    const sha = fixtureDigest();
    // eslint-disable-next-line no-console
    console.log(`SCHEDULE_HELDOUT_FIXTURE_SHA256=${sha}`);
    expect(sha.length).toBe(64);
    if (SCHEDULE_HELDOUT_FIXTURE_SHA256 !== 'PENDING_LOCK') {
      expect(sha).toBe(SCHEDULE_HELDOUT_FIXTURE_SHA256);
    }
  });
});
