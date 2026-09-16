import { describe, expect, it } from 'vitest';
import { matchHistoricalParlayLeg } from '@/lib/parlay-xray/replay/match';
import { CORPUS, replayInput } from '@/lib/parlay-xray/replay/__tests__/fixtures';
import { assembleXrayLegContext } from '../assemble';
import { assembleMarketContext } from '../market';
import { CUTOFF, matchedPoints, mmRow, priorLogs, resolution } from './fixtures';

describe('X3C market context preserves X3B distinctions', () => {
  it('keeps an exact line/book match factual, including close-minus-3-hour delta', () => {
    const packet = assembleXrayLegContext({
      resolution: resolution(),
      match: matchedPoints(11.5),
      contextCutoffAt: CUTOFF,
      season: '2026',
      sources: { priorPlayerLogs: priorLogs(10), priorTeamStats: [], projectionSnapshots: [] },
    });
    expect(packet.market.status).toBe('AVAILABLE');
    expect(packet.market.matchStatus).toBe('MATCHED');
    expect(packet.market.requestedLine).toBe(11.5);
    expect(packet.market.threeHourLine).toBe(11.5);
    expect(packet.market.closeLine).toBe(12.5);
    expect(packet.market.lineDeltaCloseMinusThreeHour).toBe(1);
    expect(packet.market.lineDeltaThreeHourMinusRequested).toBe(0);
    expect(packet.market.snapshotAvailable).toEqual({ threeHourPreTip: true, decisionClose: true });
    expect(JSON.stringify(packet)).not.toMatch(/sharp|favor|support the Over/i);
  });

  it('keeps a different-line match LIMITED', () => {
    const market = assembleMarketContext(matchedPoints(13.5));
    expect(market.status).toBe('LIMITED');
    expect(market.matchStatus).toBe('PARTIAL_MATCH');
    expect(market.lineQuality).toBe('MARKET_MATCH_DIFFERENT_LINE');
    expect(market.requestedLine).toBe(13.5);
    expect(market.threeHourLine).toBe(11.5);
  });

  it('keeps an unavailable requested book LIMITED', () => {
    const match = matchHistoricalParlayLeg(
      replayInput({
        historicalDate: '2026-04-02',
        playerId: resolution().playerResolution.value!.playerId,
        gameId: resolution().gameResolution.value!.gameId,
        market: 'points',
        line: 11.5,
        sportsbookVendor: 'fanduel',
      }),
      [mmRow()]
    );
    const market = assembleMarketContext(match);
    expect(market.status).toBe('LIMITED');
    expect(market.reason).toBe('BOOK_UNAVAILABLE');
    expect(market.matchedBook).toBeNull();
  });

  it('keeps a missing close snapshot visible', () => {
    const match = matchHistoricalParlayLeg(
      replayInput({ market: 'rebounds', line: 12.5 }),
      CORPUS
    );
    const market = assembleMarketContext(match);
    expect(market.snapshotAvailable.threeHourPreTip).toBe(true);
    expect(market.snapshotAvailable.decisionClose).toBe(false);
    expect(market.closeLine).toBeNull();
  });

  it('keeps unsupported RA market unavailable while player-form RA can still exist', () => {
    const match = matchHistoricalParlayLeg(
      replayInput({ market: 'rebounds_assists', line: 10.5, marketUnsupported: true }),
      CORPUS
    );
    const packet = assembleXrayLegContext({
      resolution: resolution({ market: 'rebounds_assists', line: 10.5 }),
      match,
      contextCutoffAt: CUTOFF,
      season: '2026',
      sources: { priorPlayerLogs: priorLogs(10), priorTeamStats: [], projectionSnapshots: [] },
    });
    expect(packet.market.status).toBe('UNAVAILABLE');
    expect(packet.market.reason).toBe('UNSUPPORTED_MARKET');
    expect(packet.playerForm.status).toBe('AVAILABLE');
    expect(packet.playerForm.market).toBe('rebounds_assists');
  });
});
