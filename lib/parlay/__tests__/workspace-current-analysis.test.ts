import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(), queryOne: vi.fn() }));

import { adaptPropsExplorerOffer, type PropsExplorerOfferInput } from '../adapt-props-explorer-offer';
import type { SelectedParlayLeg } from '../selection';
import { evaluateWorkspaceAnalysisEligibility, runWorkspaceHistoricalAnalysis } from '../workspace-analysis';
import { isWorkspaceCurrentAnalysisEnabled, PARLAY_WORKSPACE_CURRENT_ANALYSIS_ENV } from '../workspace-current-analysis-flag';
import {
  WORKSPACE_CURRENT_CONTEXT_PATH,
  runWorkspaceCurrentAnalysis,
  workspaceCurrentContextRequest,
} from '../workspace-current-analysis-client';
import {
  buildWorkspaceCurrentReplay,
  ownInjuryStatus,
  type WorkspaceCurrentContextDeps,
} from '../workspace-current-context';
import {
  workspaceCoverageSummary,
  workspaceKeySignals,
  workspaceProjectionTable,
  workspaceShowsProjection,
} from '../workspace-presentation';
import {
  CONTEXT_PLAYER_LOGS_SQL,
  CONTEXT_PROJECTION_SQL,
  CONTEXT_TARGET_GAME_SQL,
  CONTEXT_TEAM_STATS_SQL,
} from '@/lib/parlay-xray/context/sql';
import { buildX3fReplayContext, buildX3fReplayDeps } from '@/lib/parlay-xray/e2e/fixture';
import type { TeammatesOutResponse } from '@/lib/betting/teammates-out-display';

const GAME_ID = '18450001';
const HOME = '21';
const AWAY = '14';
const TIP = '2026-11-06T00:30:00.000Z';
const NOW = new Date('2026-11-05T22:00:00.000Z');
const ENV = { INJURY_SERVING_ENABLED: '1' };

function mustAdapt(input: PropsExplorerOfferInput) {
  const result = adaptPropsExplorerOffer(input);
  if (!result.ok) throw new Error(result.code);
  return result.offer;
}

function liveLeg(playerId: string, name: string, line: number, overrides: Partial<PropsExplorerOfferInput> = {}): SelectedParlayLeg {
  return {
    offer: mustAdapt({
      playerId,
      playerName: name,
      gameId: GAME_ID,
      propType: 'points',
      side: 'over',
      lineValue: line,
      sportsbook: 'DraftKings',
      oddsAmerican: -110,
      snapshotAt: NOW.toISOString(),
      marketContext: 'live',
      sourceTable: 'analytics.player_props_current',
      ...overrides,
    }),
    gameLabel: 'LAL @ OKC',
  };
}

function priorLogRows(playerId: string, teamId: string, count: number, points: number) {
  return Array.from({ length: count }, (_, i) => ({
    player_id: playerId,
    game_id: `prior-${playerId}-${i}`,
    team_id: teamId,
    start_time: new Date(Date.parse('2026-11-04T00:00:00.000Z') - i * 2 * 86400000).toISOString(),
    season: '2026',
    minutes: '30',
    points: points + (i % 3),
    rebounds: 5,
    assists: 4,
    three_pointers_made: 2,
  }));
}

function teamRows() {
  return [
    { team_id: HOME, game_id: 't1', opponent_team_id: '3', start_time: '2026-11-03T00:00:00.000Z', season: '2026', pace: 100, points_allowed: 110, team_points: 115 },
    { team_id: AWAY, game_id: 't2', opponent_team_id: '4', start_time: '2026-11-03T00:00:00.000Z', season: '2026', pace: 98, points_allowed: 112, team_points: 109 },
  ];
}

type Call = { sql: string; params: unknown[] | undefined };

