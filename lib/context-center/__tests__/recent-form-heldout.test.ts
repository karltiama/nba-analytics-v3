import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  computePlayerRoleContext,
  computeRecentFormContext,
  selectFormPriorHistory,
  selectPriorPlayedGames,
} from '@/lib/context-center';
import { FORM_HELDOUT_CASES } from './recent-form-heldout-fixtures';

/** Frozen before final certification — do not change fixtures without re-locking. */
export const FORM_HELDOUT_FIXTURE_SHA =
  '429f554ede4e55d11138eeb55f407c5b4ae8f6bea813ad0688e35d4fffbb2ade';

function canonicalize(): string {
  return JSON.stringify(FORM_HELDOUT_CASES);
}

describe('recent-form-context-v1 blind held-out', () => {
  it('has at least 20 held-out cases', () => {
    expect(FORM_HELDOUT_CASES.length).toBeGreaterThanOrEqual(20);
  });

  it('locks fixture SHA', () => {
    const sha = createHash('sha256').update(canonicalize()).digest('hex');
    // First run helper: if PENDING, print actual so we can freeze.
    if (FORM_HELDOUT_FIXTURE_SHA.startsWith('PENDING')) {
      // eslint-disable-next-line no-console
      console.log('FORM_HELDOUT_FIXTURE_SHA=', sha);
    }
    expect(sha).toBe(FORM_HELDOUT_FIXTURE_SHA);
  });

  for (const c of FORM_HELDOUT_CASES) {
    it(`${c.id} (${c.category})`, () => {
      const snap = computeRecentFormContext({
        gameId: c.gameId,
        playerEntityId: c.playerEntityId,
        teamId: c.teamId,
        season: c.season,
        targetGameStart: c.targetGameStart,
        history: c.history,
      });
      expect(snap.seasonForm.historyN).toBe(c.expect.seasonHistoryN);
      expect(snap.recentForm.historyN).toBe(c.expect.recentHistoryN);
      expect(snap.completeness.status).toBe(c.expect.completeness);
      expect(snap.seasonForm.points).toBe(c.expect.seasonPoints);
      expect(snap.seasonForm.rebounds).toBe(c.expect.seasonRebounds);
      expect(snap.seasonForm.tpm).toBe(c.expect.seasonTpm);
      expect(snap.seasonForm.fgPct).toBe(c.expect.seasonFgPct);
      expect(snap.seasonForm.threePct).toBe(c.expect.seasonThreePct);
      expect(snap.recentForm.points).toBe(c.expect.recentPoints);
      expect(snap.recentForm.fgPct).toBe(c.expect.recentFgPct);
      expect(snap.recentForm.threePct).toBe(c.expect.recentThreePct);
      expect(snap.predictiveStatus).toBe('NOT_TESTED');
      expect(snap.displayStatus).toBe('DISPLAYABLE');
      expect(snap.recentForm.historyN).toBeLessThanOrEqual(10);

      if (c.category === 'role_form_history_parity') {
        const rolePrior = selectPriorPlayedGames({
          season: c.season,
          teamId: c.teamId,
          targetGameStart: c.targetGameStart,
          history: c.history,
        });
        const formPrior = selectFormPriorHistory({
          season: c.season,
          teamId: c.teamId,
          targetGameStart: c.targetGameStart,
          history: c.history,
        });
        expect(formPrior.season.map((g) => g.gameId)).toEqual(rolePrior.map((g) => g.gameId));
        const roleSnap = computePlayerRoleContext({
          gameId: c.gameId,
          playerEntityId: c.playerEntityId,
          teamId: c.teamId,
          season: c.season,
          targetGameStart: c.targetGameStart,
          history: c.history,
        });
        expect(snap.seasonForm.historyN).toBe(roleSnap.seasonRole.historyN);
        expect(snap.recentForm.historyN).toBe(roleSnap.recentRole.historyN);
      }
    });
  }
});
