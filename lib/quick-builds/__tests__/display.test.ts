import { describe, expect, it } from 'vitest';
import { attachQuickBuildDisplay, QUICK_BUILD_PLAYERS_SQL, usablePlayerName, type PlayerNameRow } from '../display';
import type { QuickBuild, QuickBuildGameInput } from '../types';

const TIP = '2026-11-10T00:00:00.000Z';

function build(overrides?: Partial<QuickBuild['legs'][number]>): QuickBuild {
  const leg = {
    playerId: '11',
    gameId: '101',
    market: 'points' as const,
    side: 'over' as const,
    line: 20.5,
    sportsbook: 'draftkings' as const,
    oddsAmerican: -200,
    oppositeAmerican: -200,
    noVigProbability: 0.5,
    pullRunId: '2',
    observedAt: '2026-11-09T17:00:00.000Z',
    ageMs: 3_600_000,
    ...overrides,
  };
  const other = {
    ...leg,
    playerId: '22',
    gameId: '102',
    side: 'under' as const,
  };
  return {
    id: 'build-1',
    legs: [leg, other],
    combinedAmerican: 125,
    breakEvenProbability: 0.444,
    distanceToMidpoint: 0.2,
    oldestObservedAt: leg.observedAt,
    newestObservedAt: leg.observedAt,
    maxAgeMs: leg.ageMs,
  };
}

const games: QuickBuildGameInput[] = [
  { gameId: '101', startTime: TIP, status: 'Scheduled' },
  { gameId: '102', startTime: '2026-11-10T01:00:00.000Z', status: '7:00 pm' },
];

