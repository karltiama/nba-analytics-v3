import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeaturedGames } from '@/components/landing/FeaturedGames';
import { PreviewScenarioBadge } from '@/components/preview/PreviewModeBridge';
import { shouldSuppressProductPreviewAnalytics } from '@/lib/parlay/preview-fixture';
import { playerSearchUsedProperties } from '@/lib/product-analytics/discovery-events';
import { trackEvent } from '@/lib/product-analytics/track-event';
import {
  PREVIEW_GAMES,
  PREVIEW_PLAYERS,
  PREVIEW_PROPS,
  previewPlayerByKey,
} from '@/lib/preview/catalog';
import { resolvePreviewRequest } from '@/lib/preview/gateway';
import { isPreviewScopedId, PREVIEW_NUMERIC_ID_FLOOR } from '@/lib/preview/ids';
import { landingPreviewGames, landingPreviewPropRows, landingPreviewWowy } from '@/lib/preview/landing-data';
import { previewGameLogPayload, sparsePreviewPlayer } from '@/lib/preview/player-fixture';
import {
  listPreviewPaperBets,
  resetPreviewPersistenceForTests,
  savePreviewPaperBet,
} from '@/lib/preview/persistence';
import { filterPreviewExplorerRows, previewExplorerRows } from '@/lib/preview/props-fixture';
import { parsePreviewScenario, PREVIEW_SCENARIOS } from '@/lib/preview/scenario';
import { previewWowySummary } from '@/lib/preview/wowy-fixture';
import { loadCourtContextXrayPreview, xrayExtractHttp } from '@/lib/preview/xray-preview';
import { workspaceLegsForScenario } from '@/lib/preview/workspace-legs';
import { evaluateWorkspaceAnalysisEligibility } from '@/lib/parlay/workspace-analysis';

describe('preview scenario parsing', () => {
  it('accepts only the five typed scenarios', () => {
    for (const scenario of PREVIEW_SCENARIOS) {
      expect(parsePreviewScenario(scenario)).toBe(scenario);
    }
    expect(parsePreviewScenario(null)).toBeNull();
    expect(parsePreviewScenario('')).toBeNull();
    expect(parsePreviewScenario('historical')).toBeNull();
    expect(parsePreviewScenario('replay')).toBeNull();
    expect(parsePreviewScenario('1')).toBeNull();
    expect(parsePreviewScenario('not-a-scenario')).toBeNull();
  });

  it('suppresses analytics for new scenarios without changing a missing flag', () => {
    expect(shouldSuppressProductPreviewAnalytics(null)).toBe(false);
    expect(shouldSuppressProductPreviewAnalytics('historical')).toBe(true);
    expect(shouldSuppressProductPreviewAnalytics('replay')).toBe(true);
    for (const scenario of PREVIEW_SCENARIOS) {
      expect(shouldSuppressProductPreviewAnalytics(scenario)).toBe(true);
    }
  });
});

