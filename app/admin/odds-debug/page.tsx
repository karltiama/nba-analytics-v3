import { query } from '@/lib/db';
import Link from 'next/link';

interface OddsSummary {
  total_markets: number;
  total_staging_events: number;
  processed_events: number;
  unprocessed_events: number;
  unique_games: number;
  unique_bookmakers: number;
  markets_by_type: Array<{ market_type: string; count: number }>;
  markets_by_snapshot: Array<{ snapshot_type: string; count: number }>;
}

async function getOddsSummary(): Promise<OddsSummary> {
  const [
    totalMarkets,
    totalStaging,
    processedStaging,
    unprocessedStaging,
    uniqueGames,
    uniqueBookmakers,
    marketsByType,
    marketsBySnapshot,
  ] = await Promise.all([
    query(`SELECT COUNT(*) as count FROM markets`),
    query(`SELECT COUNT(*) as count FROM staging_events WHERE source = 'oddsapi'`),
    query(`SELECT COUNT(*) as count FROM staging_events WHERE source = 'oddsapi' AND processed = true`),
    query(`SELECT COUNT(*) as count FROM staging_events WHERE source = 'oddsapi' AND processed = false`),
    query(`SELECT COUNT(DISTINCT game_id) as count FROM markets`),
    query(`SELECT COUNT(DISTINCT bookmaker) as count FROM markets`),
    query(`
      SELECT market_type, COUNT(*) as count
      FROM markets
      GROUP BY market_type
      ORDER BY count DESC
    `),
    query(`
      SELECT snapshot_type, COUNT(*) as count
      FROM markets
      GROUP BY snapshot_type
      ORDER BY count DESC
    `),
  ]);

  return {
    total_markets: totalMarkets[0]?.count || 0,
    total_staging_events: totalStaging[0]?.count || 0,
    processed_events: processedStaging[0]?.count || 0,
    unprocessed_events: unprocessedStaging[0]?.count || 0,
    unique_games: uniqueGames[0]?.count || 0,
    unique_bookmakers: uniqueBookmakers[0]?.count || 0,
    markets_by_type: marketsByType as Array<{ market_type: string; count: number }>,
    markets_by_snapshot: marketsBySnapshot as Array<{ snapshot_type: string; count: number }>,
  };
}

async function getRecentStagingEvents(limit: number = 10) {
  return await query(`
    SELECT 
      id,
      cursor,
      fetched_at,
      processed,
      processed_at,
      error_message,
      CASE 
        WHEN jsonb_typeof(payload) = 'array' THEN jsonb_array_length(payload)
        ELSE 1
      END as event_count
    FROM staging_events
    WHERE source = 'oddsapi'
    ORDER BY fetched_at DESC
    LIMIT $1
  `, [limit]);
}

async function getRecentMarkets(limit: number = 20) {
  return await query(`
    SELECT 
      m.id,
      m.game_id,
      m.market_type,
      m.bookmaker,
      m.snapshot_type,
      m.side,
      m.line,
      m.odds,
      m.fetched_at,
      bs.home_team_abbr,
      bs.away_team_abbr,
      bs.game_date
    FROM markets m
    LEFT JOIN bbref_schedule bs ON m.game_id = bs.bbref_game_id OR m.game_id = bs.canonical_game_id
    ORDER BY m.fetched_at DESC
    LIMIT $1
  `, [limit]);
}

async function getMarketsByGame() {
  return await query(`
    SELECT 
      m.game_id,
      bs.home_team_abbr || ' vs ' || bs.away_team_abbr as matchup,
      bs.game_date,
      COUNT(DISTINCT m.market_type) as market_types,
      COUNT(DISTINCT m.bookmaker) as bookmakers,
      COUNT(*) as total_markets,
      MAX(m.fetched_at) as latest_fetch
    FROM markets m
    LEFT JOIN bbref_schedule bs ON m.game_id = bs.bbref_game_id OR m.game_id = bs.canonical_game_id
    GROUP BY m.game_id, bs.home_team_abbr, bs.away_team_abbr, bs.game_date
    ORDER BY latest_fetch DESC
    LIMIT 20
  `);
}

