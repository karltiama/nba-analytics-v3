import { describe, expect, it } from 'vitest';
import type { InjuryReport, InjuryReportPlayer, InjurySeverity } from '@/lib/pregame-matchup/injury-report';
import { buildStarters, type StarterRow } from '@/lib/pregame-matchup/starters';

const five = (gameId: string, date: string, players: [string, string][], teamId = 'ORL'): StarterRow[] =>
  players.map(([playerId, position]) => ({ teamId, gameId, date, playerId, name: `Player ${playerId}`, position }));

const lineup: [string, string][] = [
  ['pg', 'G'],
  ['sg', 'G'],
  ['sf', 'F'],
  ['pf', 'F'],
  ['c', 'C'],
];

const injured = (playerId: string, status: string, severity: InjurySeverity) =>
  ({ playerId, name: `Player ${playerId}`, status, severity }) as InjuryReportPlayer;

const report = (players: InjuryReportPlayer[], status: InjuryReport['status'] = 'listed'): InjuryReport => ({
  status,
  asOf: null,
  seasonLabel: '2026–27',
  teams: [
    { teamId: 'ORL', abbr: 'ORL', players, sampleNote: null },
    { teamId: 'PHX', abbr: 'PHX', players: [], sampleNote: null },
  ],
});

const teams = [
  { teamId: 'ORL', abbr: 'ORL' },
  { teamId: 'PHX', abbr: 'PHX' },
];

// Games 1-3: pg, sg, sf, pf, c. Game 4: sf sits, wing starts. Game 5: c sits, bigs starts; sf back.
const rows = [
  ...five('g1', '2026-10-21', lineup),
  ...five('g2', '2026-10-23', lineup),
  ...five('g3', '2026-10-25', lineup),
  ...five('g4', '2026-10-27', [['pg', 'G'], ['sg', 'G'], ['wing', 'F'], ['pf', 'F'], ['c', 'C']]),
  ...five('g5', '2026-10-29', [['pg', 'G'], ['sg', 'G'], ['sf', 'F'], ['pf', 'F'], ['bigs', 'C']]),
];

describe('buildStarters', () => {
  it('is null before any starters are loaded', () => {
    expect(buildStarters({ seasonLabel: '2026–27', teams, rows: [], injuries: null })).toBeNull();
  });

  it('keeps the last five and counts starts', () => {
    const m = buildStarters({ seasonLabel: '2026–27', teams, rows, injuries: report([]) })!;
    const orl = m.teams[0];
    expect(orl).toMatchObject({ games: 5, lastGameDate: '2026-10-29' });
    expect(orl.likely!.map((p) => [p.playerId, p.starts])).toEqual([
      ['pg', 5],
      ['sg', 5],
      ['sf', 4],
      ['pf', 5],
      ['bigs', 1],
    ]);
    // c started 4 of 5 but sat last game: flagged as a regular who may return.
    expect(orl.regularsBack.map((p) => p.playerId)).toEqual(['c']);
    expect(m.teams[1]).toMatchObject({ games: 0, likely: null });
  });

  it('swaps Out and Doubtful starters for the most frequent healthy starter, same position first', () => {
    const m = buildStarters({
      seasonLabel: '2026–27',
      teams,
      rows,
      injuries: report([injured('bigs', 'Out', 'out'), injured('sf', 'Doubtful', 'doubtful'), injured('pg', 'Questionable', 'questionable')]),
    })!;
    const orl = m.teams[0];
    const ids = orl.likely!.map((p) => p.playerId);
    expect(ids).toEqual(['pg', 'sg', 'wing', 'pf', 'c']);
    expect(orl.likely![2].replaces).toEqual({ playerId: 'sf', name: 'Player sf', status: 'Doubtful' });
    expect(orl.likely![4].replaces).toMatchObject({ playerId: 'bigs', status: 'Out' });
    // Questionable stays in, tagged.
    expect(orl.likely![0]).toMatchObject({ status: 'Questionable', severity: 'questionable', replaces: null });
    expect(orl.regularsBack).toEqual([]);
    expect(orl.unfilled).toEqual([]);
  });

  it('reports a starter with no healthy fill-in', () => {
    const m = buildStarters({
      seasonLabel: '2026–27',
      teams,
      rows: five('g1', '2026-10-21', lineup),
      injuries: report([injured('c', 'Out', 'out')]),
    })!;
    expect(m.teams[0].likely!.map((p) => p.playerId)).toEqual(['pg', 'sg', 'sf', 'pf']);
    expect(m.teams[0].unfilled).toEqual([{ playerId: 'c', name: 'Player c', status: 'Out' }]);
  });

  it('makes no swaps when the injury report is unavailable', () => {
    const m = buildStarters({ seasonLabel: '2026–27', teams, rows, injuries: report([injured('bigs', 'Out', 'out')], 'unavailable') })!;
    expect(m.injuryAdjusted).toBe(false);
    expect(m.teams[0].likely!.map((p) => p.playerId)).toContain('bigs');
  });
});
