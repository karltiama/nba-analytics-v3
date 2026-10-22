import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MatchupResearchSections } from '@/components/matchup/MatchupResearchSections';
import type { ComparisonRow } from '@/lib/pregame-matchup/compose';
import { SAMPLE_LABEL } from '@/lib/pregame-matchup/compose';
import {
  COMPACT_COMPARISON_LABELS,
  presentMatchupOverview,
  RATINGS_SCOPE,
  type MatchupOverviewSource,
} from '@/lib/pregame-matchup/overview';
import type { RosterPresentation } from '@/lib/pregame-matchup/roster';
import { ROSTER_LIMITATION, selectMatchupInsights, type MatchupInsight } from '@/lib/pregame-matchup/signals';
import type { TeamProfile } from '@/lib/pregame-matchup/aggregate';

const POSSESSION_NOTE =
  'Estimated possessions are a box-score estimate, not official NBA pace, and are not adjusted for overtime.';

const ROWS: ComparisonRow[] = [
  { label: 'Offensive rating', away: '114.2', home: '118.0' },
  { label: 'Defensive rating', away: '111.0', home: '109.4' },
  { label: 'Net rating', away: '+3.2', home: '+8.6' },
  { label: 'Estimated possessions / game', away: '99.1', home: '101.4' },
  { label: 'Points scored', away: '112.0', home: '118.4' },
  { label: 'Points allowed', away: '110.2', home: '108.1' },
  { label: 'eFG%', away: '54.1%', home: '56.0%' },
  { label: '3PA rate', away: '42.0%', home: '38.4%' },
  { label: 'Offensive-rebounding rate', away: '25.0%', home: '28.2%' },
];

function hiddenRoster(note = 'Current roster continuity is unavailable.'): RosterPresentation {
  return {
    status: 'hidden',
    observationDate: null,
    freshness: 'missing',
    note,
    teams: null,
  };
}

function shownRoster(): RosterPresentation {
  return {
    status: 'shown',
    observationDate: '2026-10-12',
    freshness: 'informative',
    note: 'Roster observation: Oct 12, 2026. A listing is not confirmation that a player is available, active, or starting.',
    teams: [
      {
        teamId: '22',
        abbr: 'ORL',
        listed: 1,
        unresolved: 0,
        returning: 1,
        otherTeam: 0,
        noPriorHistory: 0,
        minutesNumerator: 50,
        minutesDenominator: 100,
        minutesShare: 0.5,
        fgaNumerator: 10,
        fgaDenominator: 40,
        fgaShare: 0.25,
        ftaNumerator: 4,
        ftaDenominator: 10,
        ftaShare: 0.4,
        concentration: null,
      },
    ],
  };
}

function insight(id: MatchupInsight['id'], headline: string): MatchupInsight {
  const bodies: Record<MatchupInsight['id'], string> = {
    efficiency:
      'ORL scored 114.2 points per 100 estimated possessions. CLE allowed 110.1. Relative to a typical 2025–26 team, that offense-versus-defense gap stands out. It describes last season\'s teams, not a winner tonight.',
    three_point_rate:
      'ORL took threes on 42.0% of its field-goal attempts. CLE took them on 38.4%. The volume difference is large enough, against the league\'s team spread, to be a stylistic contrast. It is not a made-three prediction.',
    offensive_rebounding:
      'ORL grabbed 25.0% of its missed shots. Opponents grabbed 28.2% of their misses against CLE. Rebounding is a place these historical profiles differ. It does not say who will control the glass tonight.',
    turnover_rate:
      'ORL\'s turnover rate was 13.0%. CLE\'s was 11.0%. The gap is wide relative to other 2025–26 teams. Turnover rate here is turnovers divided by shot attempts, a free-throw estimate, and turnovers. It is not a steal projection.',
    estimated_possessions:
      'ORL averaged 99.1 estimated possessions per game. CLE averaged 101.4. This is a box-score possession estimate, not official NBA pace, and it is not adjusted for overtime.',
  };
  return {
    id,
    headline,
    body: bodies[id],
    evidence: `${headline} evidence`,
    limitation: ROSTER_LIMITATION,
  };
}

function source(over: Partial<MatchupOverviewSource> = {}): MatchupOverviewSource {
  return {
    awayAbbr: 'ORL',
    homeAbbr: 'CLE',
    history: { label: SAMPLE_LABEL, possessionNote: POSSESSION_NOTE, rows: ROWS },
    historyNote: null,
    insights: [],
    roster: hiddenRoster(),
    ...over,
  };
}

