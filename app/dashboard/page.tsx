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

async function getRecentGames() {
  return await query(`
    select 
      g.game_id,
      g.season,
      g.start_time,
      g.status,
      g.home_score,
      g.away_score,
      g.venue,
      ht.abbreviation as home_team_abbr,
      ht.full_name as home_team_name,
      at.abbreviation as away_team_abbr,
      at.full_name as away_team_name
    from games g
    join teams ht on g.home_team_id = ht.team_id
    join teams at on g.away_team_id = at.team_id
    where g.status = 'Final'
    order by g.start_time desc
    limit 10
  `);
}

async function getTopPlayers() {
  return await query(`
    select 
      p.player_id,
      p.full_name,
      p.first_name,
      p.last_name,
      count(distinct pgs.game_id) as games_played,
      avg(pgs.points) as avg_points,
      avg(pgs.rebounds) as avg_rebounds,
      avg(pgs.assists) as avg_assists
    from players p
    join player_game_stats pgs on p.player_id = pgs.player_id
    join games g on pgs.game_id = g.game_id
    group by p.player_id, p.full_name, p.first_name, p.last_name
    having count(distinct pgs.game_id) >= 3
    order by avg_points desc nulls last
    limit 10
  `);
}

export default async function DashboardPage() {
  const [games, players] = await Promise.all([
    getRecentGames(),
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
                        {player.avg_points ? player.avg_points.toFixed(1) : '-'}
                      </TableCell>
                      <TableCell>
                        {player.avg_rebounds ? player.avg_rebounds.toFixed(1) : '-'}
                      </TableCell>
                      <TableCell>
                        {player.avg_assists ? player.avg_assists.toFixed(1) : '-'}
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

