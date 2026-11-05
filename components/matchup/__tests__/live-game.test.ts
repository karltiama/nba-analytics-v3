import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { PregameMatchupView } from '@/components/scoreboard/PregameMatchupView';
import type { PregameMatchupModel } from '@/lib/pregame-matchup/compose';

const model = (over: Partial<PregameMatchupModel>): PregameMatchupModel =>
  ({
    gameId: '21718041',
    awayAbbr: 'ORL',
    awayName: 'Orlando Magic',
    homeAbbr: 'PHX',
    homeName: 'Phoenix Suns',
    tipLabel: '9:00 PM ET',
    seasonLabel: 'Regular season',
    statusLabel: 'Live',
    updatedLabel: 'Scoreboard',
    returnHref: '/dashboard',
    history: null,
    historyNote: null,
    current: null,
    currentNote: null,
    context: null,
    insights: [],
    contributors: null,
    roster: { status: 'unavailable', note: 'Roster unavailable.' },
    quote: null,
    quoteNote: 'Pregame prices stay off once the game has tipped.',
    gameDate: '2026-11-05',
    ...over,
  }) as unknown as PregameMatchupModel;

describe('PregameMatchupView on a live game', () => {
  it('leads with the live board, links Live first, and keeps props one click away', () => {
    const html = renderToStaticMarkup(createElement(PregameMatchupView, { model: model({ phase: 'live', watchLive: true }) }));
    // Server render: the board shows its placeholder until the first poll returns.
    expect(html).toContain('data-live-section');
    expect(html).toContain('Loading the live board…');
    expect(html.indexOf('href="#section-live"')).toBeLessThan(html.indexOf('href="#section-story"'));
    expect(html).toContain('data-before-game');
    expect(html.indexOf('data-live-section')).toBeLessThan(html.indexOf('id="section-story"'));
    expect(html).toContain('href="/betting/props-explorer?date=2026-11-05&amp;game_id=21718041"');
    expect(html).not.toContain('Pregame prices stay off');
  });

  it('watches before tip without showing a board, and does not watch otherwise', () => {
    const soon = renderToStaticMarkup(createElement(PregameMatchupView, { model: model({ phase: 'pregame', watchLive: true }) }));
    expect(soon).not.toContain('data-live-section');
    expect(soon).not.toContain('data-before-game');
    expect(soon).toMatch(/href="#section-story"[^>]*>Overview</);
    const later = renderToStaticMarkup(createElement(PregameMatchupView, { model: model({ phase: 'pregame', watchLive: false }) }));
    expect(later).not.toContain('data-live-section');
  });
});
