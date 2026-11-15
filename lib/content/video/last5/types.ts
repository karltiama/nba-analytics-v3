/**
 * "Last 5 vs tonight's line" short-form video.
 *
 * A Last5VideoSnapshot is frozen at render time and is the only input the
 * Remotion composition receives. The composition never queries a database.
 * The video shows history only: no picks, no projections, no edge claims.
 *
 * Keep this file free of runtime imports: `video/` imports it by relative path
 * into the Remotion webpack bundle, which does not resolve the `@/` alias.
 */

export type Last5Market = 'points' | 'rebounds' | 'assists' | 'threes';

export type LineResult = 'over' | 'under' | 'push';

export interface Last5GameBar {
  /** ET date, YYYY-MM-DD. */
  date: string;
  opponentAbbr: string;
  isHome: boolean;
  value: number;
  minutes: number | null;
  result: LineResult;
}

export interface LineRecord {
  overs: number;
  unders: number;
  pushes: number;
  games: number;
}

export interface Last5VideoSnapshot {
  kind: 'last5';
  player: {
    id: string;
    name: string;
    teamAbbr: string;
  };
  tonight: {
    gameId: string;
    opponentAbbr: string;
    isHome: boolean;
    /** ET date, YYYY-MM-DD. */
    date: string;
    /** e.g. "7:30 PM ET". */
    tipoffLabel: string;
  };
  market: Last5Market;
  /** Consensus main line across books. */
  line: number;
  bookCount: number;
  /** Oldest first, so bars read left to right in time. */
  last5: Last5GameBar[];
  last5Average: number;
  last5Record: LineRecord;
  last10Record: LineRecord;
  seasonRecord: LineRecord;
  seasonAverage: number;
  minutes: {
    last5Average: number | null;
    seasonAverage: number | null;
  };
  /** ISO timestamp of the newest line snapshot used. */
  linesAsOf: string;
  /** ET date of the newest game log used. */
  logsThrough: string;
}

export const MARKET_LABEL: Record<Last5Market, string> = {
  points: 'Points',
  rebounds: 'Rebounds',
  assists: 'Assists',
  threes: '3-pointers made',
};

/** Shared with the site footer's tone: history, not advice. */
export const VIDEO_DISCLAIMER =
  'Past results only. Not betting advice. 21+. Gambling problem? Call 1-800-GAMBLER.';
