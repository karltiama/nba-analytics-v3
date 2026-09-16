import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { PRIMARY_NAV } from '@/components/betting/primary-nav';
import { isPublicXrayExtractionReady } from '@/lib/onboarding/contract';
import { isXrayDesignPreviewEnabled } from '@/lib/parlay-xray/copy';
import { buildHistoricalReplayReviewPreview } from '@/lib/parlay-xray/e2e/preview';
import { canConfirmLegs, createInitialXrayState, reduceXrayState } from '@/lib/parlay-xray/session';
import { SCREENSHOT_EXTRACTION_AVAILABLE } from '@/lib/parlay-xray/types';
import {
  canonicalWagerIdentity,
} from '../adapt-props-explorer-offer';
import {
  PRODUCT_PREVIEW_FIXTURE,
  PRODUCT_PREVIEW_HUB_HREF,
  PROPS_HISTORICAL_PREVIEW_HREF,
  WORKSPACE_HISTORICAL_PREVIEW_HREF,
  XRAY_REPLAY_PREVIEW_HREF,
  buildWorkspaceHistoricalPreviewLegs,
  contextualWorkspaceNavAriaLabel,
  contextualWorkspaceNavLabel,
  isCertifiedXrayReplayPreview,
  isWorkspaceHistoricalPreview,
  shouldSuppressProductPreviewAnalytics,
} from '../preview-fixture';
import { addExplorerOfferToSelection, removeSelectedLeg, clearSelectedLegs } from '../selection';
import {
  getParlaySelectionLegs,
  importConfirmedXrayLegsToStore,
  replaceParlaySelectionLegs,
  resetParlaySelectionStoreForTests,
} from '../selection-store';
import { evaluateWorkspaceAnalysisEligibility } from '../workspace-analysis';

const ROOT = join(__dirname, '../../../');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('product preview fixture', () => {
  beforeEach(() => {
    resetParlaySelectionStoreForTests();
  });

  it('reuses the certified X3F LAL @ OKC slate for all preview hrefs', () => {
    expect(PRODUCT_PREVIEW_HUB_HREF).toBe('/admin/product-preview');
    expect(PROPS_HISTORICAL_PREVIEW_HREF).toBe(
      '/betting/props-explorer?date=2026-04-02&game_id=18447934&preview=historical'
    );
    expect(XRAY_REPLAY_PREVIEW_HREF).toBe('/parlay-xray?preview=replay');
    expect(WORKSPACE_HISTORICAL_PREVIEW_HREF).toBe('/parlay-workspace?preview=historical');
    expect(PRODUCT_PREVIEW_FIXTURE).toMatchObject({
      gameId: '18447934',
      dateEt: '2026-04-02',
      dateLabel: 'April 2, 2026',
      slateLabel: 'LAL @ OKC',
      dataMode: 'historical',
      legCount: 4,
      providerCalls: 'none',
    });
    expect(isWorkspaceHistoricalPreview('historical')).toBe(true);
    expect(isWorkspaceHistoricalPreview(null)).toBe(false);
    expect(isCertifiedXrayReplayPreview('replay')).toBe(true);
    expect(shouldSuppressProductPreviewAnalytics('replay')).toBe(true);
    expect(shouldSuppressProductPreviewAnalytics('historical')).toBe(true);
    expect(shouldSuppressProductPreviewAnalytics(null)).toBe(false);
  });

  it('seeds four canonical Workspace preview legs without writing the live store', () => {
    const live = addExplorerOfferToSelection(getParlaySelectionLegs(), {
      playerId: 203999,
      playerName: 'Nikola Jokic',
      gameId: 'other-game',
      propType: 'points',
      side: 'over',
      lineValue: 27.5,
      sportsbook: 'DraftKings',
      oddsAmerican: -110,
      snapshotAt: '2026-03-17T16:50:00.000Z',
      marketContext: 'historical',
      sourceTable: 'research.prop_decision_lines',
    });
    expect(live.status).toBe('added');
    if (live.status !== 'added') return;
    replaceParlaySelectionLegs(live.legs);
    expect(getParlaySelectionLegs()).toHaveLength(1);

    const preview = buildWorkspaceHistoricalPreviewLegs();
    expect(preview).toHaveLength(4);
    expect(new Set(preview.map((leg) => leg.offer.gameId))).toEqual(new Set(['18447934']));
    expect(preview.every((leg) => leg.offer.snapshotKind === 'decision_close')).toBe(true);
    const wagerIds = preview.map((leg) =>
      canonicalWagerIdentity({
        playerId: leg.offer.playerId,
        gameId: leg.offer.gameId,
        market: leg.offer.market,
        side: leg.offer.side,
        line: leg.offer.line,
        sportsbookVendor: leg.offer.sportsbook.vendor,
      })
    );
    expect(new Set(wagerIds).size).toBe(4);
    expect(preview.map((leg) => leg.offer.wagerIdentity)).toEqual(wagerIds);
    expect(getParlaySelectionLegs()).toHaveLength(1);
    expect(getParlaySelectionLegs()[0]?.offer.gameId).toBe('other-game');

    const eligibility = evaluateWorkspaceAnalysisEligibility(preview);
    expect(eligibility.status).toBe('READY');
  });
});

