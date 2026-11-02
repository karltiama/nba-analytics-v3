import { describe, expect, it } from 'vitest';
import {
  buildInjuryLine,
  classifyInjuryStatus,
  formatAsOfEt,
  formatAsOfLabel,
  selectBaseline,
  selectKeyInjuries,
  type PlayerInjuryInput,
} from '@/lib/scoreboard/card-context/injuries';

const NOW = new Date('2026-11-02T22:00:00.000Z');
const GAME = '2026-11-02';
const ENV = { INJURY_SERVING_ENABLED: '1' };
const FRESH = '2026-11-02T21:00:00.000Z';
const HOURS_30 = '2026-11-01T16:00:00.000Z';
const HOURS_37 = '2026-11-01T09:00:00.000Z';

function player(over: Partial<PlayerInjuryInput> & Pick<PlayerInjuryInput, 'playerId' | 'teamId'>): PlayerInjuryInput {
  return {
    lastName: over.playerId,
    status: 'Out',
    snapshotAt: FRESH,
    currentSeasonGames: 10,
    currentSeasonAvgMinutes: 30,
    priorSeasonAvgMinutes: null,
    ...over,
  };
}

function line(players: PlayerInjuryInput[] | null, over: Partial<Parameters<typeof buildInjuryLine>[0]> = {}) {
  return buildInjuryLine({
    gameEtDate: GAME,
    away: { teamId: 'cle', abbr: 'CLE' },
    home: { teamId: 'okc', abbr: 'OKC' },
    players,
    feedSnapshotAt: FRESH,
    now: NOW,
    env: ENV,
    ...over,
  });
}

describe('injury status and baseline', () => {
  it('classifies case and prefix variants and drops probable, available, and unknown', () => {
    expect(classifyInjuryStatus('OUT')).toBe('out');
    expect(classifyInjuryStatus('out for the season')).toBe('out');
    expect(classifyInjuryStatus('Doubtful - ankle')).toBe('doubtful');
    expect(classifyInjuryStatus('QUESTIONABLE')).toBe('questionable');
    expect(classifyInjuryStatus('Questionable (GTD)')).toBe('questionable');
    expect(classifyInjuryStatus('Probable')).toBeNull();
    expect(classifyInjuryStatus('Available')).toBeNull();
    expect(classifyInjuryStatus('Day-To-Day')).toBeNull();
    expect(classifyInjuryStatus('')).toBeNull();
    expect(classifyInjuryStatus(null)).toBeNull();
  });

  it('uses the current-season average at 3 games and the 2025-26 average otherwise', () => {
    expect(selectBaseline({ currentSeasonGames: 0, currentSeasonAvgMinutes: null, priorSeasonAvgMinutes: null })).toBeNull();
    expect(
      selectBaseline({ currentSeasonGames: 0, currentSeasonAvgMinutes: null, priorSeasonAvgMinutes: 32 })
    ).toEqual({ minutes: 32, kind: 'season_2025_26' });
    expect(
      selectBaseline({ currentSeasonGames: 2, currentSeasonAvgMinutes: 20, priorSeasonAvgMinutes: 28 })
    ).toEqual({ minutes: 28, kind: 'season_2025_26' });
    expect(
      selectBaseline({ currentSeasonGames: 3, currentSeasonAvgMinutes: 9, priorSeasonAvgMinutes: 35 })
    ).toEqual({ minutes: 9, kind: 'current_season' });
    expect(
      selectBaseline({ currentSeasonGames: 3, currentSeasonAvgMinutes: 10, priorSeasonAvgMinutes: null })
    ).toEqual({ minutes: 10, kind: 'current_season' });

    const selected = selectKeyInjuries({
      now: NOW,
      env: ENV,
      gameEtDate: GAME,
      teamId: 'cle',
      players: [
        player({ playerId: 'rookie', teamId: 'cle', lastName: 'Rookie', currentSeasonGames: 0, currentSeasonAvgMinutes: null, priorSeasonAvgMinutes: null }),
        player({ playerId: 'out-all-year', teamId: 'cle', lastName: 'Holiday', currentSeasonGames: 0, currentSeasonAvgMinutes: null, priorSeasonAvgMinutes: 32 }),
        player({ playerId: 'new-team', teamId: 'cle', lastName: 'Grant', currentSeasonGames: 2, currentSeasonAvgMinutes: 18, priorSeasonAvgMinutes: 24 }),
        player({ playerId: 'low', teamId: 'cle', lastName: 'Bench', currentSeasonGames: 3, currentSeasonAvgMinutes: 9, priorSeasonAvgMinutes: 30 }),
      ],
    });
    expect(selected.map((row) => [row.lastName, row.baselineKind])).toEqual([
      ['Holiday', 'season_2025_26'],
      ['Grant', 'season_2025_26'],
    ]);
  });

  it('orders by status severity then minutes and caps a team at two names', () => {
    const selected = selectKeyInjuries({
      now: NOW,
      env: ENV,
      gameEtDate: GAME,
      teamId: 'cle',
      players: [
        player({ playerId: 'q', teamId: 'cle', lastName: 'Mitchell', status: 'Questionable', currentSeasonAvgMinutes: 40 }),
        player({ playerId: 'd', teamId: 'cle', lastName: 'Mobley', status: 'Doubtful', currentSeasonAvgMinutes: 28 }),
        player({ playerId: 'o', teamId: 'cle', lastName: 'Allen', status: 'Out', currentSeasonAvgMinutes: 32 }),
        player({ playerId: 'o2', teamId: 'cle', lastName: 'Wade', status: 'Out', currentSeasonAvgMinutes: 12 }),
      ],
    });
    expect(selected.map((row) => row.lastName)).toEqual(['Allen', 'Wade', 'Mobley', 'Mitchell']);
    const text = line(selected.map((row) => player({
      playerId: row.playerId,
      teamId: 'cle',
      lastName: row.lastName,
      status: row.status === 'questionable' ? 'Questionable' : row.status === 'doubtful' ? 'Doubtful' : 'Out',
      currentSeasonAvgMinutes: row.baselineMinutes,
    }))).text;
    expect(text.startsWith('CLE: Allen (Out), Wade (Out) +2 · OKC: no key injuries listed · as of ')).toBe(true);
  });
});

