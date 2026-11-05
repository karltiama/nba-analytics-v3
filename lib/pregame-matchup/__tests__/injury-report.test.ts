import { describe, expect, it } from 'vitest';
import {
  buildInjuryReport,
  injuryFromProse,
  injurySeverity,
  parseInjuryNote,
  lastName,
  timeOutLabel,
  type InjuryFeedRow,
  type PlayerLogRow,
} from '@/lib/pregame-matchup/injury-report';

const now = new Date('2026-11-05T12:00:00Z');
const env = { INJURY_SERVING_ENABLED: '1' };
const snap = '2026-11-04T22:00:00Z';

const row = (over: Partial<InjuryFeedRow>): InjuryFeedRow => ({
  playerId: 'p',
  teamId: 'ORL',
  name: 'Some Player',
  status: 'Out',
  description: null,
  returnDateRaw: null,
  snapshotAt: snap,
  ...over,
});

const log = (playerId: string, date: string, minutes: string, season = '2026', teamId = 'ORL'): PlayerLogRow => ({
  playerId,
  teamId,
  season,
  date,
  minutes,
});

// ORL has played 7 finished games this season before Nov 5.
const orlDates = ['2026-10-21', '2026-10-23', '2026-10-25', '2026-10-27', '2026-10-29', '2026-10-31', '2026-11-02'];

function build(injuries: InjuryFeedRow[], logs: PlayerLogRow[]) {
  return buildInjuryReport({
    gameEtDate: '2026-11-05',
    season: '2026',
    priorSeason: '2025',
    seasonLabel: '2026–27',
    priorSeasonLabel: '2025–26',
    teams: [
      { teamId: 'ORL', abbr: 'ORL' },
      { teamId: 'PHX', abbr: 'PHX' },
    ],
    injuries,
    feedSnapshotAt: snap,
    teamGames: orlDates.map((date) => ({ teamId: 'ORL', date })),
    logs,
    now,
    env,
  });
}

describe('parseInjuryNote', () => {
  it('reads the injury label, the first report date and the note', () => {
    const p = parseInjuryNote(
      'Injury/Illness - Right High Ankle Sprain (2026-11-05, ORL@PHX). Prior reporting (2026-10-24): Banchero is expected to be sidelined.'
    );
    expect(p).toEqual({ injury: 'Right High Ankle Sprain', reportedOn: '2026-10-24', note: 'Banchero is expected to be sidelined.' });
    expect(parseInjuryNote('Rest (2026-11-04, MIL@BOS). Prior reporting (2026-11-04): Rested.').injury).toBe('Rest');
    expect(parseInjuryNote('- (2026-11-04, LAL@SAC).').injury).toBeNull();
    expect(parseInjuryNote('Free text with no structure.')).toEqual({ injury: null, reportedOn: null, note: 'Free text with no structure.' });
  });

  it('falls back to the injury named in plain-prose notes', () => {
    expect(parseInjuryNote("Goodwin (calf) won't play in Wednesday's game against Portland.").injury).toBe('Calf');
    expect(
      parseInjuryNote("Fleming is out for Wednesday's game against the Trail Blazers due to a sprained left ankle. More.").injury
    ).toBe('Sprained left ankle');
    expect(parseInjuryNote('Williams underwent surgery Thursday to repair a torn labrum.').injury).toBeNull();
  });

  it('classifies feed statuses', () => {
    expect(injurySeverity('Out')).toBe('out');
    expect(injurySeverity('Day-To-Day')).toBe('day_to_day');
    expect(injurySeverity('Probable')).toBe('probable');
  });
});

describe('lastName', () => {
  it('keeps particles and drops suffixes', () => {
    expect(lastName('Tristan da Silva')).toBe('da Silva');
    expect(lastName('Jaren Jackson Jr.')).toBe('Jackson');
    expect(lastName('Gary Trent Jr')).toBe('Trent');
    expect(lastName('Nikola Jokic')).toBe('Jokic');
    expect(lastName('Nene')).toBe('Nene');
  });
});

