import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StartingLineupCard } from '@/components/betting/MatchupAnalysis';

describe('historical minutes sample', () => {
  it('labels the sample as 2025–26 minutes and does not call it a lineup', () => {
    const html = renderToStaticMarkup(createElement(StartingLineupCard, {
      teamAbbr: 'CLE',
      embedded: true,
      lineup: {
        team_id: '6',
        players: [
          {
            player_id: '666940',
            full_name: 'Dean Wade',
            position: 'SF',
            games_started: 8,
            avg_points: 7.2,
            avg_minutes: 24.4,
          },
        ],
      },
    }));
    expect(html).toContain('CLE 2025–26 minutes');
    expect(html).toContain('Minutes logged for CLE in that sample.');
    expect(html).toContain('Dean Wade');
    expect(html).toContain('8 games');
    expect(html).not.toMatch(/Projected starters|Starting 5|starts|current roster|current rotation/i);
  });
});
