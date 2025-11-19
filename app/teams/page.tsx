import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getAllTeamsDefensiveRankings } from '@/lib/teams/defensive-rankings';

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season } = await searchParams;
  const rankings = await getAllTeamsDefensiveRankings(season || null);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-bold text-black dark:text-zinc-50">
            Team Defensive Rankings
          </h1>
          {season && (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              Season: {season}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="p-6">
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              Rankings are based on points allowed per game. Lower rank = better defense.
              Rank #1 = best defense (allows fewest points), Rank #30 = worst defense (allows most points).
            </p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rank</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Conference</TableHead>
                  <TableHead>Division</TableHead>
                  <TableHead className="text-right">Points Allowed</TableHead>
                  <TableHead className="text-right">Rebounds Allowed</TableHead>
                  <TableHead className="text-right">Assists Allowed</TableHead>
                  <TableHead className="text-right">FG% Allowed</TableHead>
                  <TableHead className="text-right">3P% Allowed</TableHead>
                  <TableHead className="text-right">Games</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rankings.map((team: any, index: number) => (
                  <TableRow key={team.team_id}>
                    <TableCell className="font-bold">
                      #{team.points_allowed_rank}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/teams/${team.team_id}`}
                        className="font-medium hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                      >
                        {team.abbreviation}
                      </Link>
                      <div className="text-xs text-zinc-500">
                        {team.full_name}
                      </div>
                    </TableCell>
                    <TableCell className="text-zinc-600 dark:text-zinc-400">
                      {team.conference || '-'}
                    </TableCell>
                    <TableCell className="text-zinc-600 dark:text-zinc-400">
                      {team.division || '-'}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {team.points_allowed_per_game != null
                        ? Number(team.points_allowed_per_game).toFixed(1)
                        : '-'}
                      <div className="text-xs text-zinc-500">
                        Rank: #{team.points_allowed_rank}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {team.rebounds_allowed_per_game != null
                        ? Number(team.rebounds_allowed_per_game).toFixed(1)
                        : '-'}
                      <div className="text-xs text-zinc-500">
                        Rank: #{team.rebounds_allowed_rank}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {team.assists_allowed_per_game != null
                        ? Number(team.assists_allowed_per_game).toFixed(1)
                        : '-'}
                      <div className="text-xs text-zinc-500">
                        Rank: #{team.assists_allowed_rank}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {team.fg_pct_allowed != null
                        ? Number(team.fg_pct_allowed).toFixed(1) + '%'
                        : '-'}
                      <div className="text-xs text-zinc-500">
                        Rank: #{team.fg_pct_allowed_rank}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {team.three_pct_allowed != null
                        ? Number(team.three_pct_allowed).toFixed(1) + '%'
                        : '-'}
                      <div className="text-xs text-zinc-500">
                        Rank: #{team.three_pct_allowed_rank}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-zinc-600 dark:text-zinc-400">
                      {team.games_played || 0}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {rankings.length === 0 && (
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <p className="text-zinc-600 dark:text-zinc-400">
              No defensive rankings available yet. Teams need at least 5 games played.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

