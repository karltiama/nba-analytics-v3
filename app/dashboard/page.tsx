import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { query } from '@/lib/db';
import { getRecentGamesList } from '@/lib/analytics/games-queries';

async function getTopPlayers() {
  return await query(`
    select 
      p.player_id,
      p.full_name,
      p.first_name,
      p.last_name,
      count(distinct pgl.game_id) as games_played,
      avg(pgl.points)::numeric(10,2) as avg_points,
      avg(pgl.rebounds)::numeric(10,2) as avg_rebounds,
      avg(pgl.assists)::numeric(10,2) as avg_assists
    from analytics.players p
    join analytics.player_game_logs pgl on p.player_id = pgl.player_id
    join analytics.games g on pgl.game_id = g.game_id
    group by p.player_id, p.full_name, p.first_name, p.last_name
    having count(distinct pgl.game_id) >= 3
    order by avg_points desc nulls last
    limit 10
  `);
}

export default async function DashboardPage() {
  const [games, players] = await Promise.all([
    getRecentGamesList(10),
    getTopPlayers(),
  ]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div>
          <h1 className="text-4xl font-bold text-black dark:text-zinc-50 mb-2">
            NBA Analytics Dashboard
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            View games, player stats, and team performance
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Recent Games */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
              Recent Games
            </h2>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Matchup</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {games.map((game: any) => (
                    <TableRow key={game.game_id}>
                      <TableCell>
                        {new Date(game.start_time).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm">
                            {game.away_team_abbr} @ {game.home_team_abbr}
                          </span>
                          <span className="text-xs text-zinc-500">
                            {game.away_team_name} vs {game.home_team_name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {game.home_score !== null && game.away_score !== null ? (
                          <span className="font-medium">
                            {game.away_score} - {game.home_score}
                          </span>
                        ) : (
                          <span className="text-zinc-400">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="px-2 py-1 rounded text-xs bg-zinc-100 dark:bg-zinc-800">
                          {game.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Link
              href="/games"
              className="mt-4 inline-block text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              View all games →
            </Link>
          </div>

          {/* Top Players */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
              Top Scorers
            </h2>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead>GP</TableHead>
                    <TableHead>PPG</TableHead>
                    <TableHead>RPG</TableHead>
                    <TableHead>APG</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {players.map((player: any) => (
                    <TableRow key={player.player_id}>
                      <TableCell className="font-medium">
                        {player.full_name}
                      </TableCell>
                      <TableCell>{player.games_played}</TableCell>
                      <TableCell>
                        {player.avg_points != null
                          ? Number(player.avg_points).toFixed(1)
                          : '-'}
                      </TableCell>
                      <TableCell>
                        {player.avg_rebounds != null
                          ? Number(player.avg_rebounds).toFixed(1)
                          : '-'}
                      </TableCell>
                      <TableCell>
                        {player.avg_assists != null
                          ? Number(player.avg_assists).toFixed(1)
                          : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Link
              href="/players"
              className="mt-4 inline-block text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              View all players →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

