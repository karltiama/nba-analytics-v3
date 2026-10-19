import { describe, expect, it } from 'vitest';
import { auditLiveGame, scoreboardGame } from '@/lib/scoreboard/fixtures';
import { freshnessAgeLabel, gamePhase, gamePulse, pulseTeamNames, statLeaders, topScorer } from '@/lib/scoreboard/game-pulse';
import { cardStatusLabel, formatPeriodClock, presentScoreboardGame } from '@/lib/scoreboard/present';
import type { ScoreboardGame } from '@/lib/scoreboard/contract';

type Line = ScoreboardGame['box_score']['players'][number];

function line(over: Partial<Line> & Pick<Line, 'playerId' | 'teamId'>): Line {
  return {
    name: 'Player',
    min: '10',
    pts: 0,
    reb: null,
    ast: null,
    fgm: null,
    fga: null,
    fg3m: null,
    fg3a: null,
    ftm: null,
    fta: null,
    oreb: null,
    dreb: null,
    ...over,
  };
}

const TEAMS = {
  home: { provider_team_id: '2', abbreviation: 'BOS', name: 'Boston Celtics' },
  visitor: { provider_team_id: '20', abbreviation: 'NYK', name: 'New York Knicks' },
};

function game(over: Parameters<typeof scoreboardGame>[0]) {
  return scoreboardGame({ ...over, home: { ...TEAMS.home, ...over.home }, visitor: { ...TEAMS.visitor, ...over.visitor } });
}

describe('formatPeriodClock', () => {
  const live = (period: number | null, clock: string | null) =>
    formatPeriodClock({ lifecycle: 'live', period, clock, overtime_periods: 0 });

  it('does not double the quarter on the audited BDL clock "Q1 4:35"', () => {
    expect(live(1, 'Q1 4:35')).toBe('Q1 4:35');
    expect(live(1, 'Q1 4:35')).not.toContain('Q1 Q1');
    expect(presentScoreboardGame(auditLiveGame())?.periodClock).toBe('Q1 4:35');
  });

  it('prefixes an unprefixed clock once', () => {
    expect(live(1, '4:35')).toBe('Q1 4:35');
    expect(live(2, 'Q2 8:12')).toBe('Q2 8:12');
    expect(live(2, '8:12')).toBe('Q2 8:12');
    expect(live(4, ' Q4 0:34.2 ')).toBe('Q4 0:34.2');
  });

  it('uses the normalized period when the provider prefix disagrees, and the provider prefix when period is missing', () => {
    expect(live(3, 'Q2 0:00')).toBe('Q3 0:00');
    expect(live(null, 'Q3 4:12')).toBe('Q3 4:12');
    expect(live(null, '4:12')).toBe('Live 4:12');
  });

  it('handles missing and malformed clocks without inventing a time', () => {
    expect(live(1, null)).toBe('Q1');
    expect(live(1, '')).toBe('Q1');
    expect(live(1, 'Q1')).toBe('Q1');
    expect(live(1, 'garbage')).toBe('Q1');
    expect(live(1, 'Q1 Q1 4:35')).toBe('Q1');
  });

  it('shows one OT label for every provider overtime form', () => {
    const ot = (clock: string | null, overtime_periods = 0, period: number | null = null) =>
      formatPeriodClock({ lifecycle: 'overtime', period, clock, overtime_periods });
    expect(ot('OT 1:48', 1, 5)).toBe('OT 1:48');
    expect(ot('1:48', 1, 5)).toBe('OT 1:48');
    expect(ot('2OT 0:48', 2, 6)).toBe('2OT 0:48');
    expect(ot('OT2 0:48', 2, 6)).toBe('2OT 0:48');
    expect(ot('0:48', 0, 7)).toBe('3OT 0:48');
    expect(ot('2OT 0:48')).toBe('2OT 0:48');
    expect(ot(null)).toBe('OT');
  });

  it('shows no running clock at halftime and only an OT mark on a final', () => {
    expect(formatPeriodClock({ lifecycle: 'halftime', period: 2, clock: 'Q2 0:00', overtime_periods: 0 })).toBeNull();
    expect(formatPeriodClock({ lifecycle: 'final', period: 4, clock: 'Final', overtime_periods: 0 })).toBeNull();
    expect(formatPeriodClock({ lifecycle: 'final', period: 5, clock: null, overtime_periods: 1 })).toBe('OT');
    expect(formatPeriodClock({ lifecycle: 'final', period: 6, clock: null, overtime_periods: 2 })).toBe('2OT');
  });
});

