import { describe, expect, it } from 'vitest';
import type { ScoreboardGame } from '@/lib/scoreboard/contract';
import { scoreboardGame } from '@/lib/scoreboard/fixtures';
import {
  GAME_CONTEXT_COPY,
  PULSE_THRESHOLDS,
  gameContext,
  insightCandidates,
  selectInsight,
  teamTotals,
  type PulseInsight,
  type TeamTotals,
} from '@/lib/scoreboard/game-pulse';
import { capturedIndAtl, capturedTorLac, capturedWasDet } from './captured-2026-10-10';

type Line = ScoreboardGame['box_score']['players'][number];
type Shooting = { fgm: number; fga: number; fg3m: number; fg3a: number; ftm: number; fta: number; oreb: number };

const ZERO: Shooting = { fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0 };
const HOME = '2';
const VISITOR = '20';

function points(s: Shooting) {
  return 2 * s.fgm + s.fg3m + s.ftm;
}

/** Five consistent lines: one carries the team's totals, four bench lines carry zeros. */
function teamLines(teamId: string, s: Shooting): Line[] {
  const row = (n: number, v: Shooting): Line => ({
    playerId: `${teamId}-${n}`,
    teamId,
    name: `Player ${teamId}-${n}`,
    min: n === 0 ? '30' : '0',
    pts: points(v),
    reb: v.oreb,
    ast: 0,
    ...v,
    dreb: 0,
  });
  return [row(0, s), row(1, ZERO), row(2, ZERO), row(3, ZERO), row(4, ZERO)];
}

function game(
  home: Partial<Shooting>,
  visitor: Partial<Shooting>,
  over: Partial<Parameters<typeof scoreboardGame>[0]> & { players?: Line[]; completeness?: ScoreboardGame['box_score']['completeness'] } = {}
): ScoreboardGame {
  const h = { ...ZERO, ...home };
  const v = { ...ZERO, ...visitor };
  const { players, completeness, ...rest } = over;
  return scoreboardGame({
    game_id: 'g',
    lifecycle: 'live',
    period: 2,
    clock: '5:00',
    ...rest,
    home: { provider_team_id: HOME, abbreviation: 'BOS', name: 'Boston Celtics', score: points(h) },
    visitor: { provider_team_id: VISITOR, abbreviation: 'NYK', name: 'New York Knicks', score: points(v) },
    box_score: {
      completeness: completeness ?? 'live_partial',
      acquired_at: '2026-10-10T23:41:00.000Z',
      players: players ?? [...teamLines(HOME, h), ...teamLines(VISITOR, v)],
    },
  });
}

const NAMES = { home: 'Boston', visitor: 'New York' };

function totals(teamId: string, s: Partial<Shooting>): TeamTotals {
  const v = { ...ZERO, ...s };
  return { teamId, pts: points(v), ...v };
}

function candidates(home: Partial<Shooting>, visitor: Partial<Shooting>, final = false) {
  return insightCandidates({ home: totals(HOME, home), visitor: totals(VISITOR, visitor) }, NAMES, final, null);
}

const ids = (list: PulseInsight[]) => list.map((c) => c.id).sort();

/** Typical half: enough attempts for every family, no gap anywhere. */
const EVEN: Shooting = { fgm: 16, fga: 36, fg3m: 5, fg3a: 14, ftm: 8, fta: 10, oreb: 4 };

