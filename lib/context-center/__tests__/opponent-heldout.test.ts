import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  buildOpponentHistoryIndex,
  computeOpponentContext,
} from '@/lib/context-center';
import { OPPONENT_HELDOUT_CASES } from './opponent-heldout-fixtures';

const payload = JSON.stringify(OPPONENT_HELDOUT_CASES);
export const OPPONENT_HELDOUT_FIXTURE_SHA256 = createHash('sha256').update(payload).digest('hex');

/** Locked after first green held-out run. */
export const OPPONENT_HELDOUT_FIXTURE_SHA256_LOCKED =
  '472269ae1d45c5188e2363b7494dd7b5099c37928b4a1e4a7dbae144c9075a1c';

describe('opponent-context-v1 blind held-out', () => {
  it('has at least 18 cases covering required categories', () => {
    expect(OPPONENT_HELDOUT_CASES.length).toBeGreaterThanOrEqual(18);
    const cats = new Set(OPPONENT_HELDOUT_CASES.map((c) => c.category));
    for (const need of [
      'cold_start',
      'history_n_1',
      'history_n_gt10',
      'same_tip_exclusion',
      'future_exclusion',
      'prior_season_exclusion',
      'pooled_drtg',
      'pooled_dreb',
      'pooled_oreb',
      'pooled_tov',
      'pooled_3pa_allowed',
      'pace_mean',
      'perspective_correctness',
      'ot',
      'missing_source_case',
      'stale_tgs_independence',
      'non_final_exclusion',
    ]) {
      expect(cats.has(need)).toBe(true);
    }
  });

  it('matches exact expected outputs', () => {
    for (const c of OPPONENT_HELDOUT_CASES) {
      const index = buildOpponentHistoryIndex(c.historyBoxes);
      const snap = computeOpponentContext({
        teamId: c.teamId,
        target: c.target,
        index,
      });
      expect(snap.opponentTeamId, c.id).toBe(c.expect.opponentTeamId);
      expect(snap.history.n, c.id).toBe(c.expect.historyN);
      expect(snap.completeness.status, c.id).toBe(c.expect.completeness);
      expect(snap.history.latestGameStart, c.id).toBe(c.expect.latestGameStart);
      expect(snap.provenance.staleTgsAdvancedColumnsUsed, c.id).toBe(false);
      expect(snap.predictiveStatus, c.id).toBe('NOT_TESTED');

      const approx = (got: number | null, exp: number | null, label: string) => {
        if (exp == null) {
          expect(got, `${c.id}.${label}`).toBeNull();
          return;
        }
        expect(got, `${c.id}.${label}`).toBeCloseTo(exp, 10);
      };
      approx(snap.opponent.pace, c.expect.pace, 'pace');
      approx(snap.opponent.defensiveRating, c.expect.defensiveRating, 'drtg');
      approx(snap.opponent.defensiveReboundPct, c.expect.defensiveReboundPct, 'drb');
      approx(snap.opponent.offensiveReboundPct, c.expect.offensiveReboundPct, 'orb');
      approx(snap.opponent.turnoverRate, c.expect.turnoverRate, 'tov');
      approx(
        snap.opponent.threePointAttemptRateAllowed,
        c.expect.threePointAttemptRateAllowed,
        '3pa'
      );
    }
  });

  it('prints and optionally locks fixture SHA', () => {
    console.log(`OPPONENT_HELDOUT_FIXTURE_SHA256=${OPPONENT_HELDOUT_FIXTURE_SHA256}`);
    if (OPPONENT_HELDOUT_FIXTURE_SHA256_LOCKED !== 'PENDING_LOCK') {
      expect(OPPONENT_HELDOUT_FIXTURE_SHA256).toBe(OPPONENT_HELDOUT_FIXTURE_SHA256_LOCKED);
    }
  });
});
