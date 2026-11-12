// @vitest-environment happy-dom
/**
 * Mocked UI transition. Fetch is stubbed. This file does not sign in,
 * call the live historical-form API, or change authentication.
 */
import { act, createElement, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParlayWorkspaceView } from '@/components/parlay-workspace/ParlayWorkspaceView';
import type { SelectedParlayLeg } from '@/lib/parlay/selection';
import { evaluateWorkspaceAnalysisEligibility } from '@/lib/parlay/workspace-analysis';
import {
  HISTORICAL_PLAYER_FORM_BASIS,
  HISTORICAL_PLAYER_FORM_TITLE,
  RESEARCH_SNAPSHOT_WORKSPACE_NOTE,
  researchSnapshotFormReason,
  type ResearchSnapshotFormRequestLeg,
} from '@/lib/parlay/research-snapshot-form';
import { handoffQuickBuildSelection, type QuickBuildHandoffLegs } from '@/lib/parlay/adapt-quick-build';
import { initialPreviewModel, parseQuickBuildResponse, type PreviewModel } from '@/lib/quick-builds/preview';

const GAME_START = '2026-12-15T00:30:00.000Z';
const GENERATED_AT = '2026-11-09T22:00:00.000Z';
const FIRST_OBSERVED = ['2026-11-09T21:00:00.000Z', '2026-11-09T20:30:00.000Z'] as const;
const NEXT_OBSERVED = ['2026-11-09T15:00:00.000Z', '2026-11-09T14:30:00.000Z'] as const;

type FormCall = {
  url: string;
  method: string;
  body: { legs: ResearchSnapshotFormRequestLeg[] };
  signal: AbortSignal | undefined;
  resolve: (response: Response) => void;
};

const calls: FormCall[] = [];
const unexpected: string[] = [];
let root: Root | null = null;

vi.mock('next/link', async () => {
  const React = await import('react');
  return {
    default: ({ href, children, className }: { href?: string; children?: unknown; className?: string }) =>
      React.createElement('a', { href: href ?? '', className }, children),
  };
});

function Host({ model }: { model: PreviewModel }) {
  const [legs, setLegs] = useState<SelectedParlayLeg[]>([]);
  const eligibility = evaluateWorkspaceAnalysisEligibility(legs, { currentAnalysisEnabled: true });
  return createElement(ParlayWorkspaceView, {
    legs,
    explorerHref: '/betting/props-explorer',
    onRemove: () => undefined,
    onClear: () => setLegs([]),
    eligibility,
    analysis: null,
    analysisBusy: false,
    analysisError: null,
    showingResults: false,
    onAnalyze: () => undefined,
    onShowReview: () => undefined,
    initialQuickModel: model,
    onReplaceQuickBuild: (next: SelectedParlayLeg[]) => setLegs(next),
  });
}

function apiLeg(overrides: Record<string, unknown> = {}) {
  const { display: displayOverride, ...rest } = overrides;
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
    observedAt: FIRST_OBSERVED[0],
    ageMs: 5_400_000,
    ...rest,
    display: {
      playerName: 'Jayson Tatum',
      gameStartTime: GAME_START,
      gameStatus: GAME_START,
      teamAbbreviation: null,
      opponentAbbreviation: null,
      homeAway: null,
      scheduledAwayAbbreviation: 'NYK',
      scheduledHomeAbbreviation: 'BOS',
      displayReady: true,
      unavailableReason: null,
      ...(displayOverride && typeof displayOverride === 'object' ? displayOverride : {}),
    },
  };
}

