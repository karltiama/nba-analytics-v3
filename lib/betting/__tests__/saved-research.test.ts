import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import {
  isSavedPaperAllowed,
  resolveSavedMarketContext,
  savedBookmarkLabel,
  savedResearchEmptyCopy,
  savedResearchHref,
  savedResearchLinks,
} from '../saved-research';
import { shouldShowLayoutHeader } from '@/components/betting/betting-shell-paths';
import { PRIMARY_NAV } from '@/components/betting/primary-nav';
import { mapSavedResearchRow, SAVED_RESEARCH_DELETE_SQL, SAVED_RESEARCH_INSERT_SQL, SAVED_RESEARCH_LIST_SQL } from '../saved-research-queries';

const BASE_ROW = {
  id: 'save-1',
  user_id: 'user-a',
  game_id: '21681995',
  player_id: 9,
  player_name: 'Jarrett Allen',
  sportsbook: 'betmgm',
  prop_type: 'points',
  market_type: 'over_under',
  side: 'over',
  line_value: 10.5,
  odds_american: -125,
  implied_probability: 0.556,
  snapshot_at: '2026-05-01T18:00:11.909Z',
  note: null,
  created_at: '2026-09-06T20:00:00.000Z',
  updated_at: '2026-09-06T20:00:00.000Z',
  market_context: 'historical',
  date_et: '2026-05-01',
  game_start_time: '2026-05-01T23:30:00.000Z',
  game_status: 'Final',
  away_abbr: 'CLE',
  home_abbr: 'TOR',
};

describe('saved research snapshot contract', () => {
  it('preserves the saved snapshot fields rather than requiring a live current row', () => {
    const item = mapSavedResearchRow(
      { ...BASE_ROW, away_abbr: null, home_abbr: null, game_start_time: null },
      '2026-09-06'
    );
    expect(item.lineValue).toBe(10.5);
    expect(item.oddsAmerican).toBe(-125);
    expect(item.sportsbook).toBe('betmgm');
    expect(item.snapshotAt).toBe('2026-05-01T18:00:11.909Z');
    expect(item.matchup).toBeNull();
  });

  it('keeps a historical May 1 bookmark historical after the source market is gone', () => {
    const item = mapSavedResearchRow(BASE_ROW, '2026-09-06');
    expect(item.marketContext).toBe('historical');
    expect(item.lineLabel).toBe('Historical closing line');
    expect(item.lineLabel).not.toMatch(/current|live/i);
    expect(savedBookmarkLabel('historical')).not.toMatch(/current|live/i);
    expect(item.paperBetAllowed).toBe(false);
  });

  it('does not drop a bookmark when the game is Final', () => {
    const item = mapSavedResearchRow(BASE_ROW, '2026-09-06');
    expect(item.gameStatus).toBe('Final');
    expect(item.playerName).toBe('Jarrett Allen');
    expect(item.matchup).toBe('CLE @ TOR');
  });

  it('keeps a true line of 0 instead of treating it as missing', () => {
    const item = mapSavedResearchRow({ ...BASE_ROW, line_value: 0 }, '2026-09-06');
    expect(item.lineValue).toBe(0);
  });

  it('keeps a persisted live snapshot after the calendar date advances', () => {
    const item = mapSavedResearchRow(
      { ...BASE_ROW, market_context: 'live', date_et: '2026-09-06', snapshot_at: '2026-09-06T18:00:00.000Z' },
      '2026-09-07'
    );
    expect(item.marketContext).toBe('live');
    expect(item.lineLabel).toBe('Saved market snapshot');
    expect(item.paperBetAllowed).toBe(true);
    expect(
      resolveSavedMarketContext({
        stored: 'live',
        dateEt: '2026-09-06',
        todayEt: '2026-09-07',
      })
    ).toBe('live');
  });

  it('keeps a persisted historical snapshot historical', () => {
    const item = mapSavedResearchRow(BASE_ROW, '2026-09-07');
    expect(item.marketContext).toBe('historical');
    expect(item.lineLabel).toBe('Historical closing line');
  });

  it('falls back to date derivation for legacy rows with null stored context', () => {
    const historicalLegacy = mapSavedResearchRow(
      { ...BASE_ROW, market_context: null, date_et: '2026-05-01' },
      '2026-09-06'
    );
    expect(historicalLegacy.marketContext).toBe('historical');
    const liveLegacy = mapSavedResearchRow(
      {
        ...BASE_ROW,
        market_context: null,
        date_et: '2026-09-06',
        snapshot_at: '2026-09-06T18:00:00.000Z',
        game_start_time: '2026-09-06T23:30:00.000Z',
      },
      '2026-09-06'
    );
    expect(liveLegacy.marketContext).toBe('live');
  });
});

describe('saved research navigation', () => {
  it('preserves original date and game when opening Explorer/player/game', () => {
    const links = savedResearchLinks({
      playerId: 9,
      gameId: '21681995',
      dateEt: '2026-05-01',
      propType: 'points',
      side: 'over',
      sportsbook: 'betmgm',
      lineValue: 10.5,
    });
    expect(links.explorerHref).toBe(
      '/betting/props-explorer?date=2026-05-01&game_id=21681995'
    );
    expect(links.gameHref).toBe('/betting/games/21681995');
    expect(links.playerHref).toContain('/betting/players/9?');
    expect(links.playerHref).toContain('date=2026-05-01');
    expect(links.playerHref).toContain('game_id=21681995');
    expect(savedResearchHref()).toBe('/betting/saved');
  });

  it('disables paper on historical bookmarks', () => {
    expect(isSavedPaperAllowed('historical')).toBe(false);
  });
});

describe('empty saved state', () => {
  it('explains how to save without looking like a load failure', () => {
    const copy = savedResearchEmptyCopy();
    expect(copy.title).toMatch(/No saved research yet/i);
    expect(copy.detail).toMatch(/Props Explorer/i);
    expect(copy.cta).toMatch(/Props Explorer/i);
    expect(copy.detail).not.toMatch(/failed to load/i);
  });
});

describe('user isolation SQL', () => {
  it('lists and deletes only with the authenticated user_id bind', () => {
    expect(SAVED_RESEARCH_LIST_SQL).toMatch(/WHERE s\.user_id = \$1::uuid/);
    expect(SAVED_RESEARCH_LIST_SQL).toMatch(/s\.market_context/);
    expect(SAVED_RESEARCH_LIST_SQL).not.toMatch(/NULL::text AS market_context/);
    expect(SAVED_RESEARCH_LIST_SQL).toMatch(/LEFT JOIN analytics\.games/);
    expect(SAVED_RESEARCH_LIST_SQL).not.toMatch(/INNER JOIN analytics\.games/);
    expect(SAVED_RESEARCH_DELETE_SQL).toMatch(/user_id = \$2::uuid/);
    expect(SAVED_RESEARCH_INSERT_SQL).toMatch(/\$1::uuid/);
    expect(SAVED_RESEARCH_INSERT_SQL).toMatch(/market_context, date_et/);
  });
});

describe('saved research navigation item', () => {
  it('is a primary betting destination with header shell', () => {
    expect(PRIMARY_NAV.some((n) => n.href === '/betting/saved' && n.label === 'Saved')).toBe(true);
    expect(PRIMARY_NAV.some((n) => n.href === '/betting/research')).toBe(false);
    expect(shouldShowLayoutHeader('/betting/saved')).toBe(true);
  });
});
