import { describe, expect, it } from 'vitest';
import {
  formatWowyTeammatePickerLabel,
  resolveWowyExplorerSelection,
  wowySummaryMatchesSelection,
} from '../explorer-selection';

describe('resolveWowyExplorerSelection', () => {
  it('does not fetch a subject-mode pair while a teammate is still requested', () => {
    const pending = resolveWowyExplorerSelection({
      requestedTeammateId: '335',
      teammateIds: [],
      contextLoaded: false,
    });
    expect(pending.readyToFetchPair).toBe(false);
    expect(pending.visibleTeammateId).toBeNull();
    expect(pending.teammateIdForPair).toBe('335');
  });

  it('fetches teammate mode once the requested id is in the loaded options', () => {
    const ready = resolveWowyExplorerSelection({
      requestedTeammateId: '335',
      teammateIds: ['177', '335'],
      contextLoaded: true,
    });
    expect(ready.readyToFetchPair).toBe(true);
    expect(ready.teammateIdForPair).toBe('335');
    expect(ready.visibleTeammateId).toBe('335');
    expect(ready.clearRequested).toBe(false);
    expect(
      wowySummaryMatchesSelection(
        { query: { teammatePlayerId: '335' }, mode: 'teammate' },
        ready.teammateIdForPair
      )
    ).toBe(true);
    expect(
      wowySummaryMatchesSelection(
        { query: { teammatePlayerId: null }, mode: 'subject' },
        ready.teammateIdForPair
      )
    ).toBe(false);
  });

  it('clears an invalid teammate after context change before showing self-mode', () => {
    const cleared = resolveWowyExplorerSelection({
      requestedTeammateId: '335',
      teammateIds: ['177'],
      contextLoaded: true,
    });
    expect(cleared.clearRequested).toBe(true);
    expect(cleared.visibleTeammateId).toBeNull();
    expect(cleared.teammateIdForPair).toBeNull();
    expect(cleared.readyToFetchPair).toBe(true);
    expect(
      wowySummaryMatchesSelection({ query: { teammatePlayerId: null }, mode: 'subject' }, cleared.teammateIdForPair)
    ).toBe(true);
  });

  it('labels picker counts as with / verified DNP, not together', () => {
    const label = formatWowyTeammatePickerLabel({
      fullName: 'Jamal Murray',
      togetherPlayedGames: 58,
      verifiedDnpGames: 12,
    });
    expect(label).toBe('Jamal Murray · 58 with · 12 verified DNP');
    expect(label).not.toMatch(/together/i);
  });
});