async function getUnprocessedEvents() {
  return await query(`
    SELECT 
      id,
      cursor,
      fetched_at,
      error_message,
      CASE 
        WHEN jsonb_typeof(payload) = 'array' THEN jsonb_array_length(payload)
        ELSE 1
      END as event_count
    FROM staging_events
    WHERE source = 'oddsapi' 
      AND processed = false
    ORDER BY fetched_at DESC
    LIMIT 20
  `);
}

export default async function OddsDebugPage() {
  const [summary, recentStaging, recentMarkets, marketsByGame, unprocessed] = await Promise.all([
    getOddsSummary(),
    getRecentStagingEvents(10),
    getRecentMarkets(20),
    getMarketsByGame(),
    getUnprocessedEvents(),
  ]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-black dark:text-zinc-50 mb-2">
              Odds API Debug
            </h1>
            <p className="text-zinc-600 dark:text-zinc-400">
              View and verify odds data from Odds API
            </p>
          </div>
          <div className="flex gap-4">
            <Link
              href="/admin/data-dump"
              className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-zinc-50"
            >
              ← Data Dump
            </Link>
            <Link
              href="/dashboard"
              className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-zinc-50"
            >
              Dashboard
            </Link>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">Total Markets</div>
            <div className="text-3xl font-bold text-black dark:text-zinc-50">
              {summary.total_markets.toLocaleString()}
            </div>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">Staging Events</div>
            <div className="text-3xl font-bold text-black dark:text-zinc-50">
              {summary.total_staging_events.toLocaleString()}
            </div>
            <div className="text-xs mt-1">
              <span className="text-green-600 dark:text-green-400">
                {summary.processed_events} processed
              </span>
              {summary.unprocessed_events > 0 && (
                <span className="text-red-600 dark:text-red-400 ml-2">
                  {summary.unprocessed_events} unprocessed
                </span>
              )}
            </div>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">Games with Odds</div>
            <div className="text-3xl font-bold text-black dark:text-zinc-50">
              {summary.unique_games.toLocaleString()}
            </div>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">Bookmakers</div>
            <div className="text-3xl font-bold text-black dark:text-zinc-50">
              {summary.unique_bookmakers.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Markets by Type and Snapshot */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
              Markets by Type
            </h2>
            <div className="space-y-2">
              {summary.markets_by_type.map((item) => (
                <div key={item.market_type} className="flex justify-between items-center">
                  <span className="text-zinc-600 dark:text-zinc-400 capitalize">
                    {item.market_type.replace('_', ' ')}
                  </span>
                  <span className="font-semibold text-black dark:text-zinc-50">
                    {item.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
              Markets by Snapshot
            </h2>
            <div className="space-y-2">
              {summary.markets_by_snapshot.map((item) => (
                <div key={item.snapshot_type} className="flex justify-between items-center">
                  <span className="text-zinc-600 dark:text-zinc-400 capitalize">
                    {item.snapshot_type.replace('_', ' ')}
                  </span>
                  <span className="font-semibold text-black dark:text-zinc-50">
                    {item.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Unprocessed Events Warning */}
        {unprocessed.length > 0 && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg shadow-sm border border-yellow-200 dark:border-yellow-800 p-6">
            <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
              ⚠️ Unprocessed Staging Events ({unprocessed.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-yellow-200 dark:border-yellow-800">
                    <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">ID</th>
                    <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Cursor</th>
                    <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Fetched At</th>
                    <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Events</th>
                    <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {unprocessed.map((event: any) => (
                    <tr key={event.id} className="border-b border-yellow-100 dark:border-yellow-900">
                      <td className="py-2 px-4 text-black dark:text-zinc-50 font-mono text-sm">
                        {event.id}
                      </td>
                      <td className="py-2 px-4 text-black dark:text-zinc-50">
                        {event.cursor || '-'}
                      </td>
                      <td className="py-2 px-4 text-black dark:text-zinc-50">
                        {new Date(event.fetched_at).toLocaleString()}
                      </td>
                      <td className="py-2 px-4 text-black dark:text-zinc-50">
                        {event.event_count || 0}
                      </td>
                      <td className="py-2 px-4">
                        {event.error_message ? (
                          <span className="text-red-600 dark:text-red-400 text-sm">
                            {event.error_message.substring(0, 50)}...
                          </span>
                        ) : (
                          <span className="text-zinc-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Markets by Game */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
          <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
            Markets by Game (Last 20)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Game</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Date</th>
                  <th className="text-right py-2 px-4 text-zinc-600 dark:text-zinc-400">Market Types</th>
                  <th className="text-right py-2 px-4 text-zinc-600 dark:text-zinc-400">Bookmakers</th>
                  <th className="text-right py-2 px-4 text-zinc-600 dark:text-zinc-400">Total Markets</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Latest Fetch</th>
                </tr>
              </thead>
              <tbody>
                {marketsByGame.map((game: any) => (
                  <tr key={game.game_id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 px-4 text-black dark:text-zinc-50">
                      {game.matchup || game.game_id}
                    </td>
                    <td className="py-2 px-4 text-black dark:text-zinc-50">
                      {game.game_date ? new Date(game.game_date).toLocaleDateString() : '-'}
                    </td>
                    <td className="py-2 px-4 text-right text-black dark:text-zinc-50">
                      {game.market_types}
                    </td>
                    <td className="py-2 px-4 text-right text-black dark:text-zinc-50">
                      {game.bookmakers}
                    </td>
                    <td className="py-2 px-4 text-right text-black dark:text-zinc-50">
                      {game.total_markets}
                    </td>
                    <td className="py-2 px-4 text-black dark:text-zinc-50 text-sm">
                      {game.latest_fetch
                        ? new Date(game.latest_fetch).toLocaleString()
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Markets */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
          <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
            Recent Markets (Last 20)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Game</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Market</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Bookmaker</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Side</th>
                  <th className="text-right py-2 px-4 text-zinc-600 dark:text-zinc-400">Line</th>
                  <th className="text-right py-2 px-4 text-zinc-600 dark:text-zinc-400">Odds</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Snapshot</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Fetched</th>
                </tr>
              </thead>
              <tbody>
                {recentMarkets.map((market: any) => (
                  <tr key={market.id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 px-4 text-black dark:text-zinc-50">
                      {market.matchup || market.game_id?.substring(0, 20)}
                    </td>
                    <td className="py-2 px-4">
                      <span className="px-2 py-1 rounded text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 capitalize">
                        {market.market_type.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-black dark:text-zinc-50 capitalize">
                      {market.bookmaker}
                    </td>
                    <td className="py-2 px-4 text-black dark:text-zinc-50 capitalize">
                      {market.side || '-'}
                    </td>
                    <td className="py-2 px-4 text-right text-black dark:text-zinc-50">
                      {market.line !== null ? market.line : '-'}
                    </td>
                    <td className="py-2 px-4 text-right">
                      <span
                        className={`font-semibold ${
                          market.odds > 0
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {market.odds > 0 ? '+' : ''}
                        {market.odds}
                      </span>
                    </td>
                    <td className="py-2 px-4">
                      <span className="px-2 py-1 rounded text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 capitalize">
                        {market.snapshot_type.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-black dark:text-zinc-50 text-sm">
                      {new Date(market.fetched_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Staging Events */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
          <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
            Recent Staging Events (Last 10)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">ID</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Cursor</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Fetched At</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Events</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Status</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Processed At</th>
                </tr>
              </thead>
              <tbody>
                {recentStaging.map((event: any) => (
                  <tr key={event.id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 px-4 text-black dark:text-zinc-50 font-mono text-sm">
                      {event.id}
                    </td>
                    <td className="py-2 px-4 text-black dark:text-zinc-50">
                      {event.cursor || '-'}
                    </td>
                    <td className="py-2 px-4 text-black dark:text-zinc-50">
                      {new Date(event.fetched_at).toLocaleString()}
                    </td>
                    <td className="py-2 px-4 text-black dark:text-zinc-50">
                      {event.event_count || 0}
                    </td>
                    <td className="py-2 px-4">
                      {event.processed ? (
                        <span className="px-2 py-1 rounded text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                          ✓ Processed
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                          ⏳ Pending
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-black dark:text-zinc-50 text-sm">
                      {event.processed_at
                        ? new Date(event.processed_at).toLocaleString()
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Console Command */}
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 p-6">
          <h2 className="text-xl font-semibold text-black dark:text-zinc-50 mb-2">
            Test Odds API
          </h2>
          <p className="text-zinc-600 dark:text-zinc-400 mb-4">
            To fetch and store today's odds, run:
          </p>
          <code className="block bg-zinc-900 text-green-400 p-4 rounded-lg font-mono text-sm">
            tsx scripts/test-odds-api.ts
          </code>
        </div>
      </div>
    </div>
  );
}