describe('teamTotals', () => {
  it('sums each team by provider team id and maps home and visitor correctly', () => {
    const t = teamTotals(game({ fgm: 20, fga: 40, fg3m: 7, fg3a: 15, ftm: 10, fta: 18, oreb: 9 }, EVEN));
    expect(t?.home).toEqual({ teamId: HOME, pts: 57, fgm: 20, fga: 40, fg3m: 7, fg3a: 15, ftm: 10, fta: 18, oreb: 9 });
    expect(t?.visitor).toMatchObject({ teamId: VISITOR, pts: points(EVEN), fga: 36 });
  });

  it('keeps zero-minute lines that carry real attempts', () => {
    const t = teamTotals(capturedWasDet());
    expect(t?.visitor).toEqual({ teamId: '9', pts: 40, fgm: 16, fga: 40, fg3m: 4, fg3a: 19, ftm: 4, fta: 6, oreb: 6 });
    expect(t?.home).toEqual({ teamId: '30', pts: 52, fgm: 17, fga: 31, fg3m: 5, fg3a: 11, ftm: 13, fta: 18, oreb: 4 });
  });

  it('rejects missing, negative, non-integer, and impossible shooting values instead of zero-filling', () => {
    const base = game(EVEN, EVEN);
    const broken = (patch: Partial<Line>) => {
      const players = base.box_score.players.map((line, i) => (i === 0 ? { ...line, ...patch } : line));
      return teamTotals({ ...base, box_score: { ...base.box_score, players } });
    };
    expect(teamTotals(base)).not.toBeNull();
    expect(broken({ fga: null })).toBeNull();
    expect(broken({ fta: -1 })).toBeNull();
    expect(broken({ fg3a: 14.5 })).toBeNull();
    expect(broken({ fg3a: Number.NaN })).toBeNull();
    expect(broken({ fgm: 37 })).toBeNull();
    expect(broken({ fg3m: 15 })).toBeNull();
    expect(broken({ fg3a: 37 })).toBeNull();
    expect(broken({ ftm: 11 })).toBeNull();
    expect(broken({ pts: points(EVEN) + 1 })).toBeNull();
  });

  it('rejects duplicate players, players from a third team, and thin team boxes', () => {
    const base = game(EVEN, EVEN);
    const lines = base.box_score.players;
    const withPlayers = (players: Line[]) => teamTotals({ ...base, box_score: { ...base.box_score, players } });
    expect(withPlayers([...lines, { ...lines[1] }])).toBeNull();
    expect(withPlayers([...lines, { ...lines[1], playerId: 'x', teamId: '99' }])).toBeNull();
    expect(withPlayers(lines.filter((line) => line.playerId !== `${HOME}-4`))).toBeNull();
    expect(withPlayers(lines.map((line) => (line.teamId === VISITOR ? { ...line, playerId: '' } : line)))).toBeNull();
  });

  it('rejects a box whose player points do not add up to the team score', () => {
    expect(teamTotals(capturedTorLac())).toBeNull();
    const behind = game(EVEN, EVEN);
    expect(teamTotals({ ...behind, home: { ...behind.home, score: (behind.home.score ?? 0) + 2 } })).toBeNull();
    expect(teamTotals({ ...behind, home: { ...behind.home, score: null } })).toBeNull();
  });

  it('marks offensive rebounds unknown when a line lacks oreb or contradicts reb = oreb + dreb', () => {
    const base = game({ ...EVEN, oreb: 12 }, EVEN);
    const patched = (patch: Partial<Line>) => {
      const players = base.box_score.players.map((line, i) => (i === 0 ? { ...line, ...patch } : line));
      return teamTotals({ ...base, box_score: { ...base.box_score, players } });
    };
    expect(patched({ oreb: null })?.home.oreb).toBeNull();
    expect(patched({ reb: 20, dreb: 3 })?.home.oreb).toBeNull();
    expect(patched({ oreb: null })?.home.fga).toBe(36);
  });
});

