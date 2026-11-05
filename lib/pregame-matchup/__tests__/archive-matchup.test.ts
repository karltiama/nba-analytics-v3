import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PregameMatchupView } from '@/components/scoreboard/PregameMatchupView';
import { archiveGameFromRow, archiveSeasonLabel, archiveWhenLabel } from '@/lib/pregame-matchup/archive';
import { loadPregameMatchup } from '@/lib/pregame-matchup/load';
import { createMemoryScoreboardStore } from '@/lib/scoreboard/store';

const NOW = new Date('2026-11-05T18:00:00.000Z');

const ROW = {
  game_id: '21716138',
  season: '2025',
  start_time: new Date('2026-06-14T00:30:00.000Z'),
  status: 'Final',
  season_phase: 'UNCLASSIFIED',
  et_date: '2026-06-13',
  home_team_id: '27',
  away_team_id: '20',
  home_score: 90,
  away_score: 94,
  home_abbr: 'SAS',
  home_name: 'San Antonio Spurs',
  away_abbr: 'NYK',
  away_name: 'New York Knicks',
};

function boxLine(teamId: string, playerId: string, name: string, points: number) {
  return {
    team_id: teamId,
    player_id: playerId,
    name,
    minutes: '40',
    points,
    rebounds: 5,
    assists: 6,
    steals: 1,
    blocks: 0,
    turnovers: 2,
    field_goals_made: 15,
    field_goals_attempted: 28,
    three_pointers_made: 4,
    three_pointers_attempted: 9,
    free_throws_made: 11,
    free_throws_attempted: 12,
    plus_minus: 4,
  };
}

describe('archive game helpers', () => {
  it('reads an analytics.games row and rejects incomplete rows', () => {
    const game = archiveGameFromRow(ROW);
    expect(game).toMatchObject({
      gameId: '21716138',
      season: '2025',
      etDate: '2026-06-13',
      scheduledTip: '2026-06-14T00:30:00.000Z',
      visitorAbbr: 'NYK',
      homeAbbr: 'SAS',
      visitorScore: 94,
      homeScore: 90,
      overtimePeriods: 0,
    });
    expect(archiveGameFromRow(undefined)).toBeNull();
    expect(archiveGameFromRow({ ...ROW, home_score: null })).toBeNull();
  });

  it('labels the season part from the postseason start when the phase is unclassified', () => {
    expect(archiveSeasonLabel({ season: '2025', etDate: '2026-06-13', seasonPhase: 'UNCLASSIFIED' })).toBe('2025–26 Postseason');
    expect(archiveSeasonLabel({ season: '2023', etDate: '2024-01-10', seasonPhase: 'UNCLASSIFIED' })).toBe('2023–24 Regular season');
    expect(archiveSeasonLabel({ season: '2026', etDate: '2026-11-01', seasonPhase: 'IST' })).toBe('2026–27 Regular season');
  });

  it('leads with the ET date and drops a midnight start time', () => {
    expect(archiveWhenLabel({ etDate: '2026-06-13', scheduledTip: '2026-06-14T00:30:00.000Z' })).toBe('Sat, Jun 13, 2026 · 8:30 PM EDT');
    expect(archiveWhenLabel({ etDate: '2026-06-13', scheduledTip: '2026-06-13T04:00:00.000Z' })).toBe('Sat, Jun 13, 2026');
    expect(archiveWhenLabel({ etDate: '2024-01-10', scheduledTip: null })).toBe('Wed, Jan 10, 2024');
  });
});

describe('past-season game on the matchup page', () => {
  it('falls back to analytics.games and renders the header and recap only', async () => {
    const calls: string[] = [];
    const model = await loadPregameMatchup({
      gameId: '21716138',
      now: NOW,
      env: {},
      store: createMemoryScoreboardStore(),
      query: async (text, params) => {
        calls.push(text);
        if (text.includes('FROM analytics.games g') && text.includes("g.status = 'Final'") && text.includes('g.game_id = $1')) return [ROW];
        if (text.includes('game_odds_history')) return [];
        if (text.includes('analytics.game_starters') && text.includes('s.season = $1')) {
          expect(params).toEqual(['2025', ['20', '27'], '2026-06-13']);
          return [{ team_id: '20', game_id: '21716137', game_date: '2026-06-11', player_id: '1', name: 'Jalen Brunson', position: 'G' }];
        }
        if (text.includes('analytics.game_starters')) return [{ team_id: '20', player_id: '1', name: 'Jalen Brunson' }];
        if (text.includes('analytics.player_game_logs')) {
          return [boxLine('20', '1', 'Jalen Brunson', 45), boxLine('27', '2', 'Victor Wembanyama', 30)];
        }
        throw new Error(`unexpected query: ${text}`);
      },
    });
    expect(model).not.toBeNull();
    expect(model?.archive).toBe(true);
    expect(model?.phase).toBe('final');
    expect(model?.watchLive).toBe(false);
    expect(model?.awayAbbr).toBe('NYK');
    expect(model?.homeName).toBe('San Antonio Spurs');
    expect(model?.seasonLabel).toBe('2025–26 Postseason');
    expect(model?.statusLabel).toBe('Final');
    expect(model?.injuryReport).toBeNull();
    expect(model?.starters).toBeNull();
    expect(model?.context).toBeNull();
    expect(model?.recap).not.toBeNull();
    expect(model?.recap?.teams.find((t) => t.abbr === 'NYK')?.players.some((p) => p.name === 'Jalen Brunson')).toBe(true);
    expect(model?.recap?.score).toEqual({ away: 94, home: 90 });
    // Starters compare with the team's previous game that season, not "first on record".
    expect(model?.recap?.teams.find((t) => t.abbr === 'NYK')?.starters?.summary).toBe('Same five as the previous game (Jun 11).');
    // No injury, roster, season-window or scoreboard reads for a past game.
    expect(calls.some((t) => /player_injury_status_current|team_game_stats|roster_observation/.test(t))).toBe(false);

    const html = renderToStaticMarkup(createElement(PregameMatchupView, { model: model! }));
    expect(html).toContain('Jalen Brunson');
    expect(html).toContain('section-recap');
    expect(html).not.toContain('Before the game');
    expect(html).not.toContain('section-injuries');
    expect(html).not.toContain('section-comparison');
    expect(html).not.toContain('section-roster');
    expect(html).not.toContain('Props');
  });

  it('returns null when the game is on neither the scoreboard nor analytics.games', async () => {
    const model = await loadPregameMatchup({
      gameId: '999',
      now: NOW,
      env: {},
      store: createMemoryScoreboardStore(),
      query: async (text) => {
        if (text.includes('FROM analytics.games g')) return [];
        throw new Error(`unexpected query: ${text}`);
      },
    });
    expect(model).toBeNull();
  });
});
