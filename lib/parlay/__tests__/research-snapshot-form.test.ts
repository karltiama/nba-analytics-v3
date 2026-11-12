import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ParlayWorkspaceView } from '@/components/parlay-workspace/ParlayWorkspaceView';
import { handoffQuickBuildSelection, type QuickBuildHandoffLeg } from '@/lib/parlay/adapt-quick-build';
import {
  assembleResearchSnapshotFormLeg,
  formatSampleAverage,
  HISTORICAL_PLAYER_FORM_BASIS,
  HISTORICAL_PLAYER_FORM_COPY,
  HISTORICAL_PLAYER_FORM_TITLE,
  RESEARCH_SNAPSHOT_WORKSPACE_NOTE,
  normalizeObservedAt,
  parseResearchSnapshotFormRequest,
  RESEARCH_SNAPSHOT_FORM_MAX_LOGS,
  researchSnapshotFormKey,
  researchSnapshotFormReason,
  researchSnapshotFormRequestFromSelection,
  researchSnapshotFormResponseMatches,
  type ResearchSnapshotFormRequestLeg,
  type ResearchSnapshotFormSources,
  type ResearchSnapshotPriorLog,
} from '@/lib/parlay/research-snapshot-form';
import { loadResearchSnapshotForm } from '@/lib/parlay/research-snapshot-form-load';
import { shouldRequestCurrentParlayPrices } from '@/lib/parlay/research-snapshot-cost';
import type { SelectedParlayLeg } from '@/lib/parlay/selection';
import { evaluateWorkspaceAnalysisEligibility } from '@/lib/parlay/workspace-analysis';
import type { SqlQuery } from '@/lib/parlay-xray/context/load';
import { formatEtTimestamp } from '@/lib/quick-builds/preview';

const OBSERVED = '2026-11-09T16:00:00.000Z';
const NOW = Date.parse('2026-11-09T18:00:00.000Z');
const START = '2026-11-10T00:30:00.000Z';

function handoffLeg(overrides: Partial<QuickBuildHandoffLeg> = {}): QuickBuildHandoffLeg {
  return {
    displayReady: true,
    playerId: '11',
    playerName: 'Jayson Tatum',
    gameId: 'g1',
    market: 'points',
    side: 'over',
    line: 15,
    sportsbook: 'draftkings',
    oddsAmerican: -115,
    observedAt: OBSERVED,
    gameStartTime: START,
    gameStatus: 'Scheduled',
    ...overrides,
  };
}

function requestLeg(overrides: Partial<ResearchSnapshotFormRequestLeg> = {}): ResearchSnapshotFormRequestLeg {
  return {
    playerId: '11',
    gameId: 'g1',
    market: 'points',
    side: 'over',
    line: 15,
    snapshotAt: OBSERVED,
    ...overrides,
  };
}

