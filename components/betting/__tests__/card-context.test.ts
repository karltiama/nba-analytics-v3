import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GameCard, type Game } from '@/components/betting/GameCard';
import type { CardInjuryTeam } from '@/lib/scoreboard/card-context/client';
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

function teams(
  away: { abbr: string; players: CardInjuryTeam['players']; extra?: number },
  home: { abbr: string; players: CardInjuryTeam['players']; extra?: number }
): CardInjuryTeam[] {
  return [
    { abbr: away.abbr, players: away.players, extra: away.extra ?? 0 },
    { abbr: home.abbr, players: home.players, extra: home.extra ?? 0 },
  ];
}

function context(injuryTeams: CardInjuryTeam[], asOfLabel = 'as of 5:00 PM ET') {
  return {
    schedule: 'OKC on 2nd night of a back-to-back · CLE 2 days rest',
    injuries: 'kept for older clients',
    injuryTeams,
    asOfLabel,
  };
}

function tagOpen(markup: string, attr: string): string {
  const match = markup.match(new RegExp(`<p\\b[^>]*${attr}[^>]*>`));
  if (!match) throw new Error(`missing <p ${attr}>`);
  return match[0];
}

function inner(markup: string, attr: string): string {
  const match = markup.match(new RegExp(`<p\\b[^>]*${attr}[^>]*>([\\s\\S]*?)</p>`));
  if (!match) throw new Error(`missing <p ${attr}>`);
  return match[1];
}

function questionableTexts(markup: string): string[] {
  return [...markup.matchAll(/<span\b[^>]*\bdata-questionable=""[^>]*>([^<]*)<\/span>/g)].map((match) => match[1]);
}

describe('GameCard pregame context', () => {
  it('keeps the schedule on one line, wraps injury names, and puts the as-of caption in its own element', () => {
    const rendered = html({
      ...slate('scheduled'),
      pregameContext: context(
        teams(
          {
            abbr: 'CLE',
            players: [
              { name: 'Allen', status: 'Out' },
              { name: 'Mobley', status: 'Doubtful' },
            ],
            extra: 1,
          },
          {
            abbr: 'OKC',
            players: [
              { name: 'Holmgren', status: 'Out' },
              { name: 'Williams', status: 'Q' },
            ],
            extra: 1,
          }
        ),
        'as of Nov 1, 5:00 PM ET'
      ),
    });
    const schedule = tagOpen(rendered, 'data-card-schedule');
    const injuries = tagOpen(rendered, 'data-card-injuries');
    const asOf = tagOpen(rendered, 'data-card-as-of');
    expect(schedule).toContain('truncate');
    expect(schedule).not.toContain('line-clamp');
    expect(injuries).toContain('line-clamp-2');
    expect(injuries).not.toContain('truncate');
    expect(asOf).not.toContain('truncate');
    expect(asOf).not.toContain('line-clamp');
    expect(inner(rendered, 'data-card-injuries')).not.toContain('as of');
    expect(inner(rendered, 'data-card-as-of')).toBe('as of Nov 1, 5:00 PM ET');
    expect(inner(rendered, 'data-card-injuries')).toContain('CLE');
    expect(inner(rendered, 'data-card-injuries')).toContain('OKC');
    expect(inner(rendered, 'data-card-injuries')).toContain('+1');
    expect(rendered).toContain('data-card-context-body');
    expect(rendered).toContain('grid-rows-[20px_40px_16px]');
    expect(html(slate('scheduled'))).toContain('grid-rows-[20px_40px_16px]');
    expect(html(slate('scheduled'))).toContain('No verified matchup context for this game yet.');
  });

  it.each([
    {
      name: 'questionable player first',
      injuryTeams: teams(
        { abbr: 'CLE', players: [{ name: 'Mitchell', status: 'Q' }, { name: 'Allen', status: 'Out' }] },
        { abbr: 'OKC', players: [{ name: 'Holmgren', status: 'Out' }] }
      ),
      highlighted: ['Mitchell (Q)'],
    },
    {
      name: 'questionable player second',
      injuryTeams: teams(
        { abbr: 'CLE', players: [{ name: 'Allen', status: 'Out' }, { name: 'Mitchell', status: 'Q' }] },
        { abbr: 'OKC', players: [] }
      ),
      highlighted: ['Mitchell (Q)'],
    },
    {
      name: 'two questionable players on both teams',
      injuryTeams: teams(
        { abbr: 'CLE', players: [{ name: 'Mitchell', status: 'Q' }, { name: 'Garland', status: 'Q' }] },
        { abbr: 'OKC', players: [{ name: 'Williams', status: 'Q' }, { name: 'Holmgren', status: 'Q' }] }
      ),
      highlighted: ['Mitchell (Q)', 'Garland (Q)', 'Williams (Q)', 'Holmgren (Q)'],
    },
    {
      name: 'no questionable players',
      injuryTeams: teams(
        { abbr: 'CLE', players: [{ name: 'Allen', status: 'Out' }] },
        { abbr: 'OKC', players: [{ name: 'Holmgren', status: 'Doubtful' }] }
      ),
      highlighted: [],
    },
  ])('highlights only the questionable name when the $name', ({ injuryTeams, highlighted }) => {
    const rendered = html({ ...slate('scheduled'), pregameContext: context(injuryTeams) });
    expect(questionableTexts(rendered)).toEqual(highlighted);
    const withoutHighlights = inner(rendered, 'data-card-injuries').replace(
      /<span\b[^>]*\bdata-questionable=""[^>]*>[^<]*<\/span>/g,
      ''
    );
    expect(withoutHighlights).toContain('CLE');
    expect(withoutHighlights).toContain('OKC');
    expect(withoutHighlights).not.toContain('data-questionable');
  });

  it('keeps the fallback when context is missing and leaves live and final cards unchanged', () => {
    expect(html(slate('scheduled'))).toContain('No verified matchup context for this game yet.');
    expect(html(slate('scheduled'))).not.toContain('data-card-schedule');

    const withContext = context(teams({ abbr: 'CLE', players: [] }, { abbr: 'OKC', players: [] }), 'as of 5:00 PM ET');
    withContext.schedule = 'Both teams on 1 day rest';
    const live = html({
      ...slate('live', { home: 40, visitor: 38 }),
      pregameContext: withContext,
      matchupContext: 'Should not replace the live pulse.',
    });
    expect(live).toContain('data-context-panel="live"');
    expect(live).not.toContain('data-card-schedule');
    expect(live).not.toContain('data-card-context-body');
    expect(live).not.toContain('Both teams on 1 day rest');

    const finalGame = html({
      ...slate('final', { home: 110, visitor: 102 }),
      pregameContext: withContext,
    });
    expect(finalGame).toContain('data-context-panel="final"');
    expect(finalGame).not.toContain('data-card-schedule');
    expect(finalGame).not.toContain('data-card-context-body');
  });

  it('still renders a fixture matchupContext when no pregame lines are passed', () => {
    const game = slate('scheduled');
    const rendered = html({ ...game, matchupContext: 'Boston is rested; New York played last night.' });
    expect(rendered).toContain('Boston is rested; New York played last night.');
    expect(rendered).not.toContain('No verified matchup context for this game yet.');
    expect(rendered).not.toContain('data-card-context-body');
  });
});