describe('preview fixtures', () => {
  it('is deterministic and uses preview-scoped ids', () => {
    expect(previewExplorerRows('default')).toEqual(previewExplorerRows('default'));
    expect(previewExplorerRows('mobile-dense')).toEqual(previewExplorerRows('mobile-dense'));
    const ids = [
      ...PREVIEW_PLAYERS.flatMap((player) => [player.playerId, player.wowyId]),
      ...PREVIEW_GAMES.map((game) => game.gameId),
      ...PREVIEW_PROPS.map((prop) => prop.id),
    ];
    expect(ids.every((id) => isPreviewScopedId(id))).toBe(true);
    expect(isPreviewScopedId(203999)).toBe(false);
    expect(isPreviewScopedId('18447934')).toBe(false);
    expect(isPreviewScopedId('1628369')).toBe(false);
    expect(PREVIEW_NUMERIC_ID_FLOOR).toBeGreaterThan(18447934);
  });

  it('covers props markets, signals, search, and a sparse player', () => {
    const rows = previewExplorerRows('mobile-dense');
    expect(new Set(rows.map((row) => row.propType))).toEqual(
      new Set(['points', 'rebounds', 'assists', 'threes'])
    );
    expect(rows.some((row) => (row.ev ?? 0) > 0)).toBe(true);
    expect(rows.some((row) => (row.ev ?? 0) < 0)).toBe(true);
    expect(rows.some((row) => row.oddsAmerican == null || row.projection == null)).toBe(true);
    expect(rows.some((row) => row.playerName.includes('Okonkwo-Bellamy'))).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const found = filterPreviewExplorerRows(rows, new URLSearchParams({ player_name: 'Mara' }));
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((row) => row.playerName.includes('Mara'))).toBe(true);
    const sparse = previewGameLogPayload(String(sparsePreviewPlayer().playerId), 'default');
    expect(sparse.status).toBe(200);
    expect((sparse.body as { games: unknown[] }).games).toEqual([]);
    expect((sparse.body as { seasonAverages: unknown }).seasonAverages).toBeNull();
  });

  it('builds distinct WOWY splits and workspace leg counts', () => {
    const subject = previewPlayerByKey('ellison');
    const teammate = previewPlayerByKey('okonkwo');
    const other = previewPlayerByKey('bellamy');
    const withJules = previewWowySummary({
      scenario: 'default',
      subjectPlayerId: subject.wowyId,
      teammatePlayerId: teammate.wowyId,
      season: '2025',
      teamId: 'ccpreview:team-herons',
      seasonType: 'regular',
    });
    const withBellamy = previewWowySummary({
      scenario: 'default',
      subjectPlayerId: subject.wowyId,
      teammatePlayerId: other.wowyId,
      season: '2024',
      teamId: 'ccpreview:team-herons',
      seasonType: 'regular',
    });
    const jules = (withJules.body as { summary: { with: { perGame: { pts: number } }; without: { perGame: { pts: number } } } }).summary;
    const bellamy = (withBellamy.body as { summary: { with: { perGame: { pts: number } } } }).summary;
    expect(jules.with.perGame.pts).not.toBe(jules.without.perGame.pts);
    expect(jules.with.perGame.pts).not.toBe(bellamy.with.perGame.pts);
    expect(workspaceLegsForScenario('empty')).toHaveLength(0);
    expect(workspaceLegsForScenario('partial')).toHaveLength(2);
    expect(workspaceLegsForScenario('default')).toHaveLength(3);
    expect(workspaceLegsForScenario('mobile-dense')).toHaveLength(5);
    expect(workspaceLegsForScenario('error')).toHaveLength(3);
    const mixed = evaluateWorkspaceAnalysisEligibility(workspaceLegsForScenario('partial'));
    expect(mixed.status).toBe('UNAVAILABLE');
    expect(workspaceLegsForScenario('default').every((leg) => isPreviewScopedId(leg.offer.playerId))).toBe(true);
    expect(workspaceLegsForScenario('default').every((leg) => isPreviewScopedId(leg.offer.gameId))).toBe(true);
  });

  it('covers X-Ray success, partial, needs confirmation, no legs, and a blocked provider', () => {
    const success = loadCourtContextXrayPreview('default');
    const partial = loadCourtContextXrayPreview('partial');
    const empty = loadCourtContextXrayPreview('empty');
    const error = loadCourtContextXrayPreview('error');
    expect(success.kind).toBe('parlay');
    if (success.kind === 'parlay') {
      expect(success.result).toBe('SUCCESS');
      expect(success.parlay.extractionStatus).toBe('complete');
      expect(success.parlay.legs.every((leg) => isPreviewScopedId(leg.nbaPlayerId.value))).toBe(true);
    }
    expect(partial.kind).toBe('parlay');
    if (partial.kind === 'parlay') {
      expect(partial.result).toBe('PARTIAL');
      expect(partial.parlay.legs.some((leg) => leg.resolution === 'needs_confirmation')).toBe(true);
    }
    expect(empty.kind).toBe('parlay');
    if (empty.kind === 'parlay') expect(empty.result).toBe('NO_LEGS_FOUND');
    expect(error).toEqual({ kind: 'error', code: 'unreadable_screenshot' });
    const extracted = xrayExtractHttp('default');
    expect(extracted.status).toBe(200);
    expect((extracted.body as { providerAttempted: boolean }).providerAttempted).toBe(false);
  });
});

