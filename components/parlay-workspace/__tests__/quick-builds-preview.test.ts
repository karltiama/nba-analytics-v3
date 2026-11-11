import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QuickBuildReplaceDialog, QuickBuildsPreview, QuickBuildsResults, QuickBuildsStatus, QUICK_BUILD_REPLACE_COPY, QUICK_BUILD_UNAVAILABLE_COPY, QUICK_BUILD_UNAVAILABLE_TITLE } from '@/components/parlay-workspace/QuickBuildsPreview';
import { ParlayWorkspaceView } from '@/components/parlay-workspace/ParlayWorkspaceView';
import { adaptPropsExplorerOffer } from '@/lib/parlay/adapt-props-explorer-offer';
import { handoffQuickBuildSelection, type QuickBuildHandoffLeg } from '@/lib/parlay/adapt-quick-build';
import { quickBuildGameStartLine } from '@/lib/quick-builds/format-et';
import type { SelectedParlayLeg } from '@/lib/parlay/selection';
import {
  QUICK_BUILD_AGE_AT_SEARCH_NOTE,
  QUICK_BUILD_BOOK_OPTIONS,
  QUICK_BUILD_BREAK_EVEN_COPY,
  QUICK_BUILD_COMBINED_ODDS_COPY,
  QUICK_BUILD_EMPTY_COPY,
  QUICK_BUILD_LOWER_PAYOUT_EMPTY_SUGGESTION,
  QUICK_BUILD_PAYOUT_OPTIONS,
  QUICK_BUILD_PRESET_EXPLANATION,
  QUICK_BUILD_MATCHUP_UNAVAILABLE,
  QUICK_BUILD_NO_GAMES_COPY,
  QUICK_BUILD_ONE_GAME_COPY,
  QUICK_BUILD_REFRESH_GAMES_COPY,
  QUICK_BUILD_RESEARCH_SNAPSHOT_COPY,
  QUICK_BUILD_SELECT_TWO_COPY,
  lowerPayoutEmptySuggestion,
  acceptPreviewResult,
  beginPreviewRequest,
  fetchQuickBuilds,
  formatEtTimestamp,
  formatObservationAge,
  initialPreviewModel,
  invalidatePreview,
  parseQuickBuildResponse,
  previewErrorMessage,
  parseSlateGames,
  previewScopeKey,
  searchBlockReason,
  toggleSelectedGame,
  presetApiKey,
  presetRange,
  previewRequestPath,
  type PreviewModel,
  type QuickBuildPreviewView,
} from '@/lib/quick-builds/preview';
import { QUICK_BUILD_PRESETS, type QuickBuildEmptyReason } from '@/lib/quick-builds/types';
import {
  oldestShortlistAgeMs,
  quickBuildsHandoffEvent,
  quickBuildsSearchEvent,
} from '@/lib/product-analytics/quick-builds-events';

const GENERATED_AT = '2026-11-09T22:00:00.000Z';
const OBSERVED_AT = '2026-11-09T21:00:00.000Z';
const GAME_START = '2026-11-10T00:30:00.000Z';

function leg(overrides: Record<string, unknown> = {}) {
  return {
    playerId: '11',
    gameId: 'g1',
    market: 'points',
    side: 'over',
    line: 22.5,
    sportsbook: 'draftkings',
    oddsAmerican: -115,
    oppositeAmerican: -105,
    noVigProbability: 0.524,
    pullRunId: 'pull-1',
    observedAt: OBSERVED_AT,
    ageMs: 5_400_000,
    display: {
      playerName: 'Jayson Tatum',
      gameStartTime: GAME_START,
      gameStatus: 'Scheduled',
      teamAbbreviation: null,
      opponentAbbreviation: null,
      homeAway: null,
      displayReady: true,
      unavailableReason: null,
    },
    ...overrides,
  };
}

function body(overrides: Record<string, unknown> = {}) {
  const first = leg();
  const second = leg({
    playerId: '22',
    gameId: 'g2',
    market: 'rebounds',
    side: 'under',
    line: 8.5,
    oddsAmerican: -110,
    display: {
      ...(first.display as object),
      playerName: 'Jaylen Brown',
    },
  });
  return {
    status: 'ok',
    emptyReason: null,
    sportsbook: 'draftkings',
    range: { minAmerican: -110, maxAmerican: 125 },
    policy: { mode: 'research_snapshot', asOf: GENERATED_AT },
    priceNotice: 'Calculated combined odds are the product of the two leg prices. They are not a sportsbook parlay quote.',
    games: [
      { gameId: 'g1', upcoming: true, eligiblePullRunId: 'pull-1', rejection: null, newerUnsuccessfulAttempt: null, stalePullRunId: null },
      {
        gameId: 'g2',
        upcoming: true,
        eligiblePullRunId: 'pull-1',
        rejection: null,
        newerUnsuccessfulAttempt: { pullRunId: 'pull-9', status: 'error', rowsStored: 0, kind: 'failed' },
        stalePullRunId: null,
      },
    ],
    builds: [
      {
        id: 'build-1',
        combinedAmerican: 125,
        breakEvenProbability: 0.444,
        distanceToMidpoint: 0.1,
        oldestObservedAt: OBSERVED_AT,
        newestObservedAt: OBSERVED_AT,
        maxAgeMs: 5_400_000,
        legs: [first, second],
      },
    ],
    generatedAt: GENERATED_AT,
    preset: 'balanced',
    snapshotClass: 'research_snapshot',
    limitations: [
      "Research snapshot of the latest complete pregame pull on today's unstarted slate. It is not a current sportsbook quote.",
      'Calculated combined odds are the product of the two leg prices. They are not a sportsbook parlay quote.',
    ],
    ...overrides,
  };
}

