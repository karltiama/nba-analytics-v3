/**
 * Blind held-out fixtures for schedule-context-v1.
 * Frozen before final certification.
 */
import type { ScheduleGameRow } from '@/lib/context-center';

export type ScheduleHeldOutCase = {
  id: string;
  category: string;
  teamId: string;
  target: ScheduleGameRow;
  history: ScheduleGameRow[];
  expected: {
    homeAway: 'HOME' | 'AWAY';
    daysRest: number | null;
    backToBack: boolean;
    isSeasonOpener: boolean;
    previousGameId: string | null;
  };
};

function g(
  partial: Partial<ScheduleGameRow> & Pick<ScheduleGameRow, 'gameId' | 'startTime' | 'homeTeamId' | 'awayTeamId'>
): ScheduleGameRow {
  return {
    season: '2025',
    status: 'Final',
    homeScore: 110,
    awayScore: 105,
    ...partial,
  };
}

export const SCHEDULE_HELDOUT_CASES: ScheduleHeldOutCase[] = [
  {
    id: 'sch-home',
    category: 'HOME',
    teamId: '1',
    target: g({
      gameId: 'sch-home',
      startTime: '2025-12-15T00:30:00Z',
      homeTeamId: '1',
      awayTeamId: '2',
    }),
    history: [
      g({
        gameId: 'sch-home-prev',
        startTime: '2025-12-13T00:30:00Z',
        homeTeamId: '1',
        awayTeamId: '3',
      }),
    ],
    expected: {
      homeAway: 'HOME',
      daysRest: 1,
      backToBack: false,
      isSeasonOpener: false,
      previousGameId: 'sch-home-prev',
    },
  },
  {
    id: 'sch-away',
    category: 'AWAY',
    teamId: '2',
    target: g({
      gameId: 'sch-away',
      startTime: '2025-12-15T00:30:00Z',
      homeTeamId: '1',
      awayTeamId: '2',
    }),
    history: [
      g({
        gameId: 'sch-away-prev',
        startTime: '2025-12-12T00:30:00Z',
        homeTeamId: '4',
        awayTeamId: '2',
      }),
    ],
    expected: {
      homeAway: 'AWAY',
      daysRest: 2,
      backToBack: false,
      isSeasonOpener: false,
      previousGameId: 'sch-away-prev',
    },
  },
  {
    id: 'sch-b2b',
    category: '0_rest',
    teamId: '7',
    target: g({
      gameId: 'sch-b2b',
      startTime: '2026-11-12T00:30:00Z',
      homeTeamId: '7',
      awayTeamId: '8',
    }),
    history: [
      g({
        gameId: 'sch-b2b-prev',
        startTime: '2026-11-11T00:00:00Z',
        homeTeamId: '9',
        awayTeamId: '7',
      }),
    ],
    expected: {
      homeAway: 'HOME',
      daysRest: 0,
      backToBack: true,
      isSeasonOpener: false,
      previousGameId: 'sch-b2b-prev',
    },
  },
  {
    id: 'sch-1rest',
    category: '1_rest',
    teamId: '7',
    target: g({
      gameId: 'sch-1rest',
      startTime: '2026-11-13T00:00:00Z',
      homeTeamId: '8',
      awayTeamId: '7',
    }),
    history: [
      g({
        gameId: 'sch-1rest-prev',
        startTime: '2026-11-11T00:00:00Z',
        homeTeamId: '7',
        awayTeamId: '9',
      }),
    ],
    expected: {
      homeAway: 'AWAY',
      daysRest: 1,
      backToBack: false,
      isSeasonOpener: false,
      previousGameId: 'sch-1rest-prev',
    },
  },
  {
    id: 'sch-2rest',
    category: '2+_rest',
    teamId: '7',
    target: g({
      gameId: 'sch-2rest',
      startTime: '2026-11-14T00:00:00Z',
      homeTeamId: '7',
      awayTeamId: '8',
    }),
    history: [
      g({
        gameId: 'sch-2rest-prev',
        startTime: '2026-11-11T00:00:00Z',
        homeTeamId: '7',
        awayTeamId: '9',
      }),
    ],
    expected: {
      homeAway: 'HOME',
      daysRest: 2,
      backToBack: false,
      isSeasonOpener: false,
      previousGameId: 'sch-2rest-prev',
    },
  },
  {
    id: 'sch-opener',
    category: 'season_opener',
    teamId: '12',
    target: g({
      gameId: 'sch-opener',
      season: '2025',
      startTime: '2025-10-22T23:30:00Z',
      homeTeamId: '12',
      awayTeamId: '13',
    }),
    history: [
      g({
        gameId: 'sch-opener-prev-season',
        season: '2024',
        startTime: '2025-04-20T00:00:00Z',
        homeTeamId: '12',
        awayTeamId: '14',
      }),
    ],
    expected: {
      homeAway: 'HOME',
      daysRest: null,
      backToBack: false,
      isSeasonOpener: true,
      previousGameId: null,
    },
  },
  {
    id: 'sch-long',
    category: 'long_break',
    teamId: '5',
    target: g({
      gameId: 'sch-long',
      startTime: '2026-02-20T00:30:00Z',
      homeTeamId: '5',
      awayTeamId: '6',
    }),
    history: [
      g({
        gameId: 'sch-long-prev',
        startTime: '2026-02-12T00:30:00Z',
        homeTeamId: '6',
        awayTeamId: '5',
      }),
    ],
    expected: {
      homeAway: 'HOME',
      daysRest: 7,
      backToBack: false,
      isSeasonOpener: false,
      previousGameId: 'sch-long-prev',
    },
  },
  {
    id: 'sch-et-utc',
    category: 'ET_UTC_boundary',
    teamId: '3',
    target: g({
      gameId: 'sch-et-utc',
      startTime: '2025-11-12T00:30:00Z',
      homeTeamId: '4',
      awayTeamId: '3',
    }),
    history: [
      g({
        gameId: 'sch-et-utc-prev',
        startTime: '2025-11-11T00:30:00Z',
        homeTeamId: '3',
        awayTeamId: '4',
      }),
    ],
    expected: {
      homeAway: 'AWAY',
      daysRest: 0,
      backToBack: true,
      isSeasonOpener: false,
      previousGameId: 'sch-et-utc-prev',
    },
  },
  {
    id: 'sch-same-tip',
    category: 'same_tip_exclusion',
    teamId: '15',
    target: g({
      gameId: 'sch-same-tip',
      startTime: '2025-12-01T00:30:00Z',
      homeTeamId: '15',
      awayTeamId: '16',
    }),
    history: [
      g({
        gameId: 'sch-same-tip-other',
        startTime: '2025-12-01T00:30:00Z',
        homeTeamId: '15',
        awayTeamId: '17',
      }),
      g({
        gameId: 'sch-same-tip-earlier',
        startTime: '2025-11-28T00:30:00Z',
        homeTeamId: '18',
        awayTeamId: '15',
      }),
    ],
    expected: {
      homeAway: 'HOME',
      daysRest: 2,
      backToBack: false,
      isSeasonOpener: false,
      previousGameId: 'sch-same-tip-earlier',
    },
  },
  {
    id: 'sch-postponed',
    category: 'postponed_prior',
    teamId: '20',
    target: g({
      gameId: 'sch-postponed',
      startTime: '2025-12-10T00:30:00Z',
      homeTeamId: '20',
      awayTeamId: '21',
    }),
    history: [
      g({
        gameId: 'sch-postponed-bad',
        startTime: '2025-12-09T00:30:00Z',
        status: 'Postponed',
        homeTeamId: '20',
        awayTeamId: '22',
        homeScore: null,
        awayScore: null,
      }),
      g({
        gameId: 'sch-postponed-good',
        startTime: '2025-12-07T00:30:00Z',
        homeTeamId: '23',
        awayTeamId: '20',
      }),
    ],
    expected: {
      homeAway: 'HOME',
      daysRest: 2,
      backToBack: false,
      isSeasonOpener: false,
      previousGameId: 'sch-postponed-good',
    },
  },
  {
    id: 'sch-month',
    category: 'month_boundary',
    teamId: '25',
    target: g({
      gameId: 'sch-month',
      season: '2024',
      startTime: '2024-12-02T00:30:00Z',
      homeTeamId: '25',
      awayTeamId: '26',
    }),
    history: [
      g({
        gameId: 'sch-month-prev',
        season: '2024',
        startTime: '2024-11-30T00:30:00Z',
        homeTeamId: '26',
        awayTeamId: '25',
      }),
    ],
    expected: {
      homeAway: 'HOME',
      daysRest: 1,
      backToBack: false,
      isSeasonOpener: false,
      previousGameId: 'sch-month-prev',
    },
  },
  {
    id: 'sch-year',
    category: 'year_boundary',
    teamId: '27',
    target: g({
      gameId: 'sch-year',
      season: '2024',
      startTime: '2025-01-02T00:30:00Z',
      homeTeamId: '28',
      awayTeamId: '27',
    }),
    history: [
      g({
        gameId: 'sch-year-prev',
        season: '2024',
        startTime: '2024-12-31T00:30:00Z',
        homeTeamId: '27',
        awayTeamId: '28',
      }),
    ],
    expected: {
      homeAway: 'AWAY',
      daysRest: 1,
      backToBack: false,
      isSeasonOpener: false,
      previousGameId: 'sch-year-prev',
    },
  },
  {
    id: 'sch-3rest',
    category: '2+_rest',
    teamId: '30',
    target: g({
      gameId: 'sch-3rest',
      startTime: '2026-01-20T00:30:00Z',
      homeTeamId: '30',
      awayTeamId: '31',
    }),
    history: [
      g({
        gameId: 'sch-3rest-prev',
        startTime: '2026-01-16T00:30:00Z',
        homeTeamId: '31',
        awayTeamId: '30',
      }),
    ],
    expected: {
      homeAway: 'HOME',
      daysRest: 3,
      backToBack: false,
      isSeasonOpener: false,
      previousGameId: 'sch-3rest-prev',
    },
  },
  {
    id: 'sch-away-b2b',
    category: '0_rest',
    teamId: '33',
    target: g({
      gameId: 'sch-away-b2b',
      startTime: '2026-03-11T00:00:00Z',
      homeTeamId: '34',
      awayTeamId: '33',
    }),
    history: [
      g({
        gameId: 'sch-away-b2b-prev',
        startTime: '2026-03-10T00:00:00Z',
        homeTeamId: '33',
        awayTeamId: '35',
      }),
    ],
    expected: {
      homeAway: 'AWAY',
      daysRest: 0,
      backToBack: true,
      isSeasonOpener: false,
      previousGameId: 'sch-away-b2b-prev',
    },
  },
  {
    id: 'sch-opener-away',
    category: 'season_opener',
    teamId: '40',
    target: g({
      gameId: 'sch-opener-away',
      season: '2023',
      startTime: '2023-10-25T00:00:00Z',
      homeTeamId: '41',
      awayTeamId: '40',
    }),
    history: [],
    expected: {
      homeAway: 'AWAY',
      daysRest: null,
      backToBack: false,
      isSeasonOpener: true,
      previousGameId: null,
    },
  },
];
