import { HISTORICAL_VIEW_MODE_LIVE } from '@/lib/betting/historical-final';
import {
  PREVIEW_DATE_ET,
  PREVIEW_GAMES,
  PREVIEW_SEASON,
  PREVIEW_TEAMS,
  teamDisplayName,
} from './catalog';
import { previewId } from './ids';
import { previewExplorerRows } from './props-fixture';
import type { PreviewScenario } from './scenario';

function teamSide(key: keyof typeof PREVIEW_TEAMS, scenario: PreviewScenario) {
  const team = PREVIEW_TEAMS[key];
  return {
    id: team.id,
    name: teamDisplayName(team, scenario),
    abbreviation: team.abbreviation,
    record: scenario === 'partial' ? null : team.record,
  };
}

function recentForm(scenario: PreviewScenario) {
  if (scenario === 'empty' || scenario === 'partial') return [];
  return [
    { opponent: 'CBN', result: 'W' as const, score: '118-109', spread: -3.5, covered: true, game_date: '2026-03-30' },
    { opponent: 'LVN', result: 'L' as const, score: '104-111', spread: 2.5, covered: false, game_date: '2026-03-28' },
    { opponent: 'HCH', result: 'W' as const, score: '121-116', spread: -1.5, covered: true, game_date: '2026-03-26' },
  ];
}

export function previewGameDetails(scenario: PreviewScenario, requestedId: string): {
  status: number;
  body: unknown;
} {
  if (scenario === 'error') {
    return { status: 500, body: { error: 'Failed to fetch game details', message: 'Preview error scenario' } };
  }
  const game = PREVIEW_GAMES[0];
  const populated = scenario === 'default' || scenario === 'mobile-dense';
  const partial = scenario === 'partial';
  return {
    status: 200,
    body: {
      viewMode: HISTORICAL_VIEW_MODE_LIVE,
      gameSeason: PREVIEW_SEASON,
      availability: {
        starters: false,
        advanced: false,
        roleProfile: false,
        timeline: false,
        rotationContext: false,
      },
      boxScore: { available: false, home: [], away: [] },
      starters: { available: false, home: [], away: [] },
      game: {
        id: String(game.gameId),
        requestedId,
        gameDate: PREVIEW_DATE_ET,
        status: game.status,
        statusRaw: game.status,
        homeTeam: teamSide(game.homeKey, scenario),
        awayTeam: teamSide(game.awayKey, scenario),
        startTime: game.startTime,
      },
      homeTeamStats: {
        offensiveRating: populated ? 116.4 : null,
        defensiveRating: populated ? 110.2 : null,
        pace: populated ? 100.8 : null,
        hasSeasonAnalytics: populated,
        recentForm: recentForm(scenario),
      },
      awayTeamStats: {
        offensiveRating: populated ? 114.1 : null,
        defensiveRating: populated ? 112.6 : null,
        pace: populated ? 99.4 : null,
        hasSeasonAnalytics: populated,
        recentForm: recentForm(scenario),
      },
      spreadMovement: populated
        ? [
            { time: '2026-04-02T12:00:00.000Z', value: -2.5 },
            { time: '2026-04-02T18:00:00.000Z', value: -3.5 },
          ]
        : [],
      totalMovement: populated
        ? [
            { time: '2026-04-02T12:00:00.000Z', value: 224.5 },
            { time: '2026-04-02T18:00:00.000Z', value: 226.5 },
          ]
        : [],
      historicalMatchups: populated
        ? [
            {
              date: '2026-01-14',
              homeTeam: 'RWR',
              awayTeam: 'HCH',
              homeScore: 118,
              awayScore: 111,
              totalPoints: 229,
            },
            {
              date: '2025-12-02',
              homeTeam: 'HCH',
              awayTeam: 'RWR',
              homeScore: 107,
              awayScore: 104,
              totalPoints: 211,
            },
          ]
        : partial
          ? [
              {
                date: '2026-01-14',
                homeTeam: 'RWR',
                awayTeam: 'HCH',
                homeScore: 118,
                awayScore: 111,
                totalPoints: 229,
              },
            ]
          : [],
      currentOdds: populated
        ? {
            spread: -3.5,
            spreadOddsHome: -110,
            spreadOddsAway: -110,
            moneylineHome: -160,
            moneylineAway: 135,
            overUnder: 226.5,
            overOdds: -108,
            underOdds: -112,
            bookmaker: 'DraftKings',
          }
        : {
            spread: partial ? -3.5 : null,
            spreadOddsHome: null,
            spreadOddsAway: null,
            moneylineHome: null,
            moneylineAway: null,
            overUnder: null,
            overOdds: null,
            underOdds: null,
            bookmaker: null,
          },
      injuries: populated
        ? {
            home: [
              { player: 'Nico Varga', status: 'Questionable', injury: 'Ankle' },
              { player: 'Andre Pell', status: 'Out', injury: 'Rest' },
            ],
            away: [{ player: 'Jules Okonkwo', status: 'Probable', injury: 'Knee' }],
          }
        : partial
          ? { home: [{ player: 'Andre Pell', status: 'Out', injury: 'Rest' }], away: [] }
          : { home: [], away: [] },
      injuryFeed: populated || partial ? 'authoritative_present' : 'authoritative_empty',
      ingestionFrozen: true,
      injuryMatchupContext: { season: PREVIEW_SEASON, entries: [] },
      aiSuggestions: [],
      aiConfidenceScores: { moneyline: 0, spread: 0, total: 0 },
      previewScope: previewId('game-details'),
    },
  };
}

export function previewPlayerPropsResponse(scenario: PreviewScenario): { status: number; body: unknown } {
  if (scenario === 'error') {
    return { status: 500, body: { error: 'Preview error scenario' } };
  }
  const playerProps = previewExplorerRows(scenario).map((row) => ({
    playerId: String(row.playerId),
    playerName: row.playerName,
    propType: row.propType,
    lineValue: row.lineValue,
    overOdds: row.side === 'over' ? row.oddsAmerican : -115,
    underOdds: row.side === 'under' ? row.oddsAmerican : -105,
    vendor: row.sportsbook,
  }));
  return { status: 200, body: { playerProps } };
}

export function previewSidebarProps(scenario: PreviewScenario, playerId: string): { status: number; body: unknown } {
  if (scenario === 'error') {
    return { status: 500, body: { error: 'Preview error scenario' } };
  }
  const props = previewExplorerRows(scenario).filter((row) => String(row.playerId) === String(playerId));
  return {
    status: 200,
    body: {
      props: props.map((row) => ({
        ...row,
        oddsDecimal: null,
      })),
    },
  };
}