function previewModel(): PreviewModel {
  const view = parseQuickBuildResponse({
    status: 'ok',
    emptyReason: null,
    sportsbook: 'draftkings',
    range: { minAmerican: -110, maxAmerican: 125 },
    policy: { mode: 'research_snapshot', asOf: GENERATED_AT },
    priceNotice: 'Calculated combined odds are the product of the leg prices. They are not a sportsbook parlay quote.',
    games: ['g1', 'g2', 'g3', 'g4'].map((gameId) => ({
      gameId,
      upcoming: true,
      eligiblePullRunId: 'pull-1',
      rejection: null,
      newerUnsuccessfulAttempt: null,
      stalePullRunId: null,
    })),
    builds: [
      {
        id: 'build-1',
        combinedAmerican: 125,
        breakEvenProbability: 0.444,
        distanceToMidpoint: 0.1,
        oldestObservedAt: FIRST_OBSERVED[1],
        newestObservedAt: FIRST_OBSERVED[0],
        maxAgeMs: 5_400_000,
        legs: [
          apiLeg({}),
          apiLeg({
            playerId: '22',
            gameId: 'g2',
            market: 'rebounds',
            side: 'under',
            line: 8.5,
            oddsAmerican: -110,
            observedAt: FIRST_OBSERVED[1],
            display: {
              playerName: 'Jaylen Brown',
              gameStartTime: GAME_START,
              gameStatus: 'Scheduled',
              teamAbbreviation: null,
              opponentAbbreviation: null,
              homeAway: null,
              displayReady: true,
              unavailableReason: null,
            },
          }),
        ],
      },
      {
        id: 'build-2',
        combinedAmerican: 140,
        breakEvenProbability: 0.417,
        distanceToMidpoint: 0.2,
        oldestObservedAt: NEXT_OBSERVED[1],
        newestObservedAt: NEXT_OBSERVED[0],
        maxAgeMs: 5_400_000,
        legs: [
          apiLeg({
            playerId: '55',
            gameId: 'g3',
            line: 12.5,
            oddsAmerican: -105,
            observedAt: NEXT_OBSERVED[0],
            display: {
              playerName: 'Payton Pritchard',
              gameStartTime: GAME_START,
              gameStatus: 'Scheduled',
              teamAbbreviation: null,
              opponentAbbreviation: null,
              homeAway: null,
              displayReady: true,
              unavailableReason: null,
            },
          }),
          apiLeg({
            playerId: '66',
            gameId: 'g4',
            market: 'rebounds',
            side: 'under',
            line: 4.5,
            oddsAmerican: 120,
            observedAt: NEXT_OBSERVED[1],
            display: {
              playerName: 'Sam Hauser',
              gameStartTime: GAME_START,
              gameStatus: 'Scheduled',
              teamAbbreviation: null,
              opponentAbbreviation: null,
              homeAway: null,
              displayReady: true,
              unavailableReason: null,
            },
          }),
        ],
      },
    ],
    generatedAt: GENERATED_AT,
    preset: 'balanced',
    snapshotClass: 'research_snapshot',
    limitations: ['Research snapshot of stored pregame prices. It is not a current sportsbook quote.'],
  });
  if (!view?.builds[0]?.handoff || !view.builds[1]?.handoff) throw new Error('preview fixture did not produce two handoffs');
  return { ...initialPreviewModel(), phase: 'ready', view };
}

function installFetch() {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes('/api/parlay-workspace/research-snapshot-form')) {
      unexpected.push(`${init?.method ?? 'GET'} ${url}`);
      return Promise.resolve(new Response('{}', { status: 500 }));
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as { legs: ResearchSnapshotFormRequestLeg[] };
    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal ?? undefined;
      calls.push({ url, method: init?.method ?? 'GET', body, signal, resolve });
      const abort = () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  });
}

