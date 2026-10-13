import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ComparisonGrid } from '@/components/matchup/ComparisonGrid';
import { ContextSignals } from '@/components/matchup/ContextSignals';
import { MatchupHeader } from '@/components/matchup/MatchupHeader';
import { PlayerContributors } from '@/components/matchup/PlayerContributors';
import { RosterContinuity } from '@/components/matchup/RosterContinuity';
import { PregameMatchupView } from '@/components/scoreboard/PregameMatchupView';
import type { HistoricalContributor } from '@/lib/pregame-matchup/aggregate';
import { buildPregameMatchup } from '@/lib/pregame-matchup/compose';
import { presentBdlRoster, teamContinuity, type RosterMember, type ProductionRow } from '@/lib/pregame-matchup/roster';
import { ROSTER_LIMITATION, type MatchupInsight } from '@/lib/pregame-matchup/signals';

const STORED = '2026-10-12T12:15:55.474Z';

function member(): RosterMember {
  return { teamId: '2', nbaPlayerId: '10', analyticsPlayerId: '10', identityStatus: 'resolved', name: 'A' };
}

function production(): ProductionRow {
  return { teamId: '2', playerId: '10', minutes: 100, fga: 40, fta: 10, usageMass: 0, usagePossessions: 0 };
}

function team() {
  return teamContinuity({
    teamId: '2',
    abbr: 'BOS',
    observationDate: '2026-10-12',
    members: [member()],
    production: [production()],
  });
}

function roster(reason: 'eligible' | 'missing' | 'incomplete' | 'after_tipoff' | 'invalid_time', freshness: 'fresh' | 'informative' | 'stale' | null) {
  return presentBdlRoster({
    observationEtDate: reason === 'missing' ? null : '2026-10-12',
    collectedAt: STORED,
    reason,
    freshness,
    teams: [team()],
  });
}

const contributor = (name: string, id: string): HistoricalContributor => ({
  playerId: id,
  name,
  games: 80,
  minutesPerGame: 32.4,
  pointsPerGame: 22.1,
  fgaPerGame: 16.2,
  usage: 0.28,
  totalMinutes: 2592,
});

