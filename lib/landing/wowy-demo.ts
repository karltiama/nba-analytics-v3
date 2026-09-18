/**
 * Static marketing demo for the landing WOWY section.
 * Built through the same classify → summarize path as /wowy, so WowyResults renders identically.
 * Illustration only — not a live API pair load.
 */

import { classifyWowyGames } from '@/lib/wowy/eligibility';
import { summarizeWowyPair } from '@/lib/wowy/aggregate';
import type { WowyLoadedGame, WowyPairQuery, WowyPairSummary } from '@/lib/wowy/types';

export type LandingWowyDemoScenario = {
  id: string;
  subjectName: string;
  subjectNbaId: string;
  teammateName: string;
  teammateNbaId: string;
  seasonLabel: string;
  teamLabel: string;
  seasonTypeLabel: string;
  summary: WowyPairSummary;
};

type SideAverages = {
  minutes: number;
  pts: number;
  reb: number;
  ast: number;
  tpm: number;
  fga: number;
  tpa: number;
  fta: number;
};

function demoGame(
  query: WowyPairQuery,
  gameId: string,
  startTime: string,
  side: 'with' | 'without',
  avgs: SideAverages,
  opponentAbbr: string
): WowyLoadedGame {
  const without = side === 'without';
  return {
    gameId,
    startTime,
    gameDate: startTime.slice(0, 10),
    season: query.season,
    status: 'Final',
    homeScore: 110,
    awayScore: 104,
    subjectTeamId: query.teamId,
    homeTeamId: query.teamId,
    opponentTeamId: '99',
    opponentAbbr,
    subjectMinutes: String(Math.round(avgs.minutes)),
    subjectPts: avgs.pts,
    subjectReb: avgs.reb,
    subjectAst: avgs.ast,
    subjectTpm: avgs.tpm,
    subjectFga: avgs.fga,
    subjectTpa: avgs.tpa,
    subjectFta: avgs.fta,
    teammateRowPresent: true,
    teammateTeamId: query.teamId,
    teammateMinutes: without ? '00' : '28',
    teammatePts: without ? 0 : 18,
    teammateReb: without ? 0 : 8,
    teammateAst: without ? 0 : 4,
    teammateTpm: without ? 0 : 1,
    teammateFga: without ? 0 : 14,
    teammateFta: without ? 0 : 3,
    teamPts: null,
    teamReb: null,
    teamAst: null,
    teamTpm: null,
    teamFga: null,
    teamTpa: null,
    teamFta: null,
    teamOppPts: null,
  };
}

function buildTeammateSplitSummary(args: {
  subjectPlayerId: string;
  teammatePlayerId: string;
  subjectName: string;
  teammateName: string;
  teamId: string;
  teamAbbreviation: string;
  teamFullName: string;
  season: string;
  withAvgs: SideAverages;
  withoutAvgs: SideAverages;
  gamesPerSide: number;
}): WowyPairSummary {
  const query: WowyPairQuery = {
    subjectPlayerId: args.subjectPlayerId,
    teammatePlayerId: args.teammatePlayerId,
    season: args.season,
    teamId: args.teamId,
    seasonType: 'regular',
  };

  const opponents = ['BOS', 'MIA', 'MIL', 'CLE', 'PHI', 'ATL', 'CHI', 'DET', 'IND', 'ORL', 'TOR', 'WAS'];
  const games: WowyLoadedGame[] = [];

  for (let i = 0; i < args.gamesPerSide; i++) {
    const day = String(i + 2).padStart(2, '0');
    games.push(
      demoGame(
        query,
        `landing-wowy-with-${args.subjectPlayerId}-${i + 1}`,
        `2025-01-${day}T00:00:00.000Z`,
        'with',
        args.withAvgs,
        opponents[i % opponents.length]
      )
    );
  }
  for (let i = 0; i < args.gamesPerSide; i++) {
    const day = String(i + 2).padStart(2, '0');
    games.push(
      demoGame(
        query,
        `landing-wowy-without-${args.subjectPlayerId}-${i + 1}`,
        `2025-02-${day}T00:00:00.000Z`,
        'without',
        args.withoutAvgs,
        opponents[(i + 3) % opponents.length]
      )
    );
  }

  const classified = classifyWowyGames(games, query);
  return summarizeWowyPair({
    query,
    classified,
    subjectName: args.subjectName,
    teammateName: args.teammateName,
    teamAbbreviation: args.teamAbbreviation,
    teamFullName: args.teamFullName,
  });
}

export const LANDING_WOWY_DEMO_SCENARIOS: LandingWowyDemoScenario[] = [
  {
    id: 'brunson-randle',
    subjectName: 'Jalen Brunson',
    subjectNbaId: '1628973',
    teammateName: 'Julius Randle',
    teammateNbaId: '203944',
    seasonLabel: '2024-25',
    teamLabel: 'NYK · sample stint',
    seasonTypeLabel: 'Regular season',
    summary: buildTeammateSplitSummary({
      subjectPlayerId: 'landing-brunson',
      teammatePlayerId: 'landing-randle',
      subjectName: 'Jalen Brunson',
      teammateName: 'Julius Randle',
      teamId: 'nyk',
      teamAbbreviation: 'NYK',
      teamFullName: 'New York Knicks',
      season: '2024',
      gamesPerSide: 8,
      withAvgs: {
        minutes: 35.1,
        pts: 25.7,
        reb: 3.5,
        ast: 6.7,
        tpm: 2.4,
        fga: 18.8,
        tpa: 6.2,
        fta: 5.1,
      },
      withoutAvgs: {
        minutes: 37.4,
        pts: 29.2,
        reb: 3.8,
        ast: 7.5,
        tpm: 2.8,
        fga: 21.6,
        tpa: 7.1,
        fta: 5.8,
      },
    }),
  },
  {
    id: 'haliburton-siakam',
    subjectName: 'Tyrese Haliburton',
    subjectNbaId: '1630169',
    teammateName: 'Pascal Siakam',
    teammateNbaId: '1627783',
    seasonLabel: '2024-25',
    teamLabel: 'IND · sample stint',
    seasonTypeLabel: 'Regular season',
    summary: buildTeammateSplitSummary({
      subjectPlayerId: 'landing-haliburton',
      teammatePlayerId: 'landing-siakam',
      subjectName: 'Tyrese Haliburton',
      teammateName: 'Pascal Siakam',
      teamId: 'ind',
      teamAbbreviation: 'IND',
      teamFullName: 'Indiana Pacers',
      season: '2024',
      gamesPerSide: 8,
      withAvgs: {
        minutes: 32.4,
        pts: 18.6,
        reb: 3.9,
        ast: 10.1,
        tpm: 2.1,
        fga: 14.2,
        tpa: 5.8,
        fta: 2.4,
      },
      withoutAvgs: {
        minutes: 34.8,
        pts: 22.1,
        reb: 4.2,
        ast: 11.4,
        tpm: 2.5,
        fga: 16.9,
        tpa: 6.6,
        fta: 3.1,
      },
    }),
  },
];

export function findLandingWowyScenario(id: string): LandingWowyDemoScenario {
  return (
    LANDING_WOWY_DEMO_SCENARIOS.find((s) => s.id === id) ?? LANDING_WOWY_DEMO_SCENARIOS[0]
  );
}
