import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import { computePlayerRoleContext, estimatePlayerRole } from '@/lib/context-center';
import { ROLE_HELDOUT_CASES } from './player-role-heldout-fixtures';

const payload = JSON.stringify(ROLE_HELDOUT_CASES);
export const ROLE_HELDOUT_FIXTURE_SHA256 = createHash('sha256').update(payload).digest('hex');
export const ROLE_HELDOUT_FIXTURE_SHA256_LOCKED =
  '1a9b5047cdf09cc3a7e5438d5a3d11fa06927309ae4e72af01e650865eaa328f';

describe('player-role-context-v1 blind held-out', () => {
  it('has at least 20 cases with required categories', () => {
    expect(ROLE_HELDOUT_CASES.length).toBeGreaterThanOrEqual(20);
    const cats = new Set(ROLE_HELDOUT_CASES.map((c) => c.category));
    for (const need of [
      'cold_start',
      'history_n_1',
      'history_n_2',
      'history_n_gt10',
      'recent_rollover',
      'season_reset',
      'trade_reset',
      'return_stint',
      'dnp_exclusion',
      'same_tip_exclusion',
      'future_exclusion',
      'target_outcome_exclusion',
      'overtime_minutes',
      'metric_exact_means',
      'next_game_ingestion',
    ]) {
      expect(cats.has(need), need).toBe(true);
    }
  });

  it('matches exact expected outputs', () => {
    for (const c of ROLE_HELDOUT_CASES) {
      const snap = computePlayerRoleContext({
        gameId: c.gameId,
        playerEntityId: c.playerEntityId,
        teamId: c.teamId,
        season: c.season,
        targetGameStart: c.targetGameStart,
        history: c.history,
      });
      expect(snap.seasonRole.historyN, c.id).toBe(c.expect.seasonHistoryN);
      expect(snap.recentRole.historyN, c.id).toBe(c.expect.recentHistoryN);
      expect(snap.completeness.status, c.id).toBe(c.expect.completeness);
      expect(snap.recentRole.windowMax, c.id).toBe(10);
      expect(snap.predictiveStatus, c.id).toBe('NOT_TESTED');

      const approx = (got: number | null, exp: number | null, label: string) => {
        if (exp == null) {
          expect(got, `${c.id}.${label}`).toBeNull();
          return;
        }
        expect(got, `${c.id}.${label}`).toBeCloseTo(exp, 10);
      };
      approx(snap.seasonRole.minutes, c.expect.seasonMinutes, 'seasonMin');
      approx(snap.seasonRole.fga, c.expect.seasonFga, 'seasonFga');
      approx(snap.seasonRole.fta, c.expect.seasonFta, 'seasonFta');
      approx(snap.seasonRole.ast, c.expect.seasonAst, 'seasonAst');
      approx(snap.seasonRole.tpa, c.expect.seasonTpa, 'seasonTpa');
      approx(snap.recentRole.minutes, c.expect.recentMinutes, 'recentMin');
      approx(snap.recentRole.fga, c.expect.recentFga, 'recentFga');

      if (c.category === 'role_expectation_parity') {
        const est = estimatePlayerRole({
          playerEntityId: c.playerEntityId,
          season: c.season,
          teamId: c.teamId,
          targetGameStart: c.targetGameStart,
          history: c.history,
        });
        expect(est.status).toBe('OK');
        if (est.status === 'OK') {
          expect(est.estimate.expectedMinutes).toBe(snap.seasonRole.minutes);
          expect(est.estimate.expectedFga).toBe(snap.seasonRole.fga);
          expect(est.estimate.expectedPoints).toBe(20);
        }
      }
    }
  });

  it('prints and locks fixture SHA', () => {
    console.log(`ROLE_HELDOUT_FIXTURE_SHA256=${ROLE_HELDOUT_FIXTURE_SHA256}`);
    if (ROLE_HELDOUT_FIXTURE_SHA256_LOCKED !== 'PENDING_LOCK') {
      expect(ROLE_HELDOUT_FIXTURE_SHA256).toBe(ROLE_HELDOUT_FIXTURE_SHA256_LOCKED);
    }
  });
});