describe('gamePulse', () => {
  it('names the home or away leader with the exact margin', () => {
    expect(gamePulse(auditLiveGame())).toEqual({ kind: 'leading', text: 'Toronto leads by 7', teamId: '28', margin: 7 });
    const away = gamePulse(game({ game_id: 'a', lifecycle: 'live', home: { score: 80 }, visitor: { score: 91 } }));
    expect(away).toEqual({ kind: 'leading', text: 'New York leads by 11', teamId: '20', margin: 11 });
  });

  it('reports a tie without picking a side', () => {
    expect(gamePulse(game({ game_id: 't', lifecycle: 'halftime', home: { score: 50 }, visitor: { score: 50 } }))).toEqual({
      kind: 'tied',
      text: 'Game tied',
      teamId: null,
      margin: 0,
    });
  });

  it('describes a stale in-game score in the past tense', () => {
    const stale = gamePulse(game({ game_id: 's', lifecycle: 'live', stale: true, home: { score: 99 }, visitor: { score: 102 } }));
    expect(stale?.text).toBe('New York led by 3 at last update');
    const staleTie = gamePulse(game({ game_id: 's2', lifecycle: 'overtime', stale: true, home: { score: 110 }, visitor: { score: 110 } }));
    expect(staleTie?.text).toBe('Tied at last update');
  });

  it('gives the final winner and margin only for a provider-confirmed final', () => {
    expect(gamePulse(game({ game_id: 'f', lifecycle: 'final', home: { score: 112 }, visitor: { score: 104 } }))).toEqual({
      kind: 'won',
      text: 'Boston wins by 8',
      teamId: '2',
      margin: 8,
    });
    for (const lifecycle of ['scheduled', 'postponed', 'canceled', 'unknown'] as const) {
      expect(gamePulse(game({ game_id: lifecycle, lifecycle, home: { score: 112 }, visitor: { score: 104 } }))).toBeNull();
    }
    expect(gamePulse(game({ game_id: 'ft', lifecycle: 'final', home: { score: 100 }, visitor: { score: 100 } }))).toBeNull();
  });

  it('returns nothing when either score is missing or not a whole number', () => {
    expect(gamePulse(game({ game_id: 'm1', lifecycle: 'live', home: { score: null }, visitor: { score: 10 } }))).toBeNull();
    expect(gamePulse(game({ game_id: 'm2', lifecycle: 'live', home: { score: Number.NaN }, visitor: { score: 10 } }))).toBeNull();
    expect(gamePulse(game({ game_id: 'm3', lifecycle: 'live', home: { score: -1 }, visitor: { score: 10 } }))).toBeNull();
    expect(gamePulse(game({ game_id: 'm4', lifecycle: 'live', home: { score: 10.5 }, visitor: { score: 10 } }))).toBeNull();
  });

  it('uses abbreviations when both city names read the same', () => {
    const la = {
      home: { abbreviation: 'LAL', name: 'Los Angeles Lakers' },
      visitor: { abbreviation: 'LAC', name: 'Los Angeles Clippers' },
    } as Pick<ScoreboardGame, 'home' | 'visitor'>;
    expect(pulseTeamNames(la)).toEqual({ home: 'LAL', visitor: 'LAC' });
    expect(pulseTeamNames({ home: { abbreviation: 'POR', name: 'Portland Trail Blazers' }, visitor: { abbreviation: null, name: null } } as never)).toEqual({
      home: 'Portland',
      visitor: 'Team',
    });
  });
});