describe('contextual Workspace header access', () => {
  beforeEach(() => {
    resetParlaySelectionStoreForTests();
  });

  it('hides the action at 0 legs and shows the live count at 1 and 4', () => {
    expect(contextualWorkspaceNavLabel(0)).toBeNull();
    expect(contextualWorkspaceNavLabel(1)).toBe('Parlay · 1');
    expect(contextualWorkspaceNavLabel(4)).toBe('Parlay · 4');
    expect(contextualWorkspaceNavAriaLabel(1)).toBe('Open Parlay Workspace, 1 leg');
    expect(contextualWorkspaceNavAriaLabel(4)).toBe('Open Parlay Workspace, 4 legs');
  });

  it('updates from Props add, XRay import, remove, and clear using the live store', () => {
    expect(contextualWorkspaceNavLabel(getParlaySelectionLegs().length)).toBeNull();
    const added = addExplorerOfferToSelection(getParlaySelectionLegs(), {
      playerId: 203999,
      playerName: 'Nikola Jokic',
      gameId: 'game-den-okc-2026-03-17',
      propType: 'points',
      side: 'over',
      lineValue: 27.5,
      sportsbook: 'DraftKings',
      oddsAmerican: -110,
      snapshotAt: '2026-03-17T16:50:00.000Z',
      marketContext: 'historical',
      sourceTable: 'research.prop_decision_lines',
    });
    expect(added.status).toBe('added');
    if (added.status !== 'added') return;
    replaceParlaySelectionLegs(added.legs);
    expect(contextualWorkspaceNavLabel(getParlaySelectionLegs().length)).toBe('Parlay · 1');

    const preview = buildWorkspaceHistoricalPreviewLegs();
    importConfirmedXrayLegsToStore(preview);
    expect(contextualWorkspaceNavLabel(getParlaySelectionLegs().length)).toBe('Parlay · 4');

    const remaining = removeSelectedLeg(
      getParlaySelectionLegs(),
      getParlaySelectionLegs()[0]!.offer.offerIdentity
    );
    replaceParlaySelectionLegs(remaining);
    expect(contextualWorkspaceNavLabel(getParlaySelectionLegs().length)).toBe('Parlay · 3');

    replaceParlaySelectionLegs(clearSelectedLegs());
    expect(contextualWorkspaceNavLabel(getParlaySelectionLegs().length)).toBeNull();
  });

  it('does not treat isolated preview legs as the header count', () => {
    const preview = buildWorkspaceHistoricalPreviewLegs();
    expect(preview).toHaveLength(4);
    expect(getParlaySelectionLegs()).toEqual([]);
    expect(contextualWorkspaceNavLabel(getParlaySelectionLegs().length)).toBeNull();
  });
});

