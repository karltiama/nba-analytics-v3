import { describe, expect, it } from 'vitest';
import {
  explorerGamesApiHref,
  explorerReturnHref,
  gameDetailHref,
  parsePlayerReturnContext,
  playerResearchHref,
  propsExplorerHref,
  slateHref,
} from '../research-journey';

describe('research journey URLs', () => {
  it('game → Explorer preserves game and date', () => {
    expect(propsExplorerHref({ gameId: '21681995', date: '2026-05-01' })).toBe(
      '/betting/props-explorer?date=2026-05-01&game_id=21681995'
    );
  });

  it('historical player return preserves game/date rather than today', () => {
    const href = playerResearchHref({
      playerId: '1629027',
      date: '2026-05-01',
      gameId: '21681995',
      propType: 'points',
      side: 'over',
      sportsbook: 'betmgm',
      lineValue: 28.5,
    });
    expect(href).toContain('/betting/players/1629027?');
    expect(href).toContain('date=2026-05-01');
    expect(href).toContain('game_id=21681995');
    expect(href).toContain('from=explorer');
    expect(href).not.toContain('2026-09-06');

    const ctx = parsePlayerReturnContext(new URLSearchParams(href.split('?')[1]));
    expect(explorerReturnHref(ctx)).toBe(
      '/betting/props-explorer?date=2026-05-01&game_id=21681995'
    );
    expect(gameDetailHref(ctx.gameId!)).toBe('/betting/games/21681995');
  });

  it('current-path Explorer href stays on today without a game fallback', () => {
    expect(propsExplorerHref({ date: '2026-09-06' })).toBe(
      '/betting/props-explorer?date=2026-09-06'
    );
    expect(slateHref('2026-09-06')).toBe('/betting?date=2026-09-06');
  });

  it('empty Explorer still has a game back-link from the same identifiers', () => {
    const empty = propsExplorerHref({ date: '2026-05-06', gameId: '21700001' });
    expect(empty).toBe('/betting/props-explorer?date=2026-05-06&game_id=21700001');
    expect(gameDetailHref('21700001')).toBe('/betting/games/21700001');
  });

  it('historical explorer picker requests calendar scope for the selected date only', () => {
    const href = explorerGamesApiHref({ dateEt: '2026-05-01', todayEt: '2026-09-06' });
    expect(href).toContain('date=2026-05-01');
    expect(href).toContain('scope=explorer');
    expect(href).toContain('picker=calendar');
    expect(href).not.toContain('2026-05-06');
    expect(href).not.toContain('season=');
  });

  it('historical player href includes game season for Court Context player page', () => {
    const href = playerResearchHref({
      playerId: '434',
      date: '2024-06-17',
      gameId: '15905067',
      season: '2023',
    });
    expect(href).toContain('season=2023');
    expect(href).toContain('/betting/players/434?');
  });
});
