import { query } from '@/lib/db';
import Link from 'next/link';

interface DataOverview {
  games: {
    total: number;
    by_status: Array<{ status: string; count: number }>;
    by_season: Array<{ season: string; count: number }>;
    with_scores: number;
    with_boxscores: number;
  };
  teams: number;
  players: number;
  provider_mappings: number;
  team_game_stats: number;
  player_game_stats: number;
}

async function getDataOverview(): Promise<DataOverview> {
  const [gamesTotal, gamesByStatus, gamesBySeason, gamesWithScores, gamesWithBoxscores, teamsCount, playersCount, mappingsCount, teamStatsCount, playerStatsCount] = await Promise.all([
    query(`SELECT COUNT(*) as count FROM games`),
    query(`
      SELECT status, COUNT(*) as count 
      FROM games 
      GROUP BY status 
      ORDER BY count DESC
    `),
    query(`
      SELECT season, COUNT(*) as count 
      FROM games 
      GROUP BY season 
      ORDER BY season DESC
    `),
    query(`SELECT COUNT(*) as count FROM games WHERE home_score IS NOT NULL AND away_score IS NOT NULL`),
    query(`SELECT COUNT(DISTINCT game_id) as count FROM player_game_stats`),
    query(`SELECT COUNT(*) as count FROM teams`),
    query(`SELECT COUNT(*) as count FROM players`),
    query(`SELECT COUNT(*) as count FROM provider_id_map WHERE entity_type = 'game'`),
    query(`SELECT COUNT(*) as count FROM team_game_stats`),
    query(`SELECT COUNT(*) as count FROM player_game_stats`),
  ]);

  return {
    games: {
      total: gamesTotal[0]?.count || 0,
      by_status: gamesByStatus as Array<{ status: string; count: number }>,
      by_season: gamesBySeason as Array<{ season: string; count: number }>,
      with_scores: gamesWithScores[0]?.count || 0,
      with_boxscores: gamesWithBoxscores[0]?.count || 0,
    },
    teams: teamsCount[0]?.count || 0,
    players: playersCount[0]?.count || 0,
    provider_mappings: mappingsCount[0]?.count || 0,
    team_game_stats: teamStatsCount[0]?.count || 0,
    player_game_stats: playerStatsCount[0]?.count || 0,
  };
}

async function getRecentGames(limit: number = 10) {
  return await query(`
    SELECT 
      g.game_id,
      g.season,
      g.start_time,
      g.status,
      g.home_score,
      g.away_score,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr,
      (SELECT COUNT(*) FROM player_game_stats WHERE game_id = g.game_id) as boxscore_count
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    ORDER BY g.start_time DESC
    LIMIT $1
  `, [limit]);
}

async function getSampleGames() {
  return await query(`
    SELECT 
      g.game_id,
      g.season,
      g.start_time,
      g.status,
      g.home_score,
      g.away_score,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr,
      CASE 
        WHEN g.game_id LIKE '002%' THEN 'NBA Stats'
        WHEN g.game_id LIKE '184%' THEN 'BallDontLie'
        ELSE 'Unknown'
      END as source
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    ORDER BY g.start_time DESC
    LIMIT 20
  `);
}

async function getDuplicateGames() {
  return await query(`
    WITH game_duplicates AS (
      SELECT 
        g1.game_id as game1_id,
        g2.game_id as game2_id,
        g1.start_time as time1,
        g2.start_time as time2,
        (g1.start_time AT TIME ZONE 'America/New_York')::date as date1_et,
        (g2.start_time AT TIME ZONE 'America/New_York')::date as date2_et,
        ABS(EXTRACT(EPOCH FROM (g1.start_time - g2.start_time))) / 3600 as hours_diff,
        ht.abbreviation as home_abbr,
        at.abbreviation as away_abbr
      FROM games g1
      JOIN games g2 ON (
        g1.home_team_id = g2.home_team_id
        AND g1.away_team_id = g2.away_team_id
        AND g1.game_id < g2.game_id
        AND ABS(EXTRACT(EPOCH FROM (g1.start_time - g2.start_time))) < 172800
      )
      JOIN teams ht ON g1.home_team_id = ht.team_id
      JOIN teams at ON g1.away_team_id = at.team_id
    )
    SELECT * FROM game_duplicates
    ORDER BY hours_diff ASC
    LIMIT 20
  `);
}

