import { describe, expect, it } from 'vitest';
import type { TeamSumRow } from '@/lib/pregame-matchup/aggregate';
import { buildCurrentStory, CURRENT_STORY_MIN_GAMES, type CurrentStory } from '@/lib/pregame-matchup/compose';
import { currentStoryScope, presentMatchupOverview } from '@/lib/pregame-matchup/overview';
import { presentRoster } from '@/lib/pregame-matchup/roster';
import { CURRENT_LIMITATION, ROSTER_LIMITATION, type MatchupInsight } from '@/lib/pregame-matchup/signals';

function sum(teamId: string, games: number, over: Partial<TeamSumRow> = {}): TeamSumRow {
  return {
    teamId,
    rows: games,
    games,
    points: games * 112,
    pointsAllowed: games * 110,
    possessions: games * 100,
    fgm: games * 42,
    fga: games * 88,
    fg3m: games * 12,
    fg3a: games * 35,
    fta: games * 22,
    turnovers: games * 13,
    offensiveRebounds: games * 10,
    defensiveRebounds: games * 33,
    opponentOffensiveRebounds: games * 10,
    opponentDefensiveRebounds: games * 33,
    badPossessions: 0,
    badShot: 0,
    badRebounds: 0,
    badTurnovers: 0,
    ...over,
  };
}

/** 30 teams with a small three-point spread; ORL (22) takes far more threes than CLE (6). */
function season(games: number, orlThrees = 45, cleThrees = 28): TeamSumRow[] {
  return Array.from({ length: 30 }, (_, i) => {
    const id = String(i + 1);
    const rate = id === '22' ? orlThrees : id === '6' ? cleThrees : 34 + (i % 5) * 0.5;
    return sum(id, games, { fg3a: games * rate });
  });
}

const prior = (subject: string): MatchupInsight => ({
  id: 'three_point_rate',
  subject,
  headline: `${subject} lived on more threes`,
  body: 'x',
  evidence: 'x',
  limitation: ROSTER_LIMITATION,
});

const base = { awayTeamId: '22', homeTeamId: '6', awayAbbr: 'ORL', homeAbbr: 'CLE' };

describe('buildCurrentStory', () => {
  it('waits until both teams have enough games', () => {
    expect(buildCurrentStory({ ...base, current: { season: '2026', teamRows: season(CURRENT_STORY_MIN_GAMES - 1) }, history: [] })).toBeNull();
    expect(buildCurrentStory({ ...base, current: null, history: [] })).toBeNull();
  });

  it('finds this season’s contrasts with this season’s copy', () => {
    const story = buildCurrentStory({ ...base, current: { season: '2026', teamRows: season(7) }, history: [] })!;
    expect(story).toMatchObject({ seasonLabel: '2026–27', awayGames: 7, homeGames: 7 });
    const threes = story.insights.find((i) => i.id === 'three_point_rate')!;
    expect(threes.subject).toBe('ORL');
    expect(threes.trend).toBe('new');
    expect(threes.limitation).toBe(CURRENT_LIMITATION);
  });

  it('tags held, reversed and faded against last season', () => {
    const held = buildCurrentStory({ ...base, current: { season: '2026', teamRows: season(7) }, history: [prior('ORL')] })!;
    expect(held.insights.find((i) => i.id === 'three_point_rate')!.trend).toBe('held');
    expect(held.faded).toEqual([]);

    const reversed = buildCurrentStory({ ...base, current: { season: '2026', teamRows: season(7) }, history: [prior('CLE')] })!;
    expect(reversed.insights.find((i) => i.id === 'three_point_rate')!.trend).toBe('reversed');
    expect(reversed.faded).toEqual([]);

    const quiet = buildCurrentStory({ ...base, current: { season: '2026', teamRows: season(7, 35, 35) }, history: [prior('ORL')] })!;
    expect(quiet.insights.find((i) => i.id === 'three_point_rate')).toBeUndefined();
    expect(quiet.faded.map((i) => i.id)).toEqual(['three_point_rate']);
  });
});

describe('this-season story', () => {
  const roster = presentRoster({ gameDate: '2026-11-05', day: null, teams: [] });
  const history = { label: '2025–26 Regular Season · 82 games', possessionNote: 'x', rows: [] };

  it('leads with this season, marks the trend, and carries injury notes', () => {
    const currentStory = buildCurrentStory({ ...base, current: { season: '2026', teamRows: season(7) }, history: [prior('CLE')] })!;
    const overview = presentMatchupOverview({
      awayAbbr: 'ORL',
      homeAbbr: 'CLE',
      history,
      historyNote: null,
      insights: [prior('CLE')],
      roster,
      currentStory,
      injuryNotes: ["ORL's 2026–27 numbers: Banchero played 2 of 7."],
    });
    expect(overview.story.headline).toBe('The clearest 2026–27 contrast is three-point volume');
    expect(overview.story.lede).toContain('In 2025–26 this contrast ran the other way');
    expect(overview.story.sampleLabel).toBe('2026–27 so far · ORL 7 games · CLE 7 games');
    expect(overview.story.caveat).toContain(currentStoryScope(currentStory));
    expect(overview.story.caveat).toContain('Banchero played 2 of 7');
    expect(overview.findings[0]).toMatchObject({ category: 'current_season', trend: 'reversed' });
  });

  it('says when last season’s contrast is gone and nothing new clears the bar', () => {
    const currentStory: CurrentStory = { seasonLabel: '2026–27', awayGames: 7, homeGames: 6, insights: [], faded: [prior('ORL')] };
    const overview = presentMatchupOverview({
      awayAbbr: 'ORL',
      homeAbbr: 'CLE',
      history,
      historyNote: null,
      insights: [prior('ORL')],
      roster,
      currentStory,
    });
    expect(overview.story.headline).toBe('No standout 2026–27 contrast yet');
    expect(overview.story.lede).toContain("Last season's contrast in three-point volume has not shown up this season.");
    expect(overview.findings).toEqual([]);
  });

  it('keeps last season’s story when there is no this-season story', () => {
    const overview = presentMatchupOverview({
      awayAbbr: 'ORL',
      homeAbbr: 'CLE',
      history,
      historyNote: null,
      insights: [{ ...prior('ORL'), body: 'The volume difference is large enough, against the league’s team spread, to be a stylistic contrast.' }],
      roster,
      currentStory: null,
    });
    expect(overview.story.headline).toBe('The clearest 2025–26 contrast is three-point volume');
    expect(overview.findings[0].trend).toBeUndefined();
  });
});