function log(overrides: Partial<ResearchSnapshotPriorLog> = {}): ResearchSnapshotPriorLog {
  return {
    playerId: '11',
    gameId: 'old-1',
    teamId: 'home',
    startTime: '2026-11-01T00:00:00.000Z',
    season: '2026',
    minutes: 30,
    points: 10,
    rebounds: 4,
    assists: 3,
    threePointersMade: 1,
    gameStatus: 'Final',
    boxScoreStoredAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function sources(logs: ResearchSnapshotPriorLog[]): ResearchSnapshotFormSources {
  return {
    scheduledGame: {
      homeAbbr: 'BOS',
      awayAbbr: 'NYK',
      startTime: START,
      season: '2026',
      homeTeamId: 'home',
      awayTeamId: 'away',
    },
    logs,
  };
}

function playedSample(): ResearchSnapshotPriorLog[] {
  return [
    log({ gameId: 'old-1', startTime: '2026-11-01T00:00:00.000Z', points: 10, minutes: 30 }),
    log({ gameId: 'old-2', startTime: '2026-11-05T00:00:00.000Z', points: 20, minutes: 20 }),
    log({ gameId: 'old-3', startTime: '2026-11-08T00:00:00.000Z', points: 15, minutes: 25 }),
    log({ gameId: 'g1', startTime: START, points: 99, minutes: 40 }),
    log({ gameId: 'later', startTime: '2026-11-12T00:00:00.000Z', points: 99, minutes: 40 }),
    log({ gameId: 'same-instant', startTime: OBSERVED, points: 99, minutes: 40 }),
    log({ playerId: 'other', gameId: 'other-game', startTime: '2026-11-04T00:00:00.000Z', points: 99, minutes: 40 }),
    log({
      gameId: 'finished-later',
      startTime: '2026-11-09T15:00:00.000Z',
      points: 99,
      minutes: 40,
      boxScoreStoredAt: '2026-11-09T18:00:00.000Z',
    }),
    log({
      gameId: 'still-playing',
      startTime: '2026-11-09T15:00:00.000Z',
      points: 99,
      minutes: 40,
      gameStatus: 'In Progress',
    }),
    log({
      gameId: 'unknown-storage',
      startTime: '2026-11-07T00:00:00.000Z',
      points: 99,
      minutes: 40,
      boxScoreStoredAt: null,
    }),
  ];
}

describe('research snapshot player form', () => {
  it('keeps only logged games that started before the observation', () => {
    const result = assembleResearchSnapshotFormLeg(requestLeg(), sources(playedSample()));
    expect(result.status).toBe('ready');
    expect(result.line).toBe(15);
    expect(result.snapshotAt).toBe(OBSERVED);
    expect(result.cutoffAt).toBe(OBSERVED);
    expect(result.season).toEqual({ gameCount: 3, average: 15 });
    expect(result.last5).toEqual({ gameCount: 3, average: 15 });
    expect(result.last10).toEqual({ gameCount: 3, average: 15 });
    expect(result.lineRelative).toEqual({ sampleCount: 3, above: 1, below: 1, equal: 1 });
    expect(result.minutes?.gamesPlayed).toBe(3);
    expect(result.minutes?.priorGame).toBe(25);
    expect(result.minutes?.last5).toEqual({ gameCount: 3, average: 25 });
    expect(formatSampleAverage(result.last5?.average ?? null, result.last5?.gameCount ?? 0)).toBe('15 over 3 games');
    expect(result.reason).toBe(researchSnapshotFormReason('SMALL_PRIOR_SAMPLE'));
    expect(result.teamAssignment).toEqual({
      status: 'resolved',
      playerTeamAbbr: 'BOS',
      opponentAbbr: 'NYK',
      provenance: 'most_recent_final_box_score_stored_before_observation',
    });
    expect(JSON.stringify(result)).not.toContain('odds');
    expect(HISTORICAL_PLAYER_FORM_COPY).toContain('first stored');
    expect(HISTORICAL_PLAYER_FORM_BASIS).toContain('no official end time');
    expect(HISTORICAL_PLAYER_FORM_BASIS.toLowerCase()).not.toContain('completed before');
  });

  it('leaves out games that were not yet stored, not final, or not finished before the observation', () => {
    const storedBefore = log({ gameId: 'done', startTime: '2026-11-08T00:00:00.000Z', points: 11, minutes: 22 });
    const startedAfter = log({ gameId: 'after', startTime: '2026-11-12T00:00:00.000Z', points: 50, minutes: 30 });
    const storedLater = log({
      gameId: 'late-box',
      startTime: '2026-11-09T15:00:00.000Z',
      points: 50,
      minutes: 30,
      boxScoreStoredAt: '2026-11-09T20:00:00.000Z',
    });
    const notFinal = log({
      gameId: 'live',
      startTime: '2026-11-09T15:00:00.000Z',
      points: 50,
      minutes: 30,
      gameStatus: null,
    });
    const target = log({ gameId: 'g1', startTime: '2026-11-09T12:00:00.000Z', points: 50, minutes: 30 });
    const result = assembleResearchSnapshotFormLeg(
      requestLeg(),
      sources([storedBefore, startedAfter, storedLater, notFinal, target])
    );
    expect(result.status).toBe('ready');
    expect(result.season).toEqual({ gameCount: 1, average: 11 });
    expect(result.lineRelative?.sampleCount).toBe(1);
    const none = assembleResearchSnapshotFormLeg(requestLeg(), sources([startedAfter, storedLater, notFinal, target]));
    expect(none.status).toBe('unavailable');
    expect(none.reason).toBe(researchSnapshotFormReason('NO_PRIOR_GAMES'));
    expect(none.season).toBeNull();
    expect(none.lineRelative).toBeNull();
  });

  it('uses the instant for both EST and EDT observations', () => {
    const estCutoff = '2026-11-10T04:00:00.000Z';
    const edtCutoff = '2026-07-11T03:00:00.000Z';
    expect(formatEtTimestamp(estCutoff)).toContain('EST');
    expect(formatEtTimestamp(edtCutoff)).toContain('EDT');
    const est = assembleResearchSnapshotFormLeg(requestLeg({ snapshotAt: estCutoff }), sources([
      log({ gameId: 'before-est', startTime: '2026-11-10T03:59:00.000Z', points: 12, minutes: 20 }),
      log({ gameId: 'at-est', startTime: estCutoff, points: 40, minutes: 20 }),
    ]));
    const edt = assembleResearchSnapshotFormLeg(requestLeg({ snapshotAt: edtCutoff, line: 8 }), sources([
      log({ gameId: 'before-edt', startTime: '2026-07-11T02:59:00.000Z', points: 9, minutes: 18, season: '2026' }),
      log({ gameId: 'after-edt', startTime: '2026-07-11T03:01:00.000Z', points: 30, minutes: 18, season: '2026' }),
    ]));
    expect(est.season?.gameCount).toBe(1);
    expect(est.season?.average).toBe(12);
    expect(edt.lineRelative).toEqual({ sampleCount: 1, above: 1, below: 0, equal: 0 });
  });

  it('rejects a missing or invalid observation time', () => {
    expect(normalizeObservedAt('')).toBeNull();
    expect(normalizeObservedAt('not-a-time')).toBeNull();
    expect(parseResearchSnapshotFormRequest({ legs: [requestLeg({ snapshotAt: 'yesterday' as unknown as string })] }).ok).toBe(false);
    expect(parseResearchSnapshotFormRequest({ legs: [{ ...requestLeg(), snapshotAt: '   ' }] }).ok).toBe(false);
  });

  it('returns an explicit gap when logs or the market are missing', () => {
    const missing = assembleResearchSnapshotFormLeg(requestLeg(), sources([]));
    expect(missing.status).toBe('unavailable');
    expect(missing.reason).toBe(researchSnapshotFormReason('NO_PRIOR_GAMES'));
    expect(missing.season).toBeNull();
    expect(missing.lineRelative).toBeNull();
    const unsupported = assembleResearchSnapshotFormLeg(requestLeg({ market: 'blocks' }), sources(playedSample()));
    expect(unsupported.status).toBe('unavailable');
    expect(unsupported.reason).toBe(researchSnapshotFormReason('UNSUPPORTED_MARKET'));
    expect(unsupported.lineRelative).toBeNull();
    const unknownGame = assembleResearchSnapshotFormLeg(requestLeg(), null);
    expect(unknownGame.reason).toBe(researchSnapshotFormReason('GAME_NOT_FOUND'));
  });

  it('does not invent a team when the prior log is outside the scheduled game', () => {
    const result = assembleResearchSnapshotFormLeg(
      requestLeg(),
      sources([log({ teamId: 'somewhere-else', points: 12, minutes: 22 })])
    );
    expect(result.status).toBe('ready');
    expect(result.teamAssignment).toEqual({ status: 'unresolved' });
    expect(result.scheduledGame).toEqual({ homeAbbr: 'BOS', awayAbbr: 'NYK', startTime: START });
  });

  it('stops instead of summarizing an unbounded log set', () => {
    const logs = Array.from({ length: RESEARCH_SNAPSHOT_FORM_MAX_LOGS + 1 }, (_, index) =>
      log({
        gameId: `row-${index}`,
        startTime: new Date(Date.parse('2026-01-01T00:00:00.000Z') + index * 86_400_000).toISOString(),
        points: 10,
        minutes: 20,
      })
    );
    const result = assembleResearchSnapshotFormLeg(requestLeg(), sources(logs));
    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe(researchSnapshotFormReason('ROW_LIMIT'));
    expect(result.season).toBeNull();
  });

  it('rejects five legs and a malformed body', () => {
    const legs = [0, 1, 2, 3, 4].map((index) => requestLeg({ playerId: String(index + 1), gameId: `g${index + 1}` }));
    const parsed = parseResearchSnapshotFormRequest({ legs });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toBe('Too many legs for historical player form.');
    expect(parseResearchSnapshotFormRequest({ legs: [{ ...requestLeg(), oddsAmerican: -110 }] }).ok).toBe(true);
    const accepted = parseResearchSnapshotFormRequest({ legs: [requestLeg()] });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(JSON.stringify(accepted.legs)).not.toContain('odds');
  });
});

describe('research snapshot form loader', () => {
  it('queries logs at the observation cutoff and keeps a failed leg from erasing another', async () => {
    const calls: string[] = [];
    const query: SqlQuery = async (sql, params) => {
      calls.push(sql);
      const gameId = String(params?.[0] ?? '');
      if (sql.includes('home_abbr')) {
        if (gameId === 'missing') return [];
        return [
          {
            game_id: gameId,
            start_time: START,
            season: '2026',
            home_team_id: 'home',
            away_team_id: 'away',
            home_abbr: 'BOS',
            away_abbr: 'NYK',
          },
        ];
      }
      if (sql.includes('player_game_logs')) {
        expect(params?.[1]).toBe(OBSERVED);
        expect(params?.[2]).toBe('g1');
        expect(sql).not.toContain('player_injury');
        expect(sql).not.toContain('prediction_snapshots');
        expect(sql).toContain('l.created_at <');
        expect(sql).toContain("= 'final'");
        return [
          {
            player_id: '11',
            game_id: 'old-1',
            team_id: 'home',
            start_time: '2026-11-01T00:00:00.000Z',
            season: '2026',
            minutes: 30,
            points: 18,
            rebounds: 4,
            assists: 3,
            three_pointers_made: 1,
            game_status: 'Final',
            box_score_stored_at: '2026-11-02T00:00:00.000Z',
          },
        ];
      }
      throw new Error(`unexpected sql ${sql}`);
    };
    const [ready, missing] = await loadResearchSnapshotForm(
      [requestLeg(), requestLeg({ playerId: '22', gameId: 'missing', line: 8.5, side: 'under' })],
      query
    );
    expect(ready?.status).toBe('ready');
    expect(ready?.line).toBe(15);
    expect(ready?.snapshotAt).toBe(OBSERVED);
    expect(ready?.season?.average).toBe(18);
    expect(missing?.status).toBe('unavailable');
    expect(missing?.reason).toBe(researchSnapshotFormReason('GAME_NOT_FOUND'));
    expect(missing?.line).toBe(8.5);
    expect(calls.some((sql) => sql.includes('team_game_stats'))).toBe(false);
    expect(calls.some((sql) => sql.includes('prediction_snapshots'))).toBe(false);
  });
});

describe('research snapshot form ticket', () => {
  it('keeps original wagers for two, three, and four legs and ignores a stale form response', () => {
    const players = [
      handoffLeg(),
      handoffLeg({ playerId: '22', playerName: 'Jaylen Brown', gameId: 'g2', market: 'rebounds', side: 'under', line: 8.5, oddsAmerican: -110 }),
      handoffLeg({ playerId: '33', playerName: 'Jalen Duren', gameId: 'g3', market: 'assists', side: 'over', line: 1.5, oddsAmerican: -105, observedAt: '2026-11-09T15:00:00.000Z' }),
      handoffLeg({ playerId: '44', playerName: 'Dereck Lively', gameId: 'g4', market: 'threes', side: 'under', line: 1.5, oddsAmerican: 120, observedAt: '2026-11-09T14:00:00.000Z' }),
    ];
    for (const count of [2, 3, 4] as const) {
      const selected = transferred(players.slice(0, count));
      const request = researchSnapshotFormRequestFromSelection(selected);
      expect(request).not.toBeNull();
      expect(request?.map((leg) => leg.line)).toEqual(selected.map((leg) => leg.offer.line));
      expect(request?.map((leg) => leg.snapshotAt)).toEqual(selected.map((leg) => leg.offer.snapshotAt));
      expect(JSON.stringify(request)).not.toContain('odds');
      expect(shouldRequestCurrentParlayPrices(selected)).toBe(false);
      const eligibility = evaluateWorkspaceAnalysisEligibility(selected, { currentAnalysisEnabled: true });
      expect(eligibility.status).toBe('UNAVAILABLE');
      if (eligibility.status === 'UNAVAILABLE') {
        expect(eligibility.reasons.map((reason) => reason.code)).toEqual(['RESEARCH_SNAPSHOT']);
      }
      const html = renderTicket(selected, eligibility);
      expect(html).toContain(RESEARCH_SNAPSHOT_WORKSPACE_NOTE);
      expect(html).not.toContain('Historical analysis is not available');
      expect(html).not.toContain('Evidence alignment appears when Court Context analysis is available.');
      expect(html).not.toContain('Projection, role, relationships, and data coverage appear after analysis.');
      expect(html).not.toContain('Season avg');
      expect(html).not.toContain('Projection');
      expect(html).not.toContain('View Context');
      expect(html).not.toContain('Risk notes appear after analysis.');
      expect(html).toContain(HISTORICAL_PLAYER_FORM_TITLE);
      expect(html).toContain('Loading historical player form');
      expect(html).toContain('Original observed price');
      for (const leg of selected) expect(html).toContain(leg.offer.playerDisplayName ?? '');
    }

    const current = transferred(players.slice(0, 2));
    const replacement = transferred([
      handoffLeg({ playerId: '55', playerName: 'Payton Pritchard', gameId: 'g5' }),
      handoffLeg({ playerId: '66', playerName: 'Sam Hauser', gameId: 'g6', market: 'rebounds', line: 4.5, oddsAmerican: -120 }),
    ]);
    const currentRequest = researchSnapshotFormRequestFromSelection(current)!;
    const nextRequest = researchSnapshotFormRequestFromSelection(replacement)!;
    expect(researchSnapshotFormKey(currentRequest)).not.toBe(researchSnapshotFormKey(nextRequest));
    expect(researchSnapshotFormResponseMatches(currentRequest, [
      { ...currentRequest[0]!, status: 'ready' },
      { ...nextRequest[1]!, status: 'ready' },
    ] as never)).toBe(false);
    expect(researchSnapshotFormResponseMatches(currentRequest, currentRequest)).toBe(true);
    expect(researchSnapshotFormKey(currentRequest)).toBe(researchSnapshotFormKey(researchSnapshotFormRequestFromSelection(current)!));
  });
});

function transferred(legs: QuickBuildHandoffLeg[]): SelectedParlayLeg[] {
  const result = handoffQuickBuildSelection({
    current: [],
    legs: legs as Parameters<typeof handoffQuickBuildSelection>[0]['legs'],
    nowMs: NOW,
    confirmed: true,
  });
  if (result.status !== 'replaced') throw new Error(result.status);
  return result.legs;
}

function renderTicket(
  legs: SelectedParlayLeg[],
  eligibility: ReturnType<typeof evaluateWorkspaceAnalysisEligibility>
): string {
  return renderToStaticMarkup(
    createElement(ParlayWorkspaceView, {
      legs,
      explorerHref: '/betting/props-explorer',
      onRemove: () => undefined,
      onClear: () => undefined,
      eligibility,
      analysis: null,
      analysisBusy: false,
      analysisError: null,
      showingResults: false,
      onAnalyze: () => undefined,
      workspaceMode: 'mine',
    })
  );
}
