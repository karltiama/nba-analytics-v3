import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  QuickBuildReplaceDialog,
  QUICK_BUILD_REPLACE_COPY,
  QUICK_BUILD_REPLACE_FOUR_COPY,
  QUICK_BUILD_REPLACE_THREE_COPY,
  QuickBuildsPreview,
  QuickBuildsResults,
} from '@/components/parlay-workspace/QuickBuildsPreview';
import {
  QUICK_BUILD_FOUR_LEG_PAYOUT_OPTIONS,
  QUICK_BUILD_FIVE_LEG_PAYOUT_OPTIONS,
  QUICK_BUILD_NEED_FIVE_GAMES_COPY,
  QUICK_BUILD_NEED_FOUR_GAMES_COPY,
  QUICK_BUILD_NEED_THREE_GAMES_COPY,
  QUICK_BUILD_SELECT_FIVE_COPY,
  QUICK_BUILD_SELECT_FOUR_COPY,
  QUICK_BUILD_PAYOUT_OPTIONS,
  QUICK_BUILD_SELECT_THREE_COPY,
  QUICK_BUILD_THREE_LEG_PAYOUT_OPTIONS,
  acceptPreviewResult,
  beginPreviewRequest,
  initialPreviewModel,
  parseQuickBuildResponse,
  payoutOptionsFor,
  previewRequestPath,
  searchBlockReason,
  selectLegCount,
} from '@/lib/quick-builds/preview';
import { QUICK_BUILD_SEARCH_BUDGET_NOTE as BUDGET_NOTE } from '@/lib/quick-builds/types';

const GENERATED_AT = '2026-11-10T23:06:28.431Z';
const OBSERVED_AT = '2026-11-10T19:00:30.000Z';
const GAME_START = '2026-11-11T00:30:00.000Z';

function leg(playerId: string, name: string, gameId: string, market: string, oddsAmerican: number) {
  return {
    playerId,
    gameId,
    market,
    side: 'over',
    line: 20.5,
    sportsbook: 'draftkings',
    oddsAmerican,
    oppositeAmerican: -110,
    noVigProbability: 0.5,
    pullRunId: '681',
    observedAt: OBSERVED_AT,
    ageMs: 14_758_431,
    display: {
      playerName: name,
      gameStartTime: GAME_START,
      gameStatus: 'Scheduled',
      teamAbbreviation: null,
      opponentAbbreviation: null,
      homeAway: null,
      displayReady: true,
      unavailableReason: null,
    },
  };
}

function threeLegBody() {
  return {
    status: 'ok',
    emptyReason: null,
    sportsbook: 'draftkings',
    range: { minAmerican: 400, maxAmerican: 699 },
    policy: { mode: 'research_snapshot', asOf: GENERATED_AT },
    priceNotice: 'Calculated combined odds are the product of the three leg prices. They are not a sportsbook parlay quote.',
    searchComplete: true,
    games: ['g1', 'g2', 'g3'].map((gameId) => ({
      gameId,
      upcoming: true,
      eligiblePullRunId: '681',
      rejection: null,
      newerUnsuccessfulAttempt: null,
      stalePullRunId: null,
    })),
    builds: [
      {
        id: 'triple-1',
        combinedAmerican: 550,
        breakEvenProbability: 0.1538,
        distanceToMidpoint: 1,
        oldestObservedAt: OBSERVED_AT,
        newestObservedAt: OBSERVED_AT,
        maxAgeMs: 14_758_431,
        legs: [
          leg('11', 'Jayson Tatum', 'g1', 'points', -115),
          leg('22', 'Jaylen Brown', 'g2', 'rebounds', -110),
          leg('33', 'Derrick White', 'g3', 'assists', -105),
        ],
      },
    ],
    generatedAt: GENERATED_AT,
    preset: 'midrange',
    snapshotClass: 'research_snapshot',
    limitations: ['research'],
  };
}

