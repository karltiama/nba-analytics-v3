/**
 * Shared fixture event list for Phase 4A tests (provider-internal ids only).
 */

import type { OddsApiEventRaw } from '../types';

export const FIXTURE_EVENT_ID = 'oddsapi_evt_bos_mia_20261021';

export const FIXTURE_EVENTS: OddsApiEventRaw[] = [
  {
    id: FIXTURE_EVENT_ID,
    sport_key: 'basketball_nba',
    sport_title: 'NBA',
    commence_time: '2026-10-21T23:30:00Z',
    home_team: 'Miami Heat',
    away_team: 'Boston Celtics',
  },
  {
    id: 'oddsapi_evt_other',
    sport_key: 'basketball_nba',
    sport_title: 'NBA',
    commence_time: '2026-10-21T23:30:00Z',
    home_team: 'Los Angeles Lakers',
    away_team: 'Golden State Warriors',
  },
];

export const FIXTURE_GAME_CONTEXT = {
  homeAbbreviation: 'MIA',
  awayAbbreviation: 'BOS',
  commenceTimeIso: '2026-10-21T23:30:00Z',
} as const;
