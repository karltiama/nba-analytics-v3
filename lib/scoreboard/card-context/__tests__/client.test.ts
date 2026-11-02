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
      },
    });
  });
});
