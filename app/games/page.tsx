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

async function getGames() {
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
    limit 100
  `);
}

export default async function GamesPage() {
  const games = await getGames();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-black dark:text-zinc-50 mb-2">
              Games
            </h1>
            <p className="text-zinc-600 dark:text-zinc-400">
              View all completed games from the 2025-26 season
            </p>
          </div>
          <Link
            href="/dashboard"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            ← Back to Dashboard
          </Link>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Matchup</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {games.map((game: any) => (
                <TableRow key={game.game_id}>
                  <TableCell>
                    {new Date(game.start_time).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">
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
                  <TableCell>
                    <Link
                      href={`/games/${game.game_id}`}
                      className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      View Box Score
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