describe('topScorer', () => {
  const box = (players: Line[], completeness: ScoreboardGame['box_score']['completeness'] = 'live_partial') => ({
    completeness,
    acquired_at: '2026-10-09T23:41:00.000Z',
    players,
  });

  it('finds the audited leading scorer across both teams', () => {
    expect(topScorer(auditLiveGame())).toEqual({
      kind: 'leader',
      label: 'Leading scorer',
      text: 'RJ Barrett · 9 PTS',
      pts: 9,
      playerIds: ['501'],
    });
  });

  it('lists a two-way tie in name order and summarizes three or more', () => {
    const two = topScorer(
      game({
        game_id: 'tie2',
        lifecycle: 'live',
        box_score: box([
          line({ playerId: '9', teamId: '2', name: 'Zed Player', pts: 14 }),
          line({ playerId: '8', teamId: '20', name: 'Abe Player', pts: 14 }),
          line({ playerId: '7', teamId: '20', name: 'Bench Player', pts: 3 }),
        ]),
      })
    );
    expect(two).toMatchObject({ kind: 'leader', text: 'Abe Player & Zed Player · 14 PTS', playerIds: ['8', '9'] });
    const three = topScorer(
      game({
        game_id: 'tie3',
        lifecycle: 'live',
        box_score: box([
          line({ playerId: '1', teamId: '2', name: 'A', pts: 6 }),
          line({ playerId: '2', teamId: '20', name: 'B', pts: 6 }),
          line({ playerId: '3', teamId: '20', name: 'C', pts: 6 }),
        ]),
      })
    );
    expect(three).toMatchObject({ kind: 'leader', text: '3 players tied · 6 PTS' });
  });

  it('skips lines with missing points, names, ids, or an unknown team instead of treating them as zero', () => {
    const result = topScorer(
      game({
        game_id: 'skip',
        lifecycle: 'live',
        box_score: box([
          line({ playerId: '1', teamId: '2', name: 'No Points', pts: null }),
          line({ playerId: '2', teamId: '2', name: '   ', pts: 40 }),
          line({ playerId: '', teamId: '20', name: 'No Id', pts: 40 }),
          line({ playerId: '3', teamId: '99', name: 'Wrong Team', pts: 40 }),
          line({ playerId: '4', teamId: '2', name: 'Real Leader', pts: 11 }),
          line({ playerId: '5', teamId: '20', name: 'Other Side', pts: 8 }),
        ]),
      })
    );
    expect(result).toMatchObject({ kind: 'leader', text: 'Real Leader · 11 PTS' });
  });

  it('does not claim a game leader when only one team has usable lines', () => {
    const oneTeam = topScorer(
      game({ game_id: 'one', lifecycle: 'live', box_score: box([line({ playerId: '1', teamId: '2', name: 'Solo', pts: 20 })]) })
    );
    expect(oneTeam).toEqual({ kind: 'status', text: 'Player stats updating' });
    const pointsMissing = topScorer(
      game({
        game_id: 'nopts',
        lifecycle: 'live',
        box_score: box([
          line({ playerId: '1', teamId: '2', name: 'A', pts: 12 }),
          line({ playerId: '2', teamId: '20', name: 'B', pts: null }),
        ]),
      })
    );
    expect(pointsMissing).toEqual({ kind: 'status', text: 'Player stats updating' });
  });

  it('shows a status, not a leader, when the box score is missing', () => {
    expect(topScorer(game({ game_id: 'none', lifecycle: 'live' }))).toEqual({ kind: 'status', text: 'Player stats updating' });
    expect(topScorer(game({ game_id: 'fnone', lifecycle: 'final' }))).toEqual({ kind: 'status', text: 'Player stats pending' });
  });

  it('names a final top scorer only from a verified final box score', () => {
    const players = [
      line({ playerId: '1', teamId: '2', name: 'Jayson Tatum', pts: 31 }),
      line({ playerId: '2', teamId: '20', name: 'Jalen Brunson', pts: 27 }),
    ];
    expect(topScorer(game({ game_id: 'fv', lifecycle: 'final', box_score: box(players, 'verified_final') }))).toMatchObject({
      kind: 'leader',
      label: 'Top scorer',
      text: 'Jayson Tatum · 31 PTS',
    });
    expect(topScorer(game({ game_id: 'fu', lifecycle: 'final', box_score: box(players, 'final_unverified') }))).toEqual({
      kind: 'status',
      text: 'Box score being verified',
    });
    expect(topScorer(game({ game_id: 'fp', lifecycle: 'final', box_score: box(players, 'live_partial') }))).toEqual({
      kind: 'status',
      text: 'Box score being verified',
    });
  });

  it('hides player stats on a stale in-game snapshot and before tip', () => {
    expect(topScorer(auditLiveGame({ stale: true, stale_reason: 'no_recent_observation' }))).toBeNull();
    expect(topScorer(game({ game_id: 'pre', lifecycle: 'scheduled' }))).toBeNull();
    expect(topScorer(game({ game_id: 'pp', lifecycle: 'postponed' }))).toBeNull();
  });

  it('omits the leader when nobody has scored yet', () => {
    const zero = topScorer(
      game({
        game_id: 'zero',
        lifecycle: 'live',
        box_score: box([
          line({ playerId: '1', teamId: '2', name: 'A', pts: 0 }),
          line({ playerId: '2', teamId: '20', name: 'B', pts: 0 }),
        ]),
      })
    );
    expect(zero).toBeNull();
  });
});