function fakeDeps(overrides: Partial<WorkspaceCurrentContextDeps> = {}) {
  const calls: Call[] = [];
  const query = (async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    if (sql === CONTEXT_TARGET_GAME_SQL) {
      return params?.[0] === GAME_ID
        ? [{ game_id: GAME_ID, start_time: TIP, season: '2026', home_team_id: HOME, away_team_id: AWAY, home_abbr: 'OKC', away_abbr: 'LAL' }]
        : [];
    }
    if (sql === CONTEXT_PLAYER_LOGS_SQL) {
      const playerId = String(params?.[0]);
      return playerId === 'p1' ? priorLogRows('p1', HOME, 10, 20) : priorLogRows('p2', AWAY, 10, 8);
    }
    if (sql === CONTEXT_TEAM_STATS_SQL) return teamRows();
    if (sql === CONTEXT_PROJECTION_SQL) {
      return [{ player_id: params?.[0], game_id: GAME_ID, model_version: 'v9', generated_at: '2026-11-05T12:00:00Z', intended_cutoff_at: '2026-11-05T12:00:00Z', predictions: { pts: 30 } }];
    }
    throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
  }) as WorkspaceCurrentContextDeps['query'];
  const teammates: TeammatesOutResponse = {
    status: 'ok',
    teamId: HOME,
    teamAbbr: 'OKC',
    asOfLabel: 'as of 4:00 PM ET',
    minutesFreed: 31.4,
    teammates: [{ playerId: 'p9', name: 'Jalen Williams', status: 'Out', avgMinutes: 31.42, split: null, wowyHref: '/wowy' }],
  };
  const deps: WorkspaceCurrentContextDeps = {
    query,
    loadTeammatesOut: async () => teammates,
    loadPlayerInjury: async (playerId) =>
      playerId === 'p2' ? { status: 'Questionable', snapshotAt: '2026-11-05T21:00:00.000Z' } : null,
    env: ENV,
    now: NOW,
    ...overrides,
  };
  return { deps, calls };
}

describe('current-props eligibility flag', () => {
  it('is off unless the env flag is exactly 1', () => {
    expect(isWorkspaceCurrentAnalysisEnabled({})).toBe(false);
    expect(isWorkspaceCurrentAnalysisEnabled({ [PARLAY_WORKSPACE_CURRENT_ANALYSIS_ENV]: 'true' })).toBe(false);
    expect(isWorkspaceCurrentAnalysisEnabled({ [PARLAY_WORKSPACE_CURRENT_ANALYSIS_ENV]: ' 1 ' })).toBe(true);
  });

  it('keeps live_current blocked by default', () => {
    const eligibility = evaluateWorkspaceAnalysisEligibility([liveLeg('p1', 'A', 19.5)]);
    expect(eligibility.status).toBe('UNAVAILABLE');
    if (eligibility.status !== 'UNAVAILABLE') return;
    expect(eligibility.reasons.map((row) => row.code)).toEqual(['LIVE_CURRENT']);
  });

  it('marks one-game live legs READY in current mode when the flag is on', () => {
    const eligibility = evaluateWorkspaceAnalysisEligibility([liveLeg('p1', 'A', 19.5), liveLeg('p2', 'B', 8.5)], {
      currentAnalysisEnabled: true,
    });
    expect(eligibility).toEqual({ status: 'READY', gameId: GAME_ID, mode: 'current', reasons: [] });
  });

  it('still blocks multi-game and mixed-snapshot live selections with the flag on', () => {
    const other = liveLeg('p2', 'B', 8.5, { gameId: '18450002' });
    const multi = evaluateWorkspaceAnalysisEligibility([liveLeg('p1', 'A', 19.5), other], { currentAnalysisEnabled: true });
    expect(multi.status === 'UNAVAILABLE' && multi.reasons.map((row) => row.code)).toEqual(['MULTI_GAME']);

    const decision = liveLeg('p2', 'B', 8.5, { marketContext: 'historical', sourceTable: 'research.prop_decision_lines' });
    const mixed = evaluateWorkspaceAnalysisEligibility([liveLeg('p1', 'A', 19.5), decision], { currentAnalysisEnabled: true });
    expect(mixed.status === 'UNAVAILABLE' && mixed.reasons.some((row) => row.code === 'MIXED_SNAPSHOT')).toBe(true);
    expect(mixed.status === 'UNAVAILABLE' && mixed.reasons.some((row) => row.code === 'LIVE_CURRENT')).toBe(false);
  });

  it('refuses to pair live legs with the historical fixture context', () => {
    const legs = [liveLeg('1028037477', 'Ajay Mitchell', 12.5, { gameId: buildX3fReplayContext().gameId })];
    expect(() =>
      runWorkspaceHistoricalAnalysis(legs, buildX3fReplayContext(), buildX3fReplayDeps(), { currentAnalysisEnabled: true })
    ).toThrow(/MODE_MISMATCH/);
  });
});