function viewOf(payload: unknown): QuickBuildPreviewView {
  const view = parseQuickBuildResponse(payload);
  expect(view).not.toBeNull();
  if (!view) throw new Error('expected a preview view');
  return view;
}

function markup(view: QuickBuildPreviewView): string {
  return renderToStaticMarkup(createElement(QuickBuildsResults, { view }));
}

function panelTag(html: string, name: 'mine' | 'quick'): string {
  const marker = `data-workspace-panel="${name}"`;
  const at = html.indexOf(marker);
  const start = html.lastIndexOf('<div', at);
  return html.slice(start, html.indexOf('>', at) + 1);
}

describe('quick builds preview contract', () => {
  it('offers the four canonical books and three existing preset keys', () => {
    expect(QUICK_BUILD_BOOK_OPTIONS.map((book) => book.vendor)).toEqual(['draftkings', 'fanduel', 'betmgm', 'caesars']);
    expect(QUICK_BUILD_PAYOUT_OPTIONS.map((option) => option.preset)).toEqual(['higher_hit_chance', 'balanced', 'higher_payout']);
    expect(presetApiKey('Lower Payout')).toBe('higher_hit_chance');
    expect(presetApiKey('Balanced')).toBe('balanced');
    expect(presetApiKey('Higher Payout')).toBe('higher_payout');
    expect(presetRange('higher_hit_chance')).toEqual(QUICK_BUILD_PRESETS.higher_hit_chance);
    expect(presetRange('balanced')).toEqual({ minAmerican: -110, maxAmerican: 125 });
    expect(presetRange('higher_payout')).toEqual({ minAmerican: 125, maxAmerican: 200 });
    expect(initialPreviewModel()).toMatchObject({ sportsbook: 'draftkings', preset: 'balanced', phase: 'idle', view: null });
  });

  it('formats schedule and observation times in America/New_York', () => {
    expect(formatEtTimestamp(GAME_START)).toBe('Nov 9, 7:30 PM EST');
    expect(formatEtTimestamp(OBSERVED_AT)).toBe('Nov 9, 4:00 PM EST');
    expect(formatEtTimestamp(GENERATED_AT)).toBe('Nov 9, 5:00 PM EST');
    expect(formatObservationAge(5_400_000)).toBe('1 hour 30 minutes');
    expect(formatObservationAge(60_000)).toBe('1 minute');
  });

  it('renders a display-ready build from the API fields', () => {
    const view = viewOf(body());
    const html = markup(view);
    expect(view.builds[0]?.handoff?.[0]).toMatchObject({
      playerId: '11',
      playerName: 'Jayson Tatum',
      oddsAmerican: -115,
      observedAt: OBSERVED_AT,
      gameStartTime: GAME_START,
    });
    expect(view.builds[0]?.handoff?.[1]?.playerName).toBe('Jaylen Brown');
    expect(html).toContain('Jayson Tatum');
    expect(html).toContain('Jaylen Brown');
    expect(html).toContain('Points Over 22.5');
    expect(html).toContain('-115');
    expect(html).toContain('Rebounds Under 8.5');
    expect(html).toContain('Game start Nov 9, 7:30 PM EST');
    expect(html).toContain('Snapshot game status: Scheduled');
    expect(html).toContain('Price observed Nov 9, 4:00 PM EST');
    expect(html).toContain('Search generated Nov 9, 5:00 PM EST');
    expect(html).toContain('+125');
    expect(html).toContain('44.4%');
    expect(html).toContain('Age at search: 1 hour 30 minutes');
    expect(html).toContain(QUICK_BUILD_AGE_AT_SEARCH_NOTE);
    expect(html).toContain('Oldest observed Nov 9, 4:00 PM EST');
    expect(html).toContain('Newest observed Nov 9, 4:00 PM EST');
    expect(html).not.toContain('Oldest observation age');
    expect(html).toContain('A later failed pull (pull-9) did not replace the prices used here.');
    expect(html).toContain(QUICK_BUILD_RESEARCH_SNAPSHOT_COPY);
    expect(html).toContain(QUICK_BUILD_COMBINED_ODDS_COPY);
    expect(html).toContain(QUICK_BUILD_BREAK_EVEN_COPY);
    expect(html).toContain('Market-derived no-vig estimate 52.4%');
    expect(html).toContain('Use This Build');
    expect(html).not.toContain('>11<');
    expect(html).not.toContain('>22<');
  });

  it('keeps a display-ready result when team and opponent are absent', () => {
    const html = markup(viewOf(body()));
    expect(html).toContain('Jayson Tatum');
    expect(html).not.toContain('vs ');
    expect(html).not.toContain('not a ticket');
  });

  it('does not present a result as a ticket when display is not ready', () => {
    const payload = body();
    const builds = payload.builds as Array<{ legs: Array<Record<string, unknown>> }>;
    builds[0]!.legs[0] = leg({
      playerId: '999001',
      display: {
        playerName: null,
        gameStartTime: null,
        gameStatus: null,
        teamAbbreviation: null,
        opponentAbbreviation: null,
        homeAway: null,
        displayReady: false,
        unavailableReason: 'MISSING_PLAYER',
      },
    });
    const html = markup(viewOf(payload));
    expect(html).toContain('Player name unavailable');
    expect(html).toContain('not a ticket');
    expect(html).not.toContain('999001');
    expect(html).not.toContain('Calculated combined odds');
    expect(html).not.toContain('Use This Build');
  });

  it('keeps a display-ready build visible without a handoff when the adapter rejects it', () => {
    const patches = [{ market: 'winner' }, { sportsbook: 'pinnacle' }, { oddsAmerican: 50 }];
    for (const patch of patches) {
      const payload = body();
      const builds = payload.builds as Array<{ legs: Array<Record<string, unknown>> }>;
      builds[0]!.legs[1] = { ...builds[0]!.legs[1], ...patch };
      const view = viewOf(payload);
      expect(view.builds[0]?.displayReady).toBe(true);
      expect(view.builds[0]?.handoff).toBeNull();
      const html = markup(view);
      expect(html).toContain('Jayson Tatum');
      expect(html).toContain('Jaylen Brown');
      expect(html).toContain('Calculated combined odds');
      expect(html).toContain(QUICK_BUILD_UNAVAILABLE_TITLE);
      expect(html).toContain(QUICK_BUILD_UNAVAILABLE_COPY);
      expect(html).not.toContain('Use This Build');
      expect(html).not.toContain('999001');
    }
  });

  it('keeps a structurally valid expired game available for the click-time tip check', () => {
    const payload = body();
    const builds = payload.builds as Array<{ legs: Array<{ display: Record<string, unknown> }> }>;
    builds[0]!.legs[1]!.display = { ...builds[0]!.legs[1]!.display, gameStartTime: '2026-11-09T17:00:00.000Z' };
    const view = viewOf(payload);
    expect(view.builds[0]?.handoff).not.toBeNull();
    expect(markup(view)).toContain('Use This Build');
  });

  it('uses the five empty reasons and does not treat them as a server failure', () => {
    const reasons = Object.keys(QUICK_BUILD_EMPTY_COPY) as QuickBuildEmptyReason[];
    expect(reasons).toEqual([
      'NO_UPCOMING_GAMES',
      'NO_SUCCESSFUL_PULL',
      'NO_ELIGIBLE_MARKETS',
      'NO_CROSS_GAME',
      'NO_PAIRS_IN_BAND',
      'NO_COMBINATIONS_IN_BAND',
      'SEARCH_BUDGET_REACHED',
    ]);
    for (const reason of reasons) {
      const html = markup(viewOf(body({ status: 'empty', emptyReason: reason, builds: [] })));
      const decoded = html.replace(/&#x27;|&#39;/g, "'");
      expect(decoded).toContain(QUICK_BUILD_EMPTY_COPY[reason]);
      expect(html).toContain(`data-empty-reason="${reason}"`);
      expect(html).not.toContain('Jayson Tatum');
    }
  });

  it('rejects a malformed payload instead of inventing a build', () => {
    expect(parseQuickBuildResponse({ status: 'ok' })).toBeNull();
    expect(parseQuickBuildResponse(body({ builds: [{ id: 'x' }] }))).toBeNull();
    const idle = renderToStaticMarkup(createElement(QuickBuildsStatus, { model: initialPreviewModel() }));
    expect(idle).toContain('Nothing is requested until you do.');
    const loading = renderToStaticMarkup(
      createElement(QuickBuildsStatus, { model: { ...initialPreviewModel(), phase: 'loading' } }),
    );
    expect(loading).toContain('Finding Quick Builds…');
    const failed = renderToStaticMarkup(
      createElement(QuickBuildsStatus, {
        model: { ...initialPreviewModel(), phase: 'error', message: 'Quick Builds could not be loaded. This is not an empty market.' },
      }),
    );
    expect(failed).toContain('not an empty market');
    expect(failed).not.toContain(QUICK_BUILD_EMPTY_COPY.NO_PAIRS_IN_BAND);
  });

  it('keeps the Lower Payout empty response and suggests another range', () => {
    const view = viewOf(body({ status: 'empty', emptyReason: 'NO_PAIRS_IN_BAND', builds: [] }));
    expect(view.emptyReason).toBe('NO_PAIRS_IN_BAND');
    expect(view.builds).toEqual([]);
    expect(lowerPayoutEmptySuggestion('higher_hit_chance', 'NO_PAIRS_IN_BAND')).toBe(
      QUICK_BUILD_LOWER_PAYOUT_EMPTY_SUGGESTION,
    );
    expect(lowerPayoutEmptySuggestion('balanced', 'NO_PAIRS_IN_BAND')).toBeNull();
    expect(lowerPayoutEmptySuggestion('higher_payout', 'NO_PAIRS_IN_BAND')).toBeNull();
    expect(lowerPayoutEmptySuggestion('higher_hit_chance', 'NO_ELIGIBLE_MARKETS')).toBeNull();

    const html = renderToStaticMarkup(
      createElement(QuickBuildsStatus, {
        model: { ...initialPreviewModel(), preset: 'higher_hit_chance', phase: 'ready', view },
      }),
    );
    expect(html).toContain(QUICK_BUILD_EMPTY_COPY.NO_PAIRS_IN_BAND);
    expect(html).toContain(QUICK_BUILD_LOWER_PAYOUT_EMPTY_SUGGESTION);
    expect(html).toContain('data-empty-reason="NO_PAIRS_IN_BAND"');
    expect(html.toLowerCase()).not.toContain('higher probability');
    expect(html.toLowerCase()).not.toContain('more likely');
    expect(html).not.toContain('Jayson Tatum');

    const balanced = renderToStaticMarkup(
      createElement(QuickBuildsStatus, {
        model: { ...initialPreviewModel(), preset: 'balanced', phase: 'ready', view },
      }),
    );
    expect(balanced).toContain(QUICK_BUILD_EMPTY_COPY.NO_PAIRS_IN_BAND);
    expect(balanced).not.toContain(QUICK_BUILD_LOWER_PAYOUT_EMPTY_SUGGESTION);
  });

  it('leaves a stored search age unchanged after the result is kept on screen', () => {
    const view = viewOf(body());
    const first = markup(view);
    const later = markup(view);
    expect(later).toBe(first);
    expect(later).toContain('Age at search: 1 hour 30 minutes');
    expect(later).toContain('Price observed Nov 9, 4:00 PM EST');
    expect(later).toContain('Search generated Nov 9, 5:00 PM EST');
    expect(later).toContain(QUICK_BUILD_AGE_AT_SEARCH_NOTE);
    expect(view.builds[0]?.handoff?.[0]?.observedAt).toBe(OBSERVED_AT);
  });

  it('caps the rendered shortlist at five builds', () => {
    const builds = Array.from({ length: 6 }, (_, index) => ({
      ...(body().builds as object[])[0],
      id: `build-${index + 1}`,
    }));
    const view = viewOf(body({ builds }));
    expect(view.builds).toHaveLength(5);
    expect(markup(view)).toContain('Build 5');
    expect(markup(view)).not.toContain('Build 6');
  });
});

describe('quick builds request lifecycle', () => {
  it('calls the existing GET route only with the selected book and preset', async () => {
    const urls: string[] = [];
    const result = await fetchQuickBuilds({
      sportsbook: 'fanduel',
      preset: 'higher_hit_chance',
      fetchImpl: async (input, init) => {
        urls.push(String(input));
        expect(init?.method).toBe('GET');
        return Response.json(body({ sportsbook: 'fanduel', preset: 'higher_hit_chance' }));
      },
    });
    expect(urls).toEqual([previewRequestPath('fanduel', 'higher_hit_chance')]);
    expect(urls[0]).not.toContain('asOf');
    expect(result.kind).toBe('ok');
  });

  it('classifies authentication, data-limit, server, network, and malformed failures', async () => {
    const fetchStatus = (status: number, payload: unknown = {}) =>
      fetchQuickBuilds({
        sportsbook: 'draftkings',
        preset: 'balanced',
        fetchImpl: async () => Response.json(payload, { status }),
      });
    expect((await fetchStatus(401)).kind).toBe('unauthorized');
    expect((await fetchStatus(400)).kind).toBe('invalid');
    expect((await fetchStatus(422, { error: 'limit', code: 'LIMIT_EXCEEDED' })).kind).toBe('limit');
    expect((await fetchStatus(500, { error: 'Quick builds unavailable' })).kind).toBe('server');
    expect(
      (
        await fetchQuickBuilds({
          sportsbook: 'draftkings',
          preset: 'balanced',
          fetchImpl: async () => {
            throw new Error('socket hang up');
          },
        })
      ).kind,
    ).toBe('network');
    expect((await fetchStatus(200, { status: 'ok', builds: [] })).kind).toBe('malformed');
    expect(
      (
        await fetchQuickBuilds({
          sportsbook: 'draftkings',
          preset: 'balanced',
          fetchImpl: async () => {
            throw Object.assign(new Error('aborted'), { name: 'AbortError' });
          },
        })
      ).kind,
    ).toBe('aborted');
  });

  it('drops a stale response after the payout target changes', () => {
    let state = initialPreviewModel();
    const started = beginPreviewRequest(state);
    state = started.state;
    const stale = { requestId: started.requestId, sportsbook: state.sportsbook, preset: state.preset };
    state = invalidatePreview(state, { preset: 'higher_payout' });
    const after = acceptPreviewResult(state, stale, { kind: 'ok', view: viewOf(body()) });
    expect(after).toBe(state);
    expect(after.view).toBeNull();
    expect(after.preset).toBe('higher_payout');
    expect(after.phase).toBe('idle');
  });

  it('clears an existing result when the sportsbook changes', () => {
    const started = beginPreviewRequest(initialPreviewModel());
    const ready: PreviewModel = { ...started.state, phase: 'ready', view: viewOf(body()) };
    const next = invalidatePreview(ready, { sportsbook: 'caesars' });
    expect(next.view).toBeNull();
    expect(next.phase).toBe('idle');
    expect(next.sportsbook).toBe('caesars');
    expect(next.requestId).toBeGreaterThan(ready.requestId);
  });
});

describe('workspace quick builds mode', () => {
  const calls = { remove: 0, clear: 0, analyze: 0 };

  function renderWorkspace(
    workspaceMode?: 'mine' | 'quick',
    legs: SelectedParlayLeg[] = [],
    initialQuickModel?: PreviewModel,
  ) {
    return renderToStaticMarkup(
      createElement(ParlayWorkspaceView, {
        legs,
        explorerHref: '/betting/props-explorer',
        onRemove: () => {
          calls.remove += 1;
        },
        onClear: () => {
          calls.clear += 1;
        },
        eligibility: { status: 'UNAVAILABLE', reasons: [] },
        analysis: null,
        analysisBusy: false,
        analysisError: null,
        showingResults: false,
        onAnalyze: () => {
          calls.analyze += 1;
        },
        onShowReview: () => undefined,
        workspaceMode,
        initialQuickModel,
      }),
    );
  }

  it('keeps My Parlay as the default and opens Quick Builds without a selected leg', () => {
    const mine = renderWorkspace();
    expect(mine).toContain('My Parlay');
    expect(mine).toContain('Your parlay is empty.');
    expect(mine).toContain('aria-selected="true"');
    expect(panelTag(mine, 'quick')).toContain('hidden');
    expect(panelTag(mine, 'mine')).not.toContain('hidden');

    const quick = renderWorkspace('quick');
    expect(quick).toContain('Find Quick Builds');
    expect(quick).toContain('Find possible parlay combinations without manually researching every player.');
    expect(quick).toContain('Lower Payout');
    expect(quick).toContain('Balanced');
    expect(quick).toContain('Higher Payout');
    expect(quick).toContain(QUICK_BUILD_PRESET_EXPLANATION);
    expect(QUICK_BUILD_PRESET_EXPLANATION.toLowerCase()).not.toContain('higher probability');
    expect(QUICK_BUILD_PRESET_EXPLANATION.toLowerCase()).not.toContain('more likely');
    expect(QUICK_BUILD_LOWER_PAYOUT_EMPTY_SUGGESTION.toLowerCase()).not.toContain('probability');
    expect(panelTag(quick, 'mine')).toContain('hidden');
    expect(panelTag(quick, 'quick')).not.toContain('hidden');

    const restored = renderWorkspace('mine');
    expect(restored).toContain('Your parlay is empty.');
    expect(panelTag(restored, 'quick')).toContain('hidden');
    expect(restored).toContain('Find Quick Builds');
  });

  it('leaves the current ticket in place while Quick Builds is open', () => {
    const adapted = adaptPropsExplorerOffer({
      playerId: 203999,
      playerName: 'Nikola Jokic',
      gameId: 'game-den-okc',
      propType: 'points',
      side: 'over',
      lineValue: 27.5,
      sportsbook: 'DraftKings',
      oddsAmerican: -110,
      snapshotAt: '2026-03-17T16:50:00.000Z',
      marketContext: 'historical',
      sourceTable: 'research.prop_decision_lines',
    });
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    const legs: SelectedParlayLeg[] = [{ offer: adapted.offer, gameLabel: 'OKC vs DEN' }];
    const mine = renderWorkspace('mine', legs);
    expect(mine).toContain('Nikola Jokic');
    expect(mine).toContain('True cost');
    const quick = renderWorkspace('quick', legs);
    expect(quick).toContain('Find Quick Builds');
    expect(quick).toContain('Nikola Jokic');
    expect(quick).toContain('hidden=""');
    expect(calls).toEqual({ remove: 0, clear: 0, analyze: 0 });
  });

  it('renders a transferred Quick Build start time instead of Matchup unavailable', () => {
    const start = '2026-11-10T00:30:00.000Z';
    const handoffLeg = (overrides: Partial<QuickBuildHandoffLeg>): QuickBuildHandoffLeg => ({
      displayReady: true,
      playerId: '11',
      playerName: 'Jayson Tatum',
      gameId: 'g1',
      market: 'points',
      side: 'over',
      line: 22.5,
      sportsbook: 'draftkings',
      oddsAmerican: -115,
      observedAt: '2026-11-09T16:00:00.000Z',
      gameStartTime: start,
      gameStatus: 'Scheduled',
      ...overrides,
    });
    const result = handoffQuickBuildSelection({
      current: [],
      legs: [
        handoffLeg({}),
        handoffLeg({ playerId: '22', playerName: 'Jaylen Brown', gameId: 'g2', market: 'rebounds' }),
      ],
      nowMs: Date.parse('2026-11-09T18:00:00.000Z'),
      confirmed: false,
    });
    expect(result.status).toBe('replaced');
    if (result.status !== 'replaced') return;
    const label = quickBuildGameStartLine(start);
    expect(label).toBe('Game start Nov 9, 7:30 PM EST');
    const html = renderWorkspace('mine', [...result.legs]);
    expect(html).toContain('Jayson Tatum');
    expect(html).toContain('Jaylen Brown');
    expect(html).toContain(label!);
    expect(html).not.toContain('Matchup unavailable');
  });

  it('keeps generated cards in the hidden Quick Builds panel', () => {
    const model: PreviewModel = { ...initialPreviewModel(), phase: 'ready', view: viewOf(body()) };
    const mine = renderWorkspace('mine', [], model);
    expect(mine).toContain('Jayson Tatum');
    expect(mine).toContain('Jaylen Brown');
    expect(mine).toContain('Age at search: 1 hour 30 minutes');
    expect(mine).toContain('Price observed Nov 9, 4:00 PM EST');
    expect(mine).toContain(QUICK_BUILD_AGE_AT_SEARCH_NOTE);
    expect(panelTag(mine, 'quick')).toContain('hidden');
    const quick = renderWorkspace('quick', [], model);
    expect(quick).toContain('Jayson Tatum');
    expect(panelTag(quick, 'quick')).not.toContain('hidden');
  });

  it('renders the replacement confirmation without changing the ticket', () => {
    const html = renderToStaticMarkup(
      createElement(QuickBuildReplaceDialog, {
        pending: true,
        onCancel: () => undefined,
        onConfirm: () => undefined,
      }),
    );
    expect(html).toContain('Cancel');
    expect(html).toContain('Replace My Parlay');
    expect(html).toContain(QUICK_BUILD_REPLACE_COPY);
    expect(html).toContain('aria-labelledby="quick-build-replace-title"');
  });

  it('keeps the handoff button out of the parser and the store out of the preview', () => {
    const preview = readFileSync('components/parlay-workspace/QuickBuildsPreview.tsx', 'utf8');
    const client = readFileSync('lib/quick-builds/preview.ts', 'utf8');
    expect(preview).toContain('Use This Build');
    expect(client).not.toContain('Use This Build');
    for (const source of [preview, client]) {
      expect(source).not.toContain('replaceParlaySelectionLegs');
      expect(source).not.toContain('addExplorerOfferToSelection');
      expect(source).not.toContain('clearSelectedLegs');
    }
  });
});

describe('quick builds analytics lifecycle', () => {
  function acceptedSearch(input: {
    sportsbook?: 'draftkings' | 'fanduel' | 'betmgm' | 'caesars';
    preset?: 'higher_hit_chance' | 'balanced' | 'higher_payout';
    result: Parameters<typeof acceptPreviewResult>[2];
    ageMs?: number | null;
  }) {
    const started = beginPreviewRequest({
      ...initialPreviewModel(),
      sportsbook: input.sportsbook ?? 'draftkings',
      preset: input.preset ?? 'balanced',
    });
    const captured = {
      requestId: started.requestId,
      sportsbook: started.state.sportsbook,
      preset: started.state.preset,
    };
    const accepted = acceptPreviewResult(started.state, captured, input.result);
    return quickBuildsSearchEvent({
      accepted: accepted !== started.state,
      sportsbook: captured.sportsbook,
      preset: captured.preset,
      kind: input.result.kind === 'ineligible' || input.result.kind === 'need_two' || input.result.kind === 'need_three' ? 'invalid' : input.result.kind,
      buildCount: input.result.kind === 'ok' ? input.result.view.builds.length : 0,
      emptyReason: input.result.kind === 'empty' ? input.result.view.emptyReason : null,
      ageMs: input.result.kind === 'ok' ? (input.ageMs ?? null) : null,
    });
  }

  it('emits one event for an accepted nonempty search and keeps that search attribution', () => {
    const payload = body({ sportsbook: 'fanduel', preset: 'higher_payout' });
    const event = acceptedSearch({
      sportsbook: 'fanduel',
      preset: 'higher_payout',
      result: { kind: 'ok', view: viewOf(payload) },
      ageMs: oldestShortlistAgeMs(payload),
    });
    expect(event).toEqual({
      sportsbook: 'fanduel',
      preset: 'higher_payout',
      leg_count: 2,
      result: 'success',
      build_count: 1,
      age_bucket: '1_3h',
    });
  });

  it('emits one event for an accepted empty search', () => {
    const empty = body({ status: 'empty', emptyReason: 'NO_PAIRS_IN_BAND', builds: [] });
    expect(
      acceptedSearch({
        sportsbook: 'caesars',
        preset: 'higher_hit_chance',
        result: { kind: 'empty', view: viewOf(empty) },
        ageMs: 60_000,
      }),
    ).toEqual({
      sportsbook: 'caesars',
      preset: 'higher_hit_chance',
      leg_count: 2,
      result: 'empty',
      build_count: 0,
      empty_reason: 'NO_PAIRS_IN_BAND',
      age_bucket: 'unknown',
    });
  });

  it('emits one event for an accepted terminal error', () => {
    expect(acceptedSearch({ result: { kind: 'server' } })).toEqual({
      sportsbook: 'draftkings',
      preset: 'balanced',
      leg_count: 2,
      result: 'error',
      build_count: 0,
      age_bucket: 'unknown',
    });
    expect(acceptedSearch({ result: { kind: 'network' } })?.result).toBe('error');
  });

  it('does not emit for an aborted or stale response', () => {
    expect(acceptedSearch({ result: { kind: 'aborted' } })).toBeNull();
    let state = initialPreviewModel();
    const started = beginPreviewRequest(state);
    state = started.state;
    const stale = { requestId: started.requestId, sportsbook: state.sportsbook, preset: state.preset };
    state = invalidatePreview(state, { preset: 'higher_payout' });
    const after = acceptPreviewResult(state, stale, { kind: 'ok', view: viewOf(body()) });
    expect(after).toBe(state);
    expect(
      quickBuildsSearchEvent({
        accepted: after !== state,
        sportsbook: stale.sportsbook,
        preset: 'balanced',
        kind: 'ok',
        buildCount: 1,
        emptyReason: null,
        ageMs: 0,
      }),
    ).toBeNull();
  });

  it('emits one handoff event only after replacement, using the search that created the build', () => {
    const search = { sportsbook: 'betmgm', preset: 'balanced' } as const;
    expect(quickBuildsHandoffEvent({ status: 'needs_confirmation', ...search })).toBeNull();
    expect(quickBuildsHandoffEvent({ status: 'canceled', ...search })).toBeNull();
    expect(quickBuildsHandoffEvent({ status: 'rejected', ...search })).toBeNull();
    expect(quickBuildsHandoffEvent({ status: 'tipped', ...search })).toBeNull();
    expect(quickBuildsHandoffEvent({ status: 'replaced', ...search })).toEqual({
      ...search,
      leg_count: 2,
      result: 'successful_handoff',
    });
    expect(quickBuildsHandoffEvent({ status: 'replaced', sportsbook: 'betmgm', preset: 'higher_payout' })).toMatchObject({
      preset: 'higher_payout',
    });
  });

  it('wires search and handoff tracking to the accepted transitions only', () => {
    const source = readFileSync('components/parlay-workspace/QuickBuildsPreview.tsx', 'utf8');
    expect(source.match(/trackEvent\(/g)).toHaveLength(2);
    const findBody = source.slice(source.indexOf('function find()'), source.indexOf('function applyBuild'));
    expect(findBody.indexOf('fetchQuickBuilds')).toBeGreaterThan(-1);
    expect(findBody.indexOf('acceptPreviewResult')).toBeGreaterThan(findBody.indexOf('fetchQuickBuilds'));
    expect(findBody.indexOf('trackEvent')).toBeGreaterThan(findBody.indexOf('acceptPreviewResult'));
    expect(findBody).toContain('accepted !== current');
    expect(findBody).toContain('acceptedSearchRef.current = { sportsbook: captured.sportsbook, preset: captured.preset, legCount: captured.legCount }');
    const applyBody = source.slice(source.indexOf('function applyBuild'), source.indexOf('function cancelReplace'));
    expect(applyBody.indexOf("result.status === 'needs_confirmation'")).toBeLessThan(applyBody.indexOf('trackEvent'));
    expect(applyBody).toContain("result.status === 'replaced'");
    expect(source).toContain('applyBuild(pending.legs, true, pending.attribution)');
    expect(source.slice(source.indexOf('function cancelReplace'), source.indexOf('useEffect(() => {'))).not.toContain('trackEvent');
    const modeBody = source.slice(source.indexOf('export function WorkspaceModeSwitch'), source.indexOf('function ModeButton'));
    expect(modeBody).not.toContain('trackEvent');
    const abortEffect = source.slice(source.indexOf('abortRef.current?.abort()'), source.indexOf('function commit'));
    const dialogEffect = source.slice(source.indexOf('useEffect(() => {'), source.indexOf('}, [pending]);'));
    expect(abortEffect).not.toContain('trackEvent');
    expect(dialogEffect).not.toContain('trackEvent');
    const toggleBody = source.slice(source.indexOf('function toggleGame'), source.indexOf('function find'));
    expect(toggleBody).not.toContain('fetchQuickBuilds');
    expect(toggleBody).not.toContain('loadSlate');
    expect(source).not.toContain('quick_builds_search_requested');
  });
});

describe('quick builds game selection', () => {
  function picker(model: PreviewModel): string {
    return renderToStaticMarkup(createElement(QuickBuildsPreview, { model, onModelChange: () => undefined }));
  }

  const slateGame = {
    gameId: '101',
    startTime: '2026-11-10T00:00:00.000Z',
    label: 'LAL @ DEN',
    startLabel: 'Nov 9, 7:00 PM EST',
  };

  it('defaults to All Games and sends no game ids', () => {
    expect(initialPreviewModel().scope).toBe('all');
    expect(initialPreviewModel().selectedGameIds).toEqual([]);
    const html = picker(initialPreviewModel());
    expect(html).toContain('All Games');
    expect(html).toContain('Select Games');
    expect(html).not.toContain('games selected');
    expect(previewRequestPath('draftkings', 'balanced')).not.toContain('games=');
    expect(searchBlockReason(initialPreviewModel())).toBeNull();
  });

  it('selects and clears games, counts them, and requires two before search', () => {
    expect(toggleSelectedGame([], '102')).toEqual(['102']);
    expect(toggleSelectedGame(['102'], '101')).toEqual(['101', '102']);
    expect(toggleSelectedGame(['101', '102'], '101')).toEqual(['102']);
    const selected = {
      ...initialPreviewModel(),
      scope: 'select' as const,
      slatePhase: 'ready' as const,
      slateGames: [slateGame, { ...slateGame, gameId: '102', label: 'NYK @ BOS' }],
      selectedGameIds: ['101', '102'],
    };
    const html = picker(selected);
    expect(html).toContain('2 games selected');
    expect(html).toContain('LAL @ DEN');
    expect(html).toContain('NYK @ BOS');
    expect(html).toContain('max-h-64');
    expect(html).toContain('min-h-11');
    expect(html).toContain('type="checkbox"');
    expect(searchBlockReason(selected)).toBeNull();
    expect(previewRequestPath('draftkings', 'balanced', selected.selectedGameIds)).toContain('games=101%2C102');

    const one = { ...selected, selectedGameIds: ['101'] };
    expect(searchBlockReason(one)).toBe(QUICK_BUILD_SELECT_TWO_COPY);
    expect(picker(one)).toContain('disabled');
    const cleared = invalidatePreview(selected, { scope: 'all', selectedGameIds: [] });
    expect(cleared.scope).toBe('all');
    expect(cleared.selectedGameIds).toEqual([]);
    expect(cleared.view).toBeNull();
  });

  it('explains an empty slate, a one-game slate, and a missing matchup name', () => {
    const none = { ...initialPreviewModel(), scope: 'select' as const, slatePhase: 'ready' as const, slateGames: [] };
    expect(searchBlockReason(none)).toBe(QUICK_BUILD_NO_GAMES_COPY);
    const only = { ...none, slateGames: [{ ...slateGame, label: null }] };
    expect(searchBlockReason(only)).toBe(QUICK_BUILD_ONE_GAME_COPY);
    expect(picker(only)).toContain(QUICK_BUILD_MATCHUP_UNAVAILABLE);
    expect(picker(only)).toContain(slateGame.startLabel);
  });

  it('drops a result when the game scope changes and rejects a stale scope', () => {
    const ready: PreviewModel = {
      ...initialPreviewModel(),
      phase: 'ready',
      view: viewOf(body()),
      scope: 'select',
      selectedGameIds: ['101', '102'],
    };
    const changed = invalidatePreview(ready, { selectedGameIds: ['101', '103'] });
    expect(changed.view).toBeNull();
    expect(changed.phase).toBe('idle');
    const started = beginPreviewRequest(changed);
    const stale = acceptPreviewResult(
      { ...started.state, selectedGameIds: ['101', '104'] },
      {
        requestId: started.requestId,
        sportsbook: 'draftkings',
        preset: 'balanced',
        scopeKey: previewScopeKey('select', ['101', '103']),
      },
      { kind: 'ok', view: viewOf(body()) },
    );
    expect(stale.view).toBeNull();
    expect(stale).toMatchObject({ selectedGameIds: ['101', '104'] });
  });

  it('maps an ineligible game response to a refresh message and parses the slate', async () => {
    const result = await fetchQuickBuilds({
      sportsbook: 'draftkings',
      preset: 'balanced',
      gameIds: ['101', '102'],
      fetchImpl: async () => Response.json({ error: 'Refresh the game selection.', code: 'INELIGIBLE_GAME' }, { status: 409 }),
    });
    expect(result.kind).toBe('ineligible');
    expect(previewErrorMessage('ineligible')).toBe(QUICK_BUILD_REFRESH_GAMES_COPY);
    const games = parseSlateGames({
      games: [
        { gameId: '101', startTime: '2026-11-10T00:00:00.000Z', label: 'LAL @ DEN' },
        { gameId: '102', startTime: '2026-11-10T01:00:00.000Z', label: null },
      ],
    });
    expect(games?.map((game) => game.gameId)).toEqual(['101', '102']);
    expect(games?.[1]?.label).toBeNull();
    expect(parseSlateGames({ games: [{ gameId: 'nope', startTime: '2026-11-10T00:00:00.000Z', label: 'X' }] })).toBeNull();
  });

  it('keeps the quick panel mounted so a mode switch does not drop the selection', () => {
    const source = readFileSync('components/parlay-workspace/ParlayWorkspaceView.tsx', 'utf8');
    expect(source).toContain('hidden={mode !== \'quick\'}');
    expect(source).toContain('useState<PreviewModel>(initialQuickModel ?? initialPreviewModel)');
    expect(source).toContain('<QuickBuildsPreview model={quickModel}');
  });
});
