/**
 * STEP 14P.X3F locked ground truth.
 *
 * Written from analytics.player_prop_market_movement + games + players
 * for game 18447934 BEFORE any XRay interpretation was run.
 * Does not include expected summary copy, outlook, or why-this-could-fail text.
 */
export const X3F_GAME_ID = '18447934';
export const X3F_CUTOFF_AT = '2026-04-03T01:30:00.000Z';
export const X3F_HISTORICAL_DATE = '2026-04-02';
export const X3F_DATE_LABEL = 'April 2, 2026';
export const X3F_SEASON = '2025';
export const X3F_HOME_ABBR = 'OKC';
export const X3F_AWAY_ABBR = 'LAL';
export const X3F_HOME_TEAM_ID = '21';
export const X3F_AWAY_TEAM_ID = '14';
export const X3F_SLATE_LABEL = 'LAL @ OKC';

export const X3F_AJAY_ID = '1028037477';
export const X3F_DORT_ID = '666541';
export const X3F_LUKA_ID = '132';

/** NBA.com CDN ids for Workspace / XRay portraits (analytics.player_provider_ids). */
export const X3F_AJAY_NBA_PLAYER_ID = '1642349';
export const X3F_DORT_NBA_PLAYER_ID = '1629652';
export const X3F_LUKA_NBA_PLAYER_ID = '1629029';

export const X3F_NBA_PLAYER_ID_BY_PLAYER_ID: Record<string, string> = {
  [X3F_AJAY_ID]: X3F_AJAY_NBA_PLAYER_ID,
  [X3F_DORT_ID]: X3F_DORT_NBA_PLAYER_ID,
  [X3F_LUKA_ID]: X3F_LUKA_NBA_PLAYER_ID,
};

export const X3F_KNOWN_GAPS = ['WOWY', 'projection', 'availability'] as const;

export type X3FExpectedMatchStatus = 'MATCHED' | 'PARTIAL_MATCH';

export type X3FGroundTruthLeg = {
  id: string;
  ocrPlayerName: string;
  confirmedPlayerName: string;
  canonicalPlayerId: string;
  canonicalPlayerName: string;
  teamAbbr: string;
  opponentAbbr: string;
  market: 'points' | 'assists';
  side: 'over';
  requestedLine: number;
  book: 'draftkings';
  threeHourLine: number;
  closeLine: number;
  threeHourOverOdds: number;
  closeOverOdds: number;
  matchStatus: X3FExpectedMatchStatus;
  lineQuality: 'EXACT_LINE_MATCH' | 'MARKET_MATCH_DIFFERENT_LINE';
  matchReason: string | null;
  playerExact: boolean;
  gameExact: boolean;
  marketExact: boolean;
  lineExact: boolean;
  bookExact: boolean;
};

export const X3F_GROUND_TRUTH_LEGS: X3FGroundTruthLeg[] = [
  {
    id: 'leg-ajay-pts',
    ocrPlayerName: 'Ajay Mitchell',
    confirmedPlayerName: 'Ajay Mitchell',
    canonicalPlayerId: X3F_AJAY_ID,
    canonicalPlayerName: 'Ajay Mitchell',
    teamAbbr: 'OKC',
    opponentAbbr: 'LAL',
    market: 'points',
    side: 'over',
    requestedLine: 12.5,
    book: 'draftkings',
    threeHourLine: 11.5,
    closeLine: 12.5,
    threeHourOverOdds: -130,
    closeOverOdds: -107,
    matchStatus: 'MATCHED',
    lineQuality: 'EXACT_LINE_MATCH',
    matchReason: null,
    playerExact: true,
    gameExact: true,
    marketExact: true,
    lineExact: true,
    bookExact: true,
  },
  {
    id: 'leg-ajay-ast',
    ocrPlayerName: 'Ajay Mitchell',
    confirmedPlayerName: 'Ajay Mitchell',
    canonicalPlayerId: X3F_AJAY_ID,
    canonicalPlayerName: 'Ajay Mitchell',
    teamAbbr: 'OKC',
    opponentAbbr: 'LAL',
    market: 'assists',
    side: 'over',
    requestedLine: 2.5,
    book: 'draftkings',
    threeHourLine: 2.5,
    closeLine: 2.5,
    threeHourOverOdds: -147,
    closeOverOdds: -161,
    matchStatus: 'MATCHED',
    lineQuality: 'EXACT_LINE_MATCH',
    matchReason: null,
    playerExact: true,
    gameExact: true,
    marketExact: true,
    lineExact: true,
    bookExact: true,
  },
  {
    id: 'leg-dort-pts',
    ocrPlayerName: 'Luguentz Dort',
    confirmedPlayerName: 'Luguentz Dort',
    canonicalPlayerId: X3F_DORT_ID,
    canonicalPlayerName: 'Luguentz Dort',
    teamAbbr: 'OKC',
    opponentAbbr: 'LAL',
    market: 'points',
    side: 'over',
    requestedLine: 8.5,
    book: 'draftkings',
    threeHourLine: 6.5,
    closeLine: 7.5,
    threeHourOverOdds: -117,
    closeOverOdds: -103,
    matchStatus: 'PARTIAL_MATCH',
    lineQuality: 'MARKET_MATCH_DIFFERENT_LINE',
    matchReason: 'DIFFERENT_LINE',
    playerExact: true,
    gameExact: true,
    marketExact: true,
    lineExact: false,
    bookExact: true,
  },
  {
    id: 'leg-luka-pts',
    ocrPlayerName: 'Luka Doncic',
    confirmedPlayerName: 'Luka Doncic',
    canonicalPlayerId: X3F_LUKA_ID,
    canonicalPlayerName: 'Luka Doncic',
    teamAbbr: 'LAL',
    opponentAbbr: 'OKC',
    market: 'points',
    side: 'over',
    requestedLine: 30.5,
    book: 'draftkings',
    threeHourLine: 31.5,
    closeLine: 30.5,
    threeHourOverOdds: -108,
    closeOverOdds: -120,
    matchStatus: 'MATCHED',
    lineQuality: 'EXACT_LINE_MATCH',
    matchReason: null,
    playerExact: true,
    gameExact: true,
    marketExact: true,
    lineExact: true,
    bookExact: true,
  },
];

export const X3F_REPLAY_CONTEXT = {
  historicalDate: X3F_HISTORICAL_DATE,
  cutoffAt: X3F_CUTOFF_AT,
  gameId: X3F_GAME_ID,
  dateLabel: X3F_DATE_LABEL,
  season: X3F_SEASON,
  slateLabel: X3F_SLATE_LABEL,
} as const;
