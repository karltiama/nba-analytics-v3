import type { PlayerSumRow, TeamProfile, TeamSumRow } from './aggregate';
import { CURRENT_SEASON_MIN_GAMES, partialTeamProfile, regularSeasonSample } from './aggregate';
import { attributeMatchupPlayers, type MatchupContributors } from './membership';
import type { MatchupQuoteResult } from './quote';
import { hiddenRosterForUnconfirmedTeam, type RosterPresentation } from './roster';
import { selectMatchupInsights, type MatchupInsight } from './signals';
import { EXPECTED_TEAM_GAMES, HISTORICAL_SEASON_LABEL } from './window';

/** Pregame schedule and injury lines, the same ones Today's Games cards show. */
export type MatchupGameContext = {
  schedule: string | null;
  injuries: {
    status: 'listed' | 'none' | 'unavailable';
    text: string;
    asOfLabel: string | null;
    teams: Array<{ abbr: string; players: Array<{ name: string; status: string }>; extra: number }> | null;
  };
};

export const POSSESSION_NOTE =
  'Estimated possessions are a box-score estimate, not official NBA pace, and are not adjusted for overtime.';

export type { MatchupContributors };

export const SAMPLE_LABEL = `${HISTORICAL_SEASON_LABEL} · ${EXPECTED_TEAM_GAMES} games`;

export type ComparisonRow = { label: string; away: string; home: string };

/** This season so far. Values are the same rows as `history`, over fewer games. */
export type CurrentSeasonComparison = {
  seasonLabel: string;
  label: string;
  awayGames: number;
  homeGames: number;
  rows: ComparisonRow[];
};

export type CurrentSeasonInput = {
  season: string;
  /** Every team's sums for this season's games before the matchup date. */
  teamRows: TeamSumRow[];
};

/** '2026' → '2026–27'. */
export function seasonSpan(season: string): string {
  const year = Number(season);
  if (!Number.isInteger(year)) return season;
  return `${year}–${String((year + 1) % 100).padStart(2, '0')}`;
}

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
  history: { label: string; possessionNote: string; rows: ComparisonRow[] } | null;
  historyNote: string | null;
  current: CurrentSeasonComparison | null;
  currentNote: string | null;
  context: MatchupGameContext | null;
  insights: MatchupInsight[];
  contributors: MatchupContributors | null;
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

function currentComparison(input: {
  current: CurrentSeasonInput | null;
  awayTeamId: string;
  homeTeamId: string;
  awayAbbr: string;
  homeAbbr: string;
}): { current: CurrentSeasonComparison | null; currentNote: string | null } {
  if (!input.current) return { current: null, currentNote: null };
  const span = seasonSpan(input.current.season);
  const byTeam = new Map(input.current.teamRows.map((row) => [row.teamId, row]));
  const awayRow = byTeam.get(input.awayTeamId);
  const homeRow = byTeam.get(input.homeTeamId);
  const away = awayRow ? partialTeamProfile(awayRow) : null;
  const home = homeRow ? partialTeamProfile(homeRow) : null;
  if (!away || !home) {
    return {
      current: null,
      currentNote: `${span} numbers appear once both teams have ${CURRENT_SEASON_MIN_GAMES} complete games.`,
    };
  }
  return {
    current: {
      seasonLabel: span,
      label: `${span} so far · ${input.awayAbbr} ${away.games} games · ${input.homeAbbr} ${home.games} games`,
      awayGames: away.games,
      homeGames: home.games,
      rows: comparison(away, home),
    },
    currentNote: null,
  };
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
  current?: CurrentSeasonInput | null;
  context?: MatchupGameContext | null;
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
    quote: input.quote.quote,
    quoteNote: input.quote.note,
    roster: input.identityConfirmed ? input.roster : hiddenRosterForUnconfirmedTeam(),
    context: input.context ?? null,
    ...(input.identityConfirmed
      ? currentComparison({
          current: input.current ?? null,
          awayTeamId: input.awayTeamId,
          homeTeamId: input.homeTeamId,
          awayAbbr: input.awayAbbr,
          homeAbbr: input.homeAbbr,
        })
      : { current: null, currentNote: null }),
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
    contributors: attributeMatchupPlayers({
      awayTeamId: input.awayTeamId,
      homeTeamId: input.homeTeamId,
      playerRows: input.playerRows,
      roster: input.roster,
    }),
  };
}
