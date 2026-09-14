import { describe, expect, it } from 'vitest';
import { COURT_CONTEXT_PROP_MAPPING, OWLS_CLOSING_ODDS_BACKFILL_CAPS, OWLS_CLOSING_ODDS_PROBE_CAPS, OWLS_SNAPSHOT_PROBE_CAPS } from '../contract';
import { classifyMarketKind, expandClosingOddsQuotes } from '../closing-odds';
import { SnapshotProbeBudget } from '../snapshot-probe';
import { evaluateStopConditions } from '../validation';

describe('prop mapping', () => {
  it('maps Court Context markets to documented Owls prop types without synthesizing combos', () => {
    const byCc = Object.fromEntries(COURT_CONTEXT_PROP_MAPPING.map((r) => [r.courtContext, r]));
    expect(byCc.PTS.canonicalOwlsPropType).toBe('points');
    expect(byCc.REB.canonicalOwlsPropType).toBe('rebounds');
    expect(byCc.AST.canonicalOwlsPropType).toBe('assists');
    expect(byCc.PRA.canonicalOwlsPropType).toBe('pts_rebs_asts');
    expect(byCc.PA.canonicalOwlsPropType).toBe('pts_asts');
    expect(byCc.PR.canonicalOwlsPropType).toBe('pts_rebs');
    expect(byCc.RA.canonicalOwlsPropType).toBe('rebs_asts');
    expect(byCc['3PM'].canonicalOwlsPropType).toBe('threes');
    expect(byCc['3PM'].status).toBe('SUPPORTED');
  });
});

describe('trial stop conditions', () => {
  it('stops when event match rate is poor', () => {
    const stop = evaluateStopConditions({
      gamesRequested: 5,
      gamesMatched: 1,
      gamesAmbiguous: 0,
      playerMatchRate: 1,
      corePropsPresent: 8,
      pricesPresent: true,
      consecutive429: 0,
      consecutive503: 0,
      archiveFailures: 0,
      paginationAnomaly: false,
    });
    expect(stop.stop).toBe(true);
    expect(stop.requireApprovalForBulk).toBe(true);
    expect(stop.reasons.some((r) => r.includes('event match rate'))).toBe(true);
  });
});

describe('snapshot probe caps', () => {
  it('stops before exceeding request, row, byte, and game limits', () => {
    expect(OWLS_SNAPSHOT_PROBE_CAPS.maxRequests).toBe(50);
    expect(OWLS_SNAPSHOT_PROBE_CAPS.maxRows).toBe(5000);
    expect(OWLS_SNAPSHOT_PROBE_CAPS.maxCompressedBytes).toBe(25 * 1024 * 1024);
    expect(OWLS_SNAPSHOT_PROBE_CAPS.maxConcurrency).toBe(1);
    expect(OWLS_SNAPSHOT_PROBE_CAPS.maxGames).toBe(4);
    const budget = new SnapshotProbeBudget();
    budget.recordGame();
    budget.recordGame();
    budget.recordGame();
    budget.recordGame();
    expect(budget.canStartGame()).toBe(false);
    const tight = new SnapshotProbeBudget();
    expect(tight.canStartRequest()).toBe(true);
    tight.recordPage({ rows: 4999, compressedBytes: 100 });
    expect(tight.canStartRequest()).toBe(true);
    tight.recordPage({ rows: 2, compressedBytes: 100 });
    expect(tight.canStartRequest()).toBe(false);
  });
});

describe('closing-odds probe contract', () => {
  it('caps the live probe well below a bulk backfill', () => {
    expect(OWLS_CLOSING_ODDS_PROBE_CAPS.maxRequests).toBe(20);
    expect(OWLS_CLOSING_ODDS_PROBE_CAPS.maxGames).toBe(3);
    expect(OWLS_CLOSING_ODDS_PROBE_CAPS.maxConcurrency).toBe(1);
    expect(OWLS_CLOSING_ODDS_PROBE_CAPS.pageLimit).toBe(100);
    expect(OWLS_CLOSING_ODDS_PROBE_CAPS.maxPagesPerGame).toBe(5);
  });

  it('caps full closing-odds backfill well below 50k requests', () => {
    expect(OWLS_CLOSING_ODDS_BACKFILL_CAPS.maxProjectedRequests).toBe(50_000);
    expect(OWLS_CLOSING_ODDS_BACKFILL_CAPS.maxConcurrency).toBe(2);
    expect(OWLS_CLOSING_ODDS_BACKFILL_CAPS.pageLimit).toBe(100);
    expect(OWLS_CLOSING_ODDS_BACKFILL_CAPS.maxPagesPerGame).toBe(10);
  });

  it('classifies research markets without synthesizing a Court Context close', () => {
    expect(classifyMarketKind('h2h')).toBe('MONEYLINE');
    expect(classifyMarketKind('spreads')).toBe('SPREAD');
    expect(classifyMarketKind('totals')).toBe('TOTAL');
    expect(classifyMarketKind('first_half_h2h')).toBe('OTHER');
  });

  it('expands live nested moneyline/spread/total without synthesizing a Court Context close', () => {
    const quotes = expandClosingOddsQuotes({
      eventId: 'nba:Boston Celtics@Los Angeles Lakers-20231225',
      book: 'betmgm',
      source: 'archive-1',
      gameDate: '2023-12-25T00:00:00.000Z',
      moneyline: { home: 155, away: -190 },
      spread: { home: 4.5, away: -4.5, homePrice: -105, awayPrice: -115 },
      total: { line: 234.5, overPrice: -115, underPrice: -105 },
    });
    expect(quotes).toHaveLength(6);
    expect(quotes.filter((q) => q.market === 'MONEYLINE').map((q) => q.side).sort()).toEqual(['away', 'home']);
    expect(quotes.find((q) => q.market === 'SPREAD' && q.side === 'home')?.line).toBe(4.5);
    expect(quotes.find((q) => q.market === 'TOTAL' && q.side === 'over')?.price).toBe(-115);
    expect(quotes.every((q) => q.book === 'betmgm' && q.source === 'archive-1')).toBe(true);
  });
});
