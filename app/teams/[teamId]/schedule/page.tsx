import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { resolveAnalyticsTeamId, getTeamById } from '@/lib/teams/analytics-queries';
import { getScheduleForTeam } from '@/lib/analytics/games-queries';

function toDisplayTime(startTime: string | null): string {
  if (!startTime) return 'TBD';
  const d = new Date(startTime);
  return isNaN(d.getTime()) ? 'TBD' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

function toDisplayDate(startTime: string | null, now: Date): string {
  if (!startTime) return 'TBD';
  const d = new Date(startTime);
  if (isNaN(d.getTime())) return 'TBD';
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  });
}

export default async function TeamSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ season?: string; status?: string }>;
}) {
  const { teamId } = await params;
  const { season } = await searchParams; // status filter can be added later if needed

  const analyticsTeamId = await resolveAnalyticsTeamId(teamId);
  if (!analyticsTeamId) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">Team not found</h1>
          <Link href="/teams" className="text-blue-600 dark:text-blue-400 hover:underline">
            ← Back to Teams
          </Link>
        </div>
      </div>
    );
  }

  const [team, schedule] = await Promise.all([
    getTeamById(analyticsTeamId),
    getScheduleForTeam(analyticsTeamId, season),
  ]);

  if (!team) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">Team not found</h1>
          <Link href="/teams" className="text-blue-600 dark:text-blue-400 hover:underline">
            ← Back to Teams
          </Link>
        </div>
      </div>
    );
  }

  if (!schedule || schedule.length === 0) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <div>
            <Link
              href={`/teams/${teamId}`}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-block"
            >
              ← Back to {team.full_name}
            </Link>
            <h1 className="text-4xl font-bold text-black dark:text-zinc-50 mb-2">
              {team.full_name} Schedule
            </h1>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <p className="text-zinc-600 dark:text-zinc-400">
              No schedule data available yet.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const now = new Date();
  const pastGames = schedule.filter((game) => game.start_time && new Date(game.start_time) <= now);
  const upcomingGames = schedule.filter((game) => !game.start_time || new Date(game.start_time) > now);

  const wins = pastGames.filter((g) => g.result === 'W').length;
  const losses = pastGames.filter((g) => g.result === 'L').length;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <Link
            href={`/teams/${teamId}`}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-block"
          >
            ← Back to {team.full_name}
          </Link>
          <h1 className="text-4xl font-bold text-black dark:text-zinc-50 mb-2">
            {team.full_name} Schedule
          </h1>
          {pastGames.length > 0 && (
            <p className="text-zinc-600 dark:text-zinc-400">
              Record: <span className="font-bold text-black dark:text-zinc-50">{wins}-{losses}</span>
            </p>
          )}
        </div>

        {upcomingGames.length > 0 && (
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
              Upcoming Games ({upcomingGames.length})
            </h2>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Opponent</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcomingGames.map((game) => {
                    const gameDate = game.start_time ? new Date(game.start_time) : null;
                    const isToday = gameDate && gameDate.toDateString() === now.toDateString();
                    return (
                      <TableRow key={game.game_id}>
                        <TableCell>
                          <span className={isToday ? 'font-semibold' : ''}>
                            {toDisplayDate(game.start_time, now)}
                          </span>
                        </TableCell>
                        <TableCell className="text-zinc-600 dark:text-zinc-400">
                          {toDisplayTime(game.start_time)}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/teams/${game.opponent_id}`}
                            className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline font-medium"
                          >
                            {game.is_home === 'home' ? 'vs' : '@'} {game.opponent_abbr}
                          </Link>
                        </TableCell>
                        <TableCell className="text-zinc-600 dark:text-zinc-400 text-sm">
                          {game.is_home === 'home' ? 'Home' : 'Away'}
                          {game.venue && ` • ${game.venue}`}
                        </TableCell>
                        <TableCell>
                          <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                            {game.status ?? 'Scheduled'}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {pastGames.length > 0 && (
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
              Past Games ({pastGames.length})
            </h2>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Opponent</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Margin</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...pastGames].reverse().map((game) => {
                    const margin = game.team_score !== null && game.opponent_score !== null
                      ? game.team_score - game.opponent_score
                      : null;
                    return (
                      <TableRow key={game.game_id}>
                        <TableCell>
                          {toDisplayDate(game.start_time, now)}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/teams/${game.opponent_id}`}
                            className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                          >
                            {game.is_home === 'home' ? 'vs' : '@'} {game.opponent_abbr}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {game.result ? (
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              game.result === 'W'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                            }`}>
                              {game.result}
                            </span>
                          ) : (
                            <span className="text-zinc-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {game.team_score !== null && game.opponent_score !== null ? (
                            <span>
                              {game.team_score} - {game.opponent_score}
                            </span>
                          ) : (
                            <span className="text-zinc-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {margin !== null ? (
                            <span className={margin > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                              {margin > 0 ? '+' : ''}{margin}
                            </span>
                          ) : (
                            <span className="text-zinc-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/games/${game.game_id}`}
                            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            Box Score
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