describe('injury freshness and copy', () => {
  it('hides Questionable from a previous ET date and keeps a 30-hour Out', () => {
    const yesterdayQ = line([
      player({ playerId: 'q', teamId: 'cle', lastName: 'Mitchell', status: 'Questionable', snapshotAt: '2026-11-01T21:00:00.000Z' }),
    ]);
    expect(yesterdayQ.status).toBe('none');
    expect(yesterdayQ.text).not.toContain('Mitchell');
    expect(yesterdayQ.text.startsWith('No key injuries listed · as of ')).toBe(true);

    const recentOut = line([
      player({ playerId: 'o', teamId: 'cle', lastName: 'Allen', snapshotAt: HOURS_30 }),
    ]);
    expect(recentOut.status).toBe('listed');
    expect(recentOut.text).toContain('CLE: Allen (Out)');
    expect(recentOut.text).toContain('OKC: no key injuries listed');
  });

  it('hides an Out once the snapshot is 37 hours old', () => {
    const stale = line([player({ playerId: 'o', teamId: 'cle', lastName: 'Allen', snapshotAt: HOURS_37 })]);
    expect(stale).toEqual({ status: 'unavailable', text: 'Injury report unavailable', asOf: null, asOfLabel: null, teams: null });
  });

  it('returns unavailable when serving is frozen or one team cannot be resolved', () => {
    const frozen = line([player({ playerId: 'o', teamId: 'cle', lastName: 'Allen' })], {
      env: { INJURY_SERVING_ENABLED: '0' },
    });
    expect(frozen.status).toBe('unavailable');

    const oneTeam = line([
      player({ playerId: 'o', teamId: 'cle', lastName: 'Allen' }),
      player({ playerId: 'old', teamId: 'okc', lastName: 'Williams', snapshotAt: HOURS_37 }),
    ]);
    expect(oneTeam).toEqual({ status: 'unavailable', text: 'Injury report unavailable', asOf: null, asOfLabel: null, teams: null });
    expect(line(null).status).toBe('unavailable');
  });

  it('formats the as-of time in ET across the DST change', () => {
    expect(formatAsOfEt(new Date('2026-07-15T21:00:00.000Z'))).toBe('5:00 PM ET');
    expect(formatAsOfEt(new Date('2026-01-15T22:00:00.000Z'))).toBe('5:00 PM ET');
    expect(formatAsOfEt(new Date('2026-03-08T06:30:00.000Z'))).toBe('1:30 AM ET');
    expect(formatAsOfEt(new Date('2026-03-08T07:30:00.000Z'))).toBe('3:30 AM ET');
    expect(formatAsOfEt(new Date('2026-11-01T05:30:00.000Z'))).toBe('1:30 AM ET');
    expect(formatAsOfEt(new Date('2026-11-01T06:30:00.000Z'))).toBe('1:30 AM ET');

    const none = line([]);
    expect(none).toEqual({
      status: 'none',
      text: 'No key injuries listed · as of 4:00 PM ET',
      asOf: FRESH,
      asOfLabel: 'as of 4:00 PM ET',
      teams: [
        { abbr: 'CLE', players: [], extra: 0 },
        { abbr: 'OKC', players: [], extra: 0 },
      ],
    });
    const listed = line([
      player({ playerId: 'm', teamId: 'cle', lastName: 'Mitchell', status: 'Questionable', currentSeasonAvgMinutes: 35 }),
      player({ playerId: 'a', teamId: 'cle', lastName: 'Allen', status: 'Out', currentSeasonAvgMinutes: 32 }),
    ]);
    expect(listed.status).toBe('listed');
    expect(listed.text).toBe('CLE: Allen (Out), Mitchell (Q) · OKC: no key injuries listed · as of 4:00 PM ET');
    expect(listed.asOf).toBe(FRESH);
    expect(listed.asOfLabel).toBe('as of 4:00 PM ET');
    expect(listed.teams).toEqual([
      {
        abbr: 'CLE',
        players: [
          { name: 'Allen', status: 'Out' },
          { name: 'Mitchell', status: 'Q' },
        ],
        extra: 0,
      },
      { abbr: 'OKC', players: [], extra: 0 },
    ]);
  });

  it('dates the as-of caption when the snapshot is not the game ET date, including across midnight DST', () => {
    expect(formatAsOfLabel(new Date(FRESH), GAME)).toBe('as of 4:00 PM ET');
    expect(formatAsOfLabel(new Date('2026-11-01T22:00:00.000Z'), GAME)).toBe('as of Nov 1, 5:00 PM ET');

    // Fall-back night: 11:30 PM ET is still Nov 1, while the UTC date is already Nov 2.
    expect(formatAsOfLabel(new Date('2026-11-02T04:30:00.000Z'), GAME)).toBe('as of Nov 1, 11:30 PM ET');
    expect(formatAsOfLabel(new Date('2026-11-02T05:30:00.000Z'), GAME)).toBe('as of 12:30 AM ET');
    // Spring-forward night: 11:30 PM ET is still Mar 7, while the UTC date is already Mar 8.
    expect(formatAsOfLabel(new Date('2026-03-08T04:30:00.000Z'), '2026-03-08')).toBe('as of Mar 7, 11:30 PM ET');
    expect(formatAsOfLabel(new Date('2026-03-08T05:30:00.000Z'), '2026-03-08')).toBe('as of 12:30 AM ET');

    const priorListed = line(
      [player({ playerId: 'a', teamId: 'cle', lastName: 'Allen', snapshotAt: HOURS_30 })],
      { feedSnapshotAt: HOURS_30 }
    );
    expect(priorListed.status).toBe('listed');
    expect(priorListed.asOfLabel).toBe('as of Nov 1, 11:00 AM ET');
    expect(priorListed.text).toContain('as of Nov 1, 11:00 AM ET');

    const priorNone = line([
      player({ playerId: 'q', teamId: 'cle', lastName: 'Mitchell', status: 'Questionable', snapshotAt: '2026-11-01T21:00:00.000Z' }),
    ]);
    expect(priorNone.status).toBe('none');
    expect(priorNone.asOfLabel).toBe('as of Nov 1, 4:00 PM ET');
    expect(priorNone.text).toBe('No key injuries listed · as of Nov 1, 4:00 PM ET');
  });
});