describe('shared matchup presentation', () => {
  it('renders the header, logos, status, dated back link, and one market strip', () => {
    const html = renderToStaticMarkup(createElement(MatchupHeader, {
      away: { abbr: 'ORL', name: 'Orlando Magic' },
      home: { abbr: 'CLE', name: 'Cleveland Cavaliers' },
      statusLabel: 'Scheduled',
      whenLabel: '7:00 PM EDT',
      seasonLabel: 'Preseason',
      updatedLabel: 'Scoreboard Updated 1:59 PM EDT',
      backHref: '/dashboard?date=2026-10-11',
      backLabel: "Today's Games",
      market: {
        caption: 'DraftKings · BDL synced 2m ago',
        spreadAway: 'ORL +5.5',
        spreadHome: 'CLE -5.5',
        total: 'O/U 228.5',
        totalPrices: 'O -110 / U -110',
        moneylineAway: 'ORL +164',
        moneylineHome: 'CLE -198',
        implied: 'No-vig implied probability: ORL 38%, CLE 62%',
      },
      links: [{ href: '#section-comparison', label: 'Teams' }],
    }));
    expect(html).toContain('href="/dashboard?date=2026-10-11"');
    expect(html).toContain('aria-label="Today&#x27;s Games"');
    expect(html).toContain('Scheduled');
    expect(html).toContain('7:00 PM EDT');
    expect(html).toContain('Orlando Magic');
    expect(html).toContain('data-market-strip');
    expect(html.match(/CLE -5\.5/g)).toHaveLength(1);
    expect(html).toContain('No-vig implied probability');
    expect(html).toContain('href="#section-comparison"');
  });

  it('omits the market strip when no quote is passed', () => {
    const html = renderToStaticMarkup(createElement(MatchupHeader, {
      away: { abbr: 'ORL', name: 'Orlando Magic' },
      home: { abbr: 'CLE', name: 'Cleveland Cavaliers' },
      statusLabel: 'Scheduled',
      whenLabel: '7:00 PM EDT',
      backHref: '/dashboard',
      backLabel: "Today's Games",
      market: null,
    }));
    expect(html).not.toContain('data-market-strip');
    expect(html).not.toContain('Market spread');
  });

  it('renders comparison values, the season label, and the possession caveat', () => {
    const html = renderToStaticMarkup(createElement(ComparisonGrid, {
      awayAbbr: 'ORL',
      homeAbbr: 'CLE',
      available: true,
      label: '2025–26 Regular Season · 82 games',
      possessionNote: 'Estimated possessions are a box-score estimate, not official NBA pace, and are not adjusted for overtime.',
      rows: [{ label: 'Offensive rating', away: '114.2', home: '118.0' }],
      historyNote: null,
    }));
    expect(html).toContain('2025–26 Team Identity');
    expect(html).toContain('2025–26 Regular Season · 82 games');
    expect(html).toContain('not official NBA pace');
    expect(html).toContain('114.2');
    expect(html).toContain('118.0');
    expect(html).toContain('Offensive rating');
  });

  it('shows the incomplete-sample note and no metric row', () => {
    const html = renderToStaticMarkup(createElement(ComparisonGrid, {
      awayAbbr: 'ORL',
      homeAbbr: 'CLE',
      available: false,
      label: null,
      possessionNote: null,
      rows: [],
      historyNote: 'The 2025–26 regular-season sample is incomplete, so team and player comparisons are hidden.',
    }));
    expect(html).toContain('sample is incomplete');
    expect(html).not.toContain('Offensive rating');
  });

  it('renders signal evidence and the historical limitation, and nothing when there are no signals', () => {
    const insight: MatchupInsight = {
      id: 'efficiency',
      headline: 'ORL offense, CLE defense',
      body: 'It describes last season\'s teams, not a winner tonight.',
      evidence: 'ORL offensive rating 114.2 · CLE defensive rating 110.1',
      limitation: ROSTER_LIMITATION,
    };
    const html = renderToStaticMarkup(createElement(ContextSignals, { insights: [insight] }));
    expect(html).toContain('ORL offense, CLE defense');
    expect(html).toContain('ORL offensive rating 114.2');
    expect(html).toContain(ROSTER_LIMITATION);
    expect(html).not.toMatch(/win probability|projected winner/i);
    const empty = renderToStaticMarkup(createElement(ContextSignals, { insights: [] }));
    expect(empty).toBe('');
  });

  it('keeps every contributor and leads with three per side', () => {
    const players = ['One', 'Two', 'Three', 'Four', 'Five'].map((name, index) => contributor(name, String(index)));
    const html = renderToStaticMarkup(createElement(PlayerContributors, {
      awayAbbr: 'ORL',
      homeAbbr: 'CLE',
      label: '2025–26 historical production — not a confirmed current roster',
      away: players,
      home: [],
    }));
    expect(html).toContain('not a confirmed current roster');
    expect(html).toContain('32.4 mpg');
    expect(html).toContain('One');
    expect(html).toContain('Three');
    expect(html).toContain('2 more historical contributors');
    expect(html).toContain('Five');
    expect(html).toContain('No positive-minute games in the 2025–26 regular season.');
  });

  it('shows shares for a fresh observation and hides them when the model suppresses the roster', () => {
    const fresh = renderToStaticMarkup(createElement(RosterContinuity, { roster: roster('eligible', 'fresh') }));
    expect(fresh).toContain('data-continuity="shown"');
    expect(fresh).toContain('data-continuity-bar');
    expect(fresh).toContain('100.0%');
    expect(fresh).toContain('100 of 100 minutes');
    expect(fresh).toContain('A listing is not confirmation');

    for (const hidden of [
      roster('eligible', 'stale'),
      roster('missing', null),
      roster('after_tipoff', 'fresh'),
      roster('incomplete', null),
    ]) {
      const html = renderToStaticMarkup(createElement(RosterContinuity, { roster: hidden }));
      expect(html).toContain('data-continuity="hidden"');
      expect(html).not.toContain('data-continuity-bar');
      expect(html).not.toContain('100.0%');
      expect(html).toContain(hidden.note);
    }

    const informative = roster('eligible', 'informative');
    const dated = renderToStaticMarkup(createElement(RosterContinuity, { roster: informative }));
    expect(dated).toContain('data-continuity="shown"');
    expect(dated).toContain('Roster observation: Oct 12, 2026');
    expect(dated).toContain('older than a week');
  });

  it('places one quote on the public page and does not pull research loaders into it', () => {
    const model = buildPregameMatchup({
      gameId: '21826166',
      awayTeamId: '22',
      homeTeamId: '6',
      awayAbbr: 'ORL',
      awayName: 'Orlando Magic',
      homeAbbr: 'CLE',
      homeName: 'Cleveland Cavaliers',
      tipLabel: '7:00 PM EDT',
      seasonLabel: 'Preseason',
      statusLabel: 'Scheduled',
      updatedLabel: 'Scoreboard Updated 1:59 PM EDT',
      returnHref: '/dashboard?date=2026-10-11',
      identityConfirmed: false,
      teamRows: [],
      playerRows: [],
      roster: roster('missing', null),
      quote: {
        quote: {
          vendorLabel: 'DraftKings',
          caption: 'DraftKings · BDL synced 2m ago',
          awayAbbr: 'ORL',
          homeAbbr: 'CLE',
          spreadAway: 'ORL +5.5',
          spreadHome: 'CLE -5.5',
          total: 'O/U 228.5',
          totalPrices: 'O -110 / U -110',
          moneylineAway: 'ORL +164',
          moneylineHome: 'CLE -198',
          implied: 'No-vig implied probability: ORL 38%, CLE 62%',
        },
        note: null,
      },
    });
    const html = renderToStaticMarkup(createElement(PregameMatchupView, { model }));
    expect(html.match(/data-market-strip/g)).toHaveLength(1);
    expect(html.match(/CLE -5\.5/g)).toHaveLength(1);
    expect(html).not.toContain('Sportsbook quote');
    expect(html).toContain('max-w-[1800px]');
    expect(html).toContain('max-w-3xl');

    const view = readFileSync(join(process.cwd(), 'components/scoreboard/PregameMatchupView.tsx'), 'utf8');
    const page = readFileSync(join(process.cwd(), 'app/scoreboard/games/[gameId]/page.tsx'), 'utf8');
    const layout = readFileSync(join(process.cwd(), 'components/betting/MatchupPageLayout.tsx'), 'utf8');
    expect(view).not.toContain('GameDetailsPageClient');
    expect(view).not.toContain('/api/betting/');
    expect(page).toContain('loadPregameMatchup');
    expect(page).not.toContain('/api/betting/');
    expect(layout).toContain('IntersectionObserver');
    expect(layout).toContain('scrollToSection');
    expect(layout).toContain('section-ai-projection');
    expect(layout).toContain('section-box');
    expect(layout).toContain('components/matchup/ResearchMatchupOverview');
    expect(layout).not.toContain('loadPregameMatchup');
    expect(layout).not.toContain('loadResearchOverview');
  });
});