function profile(teamId: string, ortg: number): TeamProfile {
  return {
    teamId,
    games: 82,
    offensiveRating: ortg,
    defensiveRating: 112,
    netRating: ortg - 112,
    estimatedPossessionsPerGame: 100,
    pointsPerGame: ortg,
    pointsAllowedPerGame: 112,
    effectiveFieldGoalPct: 0.54,
    threePointAttemptRate: 0.35 + Number(teamId) * 0.002,
    offensiveReboundRate: 0.25,
    opponentOffensiveReboundRate: 0.25,
    turnoverRate: 0.12,
  };
}

describe('matchup overview presentation', () => {
  it('keeps selector order and emits zero, one, two, and three findings without a new score', () => {
    const none = presentMatchupOverview(source());
    expect(none.findings).toEqual([]);
    expect(none.story.headline).toBe('No standout 2025–26 contrast');
    expect(none.story.lede).toContain('selection threshold');
    expect(none.story.sampleLabel).toBe(SAMPLE_LABEL);
    expect(JSON.stringify(none)).not.toMatch(/confidence|win probability|advantage/i);

    for (const count of [1, 2, 3] as const) {
      const ids: MatchupInsight['id'][] = ['efficiency', 'three_point_rate', 'offensive_rebounding'];
      const insights = ids.slice(0, count).map((id, index) => insight(id, `Finding ${index + 1}`));
      const overview = presentMatchupOverview(source({ insights }));
      expect(overview.findings.map((finding) => finding.id)).toEqual(ids.slice(0, count));
      expect(overview.findings).toHaveLength(count);
      expect(overview.story.headline).toBe('The clearest 2025–26 contrast is scoring versus defense');
      expect(overview.story.headline).not.toBe(overview.findings[0]?.title);
      expect(overview.story.lede).toContain('gap stands out');
      expect(overview.story.lede).not.toContain(overview.findings[0]?.evidence);
      expect(overview.findings[0]?.title).toBe('Finding 1');
      expect(overview.findings[0]?.evidence).toBe('Finding 1 evidence');
      expect(overview.findings[0]?.summary).toContain('not a winner');
      expect(overview.findings[0]?.summary).not.toContain('gap stands out');
      if (count === 1) expect(overview.story.lede).not.toContain('also marks');
      if (count === 2) expect(overview.story.lede).toContain('also marks a contrast in three-point volume');
      if (count === 3) expect(overview.story.lede).toContain('three-point volume and second-chance rebounding');
      expect(overview.findings.every((finding) => finding.sampleLabel === SAMPLE_LABEL)).toBe(true);
      expect(overview.findings.every((finding) => finding.destination === '#section-comparison')).toBe(true);
    }
  });

  it('drops findings when history is null and keeps the unavailable copy', () => {
    const overview = presentMatchupOverview(source({
      history: null,
      historyNote: 'The 2025–26 regular-season sample is incomplete, so team and player comparisons are hidden.',
      insights: [insight('efficiency', 'Should not show')],
    }));
    expect(overview.findings).toEqual([]);
    expect(overview.story.headline).toBe('2025–26 team comparison unavailable');
    expect(overview.story.lede).toContain('sample is incomplete');
    expect(overview.story.sampleLabel).toBeNull();
    expect(overview.comparison.available).toBe(false);
    expect(overview.comparison.rows).toEqual([]);
    expect(overview.comparison.emptyNote).toContain('sample is incomplete');
    expect(overview.story.caveat).toBeNull();
    expect(overview.personnel.note).toBe('Current roster continuity is unavailable.');
  });

  it('reuses four formatted comparison strings and leaves the other rows out', () => {
    const overview = presentMatchupOverview(source());
    expect(overview.comparison.rows.map((row) => row.label)).toEqual([...COMPACT_COMPARISON_LABELS]);
    expect(overview.comparison.rows.map((row) => row.away)).toEqual(['+3.2', '99.1', '54.1%', '42.0%']);
    expect(overview.comparison.rows.map((row) => row.home)).toEqual(['+8.6', '101.4', '56.0%', '38.4%']);
    expect(overview.comparison.possessionNote).toBe(POSSESSION_NOTE);
    expect(overview.comparison.rows.some((row) => row.label === 'Offensive rating')).toBe(false);
    expect(overview.comparison.rows.some((row) => row.label === 'Points scored')).toBe(false);
  });

  it('passes a hidden roster note through and a shown observation without calling ratings a current roster', () => {
    const hidden = presentMatchupOverview(source({
      insights: [insight('estimated_possessions', 'Different estimated possession counts')],
      roster: hiddenRoster('Current roster continuity is unavailable. The latest complete observation (Sep 1, 2026) is too old to describe the roster for this game.'),
    }));
    expect(hidden.personnel.status).toBe('hidden');
    expect(hidden.personnel.shares).toEqual([]);
    expect(hidden.personnel.note).toContain('too old');
    expect(hidden.story.caveat).toContain(ROSTER_LIMITATION);
    expect(hidden.story.caveat).toContain(RATINGS_SCOPE);
    expect(hidden.story.caveat).not.toContain('too old');
    expect(hidden.story.lede).toContain('not official NBA pace');
    expect(hidden.story.lede).not.toContain(hidden.findings[0]?.evidence);
    expect(hidden.findings[0]?.summary).toBe('');

    const shown = presentMatchupOverview(source({ roster: shownRoster() }));
    expect(shown.personnel.status).toBe('shown');
    expect(shown.personnel.shares[0]?.minutesShare).toBe(0.5);
    expect(shown.story.caveat).toContain('Oct 12, 2026');
    expect(shown.story.caveat).toContain('not confirmation');
    expect(shown.story.caveat).toContain(RATINGS_SCOPE);
    expect(shown.story.caveat).not.toContain('Current rosters are not verified');
  });

  it('does not reorder a selector result', () => {
    const league = Array.from({ length: 30 }, (_, index) => profile(String(index + 1), index === 0 ? 130 : 110));
    const away = league[0]!;
    const home = league[1]!;
    const insights = selectMatchupInsights({
      away: { abbr: 'ORL', profile: away },
      home: { abbr: 'CLE', profile: home },
      league,
    });
    const overview = presentMatchupOverview(source({ insights }));
    expect(overview.findings.map((finding) => finding.id)).toEqual(insights.map((item) => item.id));
    expect(overview.findings.length).toBeLessThanOrEqual(3);
    expect(overview.story.lede.length).toBeGreaterThan(0);
    for (const finding of overview.findings) {
      const original = insights.find((item) => item.id === finding.id);
      expect(overview.story.headline).not.toBe(finding.title);
      expect(overview.story.lede).not.toContain(finding.evidence);
      if (finding.summary) expect(original?.body.includes(finding.summary)).toBe(true);
    }
  });

  it('renders zero through three findings, null history, and a hidden roster without a starter claim', () => {
    const cases = [
      source(),
      source({ insights: [insight('efficiency', 'ORL offense, CLE defense')] }),
      source({ insights: [insight('efficiency', 'One'), insight('three_point_rate', 'Two')] }),
      source({
        insights: [
          insight('efficiency', 'One'),
          insight('three_point_rate', 'Two'),
          insight('offensive_rebounding', 'Three'),
        ],
      }),
      source({
        history: null,
        historyNote: 'The 2025–26 regular-season sample is incomplete, so team and player comparisons are hidden.',
        roster: hiddenRoster(),
      }),
    ];
    const counts = ['0', '1', '2', '3', '0'];
    cases.forEach((item, index) => {
      const html = renderToStaticMarkup(createElement(MatchupResearchSections, { ...item, contributors: null }));
      expect(html).toContain('data-matchup-story');
      expect(html).toContain('2025–26 Team Identity');
      expect(html).toContain('Personnel context');
      expect(html).not.toMatch(/confirmed starter|starting lineup|win probability|confidence/i);
      if (counts[index] === '0') {
        expect(html).not.toContain('data-finding-count');
      } else {
        expect(html).toContain(`data-finding-count="${counts[index]}"`);
      }
      if (item.history == null) {
        expect(html).toContain('sample is incomplete');
        expect(html).not.toContain('Net rating');
      }
    });

    const oneFinding = renderToStaticMarkup(createElement(MatchupResearchSections, {
      ...source({ insights: [insight('efficiency', 'ORL offense, CLE defense')] }),
      contributors: null,
    }));
    const storyHtml = oneFinding.slice(oneFinding.indexOf('data-matchup-story'), oneFinding.indexOf('data-finding-count'));
    const cardHtml = oneFinding.slice(oneFinding.indexOf('data-finding-count'), oneFinding.indexOf('section-compact-comparison'));
    expect(storyHtml).toContain('The clearest 2025–26 contrast is scoring versus defense');
    expect(storyHtml).toContain('gap stands out');
    expect(storyHtml).not.toContain('ORL offense, CLE defense evidence');
    expect(cardHtml).toContain('ORL offense, CLE defense');
    expect(cardHtml).toContain('ORL offense, CLE defense evidence');
    expect(cardHtml).not.toContain('gap stands out');

    const shown = renderToStaticMarkup(createElement(MatchupResearchSections, {
      ...source({ roster: shownRoster() }),
      contributors: null,
    }));
    expect(shown).toContain('data-personnel="shown"');
    expect(shown).toContain('50.0%');
    expect(shown).toContain('not confirmation');
    expect(shown).not.toContain('minmax(6.5rem, 9.5rem)');
    expect(shown).toContain('Returning minutes, 2025–26');
  });
});