describe('three-point percentage candidate', () => {
  it('qualifies at exactly the gap threshold, not just below it', () => {
    expect(ids(candidates({ ...EVEN, fg3m: 10, fg3a: 20 }, { ...EVEN, fg3m: 8, fg3a: 25 }))).toContain('three_point_pct');
    expect(ids(candidates({ ...EVEN, fg3m: 10, fg3a: 20 }, { ...EVEN, fg3m: 8, fg3a: 24 }))).not.toContain('three_point_pct');
  });

  it('needs the minimum attempts for both teams', () => {
    expect(ids(candidates({ ...EVEN, fg3m: 4, fg3a: 7 }, { ...EVEN, fg3m: 1, fg3a: 8 }))).not.toContain('three_point_pct');
    expect(ids(candidates({ ...EVEN, fg3m: 4, fg3a: 8 }, { ...EVEN, fg3m: 1, fg3a: 8 }))).toContain('three_point_pct');
  });

  it('names the better-shooting team with makes and attempts, in present or past tense', () => {
    const live = candidates({ ...EVEN, fg3m: 6, fg3a: 25 }, { ...EVEN, fg3m: 12, fg3a: 25 }).find((c) => c.id === 'three_point_pct');
    expect(live?.text).toBe("New York is shooting 48% from three (12/25), compared with 24% for Boston (6/25).");
    expect(live?.teamId).toBe(VISITOR);
    expect(live?.values).toEqual({ leader: 48, trailer: 24, gap: 24 });
    const final = candidates({ ...EVEN, fg3m: 6, fg3a: 25 }, { ...EVEN, fg3m: 12, fg3a: 25 }, true).find((c) => c.id === 'three_point_pct');
    expect(final?.text).toBe("New York shot 48% from three (12/25), compared with 24% for Boston (6/25).");
  });

  it('ignores an exact tie', () => {
    expect(ids(candidates({ ...EVEN, fg3m: 5, fg3a: 10 }, { ...EVEN, fg3m: 5, fg3a: 10 }))).not.toContain('three_point_pct');
  });
});

describe('effective field-goal percentage candidate', () => {
  const at = (visitorFgm: number, visitorFg3m: number, fga = 25) =>
    candidates({ ...EVEN, fgm: 12, fga, fg3m: 0, fg3a: 0 }, { ...EVEN, fgm: visitorFgm, fga, fg3m: visitorFg3m, fg3a: Math.max(visitorFg3m, 0) });

  it('uses (FGM + 0.5 x 3PM) / FGA and qualifies at exactly the gap threshold', () => {
    expect(ids(at(9, 0))).toContain('efg_pct');
    expect(at(9, 0).find((c) => c.id === 'efg_pct')?.values).toEqual({ leader: 48, trailer: 36, gap: 12 });
    expect(ids(at(9, 1))).not.toContain('efg_pct');
    expect(at(8, 0).find((c) => c.id === 'efg_pct')?.text).toBe('Boston has a 48% effective field-goal percentage, compared with 32% for New York.');
  });

  it('needs the minimum field-goal attempts for both teams', () => {
    expect(ids(candidates({ ...EVEN, fgm: 10, fga: 14, fg3m: 0, fg3a: 0 }, { ...EVEN, fgm: 4, fga: 20, fg3m: 0, fg3a: 0 }))).not.toContain('efg_pct');
  });
});

describe('offensive rebound and free-throw attempt candidates', () => {
  it('qualifies offensive rebounds at exactly the gap threshold', () => {
    expect(candidates({ ...EVEN, oreb: 11 }, { ...EVEN, oreb: 6 }).find((c) => c.id === 'offensive_rebounds')?.text).toBe(
      'Boston has an 11–6 advantage in offensive rebounds.'
    );
    expect(candidates({ ...EVEN, oreb: 9 }, { ...EVEN, oreb: 4 }, true).find((c) => c.id === 'offensive_rebounds')?.text).toBe(
      'Boston finished with a 9–4 advantage in offensive rebounds.'
    );
    expect(ids(candidates({ ...EVEN, oreb: 10 }, { ...EVEN, oreb: 6 }))).not.toContain('offensive_rebounds');
    expect(ids(candidates({ ...EVEN, oreb: 6 }, { ...EVEN, oreb: 6 }))).not.toContain('offensive_rebounds');
  });

  it('qualifies free-throw attempts at exactly the gap threshold', () => {
    expect(candidates({ ...EVEN, ftm: 4, fta: 6 }, { ...EVEN, ftm: 12, fta: 14 }).find((c) => c.id === 'free_throw_attempts')?.text).toBe(
      'New York has attempted 14 free throws, compared with 6 for Boston.'
    );
    expect(ids(candidates({ ...EVEN, ftm: 4, fta: 6 }, { ...EVEN, ftm: 12, fta: 13 }))).not.toContain('free_throw_attempts');
  });

  it('suppresses counting-stat gaps on a small early sample', () => {
    const early = { fgm: 4, fga: 9, fg3m: 1, fg3a: 3, ftm: 2, fta: 2, oreb: 0 };
    expect(candidates({ ...early, oreb: 5, ftm: 10, fta: 10 }, early)).toEqual([]);
  });

  it('returns nothing when no family reaches its threshold', () => {
    expect(candidates(EVEN, EVEN)).toEqual([]);
  });
});

