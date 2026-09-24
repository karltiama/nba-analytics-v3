/**
 * Private The Odds API response shapes for the Phase 4A spike.
 * Do not re-export from the public sportsbook-selection-deeplink barrel.
 */

export type OddsApiOutcomeRaw = {
  name: string;
  description?: string;
  price: number;
  point?: number;
  link?: string | null;
  sid?: string | null;
};

export type OddsApiMarketRaw = {
  key: string;
  last_update?: string;
  link?: string | null;
  sid?: string | null;
  outcomes: OddsApiOutcomeRaw[];
};

export type OddsApiBookmakerRaw = {
  key: string;
  title: string;
  last_update?: string;
  link?: string | null;
  sid?: string | null;
  markets: OddsApiMarketRaw[];
};

export type OddsApiEventRaw = {
  id: string;
  sport_key: string;
  sport_title?: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: OddsApiBookmakerRaw[];
};
