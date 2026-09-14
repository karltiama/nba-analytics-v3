import { describe, expect, it, vi } from 'vitest';
import { OwlsInsightClient, capHistoryConcurrency, extractRows, pageIsExhausted } from '../client';
import { OWLS_HARD_CAP_HISTORY_CONCURRENCY, OWLS_PATHS } from '../contract';
import { OwlsApiKeyRequiredError, OwlsExecuteRequiredError, OwlsRateLimitError } from '../errors';
import { loadOwlsFixtures } from '../fixtures';
import { parseOwlsCliArgs, requireExecutePreconditions } from '../cli';

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

describe('Owls client safeguards', () => {
  it('does not call fetch in dry-run', async () => {
    const fetchImpl = vi.fn();
    const client = new OwlsInsightClient({ mode: 'dry-run', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(
      client.request({ method: 'GET', path: OWLS_PATHS.historyGames, query: { sport: 'nba' } })
    ).rejects.toBeInstanceOf(OwlsExecuteRequiredError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not require an API key in fixture mode', async () => {
    const fetchImpl = vi.fn();
    const client = new OwlsInsightClient({
      mode: 'fixture',
      fixtures: loadOwlsFixtures(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const page = await client.request({
      method: 'GET',
      path: OWLS_PATHS.historyPlayerProps,
      query: { eventId: 'owls-fixture-event-1037995' },
    });
    expect(extractRows(page.body).length).toBe(8);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses execute without an API key', () => {
    expect(() =>
      requireExecutePreconditions(parseOwlsCliArgs(['--execute', '--yes']), { NBA_DATA_BUCKET: 'bucket' })
    ).toThrow(OwlsApiKeyRequiredError);
  });

  it('refuses execute without --yes', () => {
    expect(() =>
      requireExecutePreconditions(parseOwlsCliArgs(['--execute']), {
        OWLS_API_KEY: 'secret',
        NBA_DATA_BUCKET: 'bucket',
      })
    ).toThrow(/--yes/);
  });

  it('caps history concurrency at the documented Hall of Fame in-flight limit', () => {
    expect(capHistoryConcurrency(99)).toBe(OWLS_HARD_CAP_HISTORY_CONCURRENCY);
    expect(capHistoryConcurrency(undefined)).toBe(2);
  });

  it('honors Retry-After on 429 then succeeds', async () => {
    const slept: number[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(
          { code: 'HISTORY_CONCURRENCY' },
          { status: 429, headers: { 'Retry-After': '2', 'x-owls-code': 'HISTORY_CONCURRENCY' } }
        );
      }
      return jsonResponse({ success: true, data: [{ eventId: 'e1' }] });
    });
    const client = new OwlsInsightClient({
      mode: 'execute',
      apiKey: 'test-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async (ms) => {
        slept.push(ms);
      },
      maxRetries: 2,
    });
    const out = await client.request({
      method: 'GET',
      path: OWLS_PATHS.historyPlayerProps,
      query: { eventId: 'e1' },
    });
    expect(extractRows(out.body)).toHaveLength(1);
    expect(slept[0]).toBe(2000);
    expect(client.getMetrics().requestsRetried).toBe(1);
    expect(client.getMetrics().status429).toBe(1);
  });

  it('keeps history concurrency at the configured cap', async () => {
    let inFlight = 0;
    let max = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 25));
      inFlight -= 1;
      return jsonResponse({ data: [] });
    });
    const client = new OwlsInsightClient({
      mode: 'execute',
      apiKey: 'test-key',
      historyConcurrency: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await Promise.all([
      client.request({ method: 'GET', path: OWLS_PATHS.historyGames, query: { sport: 'nba', startDate: 'a' } }),
      client.request({ method: 'GET', path: OWLS_PATHS.historyGames, query: { sport: 'nba', startDate: 'b' } }),
      client.request({ method: 'GET', path: OWLS_PATHS.historyGames, query: { sport: 'nba', startDate: 'c' } }),
    ]);
    expect(max).toBeLessThanOrEqual(2);
    expect(client.maxObservedConcurrency.value).toBeLessThanOrEqual(2);
  });

  it('paginates until a short page', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const u = new URL(url);
      const offset = Number(u.searchParams.get('offset') ?? 0);
      const data = offset === 0 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }];
      return jsonResponse({ data });
    });
    const client = new OwlsInsightClient({
      mode: 'execute',
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const pages = [];
    for await (const page of client.paginate({
      path: OWLS_PATHS.historyPlayerProps,
      query: { eventId: 'e' },
      limit: 2,
    })) {
      pages.push(page);
    }
    expect(pages).toHaveLength(2);
    expect(pages[0]?.exhausted).toBe(false);
    expect(pages[1]?.exhausted).toBe(true);
    expect(pages[1]?.offset).toBe(2);
  });

  it('extracts live /history/props rows from data.snapshots', () => {
    const emptyLive = {
      success: true,
      data: {
        eventId: 'nba:Boston Celtics@Los Angeles Lakers-20231225',
        opening: true,
        timeRange: { start: null, end: null },
        snapshots: [],
        count: 0,
        limit: 1,
        offset: 0,
      },
    };
    expect(extractRows(emptyLive)).toEqual([]);
    expect(pageIsExhausted(emptyLive, 0, 1)).toBe(true);
    const withRows = {
      success: true,
      data: {
        eventId: 'e1',
        opening: true,
        timeRange: { start: null, end: null },
        snapshots: [{ playerName: 'unverified-placeholder' }],
        count: 1,
        limit: 1,
        offset: 0,
      },
    };
    expect(extractRows(withRows)).toHaveLength(1);
  });

  it('extracts live /history/closing-odds rows from data.odds or data.closingOdds', () => {
    expect(
      extractRows({
        success: true,
        data: { closingOdds: [{ book: 'draftkings' }], count: 1, limit: 100, offset: 0 },
      })
    ).toHaveLength(1);
    expect(
      extractRows({
        success: true,
        data: { odds: [{ book: 'fanduel' }], pagination: { total: 1, limit: 100, offset: 0, hasMore: false } },
      })
    ).toHaveLength(1);
  });

  it('extracts live /history/public-betting rows from data.betting', () => {
    expect(
      extractRows({
        success: true,
        data: {
          betting: [{ eventId: 'e1', spread: { homePct: 37, awayPct: 63 } }],
          pagination: { total: 1, hasMore: false },
        },
      })
    ).toHaveLength(1);
    expect(
      extractRows({
        success: true,
        data: { publicBetting: [{ market: 'moneyline', side: 'home' }], pagination: { total: 1, hasMore: false } },
      })
    ).toHaveLength(1);
  });

  it('extracts live /history/games rows from data.games and honors hasMore', () => {
    const liveGamesBody = {
      success: true,
      data: {
        games: [
          {
            eventId: 'nba:Boston Celtics@Los Angeles Lakers-20231225',
            homeTeam: 'Los Angeles Lakers',
            awayTeam: 'Boston Celtics',
            gameDate: '2023-12-25T00:00:00.000Z',
          },
        ],
        pagination: { total: 1, limit: 100, offset: 0, hasMore: false },
      },
    };
    expect(extractRows(liveGamesBody)).toHaveLength(1);
    expect(pageIsExhausted(liveGamesBody, 1, 100)).toBe(true);
    expect(pageIsExhausted({ data: { games: [{ id: 1 }, { id: 2 }], pagination: { hasMore: true } } }, 2, 2)).toBe(
      false
    );
  });
});
