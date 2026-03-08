import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { resolveAnalyticsTeamId } from '@/lib/teams/analytics-queries';
import { getScheduleForTeam, type ScheduleGameRow } from '@/lib/analytics/games-queries';

interface TeamScheduleProps {
  teamId: string;
  season?: string | null;
}

const GAME_DISPLAY_TZ = 'America/New_York';

function toDisplayTime(startTime: string | null): string {
  if (!startTime) return 'TBD';
  const d = new Date(startTime);
  return isNaN(d.getTime()) ? 'TBD' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: GAME_DISPLAY_TZ });
}

function toDisplayDate(startTime: string | null, now: Date): string {
  if (!startTime) return 'TBD';
  const d = new Date(startTime);
  if (isNaN(d.getTime())) return 'TBD';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
    timeZone: GAME_DISPLAY_TZ,
  });
}

export async function TeamSchedule({ teamId, season }: TeamScheduleProps) {
  const analyticsTeamId = await resolveAnalyticsTeamId(teamId);
  if (!analyticsTeamId) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
        <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">Schedule</h2>
        <p className="text-zinc-600 dark:text-zinc-400">Team not found in analytics.</p>
      </div>
    );
  }

  const schedule = await getScheduleForTeam(analyticsTeamId, season ?? undefined);

  if (!schedule || schedule.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
        <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">Schedule</h2>
        <p className="text-zinc-600 dark:text-zinc-400">No schedule data available yet.</p>
      </div>
    );
  }

  const now = new Date();
  const pastGames = schedule.filter((game) => game.start_time && new Date(game.start_time) <= now);
  const upcomingGames = schedule.filter((game) => !game.start_time || new Date(game.start_time) > now);

  const wins = pastGames.filter((g) => g.result === 'W').length;
  const losses = pastGames.filter((g) => g.result === 'L').length;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold text-black dark:text-zinc-50">Schedule</h2>
        <div className="flex items-center gap-4">
          {pastGames.length > 0 && (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              Record: <span className="font-bold text-black dark:text-zinc-50">{wins}-{losses}</span>
            </div>
          )}
          <Link
            href={`/teams/${teamId}/schedule`}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium"
          >
            View Full Schedule →
          </Link>
        </div>
      </div>

      {upcomingGames.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-black dark:text-zinc-50 mb-3">
            Upcoming ({upcomingGames.length})
          </h3>
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
                {upcomingGames.slice(0, 10).map((game) => {
                  const gameDate = game.start_time ? new Date(game.start_time) : null;
                  const todayET = now.toLocaleDateString('en-CA', { timeZone: GAME_DISPLAY_TZ });
                  const isToday = gameDate && gameDate.toLocaleDateString('en-CA', { timeZone: GAME_DISPLAY_TZ }) === todayET;
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
          {upcomingGames.length > 10 && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
              Showing next 10 of {upcomingGames.length} upcoming games
            </p>
          )}
        </div>
      )}

      {pastGames.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-black dark:text-zinc-50 mb-3">
            Past Games ({pastGames.length})
          </h3>
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
                {pastGames.slice(-10).reverse().map((game) => {
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
          {pastGames.length > 10 && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
              Showing last 10 of {pastGames.length} games
            </p>
          )}
        </div>
      )}
    </div>
  );
}
