import type { HistoricalContributor, PlayerSumRow, TeamProfile, TeamSumRow } from './aggregate';
import { historicalContributors, regularSeasonSample } from './aggregate';
import type { MatchupQuoteResult } from './quote';
import { hiddenRosterForUnconfirmedTeam, type RosterPresentation } from './roster';
import { selectMatchupInsights, type MatchupInsight } from './signals';
import { propsExplorerHref } from '@/lib/betting/research-journey';
import { EXPECTED_TEAM_GAMES, HISTORICAL_SEASON_LABEL } from './window';

export const POSSESSION_NOTE =
  'Estimated possessions are a box-score estimate, not official NBA pace, and are not adjusted for overtime.';

export const CONTRIBUTOR_LABEL = '2025–26 historical production — not a confirmed current roster';

export const SAMPLE_LABEL = `${HISTORICAL_SEASON_LABEL} · ${EXPECTED_TEAM_GAMES} games`;

export type ComparisonRow = { label: string; away: string; home: string };

export type PregameMatchupModel = {
  gameId: string;
  awayAbbr: string;
  awayName: string;
  homeAbbr: string;
  homeName: string;
  tipLabel: string;
  seasonLabel: string;
  statusLabel: string;
  updatedLabel: string;
  returnHref: string;
  propsHref: string;
  history: { label: string; possessionNote: string; rows: ComparisonRow[] } | null;
  historyNote: string | null;
  insights: MatchupInsight[];
  contributors: { label: string; away: HistoricalContributor[]; home: HistoricalContributor[] } | null;
  roster: RosterPresentation;
  quote: MatchupQuoteResult['quote'];
  quoteNote: string | null;
};

function one(value: number): string {
  return value.toFixed(1);
}

function signed(value: number): string {
  const text = one(value);
  return value > 0 ? `+${text}` : text;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function comparison(away: TeamProfile, home: TeamProfile): ComparisonRow[] {
  return [
    { label: 'Offensive rating', away: one(away.offensiveRating), home: one(home.offensiveRating) },
    { label: 'Defensive rating', away: one(away.defensiveRating), home: one(home.defensiveRating) },
    { label: 'Net rating', away: signed(away.netRating), home: signed(home.netRating) },
    {
      label: 'Estimated possessions / game',
      away: one(away.estimatedPossessionsPerGame),
      home: one(home.estimatedPossessionsPerGame),
    },
    { label: 'Points scored', away: one(away.pointsPerGame), home: one(home.pointsPerGame) },
    { label: 'Points allowed', away: one(away.pointsAllowedPerGame), home: one(home.pointsAllowedPerGame) },
    { label: 'eFG%', away: percent(away.effectiveFieldGoalPct), home: percent(home.effectiveFieldGoalPct) },
    { label: '3PA rate', away: percent(away.threePointAttemptRate), home: percent(home.threePointAttemptRate) },
    {
      label: 'Offensive-rebounding rate',
      away: percent(away.offensiveReboundRate),
      home: percent(home.offensiveReboundRate),
    },
  ];
}

export function buildPregameMatchup(input: {
  gameId: string;
  awayTeamId: string;
  homeTeamId: string;
  awayAbbr: string;
  awayName: string;
  homeAbbr: string;
  homeName: string;
  tipLabel: string;
  seasonLabel: string;
  statusLabel: string;
  updatedLabel: string;
  returnHref: string;
  identityConfirmed: boolean;
  teamRows: TeamSumRow[];
  playerRows: PlayerSumRow[];
  roster: RosterPresentation;
  quote: MatchupQuoteResult;
}): PregameMatchupModel {
  const base = {
    gameId: input.gameId,
    awayAbbr: input.awayAbbr,
    awayName: input.awayName,
    homeAbbr: input.homeAbbr,
    homeName: input.homeName,
    tipLabel: input.tipLabel,
    seasonLabel: input.seasonLabel,
    statusLabel: input.statusLabel,
    updatedLabel: input.updatedLabel,
    returnHref: input.returnHref,
    propsHref: propsExplorerHref({
      gameId: input.gameId,
      date: /[?&]date=(\d{4}-\d{2}-\d{2})/.exec(input.returnHref)?.[1] ?? null,
    }),
    quote: input.quote.quote,
    quoteNote: input.quote.note,
    roster: input.identityConfirmed ? input.roster : hiddenRosterForUnconfirmedTeam(),
  };
  if (!input.identityConfirmed) {
    return {
      ...base,
      history: null,
      historyNote: 'Team identity could not be confirmed against the historical team list, so last season’s stats are hidden.',
      insights: [],
      contributors: null,
    };
  }
  const sample = regularSeasonSample(input.teamRows);
  const away = sample?.get(input.awayTeamId) ?? null;
  const home = sample?.get(input.homeTeamId) ?? null;
  if (!sample || !away || !home) {
    return {
      ...base,
      history: null,
      historyNote: 'The 2025–26 regular-season sample is incomplete, so team and player comparisons are hidden.',
      insights: [],
      contributors: null,
    };
  }
  return {
    ...base,
    history: {
      label: SAMPLE_LABEL,
      possessionNote: POSSESSION_NOTE,
      rows: comparison(away, home),
    },
    historyNote: null,
    insights: selectMatchupInsights({
      away: { abbr: input.awayAbbr, profile: away },
      home: { abbr: input.homeAbbr, profile: home },
      league: [...sample.values()],
    }),
    contributors: {
      label: CONTRIBUTOR_LABEL,
      away: historicalContributors(input.playerRows, input.awayTeamId),
      home: historicalContributors(input.playerRows, input.homeTeamId),
    },
  };
}
