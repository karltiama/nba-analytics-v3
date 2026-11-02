import { describe, expect, it } from 'vitest';
import {
  CARD_CONTEXT_REFRESH_MS,
  cardContextPollDelayMs,
  readCardContextPayload,
} from '@/lib/scoreboard/card-context/client';

describe('card context client', () => {
  it('refreshes every 5 minutes only while a game is still scheduled', () => {
    expect(CARD_CONTEXT_REFRESH_MS).toBe(300_000);
    expect(cardContextPollDelayMs([{ lifecycle: 'scheduled' }, { lifecycle: 'live' }])).toBe(300_000);
    expect(cardContextPollDelayMs([{ lifecycle: 'live' }, { lifecycle: 'final' }])).toBeNull();
    expect(cardContextPollDelayMs([{ lifecycle: 'final' }])).toBeNull();
    expect(cardContextPollDelayMs([])).toBeNull();
    expect(cardContextPollDelayMs(null)).toBeNull();
  });

  it('drops a store error and a malformed payload so cards keep the fallback', () => {
    expect(readCardContextPayload(null)).toBeNull();
    expect(readCardContextPayload({ schema_version: 'card-context.v1', games: {}, error: 'scoreboard_store_unavailable' })).toBeNull();
    expect(readCardContextPayload({ schema_version: 'scoreboard.v1', games: {} })).toBeNull();
    expect(
      readCardContextPayload({
        schema_version: 'card-context.v1',
        games: {
          '5001': {
            schedule: { status: 'unavailable', text: 'Schedule context unavailable.' },
            injuries: { status: 'unavailable', text: 'Injury report unavailable', as_of: null },
          },
        },
      })
    ).toEqual({
      '5001': {
        schedule: 'Schedule context unavailable.',
        injuries: 'Injury report unavailable',
        injuryTeams: null,
        asOfLabel: null,
      },
    });
  });

  it('keeps a text-only payload and passes structured teams through when they are present', () => {
    const textOnly = readCardContextPayload({
      schema_version: 'card-context.v1',
      games: {
        '5001': {
          schedule: { status: 'ready', text: 'Both teams on 1 day rest' },
          injuries: { status: 'none', text: 'No key injuries listed · as of 5:00 PM ET', as_of: '2026-11-02T21:00:00.000Z' },
        },
      },
    });
    expect(textOnly?.['5001']).toEqual({
      schedule: 'Both teams on 1 day rest',
      injuries: 'No key injuries listed · as of 5:00 PM ET',
      injuryTeams: null,
      asOfLabel: null,
    });

    const structured = readCardContextPayload({
      schema_version: 'card-context.v1',
      games: {
        '5001': {
          schedule: { status: 'ready', text: 'Both teams on 1 day rest' },
          injuries: {
            status: 'listed',
            text: 'CLE: Mitchell (Q) · OKC: no key injuries listed · as of Nov 1, 5:00 PM ET',
            as_of: '2026-11-01T22:00:00.000Z',
            as_of_label: 'as of Nov 1, 5:00 PM ET',
            teams: [
              { abbr: 'CLE', players: [{ name: 'Mitchell', status: 'Q' }], extra: 0 },
              { abbr: 'OKC', players: [], extra: 0 },
            ],
          },
        },
      },
    });
    expect(structured?.['5001'].injuryTeams).toEqual([
      { abbr: 'CLE', players: [{ name: 'Mitchell', status: 'Q' }], extra: 0 },
      { abbr: 'OKC', players: [], extra: 0 },
    ]);
    expect(structured?.['5001'].asOfLabel).toBe('as of Nov 1, 5:00 PM ET');
    expect(structured?.['5001'].injuries).toContain('Mitchell (Q)');
  });
});