describe('selectInsight', () => {
  const insight = (id: PulseInsight['id'], score: number): PulseInsight => ({
    id,
    text: id,
    teamId: HOME,
    values: { leader: 0, trailer: 0, gap: 0 },
    score,
    observedAt: null,
  });

  it('keeps only the stronger shooting observation, preferring 3P% on an equal score', () => {
    expect(selectInsight([insight('three_point_pct', 1.1), insight('efg_pct', 1.4)])?.id).toBe('efg_pct');
    expect(selectInsight([insight('three_point_pct', 1.4), insight('efg_pct', 1.1)])?.id).toBe('three_point_pct');
    expect(selectInsight([insight('three_point_pct', 1.2), insight('efg_pct', 1.2)])?.id).toBe('three_point_pct');
  });

  it('shows the higher-priority family unless another beats it by the switch margin', () => {
    expect(selectInsight([insight('offensive_rebounds', 1.0), insight('free_throw_attempts', 1.2)])?.id).toBe('offensive_rebounds');
    expect(selectInsight([insight('offensive_rebounds', 1.0), insight('free_throw_attempts', 1.0 + PULSE_THRESHOLDS.switchMargin)])?.id).toBe(
      'free_throw_attempts'
    );
    expect(selectInsight([insight('efg_pct', 1.0), insight('offensive_rebounds', 1.0)])?.id).toBe('efg_pct');
  });

  it('does not depend on candidate order and returns null for no candidates', () => {
    const list = [insight('free_throw_attempts', 2), insight('offensive_rebounds', 1.1), insight('three_point_pct', 1.3)];
    const picks = [list, [...list].reverse(), [list[1], list[2], list[0]]].map((l) => selectInsight(l)?.id);
    expect(new Set(picks)).toEqual(new Set(['free_throw_attempts']));
    expect(selectInsight([])).toBeNull();
  });
});

