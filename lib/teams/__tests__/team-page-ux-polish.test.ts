import { describe, expect, it } from 'vitest';
import {
  CONTINUITY_LIST_PREVIEW,
  previewContinuityList,
  type ContinuityPlayer,
} from '../team-roster-continuity';

function p(id: string, name: string): ContinuityPlayer {
  return { playerEntityId: id, displayName: name, playerId: null };
}

describe('team-page UX polish (Phase 2.T.4)', () => {
  it('continuity list preview stays compact (3 + more)', () => {
    expect(CONTINUITY_LIST_PREVIEW).toBe(3);
    const players = [
      p('1', 'A'),
      p('2', 'B'),
      p('3', 'C'),
      p('4', 'D'),
      p('5', 'E'),
    ];
    const { shown, more } = previewContinuityList(players);
    expect(shown).toHaveLength(3);
    expect(more).toBe(2);
  });

  it('inline join format uses middot separators without fabricating names', () => {
    const { shown, more } = previewContinuityList([
      p('1', 'Player A'),
      p('2', 'Player B'),
      p('3', 'Player C'),
      p('4', 'Player D'),
    ]);
    const line = `${shown.map((x) => x.displayName).join(' · ')}${
      more > 0 ? ` · +${more} more` : ''
    }`;
    expect(line).toBe('Player A · Player B · Player C · +1 more');
  });
});