describe('three-leg preview controls', () => {
  it('starts on two legs and changes payout targets without searching', () => {
    const start = initialPreviewModel();
    expect(start.legCount).toBe(2);
    expect(start.preset).toBe('balanced');
    expect(payoutOptionsFor(2)).toEqual(QUICK_BUILD_PAYOUT_OPTIONS);
    const html = renderToStaticMarkup(createElement(QuickBuildsPreview, { model: start, onModelChange: () => undefined }));
    expect(html).toContain('2 Legs');
    expect(html).toContain('3 Legs');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Balanced');
    expect(html).not.toContain('Midrange');
    expect(html).toContain('flex-wrap');

    const next = selectLegCount(start, 3);
    expect(next.legCount).toBe(3);
    expect(next.preset).toBe('midrange');
    expect(next.phase).toBe('idle');
    expect(next.view).toBeNull();
    expect(next.requestId).toBe(start.requestId + 1);
    expect(payoutOptionsFor(3).map((option) => option.label)).toEqual(['Shorter Payout', 'Midrange', 'Longer Payout']);
    expect(QUICK_BUILD_THREE_LEG_PAYOUT_OPTIONS.map((option) => option.rangeLabel)).toEqual([
      '+200 to +399',
      '+400 to +699',
      '+700 to +999',
    ]);
    const three = renderToStaticMarkup(createElement(QuickBuildsPreview, { model: next, onModelChange: () => undefined }));
    expect(three).toContain('Midrange');
    expect(three).toContain('+400 to +699');
    expect(three).not.toContain('Balanced');
  });

  it('requires three selected games and sends legs=3 only for that mode', () => {
    const slate = [
      { gameId: '101', startTime: GAME_START, label: 'BOS @ NYK', startLabel: 'Nov 10, 7:30 PM EST' },
      { gameId: '102', startTime: GAME_START, label: 'MIA @ ORL', startLabel: 'Nov 10, 8:00 PM EST' },
      { gameId: '103', startTime: GAME_START, label: 'DAL @ DEN', startLabel: 'Nov 10, 9:00 PM EST' },
    ];
    const two = { ...initialPreviewModel(), scope: 'select' as const, slatePhase: 'ready' as const, slateGames: slate, selectedGameIds: ['101', '102'] };
    expect(searchBlockReason(two)).toBeNull();
    expect(searchBlockReason({ ...two, legCount: 3, preset: 'midrange' })).toBe(QUICK_BUILD_SELECT_THREE_COPY);
    expect(searchBlockReason({
      ...initialPreviewModel(),
      legCount: 3,
      preset: 'midrange',
      slatePhase: 'ready',
      slateGames: slate.slice(0, 2),
    })).toBe(QUICK_BUILD_NEED_THREE_GAMES_COPY);
    expect(previewRequestPath('draftkings', 'balanced')).not.toContain('legs=');
    expect(previewRequestPath('draftkings', 'midrange', ['101', '102', '103'], 3)).toBe(
      '/api/parlay-workspace/quick-builds?sportsbook=draftkings&preset=midrange&legs=3&games=101%2C102%2C103',
    );
  });

  it('renders three legs and ignores a stale response from the other mode', () => {
    const view = parseQuickBuildResponse(threeLegBody());
    expect(view).not.toBeNull();
    expect(view?.builds[0]?.legs).toHaveLength(3);
    expect(view?.builds[0]?.handoff).toHaveLength(3);
    const html = renderToStaticMarkup(createElement(QuickBuildsResults, {
      sportsbookLabel: 'DraftKings',
      view: view!,
      suggestion: null,
    }));
    expect(html).toContain('Jayson Tatum');
    expect(html).toContain('Jaylen Brown');
    expect(html).toContain('Derrick White');
    expect(html).toContain('Three-leg');
    expect(html).toContain('-115');
    expect(html).toContain('-110');
    expect(html).toContain('-105');
    expect(html).toContain('+550');
    expect(html).toMatch(/Nov 10/);

    const loading = {
      ...selectLegCount(initialPreviewModel(), 3),
      phase: 'loading' as const,
      requestId: 2,
      view: null,
    };
    const aborted = acceptPreviewResult(
      loading,
      { requestId: 2, sportsbook: 'draftkings', preset: 'midrange', legCount: 3 },
      { kind: 'aborted' },
    );
    expect(aborted.view).toBeNull();
    expect(aborted.phase).toBe('loading');
    const switched = { ...loading, legCount: 2 as const, preset: 'balanced' as const, phase: 'idle' as const };
    const stale = acceptPreviewResult(
      switched,
      { requestId: 2, sportsbook: 'draftkings', preset: 'midrange', legCount: 3 },
      { kind: 'ok', view: view! },
    );
    expect(stale.view).toBeNull();
    expect(stale.legCount).toBe(2);
    expect(stale.preset).toBe('balanced');
    const accepted = acceptPreviewResult(
      loading,
      { requestId: 2, sportsbook: 'draftkings', preset: 'midrange', legCount: 3 },
      { kind: 'ok', view: view! },
    );
    expect(accepted.phase).toBe('ready');
    expect(accepted.view?.builds[0]?.legs).toHaveLength(3);
    expect(beginPreviewRequest(accepted).state.view).toBeNull();
  });

  it('asks to replace a three-leg snapshot and keeps the two-leg copy otherwise', () => {
    const three = renderToStaticMarkup(createElement(QuickBuildReplaceDialog, {
      pending: true,
      legCount: 3,
      onCancel: () => undefined,
      onConfirm: () => undefined,
    }));
    expect(three).toContain(QUICK_BUILD_REPLACE_THREE_COPY);
    expect(three).not.toContain('two-leg');
    const two = renderToStaticMarkup(createElement(QuickBuildReplaceDialog, {
      pending: true,
      onCancel: () => undefined,
      onConfirm: () => undefined,
    }));
    expect(two).toContain(QUICK_BUILD_REPLACE_COPY);
    expect(BUDGET_NOTE).toContain('bounded search');
  });

  it('switches to four and five legs without searching and enforces the game minimum', () => {
    const start = initialPreviewModel();
    const four = selectLegCount(start, 4);
    expect(four.legCount).toBe(4);
    expect(four.preset).toBe('four_middle');
    expect(four.view).toBeNull();
    expect(four.phase).toBe('idle');
    expect(payoutOptionsFor(4)).toEqual(QUICK_BUILD_FOUR_LEG_PAYOUT_OPTIONS);
    expect(previewRequestPath('draftkings', 'four_longer', undefined, 4)).toContain('legs=4');
    expect(previewRequestPath('draftkings', 'balanced')).not.toContain('legs=');
    const html = renderToStaticMarkup(createElement(QuickBuildsPreview, { model: four, onModelChange: () => undefined }));
    expect(html).toContain('4 Legs');
    expect(html).not.toContain('5 Legs');
    expect(html).toContain('+1,000 to +1,399');
    expect(html).not.toContain('Balanced');
    expect(html).toContain('flex-wrap');

    const five = selectLegCount(four, 5);
    expect(five.preset).toBe('five_middle');
    expect(five.view).toBeNull();
    expect(payoutOptionsFor(5).map((option) => option.rangeLabel)).toEqual(QUICK_BUILD_FIVE_LEG_PAYOUT_OPTIONS.map((option) => option.rangeLabel));
    const slate = ['1', '2', '3', '4'].map((gameId) => ({
      gameId,
      startTime: GAME_START,
      label: 'BOS @ NYK',
      startLabel: 'Nov 10, 7:30 PM ET',
    }));
    expect(searchBlockReason({ ...five, scope: 'select', slatePhase: 'ready', slateGames: [...slate, { gameId: '5', startTime: GAME_START, label: 'BOS @ NYK', startLabel: 'Nov 10, 7:30 PM ET' }], selectedGameIds: ['1', '2', '3', '4'] })).toBe(QUICK_BUILD_SELECT_FIVE_COPY);
    expect(searchBlockReason({ ...four, scope: 'select', slatePhase: 'ready', slateGames: slate.slice(0, 3), selectedGameIds: ['1', '2', '3'] })).toBe(QUICK_BUILD_NEED_FOUR_GAMES_COPY);
    expect(searchBlockReason({ ...five, scope: 'all', slatePhase: 'ready', slateGames: slate, selectedGameIds: [] })).toBe(QUICK_BUILD_NEED_FIVE_GAMES_COPY);

    const stale = acceptPreviewResult(
      five,
      { requestId: four.requestId, sportsbook: 'draftkings', preset: 'four_middle', legCount: 4 },
      { kind: 'ok', view: { generatedAtLabel: 'Nov 10', sportsbookLabel: 'DraftKings', emptyReason: null, emptyMessage: null, researchLimitation: null, boundedSearchNote: null, builds: [] } },
    );
    expect(stale.view).toBeNull();
    expect(stale.legCount).toBe(5);
    const dialog = renderToStaticMarkup(createElement(QuickBuildReplaceDialog, {
      pending: true,
      legCount: 4,
      onCancel: () => undefined,
      onConfirm: () => undefined,
    }));
    expect(dialog).toContain(QUICK_BUILD_REPLACE_FOUR_COPY);
    expect(QUICK_BUILD_SELECT_FOUR_COPY).toContain('four');
  });
});