async function getProviderMappingStats() {
  return await query(`
    SELECT 
      provider,
      COUNT(*) as count,
      COUNT(DISTINCT internal_id) as unique_games
    FROM provider_id_map
    WHERE entity_type = 'game'
    GROUP BY provider
    ORDER BY count DESC
  `);
}

export default async function DataDumpPage() {
  const [overview, recentGames, sampleGames, duplicateGames, mappingStats] = await Promise.all([
    getDataOverview(),
    getRecentGames(10),
    getSampleGames(),
    getDuplicateGames(),
    getProviderMappingStats(),
  ]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-black dark:text-zinc-50 mb-2">
              Database Data Dump
            </h1>
            <p className="text-zinc-600 dark:text-zinc-400">
              Visual overview of your NBA analytics database
            </p>
          </div>
          <div className="flex gap-4">
            <Link
              href="/admin/odds-debug"
              className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-zinc-50"
            >
              Odds Debug
            </Link>
            <Link
              href="/dashboard"
              className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-zinc-50"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </div>

        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">Total Games</div>
            <div className="text-3xl font-bold text-black dark:text-zinc-50">{overview.games.total.toLocaleString()}</div>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">Teams</div>
            <div className="text-3xl font-bold text-black dark:text-zinc-50">{overview.teams}</div>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">Players</div>
            <div className="text-3xl font-bold text-black dark:text-zinc-50">{overview.players.toLocaleString()}</div>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">Games with Box Scores</div>
            <div className="text-3xl font-bold text-black dark:text-zinc-50">{overview.games.with_boxscores.toLocaleString()}</div>
          </div>
        </div>

        {/* Games Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
              Games by Status
            </h2>
            <div className="space-y-2">
              {overview.games.by_status.map((item) => (
                <div key={item.status} className="flex justify-between items-center">
                  <span className="text-zinc-600 dark:text-zinc-400">{item.status || '(null)'}</span>
                  <span className="font-semibold text-black dark:text-zinc-50">{item.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
              Games by Season
            </h2>
            <div className="space-y-2">
              {overview.games.by_season.map((item) => (
                <div key={item.season} className="flex justify-between items-center">
                  <span className="text-zinc-600 dark:text-zinc-400">{item.season || '(null)'}</span>
                  <span className="font-semibold text-black dark:text-zinc-50">{item.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Provider Mappings */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
          <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
            Provider Mappings
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Provider</th>
                  <th className="text-right py-2 px-4 text-zinc-600 dark:text-zinc-400">Total Mappings</th>
                  <th className="text-right py-2 px-4 text-zinc-600 dark:text-zinc-400">Unique Games</th>
                </tr>
              </thead>
              <tbody>
                {mappingStats.map((stat: any) => (
                  <tr key={stat.provider} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 px-4 text-black dark:text-zinc-50">{stat.provider || '(null)'}</td>
                    <td className="py-2 px-4 text-right text-black dark:text-zinc-50">{stat.count.toLocaleString()}</td>
                    <td className="py-2 px-4 text-right text-black dark:text-zinc-50">{stat.unique_games.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Games */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
          <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
            Recent Games (Last 10)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Date</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Game</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Status</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Score</th>
                  <th className="text-right py-2 px-4 text-zinc-600 dark:text-zinc-400">Box Score</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">ID</th>
                </tr>
              </thead>
              <tbody>
                {recentGames.map((game: any) => (
                  <tr key={game.game_id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 px-4 text-black dark:text-zinc-50">
                      {new Date(game.start_time).toLocaleDateString()}
                    </td>
                    <td className="py-2 px-4 text-black dark:text-zinc-50">
                      {game.away_abbr} @ {game.home_abbr}
                    </td>
                    <td className="py-2 px-4">
                      <span className={`px-2 py-1 rounded text-xs ${
                        game.status === 'Final' 
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                      }`}>
                        {game.status}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-black dark:text-zinc-50">
                      {game.home_score !== null && game.away_score !== null
                        ? `${game.away_score} - ${game.home_score}`
                        : '-'}
                    </td>
                    <td className="py-2 px-4 text-right text-black dark:text-zinc-50">
                      {game.boxscore_count > 0 ? `${game.boxscore_count} players` : '-'}
                    </td>
                    <td className="py-2 px-4">
                      <Link
                        href={`/games/${game.game_id}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline text-xs font-mono"
                      >
                        {game.game_id.substring(0, 20)}...
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Duplicate Games */}
        {duplicateGames.length > 0 && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg shadow-sm border border-yellow-200 dark:border-yellow-800 p-6">
            <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
              Potential Duplicate Games ({duplicateGames.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-yellow-200 dark:border-yellow-800">
                    <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Teams</th>
                    <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Date 1 (ET)</th>
                    <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Date 2 (ET)</th>
                    <th className="text-right py-2 px-4 text-zinc-600 dark:text-zinc-400">Hours Diff</th>
                    <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Game IDs</th>
                  </tr>
                </thead>
                <tbody>
                  {duplicateGames.map((dup: any, idx: number) => (
                    <tr key={idx} className="border-b border-yellow-100 dark:border-yellow-900">
                      <td className="py-2 px-4 text-black dark:text-zinc-50">
                        {dup.away_abbr} @ {dup.home_abbr}
                      </td>
                      <td className="py-2 px-4 text-black dark:text-zinc-50">
                        {new Date(dup.date1_et).toLocaleDateString()}
                      </td>
                      <td className="py-2 px-4 text-black dark:text-zinc-50">
                        {new Date(dup.date2_et).toLocaleDateString()}
                      </td>
                      <td className="py-2 px-4 text-right text-black dark:text-zinc-50">
                        {Number(dup.hours_diff).toFixed(1)}h
                      </td>
                      <td className="py-2 px-4">
                        <div className="flex gap-2">
                          <Link
                            href={`/games/${dup.game1_id}`}
                            className="text-blue-600 dark:text-blue-400 hover:underline text-xs font-mono"
                          >
                            {dup.game1_id.substring(0, 15)}...
                          </Link>
                          <span className="text-zinc-400">/</span>
                          <Link
                            href={`/games/${dup.game2_id}`}
                            className="text-blue-600 dark:text-blue-400 hover:underline text-xs font-mono"
                          >
                            {dup.game2_id.substring(0, 15)}...
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Sample Games */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
          <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
            Sample Games (Last 20)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Date</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Game</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Status</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Score</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Source</th>
                  <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">ID</th>
                </tr>
              </thead>
              <tbody>
                {sampleGames.map((game: any) => (
                  <tr key={game.game_id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 px-4 text-black dark:text-zinc-50">
                      {new Date(game.start_time).toLocaleDateString()}
                    </td>
                    <td className="py-2 px-4 text-black dark:text-zinc-50">
                      {game.away_abbr} @ {game.home_abbr}
                    </td>
                    <td className="py-2 px-4">
                      <span className={`px-2 py-1 rounded text-xs ${
                        game.status === 'Final' 
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                      }`}>
                        {game.status}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-black dark:text-zinc-50">
                      {game.home_score !== null && game.away_score !== null
                        ? `${game.away_score} - ${game.home_score}`
                        : '-'}
                    </td>
                    <td className="py-2 px-4">
                      <span className={`px-2 py-1 rounded text-xs ${
                        game.source === 'NBA Stats'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                          : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                      }`}>
                        {game.source}
                      </span>
                    </td>
                    <td className="py-2 px-4">
                      <Link
                        href={`/games/${game.game_id}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline text-xs font-mono"
                      >
                        {game.game_id.substring(0, 20)}...
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Stats Summary */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
          <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
            Statistics Summary
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Games with Scores</div>
              <div className="text-2xl font-bold text-black dark:text-zinc-50">
                {overview.games.with_scores.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Team Game Stats</div>
              <div className="text-2xl font-bold text-black dark:text-zinc-50">
                {overview.team_game_stats.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Player Game Stats</div>
              <div className="text-2xl font-bold text-black dark:text-zinc-50">
                {overview.player_game_stats.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Provider Mappings</div>
              <div className="text-2xl font-bold text-black dark:text-zinc-50">
                {overview.provider_mappings.toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