describe('statLeaders', () => {
  const box = (players: Line[], completeness: ScoreboardGame['box_score']['completeness'] = 'live_partial') => ({
    completeness,
    acquired_at: '2026-10-09T23:41:00.000Z',
    players,
  });

  it('picks points, rebounds, and assists leaders across both teams', () => {
    const result = statLeaders(auditLiveGame());
    expect(result?.kind).toBe('leaders');
    if (result?.kind !== 'leaders') return;
    expect(result.pts).toEqual({ stat: 'pts', value: 9, players: [{ id: '501', name: 'RJ Barrett', teamId: '28' }] });
    expect(result.reb).toEqual({ stat: 'reb', value: 3, players: [{ id: '502', name: 'Scottie Barnes', teamId: '28' }] });
    expect(result.ast).toEqual({ stat: 'ast', value: 3, players: [{ id: '503', name: 'James Harden', teamId: '13' }] });
  });

  it('keeps every tied player in name order, then id order', () => {
    const result = statLeaders(
      game({
        game_id: 'ties',
        lifecycle: 'live',
        box_score: box([
          line({ playerId: '9', teamId: '2', name: 'Zed', pts: 10, reb: 7, ast: 4 }),
          line({ playerId: '8', teamId: '20', name: 'Abe', pts: 10, reb: 7, ast: 2 }),
          line({ playerId: '7', teamId: '20', name: 'Abe', pts: 3, reb: 1, ast: 4 }),
        ]),
      })
    );
    if (result?.kind !== 'leaders') throw new Error('expected leaders');
    expect(result.pts?.players.map((p) => p.id)).toEqual(['8', '9']);
    expect(result.reb?.players.map((p) => p.id)).toEqual(['8', '9']);
    expect(result.ast?.players.map((p) => p.id)).toEqual(['7', '9']);
  });

  it('drops one stat tile when that stat is missing for a team, without zero-filling', () => {
    const result = statLeaders(
      game({
        game_id: 'noreb',
        lifecycle: 'live',
        box_score: box([
          line({ playerId: '1', teamId: '2', name: 'A', pts: 12, reb: 5, ast: 0 }),
          line({ playerId: '2', teamId: '20', name: 'B', pts: 8, reb: null, ast: 0 }),
        ]),
      })
    );
    if (result?.kind !== 'leaders') throw new Error('expected leaders');
    expect(result.pts?.value).toBe(12);
    expect(result.reb).toBeNull();
    expect(result.ast).toBeNull();
  });

  it('returns a status for missing, partial, and unverified boxes', () => {
    expect(statLeaders(game({ game_id: 'none', lifecycle: 'live' }))).toEqual({ kind: 'status', text: 'Player stats updating' });
    expect(statLeaders(game({ game_id: 'half', lifecycle: 'halftime' }))).toEqual({ kind: 'status', text: 'Player stats updating' });
    expect(statLeaders(game({ game_id: 'fnone', lifecycle: 'final' }))).toEqual({ kind: 'status', text: 'Player stats pending' });
    const players = [line({ playerId: '1', teamId: '2', name: 'A', pts: 20 }), line({ playerId: '2', teamId: '20', name: 'B', pts: 18 })];
    expect(statLeaders(game({ game_id: 'fu', lifecycle: 'final', box_score: box(players, 'final_unverified') }))).toEqual({
      kind: 'status',
      text: 'Box score being verified',
    });
    expect(statLeaders(game({ game_id: 'fv', lifecycle: 'final', box_score: box(players, 'verified_final') }))?.kind).toBe('leaders');
  });

  it('shows nothing before tip, on postponed games, or on a stale in-game snapshot', () => {
    expect(statLeaders(game({ game_id: 'pre', lifecycle: 'scheduled' }))).toBeNull();
    expect(statLeaders(game({ game_id: 'pp', lifecycle: 'postponed' }))).toBeNull();
    expect(statLeaders(auditLiveGame({ stale: true, stale_reason: 'no_recent_observation' }))).toBeNull();
  });
});