describe('buildInjuryReport', () => {
  const banchero = row({
    playerId: 'b',
    name: 'Paolo Banchero',
    description: 'Injury/Illness - Right High Ankle Sprain (2026-11-05, ORL@PHX). Prior reporting (2026-10-24): Out 4-6 weeks.',
    returnDateRaw: '2026-11-22',
  });
  const suggs = row({ playerId: 's', name: 'Jalen Suggs', status: 'Questionable', returnDateRaw: '2026-11-05' });
  const isaac = row({ playerId: 'i', name: 'Jonathan Isaac' });
  const available = row({ playerId: 'a', name: 'Back Again', status: 'Available' });

  const logs = [
    // Banchero played the first game, then went out.
    log('b', '2026-10-21', '34:10'),
    log('b', '2026-10-23', '0'),
    ...Array.from({ length: 20 }, (_, i) => log('b', `2026-03-${String(i + 1).padStart(2, '0')}`, '33', '2025')),
    // Suggs played every game.
    ...orlDates.map((d) => log('s', d, '28:00')),
    // Isaac last played in 2025-26.
    log('i', '2026-02-10', '15', '2025'),
  ];
  const report = build([banchero, suggs, isaac, available], logs);
  const orl = report.teams[0];

  it('lists every reported player except Available, most severe first', () => {
    expect(report.status).toBe('listed');
    expect(orl.players.map((p) => p.name)).toEqual(['Paolo Banchero', 'Jonathan Isaac', 'Jalen Suggs']);
    expect(report.teams[1].players).toEqual([]);
  });

  it('counts time out from game logs', () => {
    const b = orl.players[0];
    expect(b).toMatchObject({ lastPlayed: '2026-10-21', playedThisSeason: 1, teamGames: 7, missedStreak: 6 });
    expect(b.baselineMinutes).toBeCloseTo(33, 5);
    expect(b.baselineSeason).toBe('2025–26');
    expect(b.injury).toBe('Right High Ankle Sprain');
    expect(b.expectedReturn).toBe('2026-11-22');
    expect(timeOutLabel(b, 'ORL', (d) => d)).toBe('Last played 2026-10-21 · missed last 6 ORL games');

    const i = orl.players[1];
    expect(timeOutLabel(i, 'ORL', (d) => d)).toBe('Last played 2026-02-10 · missed all 7 ORL games this season');

    const s = orl.players[2];
    expect(s.missedStreak).toBe(0);
    expect(s.baselineSeason).toBe('2026–27');
    expect(s.expectedReturn).toBeNull();
    expect(timeOutLabel(s, 'ORL', (d) => d)).toBe("Played ORL's last game (2026-11-02)");
  });

  it('links WOWY for rotation injuries: top healthy current teammates, season by sample', () => {
    const rotation = [
      { playerId: 'w', teamId: 'ORL', season: '2025', name: 'Franz Wagner', games: 60, avgMinutes: 34 },
      { playerId: 'bn', teamId: 'ORL', season: '2025', name: 'Desmond Bane', games: 70, avgMinutes: 33 },
      { playerId: 'gone', teamId: 'ORL', season: '2025', name: 'Traded Away', games: 50, avgMinutes: 36 },
      { playerId: 'i', teamId: 'ORL', season: '2025', name: 'Jonathan Isaac', games: 40, avgMinutes: 15 },
      { playerId: 'ts', teamId: 'ORL', season: '2025', name: 'Tristan da Silva', games: 2, avgMinutes: 25 },
      { playerId: 'w', teamId: 'ORL', season: '2026', name: 'Franz Wagner', games: 7, avgMinutes: 35 },
      { playerId: 'bn', teamId: 'ORL', season: '2026', name: 'Desmond Bane', games: 7, avgMinutes: 34 },
      { playerId: 'ts', teamId: 'ORL', season: '2026', name: 'Tristan da Silva', games: 7, avgMinutes: 28 },
      { playerId: 's', teamId: 'ORL', season: '2026', name: 'Jalen Suggs', games: 7, avgMinutes: 28 },
    ];
    // Banchero played 20 games for ORL last season, so his thin 2026 split falls back to 2025.
    const withOrlPrior = logs.map((l) => (l.playerId === 'b' && l.season === '2025' ? { ...l, teamId: 'ORL' } : l));
    const r = buildInjuryReport({
      gameEtDate: '2026-11-05',
      season: '2026',
      priorSeason: '2025',
      seasonLabel: '2026–27',
      priorSeasonLabel: '2025–26',
      teams: [{ teamId: 'ORL', abbr: 'ORL' }],
      injuries: [banchero, suggs, isaac],
      feedSnapshotAt: snap,
      teamGames: orlDates.map((date) => ({ teamId: 'ORL', date })),
      logs: withOrlPrior,
      rotation,
      now,
      env,
    });
    const b = r.teams[0].players.find((p) => p.playerId === 'b')!;
    expect(b.wowy?.season).toBe('2025');
    // Traded Away is not on the team now, Isaac is out, da Silva had too few games last season;
    // Suggs is only questionable so he stays in, but only played this season.
    expect(b.wowy?.links.map((l) => l.name)).toEqual(['Wagner', 'Bane']);
    expect(b.wowy?.links[0].href).toBe('/wowy?subject=w&teammate=b&season=2025&teamId=ORL');

    // Suggs (questionable, played every game, missed none) has no 'without' side this season.
    const s = r.teams[0].players.find((p) => p.playerId === 's')!;
    expect(s.wowy?.season).toBe('2026');
    expect(s.wowy?.links.map((l) => l.name)).toEqual(['Wagner', 'Bane', 'da Silva']);
  });

  it('notes rotation players missing from this season’s team numbers', () => {
    expect(orl.sampleNote).toBe("ORL's 2026–27 numbers: Banchero played 1 of 7, Isaac played 0 of 7.");
  });

  it('is unavailable when the feed is frozen or stale', () => {
    expect(build([banchero], logs).status).toBe('listed');
    const stale = buildInjuryReport({
      gameEtDate: '2026-11-05',
      season: '2026',
      priorSeason: '2025',
      seasonLabel: '2026–27',
      priorSeasonLabel: '2025–26',
      teams: [{ teamId: 'ORL', abbr: 'ORL' }],
      injuries: [row({ snapshotAt: '2026-10-01T00:00:00Z' })],
      feedSnapshotAt: '2026-10-01T00:00:00Z',
      teamGames: [],
      logs: [],
      now,
      env,
    });
    expect(stale.status).toBe('unavailable');
    expect(build([], []).status).toBe('none');
  });
});