describe('product preview page contract', () => {
  const hub = read('components/admin/product-preview/ProductPreviewHub.tsx');
  const adminPage = read('app/admin/product-preview/page.tsx');
  const header = read('components/betting/Header.tsx');
  const previewClient = read('app/parlay-workspace/ParlayWorkspacePreviewClient.tsx');
  const entry = read('app/parlay-workspace/ParlayWorkspaceEntry.tsx');
  const view = read('components/parlay-workspace/ParlayWorkspaceView.tsx');
  const primaryNav = read('components/betting/primary-nav.ts');

  it('renders an internal admin hub with the three certified preview links', () => {
    expect(adminPage).toMatch(/requireAdminPage/);
    expect(adminPage).toMatch(/robots: \{ index: false/);
    expect(hub).toMatch(/Internal · Preview/);
    expect(hub).toMatch(/Open Props Preview/);
    expect(hub).toMatch(/Open XRay Preview/);
    expect(hub).toMatch(/Open Workspace Preview/);
    expect(hub).toMatch(/PROPS_HISTORICAL_PREVIEW_HREF/);
    expect(hub).toMatch(/XRAY_REPLAY_PREVIEW_HREF/);
    expect(hub).toMatch(/WORKSPACE_HISTORICAL_PREVIEW_HREF/);
    expect(hub).toMatch(/Onboarding guidance QA/);
    expect(hub).toMatch(/isPublicXrayExtractionReady/);
    expect(hub).toMatch(/OpenAI disabled/);
    expect(hub).not.toMatch(/balldontlie/i);
    expect(SCREENSHOT_EXTRACTION_AVAILABLE).toBe(false);
    expect(isPublicXrayExtractionReady()).toBe(false);
  });

  it('keeps Workspace preview isolated from the live store and uses shared analysis', () => {
    expect(entry).toMatch(/isWorkspaceHistoricalPreview/);
    expect(entry).toMatch(/ParlayWorkspacePreviewClient/);
    expect(previewClient).toMatch(/buildWorkspaceHistoricalPreviewLegs/);
    expect(previewClient).toMatch(/runWorkspaceHistoricalAnalysis/);
    expect(previewClient).toMatch(/previewLabel="Historical Preview"/);
    expect(previewClient).not.toMatch(/replaceParlaySelectionLegs|importConfirmedXrayLegsToStore/);
    expect(previewClient).not.toMatch(/localStorage|sessionStorage/);
    expect(previewClient).not.toMatch(/trackEvent/);
    expect(previewClient).not.toMatch(/openai|balldontlie/i);
    expect(view).toMatch(/previewLabel/);
    expect(view).toMatch(/certified historical fixture/);
  });

  it('exposes a contextual header Parlay count without adding Workspace to primary nav', () => {
    expect(PRIMARY_NAV.some((item) => item.href === '/parlay-workspace')).toBe(false);
    expect(primaryNav).not.toMatch(/parlay-workspace/);
    expect(header).toMatch(/useParlaySelection/);
    expect(header).toMatch(/contextualWorkspaceNavLabel/);
    expect(header).toMatch(/contextualWorkspaceNavAriaLabel/);
    expect(header).toMatch(/PARLAY_WORKSPACE_HREF/);
    expect(header).toMatch(/variant="desktop"/);
    expect(header).toMatch(/variant="mobile-badge"/);
    expect(header).toMatch(/variant="mobile-menu"/);
  });

  it('allows certified XRay replay preview without enabling public extraction', () => {
    expect(isXrayDesignPreviewEnabled('replay', 'production')).toBe(true);
    expect(isXrayDesignPreviewEnabled('analysis', 'production')).toBe(false);
    expect(isXrayDesignPreviewEnabled('1', 'production')).toBe(false);
    expect(SCREENSHOT_EXTRACTION_AVAILABLE).toBe(false);
    const client = read('app/parlay-xray/ParlayXrayClient.tsx');
    expect(client).toMatch(/previewFlag === 'replay'/);
    expect(client).not.toMatch(/openai|balldontlie/i);
    const { parlay, historicalReplay } = buildHistoricalReplayReviewPreview();
    const luka = parlay.legs.find((leg) => (leg.playerDisplayName.value ?? '').includes('Luka'));
    expect(luka?.playerDisplayName.value).toBe('Luka Doncik');
    const previewState = reduceXrayState(createInitialXrayState(), {
      type: 'LOAD_PREVIEW',
      parlay,
      analysis: null,
      confirmed: false,
      historicalReplay,
    });
    expect(canConfirmLegs(previewState)).toBe(false);
    expect(client).toMatch(/handoffConfirmedXrayParlay/);
    expect(client).toMatch(/importConfirmedXrayLegsToStore/);
  });
});
