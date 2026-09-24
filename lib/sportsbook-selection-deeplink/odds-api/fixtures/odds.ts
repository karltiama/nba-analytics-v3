/**
 * Per-bookmaker fixture odds payloads for Level-3 deeplink spike tests.
 * Links use Phase 3 allowlisted hosts only (except the unsafe fixture).
 */

import type { OddsApiEventRaw } from '../types';
import { FIXTURE_EVENT_ID } from './events';

function baseEvent(bookmakers: OddsApiEventRaw['bookmakers']): OddsApiEventRaw {
  return {
    id: FIXTURE_EVENT_ID,
    sport_key: 'basketball_nba',
    sport_title: 'NBA',
    commence_time: '2026-10-21T23:30:00Z',
    home_team: 'Miami Heat',
    away_team: 'Boston Celtics',
    bookmakers,
  };
}

/** FanDuel — exact selection with provider-generated addToBetslip link. */
export const FIXTURE_FANDUEL_EXACT: OddsApiEventRaw = baseEvent([
  {
    key: 'fanduel',
    title: 'FanDuel',
    sid: 'fd_evt_33617147',
    link: 'https://sportsbook.fanduel.com/basketball/nba/boston-celtics-miami-heat-33617147',
    markets: [
      {
        key: 'player_points',
        sid: '42.448600011',
        link: null,
        outcomes: [
          {
            name: 'Over',
            description: 'Jayson Tatum',
            price: -110,
            point: 28.5,
            sid: '29165',
            link: 'https://sportsbook.fanduel.com/addToBetslip?marketId=42.448600011&selectionId=29165',
          },
          {
            name: 'Under',
            description: 'Jayson Tatum',
            price: -110,
            point: 28.5,
            sid: '29178',
            link: 'https://sportsbook.fanduel.com/addToBetslip?marketId=42.448600011&selectionId=29178',
          },
          {
            name: 'Over',
            description: 'Bam Adebayo',
            price: -115,
            point: 18.5,
            sid: '30001',
            link: 'https://sportsbook.fanduel.com/addToBetslip?marketId=42.448600099&selectionId=30001',
          },
          {
            name: 'Under',
            description: 'Bam Adebayo',
            price: -105,
            point: 18.5,
            sid: '30002',
            link: 'https://sportsbook.fanduel.com/addToBetslip?marketId=42.448600099&selectionId=30002',
          },
        ],
      },
    ],
  },
]);

/** DraftKings — exact with selection link. */
export const FIXTURE_DRAFTKINGS_EXACT: OddsApiEventRaw = baseEvent([
  {
    key: 'draftkings',
    title: 'DraftKings',
    sid: 'dk_evt_111',
    link: 'https://sportsbook.draftkings.com/event/111',
    markets: [
      {
        key: 'player_points',
        sid: 'dk_mkt_points',
        outcomes: [
          {
            name: 'Over',
            description: 'Jayson Tatum',
            price: -108,
            point: 28.5,
            sid: 'dk_sel_over_285',
            link: 'https://sportsbook.draftkings.com/event/111?outcomes=dk_sel_over_285',
          },
          {
            name: 'Under',
            description: 'Jayson Tatum',
            price: -112,
            point: 28.5,
            sid: 'dk_sel_under_285',
            link: 'https://sportsbook.draftkings.com/event/111?outcomes=dk_sel_under_285',
          },
        ],
      },
    ],
  },
]);

/** Caesars (williamhill_us). */
export const FIXTURE_CAESARS_EXACT: OddsApiEventRaw = baseEvent([
  {
    key: 'williamhill_us',
    title: 'Caesars',
    sid: 'czr_evt_9',
    markets: [
      {
        key: 'player_points',
        sid: 'czr_mkt_1',
        outcomes: [
          {
            name: 'Over',
            description: 'Jayson Tatum',
            price: -110,
            point: 28.5,
            sid: 'czr_sel_o',
            link: 'https://sportsbook.caesars.com/betslip?selection=czr_sel_o',
          },
          {
            name: 'Under',
            description: 'Jayson Tatum',
            price: -110,
            point: 28.5,
            sid: 'czr_sel_u',
            link: 'https://sportsbook.caesars.com/betslip?selection=czr_sel_u',
          },
        ],
      },
    ],
  },
]);

/** Fanatics. */
export const FIXTURE_FANATICS_EXACT: OddsApiEventRaw = baseEvent([
  {
    key: 'fanatics',
    title: 'Fanatics',
    sid: 'fan_evt_7',
    markets: [
      {
        key: 'player_points',
        sid: 'fan_mkt_1',
        outcomes: [
          {
            name: 'Over',
            description: 'Jayson Tatum',
            price: -110,
            point: 28.5,
            sid: 'fan_sel_o',
            link: 'https://betfanatics.com/sportsbook?selection=fan_sel_o',
          },
          {
            name: 'Under',
            description: 'Jayson Tatum',
            price: -110,
            point: 28.5,
            sid: 'fan_sel_u',
            link: 'https://betfanatics.com/sportsbook?selection=fan_sel_u',
          },
        ],
      },
    ],
  },
]);