describe('current-props context assembly', () => {
  it('builds context from DB rows as of min(now, tip), without projections or market rows', async () => {
    const { deps, calls } = fakeDeps();
    const result = await buildWorkspaceCurrentReplay({ gameId: GAME_ID, playerIds: ['p1', 'p2', 'p1'] }, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { context, deps: replayDeps } = result.replay;

    expect(context).toMatchObject({
      gameId: GAME_ID,
      cutoffAt: NOW.toISOString(),
      historicalDate: '2026-11-05',
      season: '2026',
      slateLabel: 'LAL @ OKC',
      analysisMode: 'current',
    });
    expect(replayDeps.movementRows).toEqual([]);
    expect(replayDeps.targetGame).toMatchObject({ homeTeamId: HOME, awayTeamId: AWAY });
    expect(Object.keys(replayDeps.sourcesByPlayerId).sort()).toEqual(['p1', 'p2']);

    expect(calls.some((call) => call.sql === CONTEXT_PROJECTION_SQL)).toBe(false);
    const logCalls = calls.filter((call) => call.sql === CONTEXT_PLAYER_LOGS_SQL);
    expect(logCalls).toHaveLength(2);
    for (const call of logCalls) {
      expect(call.params?.[1]).toBe(NOW.toISOString());
      expect(call.params?.[2]).toBe(GAME_ID);
      expect(call.params?.[3]).toEqual(['2026', '2025']);
    }
    expect(CONTEXT_PLAYER_LOGS_SQL).toMatch(/analytics\.player_game_logs/);
    expect(CONTEXT_PLAYER_LOGS_SQL).not.toMatch(/bbref_/);

    const p1 = replayDeps.sourcesByPlayerId.p1!;
    expect(p1.projectionSnapshots).toEqual([]);
    expect(p1.priorPlayerLogs).toHaveLength(10);
    expect(p1.availability).toEqual({
      status: 'ok',
      asOfLabel: 'as of 4:00 PM ET',
      playerStatus: null,
      teammatesOut: [{ name: 'Jalen Williams', status: 'Out', avgMinutes: 31.4 }],
    });
    expect(replayDeps.sourcesByPlayerId.p2!.availability).toMatchObject({ status: 'ok', playerStatus: 'Q' });
  });

  it('caps the cutoff at tip once the game has started', async () => {
    const { deps } = fakeDeps({ now: new Date('2026-11-06T02:00:00.000Z') });
    const result = await buildWorkspaceCurrentReplay({ gameId: GAME_ID, playerIds: ['p1'] }, deps);
    expect(result.ok && result.replay.context.cutoffAt).toBe(TIP);
  });

  it('fails closed for an unknown game', async () => {
    const { deps } = fakeDeps();
    await expect(buildWorkspaceCurrentReplay({ gameId: 'nope', playerIds: ['p1'] }, deps)).resolves.toEqual({
      ok: false,
      code: 'GAME_NOT_FOUND',
    });
  });

  it('marks availability unavailable when the injury report is not served', async () => {
    const { deps } = fakeDeps({
      loadTeammatesOut: async () => ({ status: 'unavailable', reason: 'Injury report unavailable' }),
    });
    const result = await buildWorkspaceCurrentReplay({ gameId: GAME_ID, playerIds: ['p1'] }, deps);
    expect(result.ok && result.replay.deps.sourcesByPlayerId.p1!.availability).toEqual({
      status: 'unavailable',
      reason: 'Injury report unavailable',
    });
  });

  it('reads the leg player own status only from a served, same-day report', () => {
    const args = { gameEtDate: '2026-11-05', env: ENV, now: NOW };
    expect(ownInjuryStatus({ status: 'Out', snapshotAt: '2026-11-05T20:00:00Z' }, args)).toBe('Out');
    expect(ownInjuryStatus({ status: 'Questionable', snapshotAt: '2026-11-04T20:00:00Z' }, args)).toBeNull();
    expect(ownInjuryStatus({ status: 'Out', snapshotAt: '2026-11-05T20:00:00Z' }, { ...args, env: { INJURY_SERVING_ENABLED: '0' } })).toBeNull();
    expect(ownInjuryStatus({ status: 'Probable', snapshotAt: '2026-11-05T20:00:00Z' }, args)).toBeNull();
    expect(ownInjuryStatus(null, args)).toBeNull();
  });
});

describe('current-props analysis end to end', () => {
  async function analyze() {
    const legs = [liveLeg('p1', 'Shai Gilgeous-Alexander', 19.5), liveLeg('p2', 'Austin Reaves', 9.5)];
    const { deps } = fakeDeps();
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(WORKSPACE_CURRENT_CONTEXT_PATH);
      const body = JSON.parse(String(init?.body));
      const built = await buildWorkspaceCurrentReplay(body, deps);
      if (!built.ok) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(built.replay), { status: 200 });
    });
    const result = await runWorkspaceCurrentAnalysis(legs, fetcher as unknown as typeof fetch);
    return { legs, result, fetcher };
  }

  it('requests one game with deduped players', () => {
    const legs = [liveLeg('p1', 'A', 19.5), liveLeg('p1', 'A', 4.5, { propType: 'assists' }), liveLeg('p2', 'B', 9.5)];
    expect(workspaceCurrentContextRequest(legs)).toEqual({ gameId: GAME_ID, playerIds: ['p1', 'p2'] });
  });

  it('uses real form, role, matchup and availability, with no projection', async () => {
    const { result } = await analyze();
    expect(result.contexts.every((ctx) => ctx.analysisMode === 'current')).toBe(true);
    expect(result.contexts.every((ctx) => ctx.projection.status === 'UNAVAILABLE' && ctx.projection.projectedStat == null)).toBe(true);
    expect(result.contexts[0]!.playerForm.last10.gameCount).toBe(10);
    expect(result.contexts[0]!.role.seasonToDateMinutes.average).toBe(30);
    expect(result.contexts[0]!.identity.teamAbbr).toBe('OKC');
    expect(result.contexts[1]!.identity.opponentAbbr).toBe('OKC');
    expect(result.contexts[0]!.matchup.status).not.toBe('UNAVAILABLE');
    expect(result.contexts[0]!.availability.status).toBe('AVAILABLE');

    const codes = result.interpretations.flatMap((row) => row.uncertainties.map((item) => item.code));
    expect(codes).not.toContain('NO_ARCHIVED_PROJECTION');
    expect(codes).not.toContain('MARKET_CLOSE_UNKNOWN');
    expect(codes).not.toContain('MARKET_MISSING_THREE_HOUR');
    expect(codes).toContain('AVAILABILITY_TEAMMATES_OUT');
    expect(result.interpretations[1]!.whyItCouldFail.some((item) => item.code === 'AVAILABILITY_PLAYER_LISTED')).toBe(true);

    const parlayCodes = result.parlayInterpretation.crossLegUncertainties.map((item) => item.code);
    expect(parlayCodes).not.toContain('PARLAY_SHARED_GAP_PROJECTION');
    expect(parlayCodes).not.toContain('PARLAY_SHARED_GAP_WOWY');
    expect(result.parlayInterpretation.dependencyGroups.length).toBeGreaterThan(0);
  });

  it('drops the projection key signal and projection table for current props', async () => {
    const { result } = await analyze();
    const signals = workspaceKeySignals(result.parlayInterpretation, result.interpretations, result.contexts);
    expect(signals.map((signal) => signal.id)).toEqual(['role', 'relationships', 'coverage']);
    expect(workspaceProjectionTable(result.interpretations, result.contexts)).toEqual([]);
    expect(workspaceShowsProjection(result.interpretations)).toBe(false);
    const coverage = workspaceCoverageSummary(result.parlayInterpretation, 'current');
    expect(coverage.warnings).not.toContain('Projection unavailable');
    expect(coverage.warnings).not.toContain('WOWY unavailable');
    expect(coverage.band).toBe('High');
  });

  it('surfaces a route failure instead of falling back to the fixture', async () => {
    const legs = [liveLeg('p1', 'A', 19.5)];
    const fetcher = vi.fn(async () => new Response('{}', { status: 404 }));
    await expect(runWorkspaceCurrentAnalysis(legs, fetcher as unknown as typeof fetch)).rejects.toThrow(/404/);
  });
});
