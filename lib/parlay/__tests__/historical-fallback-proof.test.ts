import { existsSync, readFileSync } from 'node:fs';
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyFallbackSqlQuotes, runHistoricalFallbackProof } from '@/lib/parlay/historical-fallback-proof';
import { resolveParlayQuoteFallback } from '@/lib/parlay/resolve-parlay-quotes';
import { quotesForLegs, type TrueCostLegKey } from '@/lib/parlay/true-cost-quotes';
import type { HistoricalBoardObjectStore } from '@/lib/props/historical-board-archive';
import { localHistoricalBoardStore } from '@/lib/props/historical-board-store';

const ARCHIVE = 'D:\\court-context-backups\\cc-pg-logical-20261114T191459Z\\historical-board-archive';
const ARCHIVED: TrueCostLegKey = {
  gameId: '21718091',
  playerId: '70',
  market: 'assists',
  side: 'over',
  line: 3.5,
};

const mocks = vi.hoisted(() => ({ admin: vi.fn() }));

vi.mock('@/lib/model-lab/admin-route', () => ({
  withAdminJson: (...args: unknown[]) => mocks.admin(...args),
}));

vi.mock('@aws-sdk/client-sts', () => ({
  GetCallerIdentityCommand: class GetCallerIdentityCommand {},
  STSClient: class STSClient { send() { return Promise.resolve({}); } },
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class S3Client {},
}));

import { GET, POST } from '@/app/api/admin/historical-quote-fallback/route';

function productionRequest(origin = 'https://courtcontext.com', fetchSite = 'same-origin') {
  return new NextRequest('https://courtcontext.com/api/admin/historical-quote-fallback', {
    method: 'POST',
    headers: { origin, 'sec-fetch-site': fetchSite },
  });
}

describe('historical quote fallback proof', () => {
  beforeEach(() => {
    mocks.admin.mockReset();
    vi.unstubAllEnvs();
    vi.stubEnv('VERCEL_ENV', 'production');
  });

  it('keeps the ordinary price route on SQL and the diagnostic on a fixed empty fixture', () => {
    const route = readFileSync('app/api/betting/parlay-prices/route.ts', 'utf8');
    const diagnostic = readFileSync('app/api/admin/historical-quote-fallback/route.ts', 'utf8');
    const proof = readFileSync('lib/parlay/historical-fallback-proof.ts', 'utf8');
    expect(route).toContain('loadCurrentLegQuotes');
    expect(route).toContain('resolveParlayQuoteFallback');
    expect(route).not.toContain('emptyFallbackSqlQuotes');
    expect(diagnostic).not.toContain('request.json');
    expect(diagnostic).not.toContain('PutObject');
    expect(diagnostic).not.toContain('INSERT');
    expect(diagnostic).toContain('SELECT game_id::text');
    expect(proof).not.toContain('research.prop_decision_lines');
    expect(emptyFallbackSqlQuotes().every((quotes) => quotes.length === 0)).toBe(true);
  });

  it('does not invent an opposite price for a one-sided quote', () => {
    const quotes = quotesForLegs(
      [{ gameId: '1', playerId: '2', market: 'points', side: 'over', line: 10.5 }],
      [{
        game_id: '1',
        player_id: '2',
        sportsbook: 'DraftKings',
        prop_type: 'points',
        side: 'over',
        line_value: '10.5',
        odds_american: -115,
      }]
    );
    expect(quotes[0]?.[0]?.oppositeAmerican ?? null).toBeNull();
  });

  it('keeps a SQL quote and does not open the archive', async () => {
    const store: HistoricalBoardObjectStore = {
      async getObject() {
        throw new Error('archive_should_not_open');
      },
    };
    const resolved = await resolveParlayQuoteFallback({
      legs: [ARCHIVED],
      vendors: ['betmgm'],
      bestBookEnabled: true,
      source: { mode: 's3', bucket: 'nba-analytics-data-260029269390', region: 'us-east-1' },
      loadSqlQuotes: async () => [[{
        vendor: 'betmgm',
        displayName: 'BetMGM',
        priceAmerican: -110,
        oppositeAmerican: -110,
      }]],
      store,
    });
    expect(resolved.quoteSource).toBe('analytics.player_props_current');
    expect(resolved.sqlRowCount).toBe(1);
    expect(resolved.quotesPerLeg[0]?.[0]?.priceAmerican).toBe(-110);
  });

  it('reports an archive failure instead of a substitute price', async () => {
    await expect(resolveParlayQuoteFallback({
      legs: [ARCHIVED],
      vendors: [null],
      bestBookEnabled: true,
      source: { mode: 's3', bucket: 'nba-analytics-data-260029269390', region: 'us-east-1' },
      loadSqlQuotes: async () => [[]],
      store: { async getObject() { throw new Error('archive_unavailable'); } },
    })).rejects.toThrow('archive_unavailable');
  });

  it('stays closed outside production and rejects another site', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    const missing = await POST(productionRequest());
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
    expect(mocks.admin).not.toHaveBeenCalled();
    vi.stubEnv('VERCEL_ENV', 'production');
    const foreign = await POST(productionRequest('https://example.com', 'cross-site'));
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get('cache-control')).toBe('no-store');
    const denied = NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    mocks.admin.mockResolvedValue(denied);
    const response = await POST(productionRequest());
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const get = await GET();
    expect(get.status).toBe(404);
  });

  it('fills the fixed archived leg from the local archive when SQL is empty', async () => {
    if (!existsSync(ARCHIVE)) return;
    const report = await runHistoricalFallbackProof({
      source: { mode: 'local', directory: ARCHIVE },
      store: localHistoricalBoardStore(ARCHIVE),
      todayEt: '2026-11-15',
    });
    expect(report.sqlRowCount).toBe(0);
    expect(report.cohortMember).toBe(true);
    expect(report.quoteSource).toBe('historical-board-archive');
    expect(report.objectsRead).toEqual(['manifest.json', 'date=2026-11-12.json.gz']);
    expect(report.manifestSha256).toBe('1c21be4abec6b16efa3b2c1be7d4c21ec65ba3e58063960c1d4074678ecfd309');
    expect(report.november12Sha256).toBe('9fa7157d0b25822ccd27097f75e1999e4ce98764d20f2baf4785f42c99898bfd');
    expect(report.savedPriceAmerican).toBe(-110);
    expect(report.savedPriceUnchanged).toBe(true);
    expect(report.oppositePresent).toBe(true);
    expect(report.oppositeAtSavedBook).toBe(true);
    expect(report.otherLineQuoteCount).toBe(0);
    expect(report.protectedQuoteCount).toBe(0);
    expect(report.openQuoteCount).toBe(0);
    expect(report.bestBookFromArchivedQuotes).toBe(true);
    expect(report.todayReadsArchive).toBe(false);
    expect(report.protectedOrOpenRequestedArchive).toBe(false);
    expect(report.researchCloseUsed).toBe(false);
    expect(JSON.stringify(report)).not.toContain('playerName');
    expect(JSON.stringify(report)).not.toContain('eyJ');
  });
});