describe('final recap wording', () => {
  it('adds the overtime count only when the provider reports overtime periods', () => {
    const final = (overtime_periods: number) =>
      gamePulse(game({ game_id: `ot${overtime_periods}`, lifecycle: 'final', overtime_periods, home: { score: 112 }, visitor: { score: 104 } }))?.text;
    expect(final(0)).toBe('Boston wins by 8');
    expect(final(1)).toBe('Boston wins by 8 in overtime');
    expect(final(2)).toBe('Boston wins by 8 in 2 overtimes');
  });
});

describe('freshness and status', () => {
  const now = Date.parse('2026-10-10T23:00:00.000Z');

  it('reports minute-resolution age from the server observation', () => {
    expect(freshnessAgeLabel('2026-10-10T22:59:15.000Z', now)).toBe('Updated just now');
    expect(freshnessAgeLabel('2026-10-10T22:58:00.000Z', now)).toBe('Updated 2m ago');
    expect(freshnessAgeLabel('2026-10-10T21:30:00.000Z', now)).toBeNull();
    expect(freshnessAgeLabel('not-a-date', now)).toBeNull();
    expect(freshnessAgeLabel(null, now)).toBeNull();
  });

  it('measures age against the response generated_at, not the browser clock', () => {
    const presented = presentScoreboardGame(auditLiveGame(), '2026-10-09T23:41:00.000Z');
    expect(presented?.freshnessAge).toBe('Updated 2m ago');
    expect(presentScoreboardGame(auditLiveGame())?.freshnessAge).toBeNull();
  });

  it('keeps delayed and suspended as their own status and never as Live', () => {
    expect(cardStatusLabel('unknown', 'Delayed')).toBe('Delayed');
    expect(cardStatusLabel('unknown', 'Suspended')).toBe('Suspended');
    expect(cardStatusLabel('unknown', null)).toBe('Status unavailable');
    expect(cardStatusLabel('scheduled', 'Delayed')).toBe('Scheduled');
    expect(gamePhase('unknown')).toBe('other');
    expect(gamePhase('halftime')).toBe('live');
    expect(gamePhase('overtime')).toBe('live');
    expect(gamePhase('final')).toBe('final');
    expect(gamePhase('scheduled')).toBe('pregame');
  });

  it('says the live score is unavailable only after a scheduled tip, without calling the game live or final', () => {
    const tip = '2026-10-20T19:00:00.000Z';
    const before = Date.parse('2026-10-20T18:59:59.000Z');
    const atTip = Date.parse(tip);
    expect(cardStatusLabel('scheduled', tip, { scheduledTip: tip, nowMs: before })).toBe('Scheduled');
    expect(cardStatusLabel('scheduled', tip, { scheduledTip: tip, nowMs: atTip })).toBe('Live score unavailable');
    expect(cardStatusLabel('live', '1st Qtr', { scheduledTip: tip, nowMs: atTip })).toBe('Live');
    expect(cardStatusLabel('final', 'Final', { scheduledTip: tip, nowMs: atTip + 3 * 60 * 60 * 1000 })).toBe('Final');
    expect(cardStatusLabel('postponed', null, { scheduledTip: tip, nowMs: atTip })).toBe('Postponed');
    const scheduled = game({
      game_id: '21717855',
      lifecycle: 'scheduled',
      season_type: 'regular',
      scheduled_tip: tip,
      home: { score: 0 },
      visitor: { score: 0 },
    });
    const presented = presentScoreboardGame(scheduled, '2026-10-20T19:05:00.000Z');
    expect(presented).toMatchObject({
      statusLabel: 'Live score unavailable',
      phase: 'pregame',
      showScores: false,
      homeScore: null,
      visitorScore: null,
      isFinal: false,
      periodClock: null,
    });
    expect(presentScoreboardGame(scheduled, '2026-10-20T18:00:00.000Z')?.statusLabel).toBe('Scheduled');
  });
});
