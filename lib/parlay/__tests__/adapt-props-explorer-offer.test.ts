import { describe, expect, it } from 'vitest';
import { interpretXrayLeg } from '@/lib/parlay-xray/interpretation/interpret';
import { buildAjayMitchellContext, cloneContext } from '@/lib/parlay-xray/interpretation/ajay-context';
import { assembleIdentity } from '@/lib/parlay-xray/context/identity';
import { resolveCanonicalParlayLeg } from '@/lib/parlay-xray/resolution/resolve-leg';
import { CATALOG, extractedLeg } from '@/lib/parlay-xray/resolution/__tests__/fixtures';
import { X3F_AJAY_ID, X3F_GAME_ID } from '@/lib/parlay-xray/e2e/ground-truth';
import { X3F_CATALOG } from '@/lib/parlay-xray/e2e/fixture';
import {
  adaptPropsExplorerOffer,
  canonicalWagerIdentityFromResolution,
  toCanonicalParlayLegResolution,
  type PropsExplorerOfferInput,
} from '../adapt-props-explorer-offer';

const HISTORICAL_JOKIC: PropsExplorerOfferInput = {
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
};

function mustAdapt(input: PropsExplorerOfferInput) {
  const result = adaptPropsExplorerOffer(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.offer;
}

describe('adaptPropsExplorerOffer', () => {
  it('maps a valid historical Explorer offer to a Decision Close canonical leg', () => {
    const offer = mustAdapt(HISTORICAL_JOKIC);
    expect(offer.source).toBe('props_explorer');
    expect(offer.sourceProvenance).toBe('selected_canonical_offer');
    expect(offer.playerId).toBe('203999');
    expect(offer.gameId).toBe('game-den-okc-2026-03-17');
    expect(offer.market).toBe('points');
    expect(offer.side).toBe('over');
    expect(offer.line).toBe(27.5);
    expect(offer.sportsbook.vendor).toBe('draftkings');
    expect(offer.oddsAmerican).toBe(-110);
    expect(offer.snapshotKind).toBe('decision_close');
    expect(offer.snapshotAt).toBe('2026-03-17T16:50:00.000Z');
    expect(offer.snapshotKind).not.toBe('3_hour_pre_tip');
    expect(offer.offerIdentity).toContain('decision_close');
  });

  it('maps a valid live fixture to live_current without fabricating 3-Hour semantics', () => {
    const offer = mustAdapt({
      ...HISTORICAL_JOKIC,
      marketContext: 'live',
      sourceTable: 'analytics.player_props_current',
      snapshotAt: '2026-09-16T16:00:00.000Z',
    });
    expect(offer.snapshotKind).toBe('live_current');
    expect(offer.line).toBe(27.5);
    expect(offer.offerIdentity).toContain('live_current');
    expect(offer.offerIdentity).not.toContain('decision_close');
  });

  it('fail-closes when player id is missing and does not use the display name', () => {
    const result = adaptPropsExplorerOffer({ ...HISTORICAL_JOKIC, playerId: null });
    expect(result).toEqual({ ok: false, code: 'MISSING_PLAYER_ID' });
  });

  it('fail-closes when game id is missing and does not infer a matchup', () => {
    const result = adaptPropsExplorerOffer({ ...HISTORICAL_JOKIC, gameId: '  ' });
    expect(result).toEqual({ ok: false, code: 'MISSING_GAME_ID' });
  });

  it('fail-closes on unsupported markets instead of coercing to points', () => {
    expect(adaptPropsExplorerOffer({ ...HISTORICAL_JOKIC, propType: 'turnovers' })).toEqual({
      ok: false,
      code: 'UNSUPPORTED_MARKET',
    });
    expect(adaptPropsExplorerOffer({ ...HISTORICAL_JOKIC, propType: 'steals' })).toEqual({
      ok: false,
      code: 'UNSUPPORTED_MARKET',
    });
    expect(adaptPropsExplorerOffer({ ...HISTORICAL_JOKIC, propType: 'First Basket' })).toEqual({
      ok: false,
      code: 'UNSUPPORTED_MARKET',
    });
  });

  it('canonicalizes PTS / REB / AST / 3PM / PRA through the existing market helper', () => {
    expect(mustAdapt({ ...HISTORICAL_JOKIC, propType: 'PTS' }).market).toBe('points');
    expect(mustAdapt({ ...HISTORICAL_JOKIC, propType: 'REB', lineValue: 12.5 }).market).toBe(
      'rebounds'
    );
    expect(mustAdapt({ ...HISTORICAL_JOKIC, propType: 'AST', lineValue: 7.5 }).market).toBe(
      'assists'
    );
    expect(mustAdapt({ ...HISTORICAL_JOKIC, propType: '3PM', lineValue: 1.5 }).market).toBe('threes');
    expect(
      mustAdapt({ ...HISTORICAL_JOKIC, propType: 'PRA', lineValue: 35.5 }).market
    ).toBe('points_rebounds_assists');
  });

  it('fail-closes when side is missing and does not default to Over', () => {
    expect(adaptPropsExplorerOffer({ ...HISTORICAL_JOKIC, side: null })).toEqual({
      ok: false,
      code: 'MISSING_SIDE',
    });
    expect(adaptPropsExplorerOffer({ ...HISTORICAL_JOKIC, side: 'yes' })).toEqual({
      ok: false,
      code: 'MISSING_SIDE',
    });
  });

  it('fail-closes on an invalid line', () => {
    expect(adaptPropsExplorerOffer({ ...HISTORICAL_JOKIC, lineValue: null })).toEqual({
      ok: false,
      code: 'INVALID_LINE',
    });
    expect(adaptPropsExplorerOffer({ ...HISTORICAL_JOKIC, lineValue: 'abc' })).toEqual({
      ok: false,
      code: 'INVALID_LINE',
    });
  });

  it('fail-closes on missing or unsupported sportsbooks without guessing', () => {
    expect(adaptPropsExplorerOffer({ ...HISTORICAL_JOKIC, sportsbook: '' })).toEqual({
      ok: false,
      code: 'MISSING_SPORTSBOOK',
    });
    expect(adaptPropsExplorerOffer({ ...HISTORICAL_JOKIC, sportsbook: 'bet365' })).toEqual({
      ok: false,
      code: 'UNSUPPORTED_VENDOR',
    });
    expect(adaptPropsExplorerOffer({ ...HISTORICAL_JOKIC, sportsbook: 'betrivers' })).toEqual({
      ok: false,
      code: 'UNSUPPORTED_VENDOR',
    });
  });

  it('preserves historical Decision Close semantics from serving context', () => {
    const fromContext = mustAdapt({
      ...HISTORICAL_JOKIC,
      sourceTable: null,
    });
    const fromTable = mustAdapt({
      ...HISTORICAL_JOKIC,
      marketContext: null,
      sourceTable: 'research.prop_decision_lines',
    });
    expect(fromContext.snapshotKind).toBe('decision_close');
    expect(fromTable.snapshotKind).toBe('decision_close');
  });

  it('does not replace a selected Decision Close line with Compare 3-Hour data', () => {
    const result = adaptPropsExplorerOffer({
      playerId: X3F_AJAY_ID,
      playerName: 'Ajay Mitchell',
      gameId: X3F_GAME_ID,
      propType: 'points',
      side: 'over',
      lineValue: 12.5,
      sportsbook: 'draftkings',
      oddsAmerican: -107,
      snapshotAt: '2026-04-03T01:15:29.542Z',
      marketContext: 'historical',
      sourceTable: 'research.prop_decision_lines',
      // Red herrings from Market Movement / Compare — must be ignored.
      threeHourLine: 11.5,
      comparisonLine: 11.5,
      referenceKind: '3_hour_pre_tip',
    } as PropsExplorerOfferInput & {
      threeHourLine: number;
      comparisonLine: number;
      referenceKind: string;
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.offer.line).toBe(12.5);
    expect(result.offer.line).not.toBe(11.5);
    expect(result.offer.snapshotKind).toBe('decision_close');
    expect(result.offer.oddsAmerican).toBe(-107);
  });

  it('keeps DraftKings 27.5 and FanDuel 28.5 as distinct offer identities', () => {
    const dk = mustAdapt({ ...HISTORICAL_JOKIC, sportsbook: 'DraftKings', lineValue: 27.5 });
    const fd = mustAdapt({ ...HISTORICAL_JOKIC, sportsbook: 'FanDuel', lineValue: 28.5 });
    expect(dk.wagerIdentity).not.toBe(fd.wagerIdentity);
    expect(dk.offerIdentity).not.toBe(fd.offerIdentity);
    expect(dk.line).toBe(27.5);
    expect(fd.line).toBe(28.5);
    expect(dk.sportsbook.vendor).toBe('draftkings');
    expect(fd.sportsbook.vendor).toBe('fanduel');
  });

  it('keeps Over 27.5 and Under 27.5 distinct', () => {
    const over = mustAdapt({ ...HISTORICAL_JOKIC, side: 'over' });
    const under = mustAdapt({ ...HISTORICAL_JOKIC, side: 'under' });
    expect(over.wagerIdentity).not.toBe(under.wagerIdentity);
    expect(over.side).toBe('over');
    expect(under.side).toBe('under');
  });

  it('keeps decision_close and live_current provenance distinct for the same wager numbers', () => {
    const historical = mustAdapt(HISTORICAL_JOKIC);
    const live = mustAdapt({
      ...HISTORICAL_JOKIC,
      marketContext: 'live',
      sourceTable: 'analytics.player_props_current',
    });
    expect(historical.wagerIdentity).toBe(live.wagerIdentity);
    expect(historical.offerIdentity).not.toBe(live.offerIdentity);
    expect(historical.snapshotKind).toBe('decision_close');
    expect(live.snapshotKind).toBe('live_current');
  });

  it('treats same-player points and rebounds as independent legs', () => {
    const pts = mustAdapt({
      playerId: 203507,
      playerName: 'Giannis Antetokounmpo',
      gameId: 'game-mil-mia-2026-03-17',
      propType: 'points',
      side: 'over',
      lineValue: 27.5,
      sportsbook: 'FanDuel',
      marketContext: 'historical',
    });
    const reb = mustAdapt({
      playerId: 203507,
      playerName: 'Giannis Antetokounmpo',
      gameId: 'game-mil-mia-2026-03-17',
      propType: 'rebounds',
      side: 'over',
      lineValue: 8.5,
      sportsbook: 'FanDuel',
      marketContext: 'historical',
    });
    expect(pts.playerId).toBe(reb.playerId);
    expect(pts.market).toBe('points');
    expect(reb.market).toBe('rebounds');
    expect(pts.wagerIdentity).not.toBe(reb.wagerIdentity);
  });

  it('fail-closes when snapshot semantics cannot be derived', () => {
    expect(
      adaptPropsExplorerOffer({
        ...HISTORICAL_JOKIC,
        marketContext: null,
        sourceTable: null,
      })
    ).toEqual({ ok: false, code: 'MISSING_SNAPSHOT_SEMANTICS' });
  });

  it('does not use odds to resolve identity', () => {
    const a = mustAdapt({ ...HISTORICAL_JOKIC, oddsAmerican: -110 });
    const b = mustAdapt({ ...HISTORICAL_JOKIC, oddsAmerican: 150 });
    expect(a.wagerIdentity).toBe(b.wagerIdentity);
    expect(a.offerIdentity).toBe(b.offerIdentity);
    expect(a.oddsAmerican).toBe(-110);
    expect(b.oddsAmerican).toBe(150);
  });

  it('is deterministic for the same Explorer offer', () => {
    const a = mustAdapt(HISTORICAL_JOKIC);
    const b = mustAdapt(HISTORICAL_JOKIC);
    expect(a).toEqual(b);
    expect(a.offerIdentity).toBe(b.offerIdentity);
  });

  it('resolves player and game from Explorer ids without fuzzy name matching', () => {
    const offer = mustAdapt({
      ...HISTORICAL_JOKIC,
      playerName: 'Jockic',
    });
    const resolution = toCanonicalParlayLegResolution(offer, CATALOG);
    expect(resolution.playerResolution.status).toBe('RESOLVED');
    expect(resolution.playerResolution.value?.playerId).toBe('203999');
    expect(resolution.gameResolution.status).toBe('RESOLVED');
    expect(resolution.gameResolution.value?.gameId).toBe('game-den-okc-2026-03-17');
    expect(resolution.fullyResolved).toBe(true);
    expect(resolution.originalLeg.rawSnippet).toBeNull();
    expect(resolution.originalLeg.playerId.value).toBe('203999');
  });
});

describe('XRay canonical parity', () => {
  it('matches XRay confirmed wager identity except source provenance', () => {
    const xray = resolveCanonicalParlayLeg(
      extractedLeg({
        player: 'Nikola Jokic',
        team: 'DEN',
        opponent: 'OKC',
        matchup: 'DEN vs OKC',
        market: 'points',
        marketLabel: 'Points',
        side: 'over',
        line: 27.5,
        sportsbook: 'DraftKings',
        gameDate: '2026-03-17',
      }),
      CATALOG
    );
    const offer = mustAdapt(HISTORICAL_JOKIC);
    const fromExplorer = toCanonicalParlayLegResolution(offer, CATALOG);

    expect(canonicalWagerIdentityFromResolution(xray)).toBe(offer.wagerIdentity);
    expect(canonicalWagerIdentityFromResolution(fromExplorer)).toBe(offer.wagerIdentity);
    expect(fromExplorer.playerResolution.value?.playerId).toBe(
      xray.playerResolution.value?.playerId
    );
    expect(fromExplorer.gameResolution.value?.gameId).toBe(xray.gameResolution.value?.gameId);
    expect(fromExplorer.marketResolution.value?.propType).toBe(
      xray.marketResolution.value?.propType
    );
    expect(fromExplorer.sideResolution.value).toBe(xray.sideResolution.value);
    expect(fromExplorer.lineResolution.value).toBe(xray.lineResolution.value);
    expect(fromExplorer.sportsbookResolution.value?.vendor).toBe(
      xray.sportsbookResolution.value?.vendor
    );
    expect(offer.source).toBe('props_explorer');
    expect(fromExplorer.originalLeg.rawSnippet).toBeNull();
  });

  it('does not let source provenance change shared interpretation for the same wager', () => {
    const xrayCtx = buildAjayMitchellContext();
    const offer = mustAdapt({
      playerId: X3F_AJAY_ID,
      playerName: 'Ajay Mitchell',
      gameId: X3F_GAME_ID,
      propType: 'points',
      side: 'over',
      lineValue: 11.5,
      sportsbook: 'DraftKings',
      oddsAmerican: -130,
      marketContext: 'historical',
      sourceTable: 'research.prop_decision_lines',
      snapshotAt: '2026-04-03T01:15:29.542Z',
    });
    const resolution = toCanonicalParlayLegResolution(offer, X3F_CATALOG);
    const explorerCtx = cloneContext(xrayCtx);
    explorerCtx.identity = assembleIdentity({
      resolution,
      contextCutoffAt: xrayCtx.identity.contextCutoffAt,
      historicalDate: xrayCtx.identity.historicalDate,
    });
    explorerCtx.identity.teamAbbr = xrayCtx.identity.teamAbbr;
    explorerCtx.identity.opponentAbbr = xrayCtx.identity.opponentAbbr;

    const xrayRead = interpretXrayLeg(xrayCtx);
    const explorerRead = interpretXrayLeg(explorerCtx);
    expect(explorerRead.identity.line).toBe(11.5);
    expect(explorerRead.marketPosition.kind).toBe(xrayRead.marketPosition.kind);
    expect(explorerRead.marketPosition.closeLine).toBe(xrayRead.marketPosition.closeLine);
    expect(explorerRead.summaryState).toBe(xrayRead.summaryState);
    expect(offer.source).toBe('props_explorer');
    expect(offer.snapshotKind).toBe('decision_close');
  });
});
