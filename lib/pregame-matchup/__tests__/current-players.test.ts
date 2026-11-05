import { describe, expect, it } from 'vitest';
import type { PlayerSumRow } from '@/lib/pregame-matchup/aggregate';
import { buildCurrentPlayers } from '@/lib/pregame-matchup/current-players';
import type { InjuryReport, InjuryReportPlayer } from '@/lib/pregame-matchup/injury-report';

const row = (teamId: string, playerId: string, games: number, mpg: number): PlayerSumRow => ({
  teamId,
  playerId,
  name: `Player ${playerId}`,
  games,
  minutes: games * mpg,
  points: games * 10,
  fga: games * 8,
  usageMass: 0,
  usagePossessions: 0,
});

const teams = [
  { teamId: 'ORL', abbr: 'ORL' },
  { teamId: 'PHX', abbr: 'PHX' },
];

const injuries: InjuryReport = {
  status: 'listed',
  asOf: null,
  seasonLabel: '2026–27',
  teams: [
    {
      teamId: 'ORL',
      abbr: 'ORL',
      sampleNote: null,
      players: [
        { playerId: 'star', name: 'Player star', status: 'Out', severity: 'out' } as InjuryReportPlayer,
        { playerId: 'hurt', name: 'Player hurt', status: 'Out', severity: 'out' } as InjuryReportPlayer,
      ],
    },
    { teamId: 'PHX', abbr: 'PHX', sampleNote: null, players: [] },
  ],
};

function build() {
  return buildCurrentPlayers({
    seasonLabel: '2026–27',
    priorLabel: '2025–26',
    teams,
    currentRows: [
      row('ORL', 'wing', 7, 35),
      row('ORL', 'star', 2, 34),
      row('ORL', 'signed', 7, 20),
      row('ORL', 'traded', 3, 25),
      row('PHX', 'traded', 3, 28),
      row('PHX', 'guard', 6, 34),
    ],
    priorRows: [row('ORL', 'wing', 80, 30), row('ORL', 'star', 70, 35), row('ORL', 'gone', 75, 28), row('PHX', 'guard', 64, 33)],
    latestTeam: new Map([
      ['wing', 'ORL'],
      ['star', 'ORL'],
      ['signed', 'ORL'],
      ['traded', 'PHX'],
      ['guard', 'PHX'],
      ['gone', 'MIA'],
    ]),
    teamGames: new Map([
      ['ORL', 7],
      ['PHX', 6],
    ]),
    playedLastSeason: new Set(['wing', 'star', 'signed', 'traded', 'gone', 'guard']),
    injuries,
  })!;
}

describe('buildCurrentPlayers', () => {
  it('is null before anyone has played this season', () => {
    expect(
      buildCurrentPlayers({
        seasonLabel: '2026–27',
        priorLabel: '2025–26',
        teams,
        currentRows: [],
        priorRows: [],
        latestTeam: new Map(),
        teamGames: new Map(),
        playedLastSeason: new Set(),
        injuries: null,
      })
    ).toBeNull();
  });

  it('lists this season’s players still with the team, by minutes, with last season beside them', () => {
    const [orl, phx] = build().teams;
    expect(orl.teamGames).toBe(7);
    expect(orl.players.map((p) => p.playerId)).toEqual(['wing', 'signed', 'star']);
    expect(orl.players[0].prior?.games).toBe(80);
    expect(orl.players[1]).toMatchObject({ prior: null, newToTeam: true });
    expect(orl.players[2]).toMatchObject({ status: 'Out', severity: 'out' });
    // Traded mid-season: listed with his new team only.
    expect(phx.players.map((p) => p.playerId)).toEqual(['guard', 'traded']);
  });

  it('names injured players who have not played and last season’s players now elsewhere', () => {
    const m = build();
    expect(m.teams[0].notYetPlayed).toEqual([{ playerId: 'hurt', name: 'Player hurt', status: 'Out' }]);
    expect(m.departed.ORL).toEqual(['Player gone']);
    expect(m.departed.PHX).toEqual([]);
  });
});
