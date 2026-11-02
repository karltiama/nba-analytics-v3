import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GameCard, type Game } from '@/components/betting/GameCard';
import { scoreboardGame, scoreboardResponse } from '@/lib/scoreboard/fixtures';
import { mergeTodaysGames } from '@/lib/scoreboard/slate-merge';

function slate(lifecycle: 'scheduled' | 'live' | 'final', scores?: { home: number; visitor: number }) {
  const game = mergeTodaysGames(
    scoreboardResponse([
      scoreboardGame({
        game_id: '5001',
        lifecycle,
        period: lifecycle === 'scheduled' ? null : 2,
        clock: lifecycle === 'final' ? null : '5:00',
        home: scores ? { score: scores.home } : {},
        visitor: scores ? { score: scores.visitor } : {},
      }),
    ])
  )[0];
  if (!game) throw new Error('fixture card missing');
  return game;
}

function html(game: Game) {
  return renderToStaticMarkup(createElement(GameCard, { game, presentation: 'scoreboard', researchDate: '2026-10-09' }));
}

describe('GameCard pregame context', () => {
  it('renders two clamped pregame lines and highlights questionable players', () => {
    const game = slate('scheduled');
    const rendered = html({
      ...game,
      pregameContext: {
        schedule: 'OKC on 2nd night of a back-to-back · CLE 2 days rest',
        injuries: 'CLE: Allen (Out), Mitchell (Q) · OKC: no key injuries listed · as of 5:00 PM ET',
      },
    });
    expect(rendered).toContain('data-context-panel="pregame"');
    expect(rendered).toContain('data-card-schedule');
    expect(rendered).toContain('OKC on 2nd night of a back-to-back · CLE 2 days rest');
    expect(rendered).toContain('data-card-injuries');
    expect(rendered).toContain('truncate');
    expect(rendered).toContain('data-questionable');
    expect(rendered).toContain('Mitchell (Q)');
    expect(rendered).not.toContain('No verified matchup context for this game yet.');
  });

  it('keeps the fallback when context is missing and leaves live and final cards unchanged', () => {
    expect(html(slate('scheduled'))).toContain('No verified matchup context for this game yet.');
    expect(html(slate('scheduled'))).not.toContain('data-card-schedule');

    const withContext = {
      schedule: 'Both teams on 1 day rest',
      injuries: 'No key injuries listed · as of 5:00 PM ET',
    };
    const live = html({
      ...slate('live', { home: 40, visitor: 38 }),
      pregameContext: withContext,
      matchupContext: 'Should not replace the live pulse.',
    });
    expect(live).toContain('data-context-panel="live"');
    expect(live).not.toContain('data-card-schedule');
    expect(live).not.toContain('Both teams on 1 day rest');

    const finalGame = html({
      ...slate('final', { home: 110, visitor: 102 }),
      pregameContext: withContext,
    });
    expect(finalGame).toContain('data-context-panel="final"');
    expect(finalGame).not.toContain('data-card-schedule');
  });

  it('still renders a fixture matchupContext when no pregame lines are passed', () => {
    const game = slate('scheduled');
    const rendered = html({ ...game, matchupContext: 'Boston is rested; New York played last night.' });
    expect(rendered).toContain('Boston is rested; New York played last night.');
    expect(rendered).not.toContain('No verified matchup context for this game yet.');
  });
});
