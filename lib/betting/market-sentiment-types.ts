/** Implied win probability from a trading market — informational, not a sportsbook line. */
export interface MarketSentimentSnapshot {
  homeWinPct: number | null;
  awayWinPct: number | null;
  source?: string | null;
  /** Time series for crowd-implied home win % (e.g. from Polymarket public price history). */
  history?: { time: string; homeWinPct: number }[] | null;
}