describe('attachQuickBuildDisplay', () => {
  it('prefers the provider headshot id and otherwise requires one roster name', () => {
    expect(QUICK_BUILD_PLAYERS_SQL).toContain('COALESCE(nba.provider_player_id, roster.nba_player_id)');
    expect(QUICK_BUILD_PLAYERS_SQL).toContain("nba.provider = 'nba'");
    expect(QUICK_BUILD_PLAYERS_SQL).toContain('raw.nba_roster_snapshots');
    expect(QUICK_BUILD_PLAYERS_SQL).toContain('HAVING count(DISTINCT nba_player_id) = 1');
    expect(QUICK_BUILD_PLAYERS_SQL).not.toMatch(/player_props_current/i);
  });

  it('joins each canonical id to its own name and keeps the price', () => {
    const players: PlayerNameRow[] = [
      { playerId: '11', fullName: 'Jayson Tatum' },
      { playerId: '22', fullName: 'Jayson Tatum' },
    ];
    const [shown] = attachQuickBuildDisplay({ builds: [build()], games, playerRows: players });
    expect(shown?.id).toBe('build-1');
    expect(shown?.combinedAmerican).toBe(125);
    expect(shown?.breakEvenProbability).toBe(0.444);
    expect(shown?.legs[0]).toMatchObject({
      oddsAmerican: -200,
      pullRunId: '2',
      observedAt: '2026-11-09T17:00:00.000Z',
      line: 20.5,
    });
    expect(shown?.legs[0].display).toMatchObject({
      playerName: 'Jayson Tatum',
      gameStartTime: TIP,
      gameStatus: 'Scheduled',
      teamAbbreviation: null,
      opponentAbbreviation: null,
      homeAway: null,
      displayReady: true,
      unavailableReason: null,
    });
    expect(shown?.legs[1].display).toMatchObject({
      playerName: 'Jayson Tatum',
      gameStartTime: '2026-11-10T01:00:00.000Z',
      gameStatus: 'Scheduled',
      displayReady: true,
    });
    expect(shown?.legs[0].playerId).toBe('11');
    expect(shown?.legs[1].playerId).toBe('22');
  });

  it('does not treat a similar name on another id as this player', () => {
    const [shown] = attachQuickBuildDisplay({
      builds: [build()],
      games,
      playerRows: [{ playerId: '99', fullName: 'Jayson Tatum' }],
    });
    expect(shown?.legs[0].display.unavailableReason).toBe('MISSING_PLAYER');
    expect(shown?.legs[0].display.playerName).toBeNull();
    expect(shown?.legs[0].display.displayReady).toBe(false);
    expect(shown?.id).toBe('build-1');
  });

  it('rejects a blank name, a numeric fallback, and two names for one id', () => {
    expect(usablePlayerName('11', '  ')).toBeNull();
    expect(usablePlayerName('11', '11')).toBeNull();
    expect(usablePlayerName('11', ' 0011 ')).toBeNull();
    expect(usablePlayerName('11', 'Jayson  Tatum')).toBe('Jayson Tatum');

    const blank = attachQuickBuildDisplay({
      builds: [build()],
      games,
      playerRows: [{ playerId: '11', fullName: '   ' }],
    });
    expect(blank[0]?.legs[0].display.unavailableReason).toBe('INVALID_PLAYER_NAME');

    const fallback = attachQuickBuildDisplay({
      builds: [build()],
      games,
      playerRows: [{ playerId: '11', fullName: '11' }],
    });
    expect(fallback[0]?.legs[0].display.unavailableReason).toBe('INVALID_PLAYER_NAME');
    expect(fallback[0]?.legs[0].display.playerName).toBeNull();

    const ambiguous = attachQuickBuildDisplay({
      builds: [build()],
      games,
      playerRows: [
        { playerId: '11', fullName: 'Jayson Tatum' },
        { playerId: '11', fullName: 'Jason Tatum' },
      ],
    });
    expect(ambiguous[0]?.legs[0].display.unavailableReason).toBe('AMBIGUOUS_PLAYER');
    expect(ambiguous[0]?.combinedAmerican).toBe(125);
  });

  it('keeps a started or status-changed game labeled, and leaves a missing tip explicit', () => {
    const started = attachQuickBuildDisplay({
      builds: [build()],
      games: [
        { gameId: '101', startTime: '2026-11-09T17:00:00.000Z', status: 'In Progress' },
        { gameId: '102', startTime: 'not-a-time', status: 'Scheduled' },
      ],
      playerRows: [
        { playerId: '11', fullName: 'Jayson Tatum' },
        { playerId: '22', fullName: 'Luka Doncic' },
      ],
    });
    expect(started[0]?.legs[0].display).toMatchObject({
      displayReady: true,
      gameStatus: 'In Progress',
      gameStartTime: '2026-11-09T17:00:00.000Z',
      teamAbbreviation: null,
      homeAway: null,
    });
    expect(started[0]?.legs[1].display).toMatchObject({
      playerName: 'Luka Doncic',
      displayReady: false,
      unavailableReason: 'MISSING_GAME_START',
      gameStartTime: null,
    });
    expect(started[0]?.legs[1].oddsAmerican).toBe(-200);
  });

  it('keeps a provider tip timestamp out of game status and off the start time', () => {
    const [shown] = attachQuickBuildDisplay({
      builds: [build()],
      games: [
        { gameId: '101', startTime: TIP, status: '2026-11-10T00:00:00.000Z' },
        { gameId: '102', startTime: '2026-11-10T01:00:00.000Z', status: '7:00 pm' },
      ],
      playerRows: [
        { playerId: '11', fullName: 'Jayson Tatum' },
        { playerId: '22', fullName: 'Jaylen Brown' },
      ],
    });
    expect(shown?.legs[0].display).toMatchObject({
      gameStartTime: TIP,
      gameStatus: 'Scheduled',
    });
    expect(shown?.legs[1].display).toMatchObject({
      gameStartTime: '2026-11-10T01:00:00.000Z',
      gameStatus: 'Scheduled',
    });
    expect(shown?.legs[0].display.gameStatus).not.toContain('2026-11-10');
    expect(shown?.legs[1].display.gameStatus).not.toContain('7:00');
  });

  it('keeps live, overtime, and final statuses distinct from a scheduled tip', () => {
    const [shown] = attachQuickBuildDisplay({
      builds: [build()],
      games: [
        { gameId: '101', startTime: TIP, status: 'Halftime' },
        { gameId: '102', startTime: '2026-11-10T01:00:00.000Z', status: 'Final/OT' },
      ],
      playerRows: [
        { playerId: '11', fullName: 'Jayson Tatum' },
        { playerId: '22', fullName: 'Jaylen Brown' },
      ],
    });
    expect(shown?.legs[0].display).toMatchObject({
      gameStartTime: TIP,
      gameStatus: 'In Progress',
    });
    expect(shown?.legs[1].display).toMatchObject({
      gameStartTime: '2026-11-10T01:00:00.000Z',
      gameStatus: 'Final',
    });
    expect(shown?.legs[0].display.gameStatus).not.toBe('Scheduled');
  });

  it('shows the scheduled game matchup and one NBA headshot id without assigning a player team', () => {
    const [shown] = attachQuickBuildDisplay({
      builds: [build()],
      games: [
        { gameId: '101', startTime: TIP, status: 'Scheduled', awayAbbreviation: 'por', homeAbbreviation: 'BOS' },
        { gameId: '102', startTime: '2026-11-10T01:00:00.000Z', status: 'Scheduled', awayAbbreviation: 'LAL' },
      ],
      playerRows: [
        { playerId: '11', fullName: 'Jayson Tatum', nbaPlayerId: '1628369' },
        { playerId: '22', fullName: 'Jaylen Brown', nbaPlayerId: '1627759' },
        { playerId: '22', fullName: 'Jaylen Brown', nbaPlayerId: '999' },
      ],
    });
    expect(shown?.legs[0].display).toMatchObject({
      scheduledAwayAbbreviation: 'POR',
      scheduledHomeAbbreviation: 'BOS',
      nbaPlayerId: '1628369',
      teamAbbreviation: null,
      opponentAbbreviation: null,
      homeAway: null,
      displayReady: true,
    });
    expect(shown?.legs[1].display).toMatchObject({
      scheduledAwayAbbreviation: null,
      scheduledHomeAbbreviation: null,
      nbaPlayerId: null,
      teamAbbreviation: null,
    });
    expect(shown?.legs[0].oddsAmerican).toBe(-200);
  });
});
