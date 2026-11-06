import type { PlayerSumRow, TeamProfile, TeamSumRow } from './aggregate';
import { CURRENT_SEASON_MIN_GAMES, partialTeamProfile, regularSeasonSample } from './aggregate';
import { attributeMatchupPlayers, type MatchupContributors } from './membership';
import type { MatchupQuoteResult } from './quote';
import { hiddenRosterForUnconfirmedTeam, type RosterPresentation } from './roster';
import { selectMatchupInsights, type MatchupInsight } from './signals';
import { EXPECTED_TEAM_GAMES, HISTORICAL_SEASON_LABEL } from './window';
import type { InjuryReport } from './injury-report';
import type { StartersModel } from './starters';
import type { CurrentPlayers } from './current-players';
import type { GameRecap } from './recap';

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

/** Games each team needs this season before the story leads with this season. */
export const CURRENT_STORY_MIN_GAMES = 5;
/** Teams with a current-season profile needed to measure the league spread. */
const CURRENT_STORY_MIN_LEAGUE = 20;

export type CurrentInsight = MatchupInsight & {
  /**
   * held: 2025–26 showed the same contrast in the same direction. reversed: it showed this measure
   * running the other way. new: it did not show it.
   */
  trend: 'held' | 'reversed' | 'new';
};

export type CurrentStory = {
  seasonLabel: string;
  awayGames: number;
  homeGames: number;
  insights: CurrentInsight[];
  /** Last season's findings whose measure does not show up this season at all. */
  faded: MatchupInsight[];
};

const sameContrast = (a: MatchupInsight, b: MatchupInsight) => a.id === b.id && a.subject === b.subject;

/** This season's findings against this season's league, tagged against last season's. */
export function buildCurrentStory(input: {
  current: CurrentSeasonInput | null;
  awayTeamId: string;
  homeTeamId: string;
  awayAbbr: string;
  homeAbbr: string;
  history: MatchupInsight[];
}): CurrentStory | null {
  if (!input.current) return null;
  const profiles = new Map<string, TeamProfile>();
  for (const row of input.current.teamRows) {
    const profile = partialTeamProfile(row);
    if (profile) profiles.set(row.teamId, profile);
  }
  const away = profiles.get(input.awayTeamId);
  const home = profiles.get(input.homeTeamId);
  if (!away || !home) return null;
  if (away.games < CURRENT_STORY_MIN_GAMES || home.games < CURRENT_STORY_MIN_GAMES) return null;
  if (profiles.size < CURRENT_STORY_MIN_LEAGUE) return null;
  const seasonLabel = seasonSpan(input.current.season);
  const found = selectMatchupInsights({
    away: { abbr: input.awayAbbr, profile: away },
    home: { abbr: input.homeAbbr, profile: home },
    league: [...profiles.values()],
    season: { label: seasonLabel, current: true },
  });
  return {
    seasonLabel,
    awayGames: away.games,
    homeGames: home.games,
    insights: found.map((insight) => ({
      ...insight,
      trend: input.history.some((prior) => sameContrast(prior, insight))
        ? 'held'
        : input.history.some((prior) => prior.id === insight.id)
          ? 'reversed'
          : 'new',
    })),
    faded: input.history.filter((prior) => !found.some((insight) => insight.id === prior.id)),
  };
}

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
  /**
   * This season's findings, each tagged by whether last season showed the same contrast. Null until
   * both teams have CURRENT_STORY_MIN_GAMES games; the story then stays on 2025–26.
   */
  currentStory?: CurrentStory | null;
  /** Every listed injury on both teams with time out. Set by the loader; absent in pure builds. */
  injuryReport?: InjuryReport | null;
  /** Likely starters from this season's certified lineups. Null before any starters are loaded. */
  starters?: StartersModel | null;
  /** This season's players per team, still with the team. Null before opening night. */
  currentPlayers?: CurrentPlayers | null;
  /** Final games only: result against the closing line and who started. */
  recap?: GameRecap | null;
  /** The game's ET date (YYYY-MM-DD), for links that filter by slate. */
  gameDate?: string | null;
  /** Scoreboard phase when the page rendered. */
  phase?: 'pregame' | 'live' | 'final' | 'other';
  /** Poll the live board: the game is live, or tips within LIVE_WATCH_LEAD_MINUTES. */
  watchLive?: boolean;
  /** A past-season Final read from analytics.games, not the scoreboard. The page shows the header and recap only. */
  archive?: boolean;
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
  const insights = selectMatchupInsights({
    away: { abbr: input.awayAbbr, profile: away },
    home: { abbr: input.homeAbbr, profile: home },
    league: [...sample.values()],
  });
  return {
    ...base,
    history: {
      label: SAMPLE_LABEL,
      possessionNote: POSSESSION_NOTE,
      rows: comparison(away, home),
    },
    historyNote: null,
    insights,
    currentStory: buildCurrentStory({
      current: input.current ?? null,
      awayTeamId: input.awayTeamId,
      homeTeamId: input.homeTeamId,
      awayAbbr: input.awayAbbr,
      homeAbbr: input.homeAbbr,
      history: insights,
    }),
    contributors: attributeMatchupPlayers({
      awayTeamId: input.awayTeamId,
      homeTeamId: input.homeTeamId,
      playerRows: input.playerRows,
      roster: input.roster,
    }),
  };
}