describe('gameContext lifecycle', () => {
  const shooting = { home: { ...EVEN, fg3m: 12, fg3a: 25 }, visitor: { ...EVEN, fg3m: 6, fg3a: 25 } };
  const withLifecycle = (lifecycle: ScoreboardGame['lifecycle'], over: Parameters<typeof game>[2] = {}) =>
    gameContext(game(shooting.home, shooting.visitor, { lifecycle, ...over }));

  it('is null before tip and for postponed, canceled, and unknown games', () => {
    for (const lifecycle of ['scheduled', 'postponed', 'canceled', 'unknown'] as const) expect(withLifecycle(lifecycle)).toBeNull();
  });

  it('gives the same insight while live, at halftime, and in overtime', () => {
    for (const lifecycle of ['live', 'halftime', 'overtime'] as const) {
      expect(withLifecycle(lifecycle)).toMatchObject({ kind: 'insight', text: 'Boston is shooting 48% from three (12/25), compared with 24% for New York (6/25).' });
    }
  });

  it('never generates a current insight from a stale or safety-stopped snapshot', () => {
    expect(withLifecycle('live', { stale: true, stale_reason: 'no_recent_observation' })).toEqual({ kind: 'stale', text: GAME_CONTEXT_COPY.stale });
    expect(withLifecycle('live', { stale: true, stale_reason: 'polling_safety_stopped', polling_state: 'safety_stopped' })?.kind).toBe('stale');
  });

  it('uses a quiet fallback, not the score, when the live box is missing, untrusted, or has no gap', () => {
    expect(withLifecycle('live', { completeness: 'none', players: [] })).toEqual({ kind: 'developing', text: GAME_CONTEXT_COPY.developing });
    expect(gameContext(capturedTorLac())).toEqual({ kind: 'developing', text: GAME_CONTEXT_COPY.developing });
    expect(gameContext(game(EVEN, EVEN))?.kind).toBe('developing');
  });

  it('recaps a final only from a verified box, in the past tense', () => {
    expect(withLifecycle('final', { completeness: 'verified_final', polling_state: 'complete' })).toMatchObject({
      kind: 'insight',
      text: 'Boston shot 48% from three (12/25), compared with 24% for New York (6/25).',
    });
    expect(gameContext(game(EVEN, EVEN, { lifecycle: 'final', completeness: 'verified_final' }))).toEqual({
      kind: 'no_standout',
      text: GAME_CONTEXT_COPY.noStandout,
    });
    expect(withLifecycle('final', { completeness: 'final_unverified' })).toEqual({ kind: 'pending', text: GAME_CONTEXT_COPY.pending });
    expect(withLifecycle('final', { completeness: 'none', players: [] })?.kind).toBe('pending');
    const thin = game(shooting.home, shooting.visitor, { lifecycle: 'final', completeness: 'verified_final' });
    const twoLines = { ...thin, box_score: { ...thin.box_score, players: thin.box_score.players.filter((l) => l.playerId.endsWith('-0')) } };
    expect(gameContext(twoLines)).toEqual({ kind: 'unavailable', text: GAME_CONTEXT_COPY.unavailable });
  });

  it('is deterministic for identical snapshots and never restates the score or leaders', () => {
    const snapshot = game(shooting.home, { ...shooting.visitor, oreb: 12 });
    expect(gameContext(snapshot)).toEqual(gameContext(structuredClone(snapshot)));
    const texts = [
      gameContext(snapshot),
      gameContext(capturedWasDet()),
      gameContext(capturedIndAtl()),
      withLifecycle('final', { completeness: 'verified_final' }),
    ].map((c) => c?.text ?? '');
    for (const text of texts) {
      expect(text).not.toMatch(/\b(leads|trails|led|wins|won|scor(ed|ing) leader|PTS)\b/);
      expect(text.length).toBeLessThanOrEqual(120);
    }
  });
});

describe('captured provider snapshots (2026-10-10)', () => {
  it('Washington vs Detroit: three families qualify and the eFG% edge is shown', () => {
    const snap = capturedWasDet();
    const t = teamTotals(snap)!;
    const all = insightCandidates(t, { home: 'Washington', visitor: 'Detroit' }, false, snap.box_score.acquired_at);
    expect(ids(all)).toEqual(['efg_pct', 'free_throw_attempts', 'three_point_pct']);
    expect(gameContext(snap)).toMatchObject({
      kind: 'insight',
      text: 'Washington has a 63% effective field-goal percentage, compared with 45% for Detroit.',
      insight: { id: 'efg_pct', teamId: '30', observedAt: '2026-10-11T00:06:37.639Z' },
    });
  });

  it('Indiana vs Atlanta: totals reconcile but no gap qualifies, so nothing is forced', () => {
    const t = teamTotals(capturedIndAtl())!;
    expect(t.visitor).toMatchObject({ fgm: 17, fga: 37, fg3m: 6, fg3a: 18, fta: 13, oreb: 3 });
    expect(t.home).toMatchObject({ fgm: 14, fga: 28, fg3m: 4, fg3a: 12, fta: 18, oreb: 0 });
    expect(gameContext(capturedIndAtl())?.kind).toBe('developing');
  });

  it('Toronto vs LA: the box trails the score by one basket, so no team-stat claim is made', () => {
    expect(teamTotals(capturedTorLac())).toBeNull();
    expect(gameContext(capturedTorLac())?.kind).toBe('developing');
  });
});