describe('preview gateway safety', () => {
  afterEach(() => {
    resetPreviewPersistenceForTests();
  });

  it('leaves production fetches alone when preview is disabled', async () => {
    const decision = await resolvePreviewRequest('/api/billing/checkout', { method: 'POST' }, null);
    expect(decision).toEqual({ action: 'passthrough' });
    const props = await resolvePreviewRequest('/api/betting/props-explorer', undefined, null);
    expect(props).toEqual({ action: 'passthrough' });
  });

  it('does not create checkout sessions, provider extracts, or production bets', async () => {
    const checkout = await resolvePreviewRequest(
      '/api/billing/checkout',
      { method: 'POST', body: JSON.stringify({ priceId: 'price_live' }) },
      'default'
    );
    expect(checkout.action).toBe('json');
    if (checkout.action !== 'json') return;
    expect(checkout.status).toBe(403);
    expect(JSON.stringify(checkout.body)).not.toMatch(/stripe|checkout.session|cs_live/i);
    expect((checkout.body as { providerAttempted: boolean }).providerAttempted).toBe(false);

    const paper = await resolvePreviewRequest(
      '/api/betting/paper-bets',
      {
        method: 'POST',
        body: JSON.stringify({
          gameId: PREVIEW_GAMES[0].gameId,
          playerId: PREVIEW_PLAYERS[0].playerId,
          playerName: 'Mara Ellison',
          propType: 'points',
          side: 'over',
          lineValue: 27.5,
          oddsAmerican: -110,
        }),
      },
      'default'
    );
    expect(paper.action).toBe('json');
    if (paper.action !== 'json') return;
    expect(String((paper.body as { id: string }).id).startsWith('ccpreview:')).toBe(true);
    expect(listPreviewPaperBets()).toHaveLength(1);
    expect(savePreviewPaperBet({
      gameId: '1',
      playerId: 1,
      playerName: null,
      propType: null,
      side: null,
      lineValue: null,
      oddsAmerican: null,
    }).id.startsWith('ccpreview:')).toBe(true);

    const props = await resolvePreviewRequest('/api/betting/props-explorer?player_name=Mara', undefined, 'error');
    expect(props.action).toBe('json');
    if (props.action === 'json') expect(props.status).toBe(500);
  });
});

describe('preview analytics and render', () => {
  const location = { search: '' };

  afterEach(() => {
    const g = globalThis as typeof globalThis & { umami?: unknown };
    delete g.umami;
    location.search = '';
    vi.unstubAllGlobals();
  });

  it('does not forward preview interactions to Umami', () => {
    const track = vi.fn();
    (globalThis as typeof globalThis & { umami?: { track: typeof track } }).umami = { track };
    vi.stubGlobal('window', { location });
    location.search = '?preview=mobile-dense';
    trackEvent('player_search_used', playerSearchUsedProperties('props_explorer', 2));
    expect(track).not.toHaveBeenCalled();
    location.search = '';
    trackEvent('player_search_used', playerSearchUsedProperties('props_explorer', 2));
    expect(track).toHaveBeenCalledOnce();
  });

  it('renders the subtle badge and preview landing games through production components', () => {
    expect(renderToStaticMarkup(PreviewScenarioBadge({ scenario: null }))).toBe('');
    expect(renderToStaticMarkup(PreviewScenarioBadge({ scenario: 'mobile-dense' }))).toContain(
      'PREVIEW · MOBILE DENSE'
    );
    const html = renderToStaticMarkup(FeaturedGames({ games: landingPreviewGames('default') }));
    expect(html).toContain('Harbor City');
    expect(html).toContain('Herons');
    expect(html).toContain('Redwood');
    expect(html).toContain('Rapids');
    expect(landingPreviewPropRows('default').length).toBeGreaterThan(0);
    expect(landingPreviewWowy('default')[0]?.summary.with.gameCount).toBeGreaterThan(0);
    expect(renderToStaticMarkup(FeaturedGames({ games: landingPreviewGames('empty') }))).not.toContain(
      'Harbor City'
    );
  });
});