/** BetMGM. */
export const FIXTURE_BETMGM_EXACT: OddsApiEventRaw = baseEvent([
  {
    key: 'betmgm',
    title: 'BetMGM',
    sid: 'mgm_evt_5',
    markets: [
      {
        key: 'player_points',
        sid: 'mgm_mkt_1',
        outcomes: [
          {
            name: 'Over',
            description: 'Jayson Tatum',
            price: -110,
            point: 28.5,
            sid: 'mgm_sel_o',
            link: 'https://www.betmgm.com/en/sports?options=mgm_sel_o',
          },
          {
            name: 'Under',
            description: 'Jayson Tatum',
            price: -110,
            point: 28.5,
            sid: 'mgm_sel_u',
            link: 'https://www.betmgm.com/en/sports?options=mgm_sel_u',
          },
        ],
      },
    ],
  },
]);

/** Line moved to 29.5 only (single main line). */
export const FIXTURE_LINE_CHANGED: OddsApiEventRaw = baseEvent([
  {
    key: 'fanduel',
    title: 'FanDuel',
    sid: 'fd_evt_line',
    markets: [
      {
        key: 'player_points',
        sid: '42.line',
        outcomes: [
          {
            name: 'Over',
            description: 'Jayson Tatum',
            price: -105,
            point: 29.5,
            sid: 'sel_295_o',
            link: 'https://sportsbook.fanduel.com/addToBetslip?marketId=42.line&selectionId=sel_295_o',
          },
          {
            name: 'Under',
            description: 'Jayson Tatum',
            price: -115,
            point: 29.5,
            sid: 'sel_295_u',
            link: 'https://sportsbook.fanduel.com/addToBetslip?marketId=42.line&selectionId=sel_295_u',
          },
        ],
      },
    ],
  },
]);

/** Multiple alternate lines in the same market payload — must not pick. */
export const FIXTURE_AMBIGUOUS_ALTERNATES: OddsApiEventRaw = baseEvent([
  {
    key: 'fanduel',
    title: 'FanDuel',
    sid: 'fd_evt_alt',
    markets: [
      {
        key: 'player_points',
        sid: '42.alt',
        outcomes: [
          {
            name: 'Over',
            description: 'Jayson Tatum',
            price: -110,
            point: 27.5,
            sid: 'a1',
            link: 'https://sportsbook.fanduel.com/addToBetslip?marketId=42.alt&selectionId=a1',
          },
          {
            name: 'Under',
            description: 'Jayson Tatum',
            price: -110,
            point: 27.5,
            sid: 'a2',
            link: 'https://sportsbook.fanduel.com/addToBetslip?marketId=42.alt&selectionId=a2',
          },
          {
            name: 'Over',
            description: 'Jayson Tatum',
            price: 100,
            point: 29.5,
            sid: 'a3',
            link: 'https://sportsbook.fanduel.com/addToBetslip?marketId=42.alt&selectionId=a3',
          },
          {
            name: 'Under',
            description: 'Jayson Tatum',
            price: -120,
            point: 29.5,
            sid: 'a4',
            link: 'https://sportsbook.fanduel.com/addToBetslip?marketId=42.alt&selectionId=a4',
          },
        ],
      },
    ],
  },
]);

/** Exact line/side but null link. */
export const FIXTURE_MISSING_LINK: OddsApiEventRaw = baseEvent([
  {
    key: 'fanduel',
    title: 'FanDuel',
    sid: 'fd_evt_nolink',
    markets: [
      {
        key: 'player_points',
        sid: '42.nolink',
        outcomes: [
          {
            name: 'Over',
            description: 'Jayson Tatum',
            price: -110,
            point: 28.5,
            sid: 'sel_nolink',
            link: null,
          },
          {
            name: 'Under',
            description: 'Jayson Tatum',
            price: -110,
            point: 28.5,
            sid: 'sel_nolink_u',
            link: null,
          },
        ],
      },
    ],
  },
]);

/** Exact selection but unexpected host. */
export const FIXTURE_UNSAFE_LINK: OddsApiEventRaw = baseEvent([
  {
    key: 'fanduel',
    title: 'FanDuel',
    sid: 'fd_evt_unsafe',
    markets: [
      {
        key: 'player_points',
        sid: '42.unsafe',
        outcomes: [
          {
            name: 'Over',
            description: 'Jayson Tatum',
            price: -110,
            point: 28.5,
            sid: 'sel_unsafe',
            link: 'https://evil.example.com/addToBetslip?selectionId=1',
          },
          {
            name: 'Under',
            description: 'Jayson Tatum',
            price: -110,
            point: 28.5,
            sid: 'sel_unsafe_u',
            link: 'https://evil.example.com/addToBetslip?selectionId=2',
          },
        ],
      },
    ],
  },
]);

export function oddsFixtureKey(
  eventId: string,
  bookmaker: string,
  market: string
): string {
  return `${eventId}:${bookmaker}:${market}`;
}

/** Coverage map: one exact fixture per handoff book for spike documentation. */
export function buildCoverageFixtureMap(): Record<string, OddsApiEventRaw> {
  const market = 'player_points';
  return {
    [oddsFixtureKey(FIXTURE_EVENT_ID, 'fanduel', market)]: FIXTURE_FANDUEL_EXACT,
    [oddsFixtureKey(FIXTURE_EVENT_ID, 'draftkings', market)]: FIXTURE_DRAFTKINGS_EXACT,
    [oddsFixtureKey(FIXTURE_EVENT_ID, 'williamhill_us', market)]: FIXTURE_CAESARS_EXACT,
    [oddsFixtureKey(FIXTURE_EVENT_ID, 'fanatics', market)]: FIXTURE_FANATICS_EXACT,
    [oddsFixtureKey(FIXTURE_EVENT_ID, 'betmgm', market)]: FIXTURE_BETMGM_EXACT,
  };
}