function panel(name: 'mine' | 'quick'): HTMLElement {
  const node = document.querySelector(`[data-workspace-panel="${name}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`${name} panel missing`);
  return node;
}

function selectedTab(): string {
  return document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() ?? '';
}

const FULL_ANALYSIS_PLACEHOLDERS = [
  'Evidence alignment appears when Court Context analysis is available.',
  'Projection, role, relationships, and data coverage appear after analysis.',
  'Shared groups appear after analysis.',
  'Risk notes appear after analysis.',
  'Run Court Context',
  'Season avg',
  'Projection',
  'View Context',
  'Needs Review',
  'Current contextual analysis is unavailable for a Research Snapshot.',
];

function expectSnapshotResearchLayout(ticket: HTMLElement) {
  const text = ticket.textContent ?? '';
  const costAt = text.indexOf('True cost');
  const noteAt = text.indexOf(RESEARCH_SNAPSHOT_WORKSPACE_NOTE);
  const formAt = text.indexOf(HISTORICAL_PLAYER_FORM_TITLE);
  expect(costAt).toBeGreaterThanOrEqual(0);
  expect(noteAt).toBeGreaterThan(costAt);
  expect(formAt).toBeGreaterThan(noteAt);
  expect(text).not.toContain('Historical analysis is not available');
  for (const phrase of FULL_ANALYSIS_PLACEHOLDERS) expect(text).not.toContain(phrase);
}

async function clickButton(label: string, index = 0) {
  const buttons = [...document.querySelectorAll('button')].filter((node) => node.textContent?.replace(/\s+/g, ' ').trim() === label);
  const button = buttons[index];
  if (!button) throw new Error(`missing button ${label} (${buttons.length} found)`);
  await act(async () => {
    (button as HTMLButtonElement).click();
  });
}

function activeCall(): FormCall {
  const call = [...calls].reverse().find((entry) => !entry.signal?.aborted);
  if (!call) throw new Error(`no active form request (${calls.length} started)`);
  return call;
}

async function deliver(call: FormCall, payload: unknown, status = 200) {
  expect(call.signal?.aborted).not.toBe(true);
  await act(async () => {
    call.resolve(new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function readyBody(legs: readonly ResearchSnapshotFormRequestLeg[], average: number) {
  return {
    basis: HISTORICAL_PLAYER_FORM_BASIS,
    legs: legs.map((leg) => ({
      ...leg,
      status: 'ready',
      reason: null,
      cutoffAt: leg.snapshotAt,
      scheduledGame: { homeAbbr: 'BOS', awayAbbr: 'NYK', startTime: GAME_START },
      teamAssignment: { status: 'unresolved' },
      season: { gameCount: 3, average },
      last5: { gameCount: 3, average },
      last10: { gameCount: 3, average },
      lineRelative: { sampleCount: 3, above: 2, below: 1, equal: 0 },
      minutes: {
        priorGame: 32,
        season: { gameCount: 3, average: 30 },
        last5: { gameCount: 3, average: 30 },
        last10: { gameCount: 3, average: 30 },
        gamesPlayed: 3,
      },
    })),
  };
}

function unavailableBody(legs: readonly ResearchSnapshotFormRequestLeg[]) {
  return {
    basis: HISTORICAL_PLAYER_FORM_BASIS,
    legs: legs.map((leg) => ({
      ...leg,
      status: 'unavailable',
      reason: researchSnapshotFormReason('NO_PRIOR_GAMES'),
      cutoffAt: leg.snapshotAt,
      scheduledGame: null,
      teamAssignment: { status: 'unresolved' },
      season: null,
      last5: null,
      last10: null,
      lineRelative: null,
      minutes: null,
    })),
  };
}

async function renderWorkspace() {
  document.body.replaceChildren();
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(StrictMode, null, createElement(Host, { model: previewModel() })));
  });
}

async function openQuickBuildsAndUse(index: number) {
  await clickButton('Quick Builds');
  expect(selectedTab()).toBe('Quick Builds');
  expect(panel('quick').hidden).toBe(false);
  await clickButton('Use This Build', index);
}

beforeEach(() => {
  calls.length = 0;
  unexpected.length = 0;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  installFetch();
  if (typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '');
    };
  }
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('quick builds handoff to historical player form', () => {
  it('switches to My Parlay, keeps the wagers, and renders the mocked form', async () => {
    await renderWorkspace();
    expect(selectedTab()).toBe('My Parlay');
    expect(document.body.textContent).toContain('2 Legs');
    expect(document.body.textContent).toContain('3 Legs');
    expect(document.body.textContent).toContain('4 Legs');
    expect(document.body.textContent).not.toContain('5 Legs');

    await openQuickBuildsAndUse(0);

    expect(selectedTab()).toBe('My Parlay');
    expect(panel('mine').hidden).toBe(false);
    expect(panel('quick').hidden).toBe(true);
    const ticket = panel('mine');
    expect(ticket.textContent).toContain('Jayson Tatum');
    expect(ticket.textContent).toContain('Jaylen Brown');
    expect(ticket.textContent).toContain('Original observed price -115');
    expect(ticket.textContent).toContain('Original observed price -110');
    expect(ticket.textContent).toContain('NYK');
    expect(ticket.textContent).toContain('BOS');
    expect(ticket.textContent).toContain('Game start Dec 14, 7:30 PM EST');
    expect(ticket.textContent).toContain('Game status: Scheduled');
    expect(ticket.textContent).not.toContain(GAME_START);
    expectSnapshotResearchLayout(ticket);
    expect(document.body.textContent).not.toContain('Analyze with Court Context');
    expect(ticket.querySelector(`[aria-label="${HISTORICAL_PLAYER_FORM_TITLE}"]`)).not.toBeNull();
    expect(ticket.textContent).toContain('Loading historical player form');
    expect(ticket.textContent).toContain('no official end time');

    const call = activeCall();
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/api/parlay-workspace/research-snapshot-form');
    expect(call.body.legs.map((leg) => [leg.playerId, leg.gameId, leg.market, leg.side, leg.line, leg.snapshotAt])).toEqual([
      ['11', 'g1', 'points', 'over', 22.5, FIRST_OBSERVED[0]],
      ['22', 'g2', 'rebounds', 'under', 8.5, FIRST_OBSERVED[1]],
    ]);
    expect(JSON.stringify(call.body)).not.toContain('odds');
    expect(unexpected).toEqual([]);

    await deliver(call, readyBody(call.body.legs, 18));
    expect(ticket.textContent).toContain('18 over 3 games');
    expect(ticket.textContent).toContain('Above 22.5: 2');
    expect(ticket.textContent).toContain('Minutes: prior 32');
    expect(ticket.textContent).toContain('Scheduled game NYK @ BOS');
    expect(ticket.textContent).toContain('Original observed price -115');
    expect(unexpected).toEqual([]);
  });

  it('shows a missing-data reason without inventing averages', async () => {
    await renderWorkspace();
    await openQuickBuildsAndUse(0);
    const call = activeCall();
    await deliver(call, unavailableBody(call.body.legs));
    const ticket = panel('mine');
    expectSnapshotResearchLayout(ticket);
    expect(ticket.textContent).toContain(researchSnapshotFormReason('NO_PRIOR_GAMES'));
    expect(ticket.textContent).toContain('Jayson Tatum');
    expect(ticket.textContent).not.toContain('18 over 3 games');
    expect(ticket.textContent).not.toContain('0 over');
    expect(ticket.textContent).toContain('Original observed price -115');
    expect(unexpected).toEqual([]);
  });

  it('keeps the ticket on cancel and ignores a stale form response after replace', async () => {
    await renderWorkspace();
    await openQuickBuildsAndUse(0);
    const first = activeCall();
    await deliver(first, readyBody(first.body.legs, 18));
    expect(panel('mine').textContent).toContain('18 over 3 games');

    await openQuickBuildsAndUse(1);
    expect(document.body.textContent).toContain('Replace My Parlay?');
    const callsBeforeCancel = calls.length;
    await clickButton('Cancel');
    expect(calls.length).toBe(callsBeforeCancel);
    expect(selectedTab()).toBe('Quick Builds');
    await clickButton('My Parlay');
    expect(panel('mine').textContent).toContain('Jayson Tatum');
    expect(panel('mine').textContent).toContain('18 over 3 games');
    expect(panel('mine').textContent).not.toContain('Payton Pritchard');

    await openQuickBuildsAndUse(1);
    await clickButton('Replace My Parlay');
    expect(selectedTab()).toBe('My Parlay');
    const ticket = panel('mine');
    expect(ticket.hidden).toBe(false);
    expect(ticket.textContent).toContain('Payton Pritchard');
    expect(ticket.textContent).toContain('Sam Hauser');
    expect(ticket.textContent).not.toContain('Jayson Tatum');
    expect(ticket.textContent).not.toContain('18 over 3 games');
    expect(ticket.textContent).toContain('Loading historical player form');
    expectSnapshotResearchLayout(ticket);
    expect(ticket.textContent).toContain('Original observed price -105');
    expect(ticket.textContent).toContain('Original observed price +120');

    await act(async () => {
      first.resolve(new Response(JSON.stringify(readyBody(first.body.legs, 18)), { status: 200, headers: { 'content-type': 'application/json' } }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(ticket.textContent).not.toContain('18 over 3 games');

    const replacement = activeCall();
    expect(replacement).not.toBe(first);
    expect(replacement.body.legs.map((leg) => leg.playerId)).toEqual(['55', '66']);
    expect(replacement.body.legs.map((leg) => leg.snapshotAt)).toEqual([...NEXT_OBSERVED]);
    await deliver(replacement, readyBody(first.body.legs, 18));
    expect(ticket.textContent).toContain('Historical player form could not be loaded.');
    expect(ticket.textContent).not.toContain('18 over 3 games');
    expect(ticket.textContent).toContain('Payton Pritchard');
    expect(ticket.textContent).toContain('Original observed price +120');
    expect(unexpected).toEqual([]);
  });

  it('keeps the transferred wagers when the form request is unauthorized', async () => {
    await renderWorkspace();
    await openQuickBuildsAndUse(0);
    await deliver(activeCall(), {}, 401);
    const ticket = panel('mine');
    expectSnapshotResearchLayout(ticket);
    expect(ticket.textContent).toContain('Sign in to load historical player form.');
    expect(ticket.textContent).toContain('Jayson Tatum');
    expect(ticket.textContent).toContain('Jaylen Brown');
    expect(ticket.textContent).toContain('Original observed price -115');
    expect(unexpected).toEqual([]);
  });

  it('keeps the full-analysis placeholders for a ticket that is not a Research Snapshot', async () => {
    const legs: SelectedParlayLeg[] = [
      {
        gameLabel: 'LAL @ OKC',
        awayAbbr: 'LAL',
        homeAbbr: 'OKC',
        offer: {
          source: 'props_explorer',
          sourceProvenance: 'selected_canonical_offer',
          playerId: '11',
          playerDisplayName: 'Shai Gilgeous-Alexander',
          gameId: 'other-game',
          market: 'points',
          side: 'over',
          line: 30.5,
          sportsbook: { vendor: 'draftkings', displayName: 'DraftKings' },
          oddsAmerican: -120,
          snapshotKind: 'decision_close',
          snapshotAt: '2026-01-01T00:00:00.000Z',
          offerIdentity: 'offer-decision',
          wagerIdentity: 'wager-decision',
        },
      },
    ];
    const eligibility = evaluateWorkspaceAnalysisEligibility(legs);
    document.body.replaceChildren();
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
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
          onShowReview: () => undefined,
          workspaceMode: 'mine',
        }),
      );
    });
    const ticket = panel('mine');
    const text = ticket.textContent ?? '';
    expect(text).toContain('Historical analysis is not available');
    expect(text).toContain('Shai Gilgeous-Alexander');
    expect(text).toContain('Projection');
    expect(text).toContain('View Context');
    for (const phrase of FULL_ANALYSIS_PLACEHOLDERS) {
      if (
        phrase === 'Current contextual analysis is unavailable for a Research Snapshot.' ||
        phrase === 'Run Court Context' ||
        phrase === 'Season avg'
      ) continue;
      expect(text).toContain(phrase);
    }
    await clickButton('View Context →');
    expect(panel('mine').textContent).toContain('Run Court Context');
    expect(text).not.toContain(HISTORICAL_PLAYER_FORM_TITLE);
    expect(text).not.toContain(RESEARCH_SNAPSHOT_WORKSPACE_NOTE);
    expect(calls).toEqual([]);
    expect(unexpected.some((url) => url.includes('/api/parlay-workspace/context'))).toBe(false);
    expect(unexpected.some((url) => url.includes('/api/parlay-workspace/research-snapshot-form'))).toBe(false);
  });

  it('keeps analysis controls on a mixed ticket and transfers two, three, and four snapshot legs', async () => {
    const counts = [2, 3, 4] as const;
    for (const count of counts) {
      const built = handoffCount(count);
      expect(built?.status).toBe('replaced');
      if (built?.status !== 'replaced') continue;
      expect(built.legs).toHaveLength(count);
      expect(built.legs.map((leg) => leg.offer.oddsAmerican)).toEqual(
        Array.from({ length: count }, (_, index) => -110 - index)
      );
      expect(built.legs.every((leg) => leg.offer.snapshotAt === FIRST_OBSERVED[0])).toBe(true);
      expect(built.legs[0]?.gameLabel).toBe('NYK @ BOS');
      expect(built.legs[0]?.gameStatus).toBe('Scheduled');
      expect(built.legs[0]?.gameStartTime).toBe(GAME_START);
      expect(built.legs[1]?.gameLabel).toBeNull();

      document.body.replaceChildren();
      const container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      const eligibility = evaluateWorkspaceAnalysisEligibility(built.legs);
      await act(async () => {
        root?.render(
          createElement(ParlayWorkspaceView, {
            legs: built.legs,
            explorerHref: '/betting/props-explorer',
            onRemove: () => undefined,
            onClear: () => undefined,
            eligibility,
            analysis: null,
            analysisBusy: false,
            analysisError: null,
            showingResults: false,
            onAnalyze: () => undefined,
            onShowReview: () => undefined,
            workspaceMode: 'mine',
          })
        );
      });
      const text = panel('mine').textContent ?? '';
      expect(text).toContain(`${count} Legs`);
      expect(text).toContain('NYK');
      expect(text).toContain('Matchup unavailable');
      expect(text).toContain('Game start Dec 14, 7:30 PM EST');
      expect(text).toContain('Game status: Scheduled');
      expect(text).not.toContain(GAME_START);
      expect(text).not.toContain('View Context');
      expect(text).toContain(RESEARCH_SNAPSHOT_WORKSPACE_NOTE);
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }

    const snapshot = handoffCount(2);
    expect(snapshot?.status).toBe('replaced');
    if (snapshot?.status !== 'replaced') return;
    const mixed: SelectedParlayLeg[] = [
      snapshot.legs[0]!,
      {
        gameLabel: 'LAL @ OKC',
        awayAbbr: 'LAL',
        homeAbbr: 'OKC',
        offer: {
          ...snapshot.legs[1]!.offer,
          source: 'props_explorer',
          snapshotKind: 'decision_close',
          playerId: '99',
          playerDisplayName: 'Shai Gilgeous-Alexander',
          offerIdentity: 'offer-mixed',
          wagerIdentity: 'wager-mixed',
        },
      },
    ];
    document.body.replaceChildren();
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(ParlayWorkspaceView, {
          legs: mixed,
          explorerHref: '/betting/props-explorer',
          onRemove: () => undefined,
          onClear: () => undefined,
          eligibility: evaluateWorkspaceAnalysisEligibility(mixed),
          analysis: null,
          analysisBusy: false,
          analysisError: null,
          showingResults: false,
          onAnalyze: () => undefined,
          onShowReview: () => undefined,
          workspaceMode: 'mine',
        })
      );
    });
    const mixedText = panel('mine').textContent ?? '';
    expect(mixedText).toContain('View Context');
    expect(mixedText).toContain('Game start Dec 14, 7:30 PM EST');
    expect(mixedText).not.toContain(RESEARCH_SNAPSHOT_WORKSPACE_NOTE);
  });
});

function handoffCount(count: 2 | 3 | 4) {
  const legs = Array.from({ length: count }, (_, index) => ({
    displayReady: true,
    playerId: String(11 + index),
    playerName: `Player ${index + 1}`,
    gameId: `g${index + 1}`,
    market: 'points',
    side: 'over' as const,
    line: 10 + index,
    sportsbook: 'draftkings',
    oddsAmerican: -110 - index,
    observedAt: FIRST_OBSERVED[0],
    gameStartTime: GAME_START,
    gameStatus: index === 0 ? GAME_START : 'Scheduled',
    awayAbbr: index === 1 ? null : 'NYK',
    homeAbbr: index === 1 ? null : 'BOS',
  }));
  return handoffQuickBuildSelection({
    current: [],
    legs: legs as unknown as QuickBuildHandoffLegs,
    nowMs: Date.parse('2026-11-09T18:00:00.000Z'),
    confirmed: true,
  });
}
