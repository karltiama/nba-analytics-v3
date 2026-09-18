import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MatchupCompositionError,
  assertMatchupInputValueParity,
  composeMatchupContext,
} from '@/lib/context-center';
import { MATCHUP_HELDOUT_CASES } from './matchup-heldout-fixtures';

/** Frozen before final certification — do not change fixtures without re-locking. */
export const MATCHUP_HELDOUT_FIXTURE_SHA =
  '503f5c2b4fe29c606ff19808d628a0ec04789d8654f98959cea1bf44613aeda2';

function canonicalize(): string {
  return JSON.stringify(MATCHUP_HELDOUT_CASES);
}

describe('matchup-context-v1 blind held-out', () => {
  it('has at least 20 held-out cases', () => {
    expect(MATCHUP_HELDOUT_CASES.length).toBeGreaterThanOrEqual(20);
  });

  it('locks fixture SHA', () => {
    const sha = createHash('sha256').update(canonicalize()).digest('hex');
    if (MATCHUP_HELDOUT_FIXTURE_SHA.startsWith('PENDING')) {
      // eslint-disable-next-line no-console
      console.log('MATCHUP_HELDOUT_FIXTURE_SHA=', sha);
    }
    expect(sha).toBe(MATCHUP_HELDOUT_FIXTURE_SHA);
  });

  for (const c of MATCHUP_HELDOUT_CASES) {
    it(`${c.id} (${c.category})`, () => {
      if (c.expectError) {
        try {
          composeMatchupContext({ role: c.role, form: c.form, opponent: c.opponent });
          expect.fail('expected MatchupCompositionError');
        } catch (e) {
          expect(e).toBeInstanceOf(MatchupCompositionError);
          expect((e as MatchupCompositionError).code).toBe(c.expectError);
        }
        return;
      }
      const snap = composeMatchupContext({
        role: c.role,
        form: c.form,
        opponent: c.opponent,
      });
      expect(snap.scoringEnvironment.completeness).toBe(c.expect!.scoring);
      expect(snap.perimeter.completeness).toBe(c.expect!.perimeter);
      expect(snap.completeness.status).toBe(c.expect!.overall);
      expect(snap.predictiveStatus).toBe('NOT_TESTED');
      expect(snap.displayStatus).toBe('DISPLAYABLE');
      expect(snap.provenance.newScalarFields).toEqual([]);
      if (c.expect!.opponentTeamId) {
        expect(snap.opponentTeamId).toBe(c.expect!.opponentTeamId);
      }
      if (c.category === 'source_parity') {
        expect(snap.scoringEnvironment.required['form.recent_points']!.value).toBe(27.5);
        expect(snap.perimeter.required['role.recent_tpa']!.value).toBe(8.4);
        assertMatchupInputValueParity(snap);
      }
    });
  }
});
