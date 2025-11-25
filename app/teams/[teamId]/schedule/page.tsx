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
import { getTeamInfo } from '@/lib/teams/queries';

interface ScheduleGame {
  game_id: string;
  season: string;
  start_time: string;
  status: string;
  is_home: 'home' | 'away';
  opponent_id: string;
  opponent_abbr: string;
  opponent_name: string;
  team_score: number | null;
  opponent_score: number | null;
  result: 'W' | 'L' | null;
  venue: string | null;
}

export default async function TeamSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ season?: string; status?: string }>;
}) {
  const { teamId } = await params;
  const { season, status } = await searchParams;

  // Build query for BBRef schedule from bbref_games table
  const queryParams: any[] = [teamId];
  let paramCount = 2;
  let queryStr = `
    SELECT 
      bg.bbref_game_id as game_id,
      bg.season,
      COALESCE(bg.start_time, bg.game_date::timestamptz) as start_time,
      bg.status,
      bg.home_score,
      bg.away_score,
      bg.venue,
      bg.game_date,
      -- Home team info
      ht.team_id as home_team_id,
      ht.abbreviation as home_team_abbr,
      ht.full_name as home_team_name,
      -- Away team info
      at.team_id as away_team_id,
      at.abbreviation as away_team_abbr,
      at.full_name as away_team_name,
      -- Determine if this team is home or away
      CASE 
        WHEN bg.home_team_id = $1 THEN 'home'
        ELSE 'away'
      END as is_home,
      -- Opponent info
      CASE 
        WHEN bg.home_team_id = $1 THEN at.team_id
        ELSE ht.team_id
      END as opponent_id,
      CASE 
        WHEN bg.home_team_id = $1 THEN at.abbreviation
        ELSE ht.abbreviation
      END as opponent_abbr,
      CASE 
        WHEN bg.home_team_id = $1 THEN at.full_name
        ELSE ht.full_name
      END as opponent_name,
      -- Team's score
      CASE 
        WHEN bg.home_team_id = $1 THEN bg.home_score
        ELSE bg.away_score
      END as team_score,
      -- Opponent's score
      CASE 
        WHEN bg.home_team_id = $1 THEN bg.away_score
        ELSE bg.home_score
      END as opponent_score,
      -- Win/Loss indicator (null if game not finished)
      CASE 
        WHEN bg.status = 'Final' AND bg.home_team_id = $1 AND bg.home_score > bg.away_score THEN 'W'
        WHEN bg.status = 'Final' AND bg.home_team_id = $1 AND bg.home_score < bg.away_score THEN 'L'
        WHEN bg.status = 'Final' AND bg.away_team_id = $1 AND bg.away_score > bg.home_score THEN 'W'
        WHEN bg.status = 'Final' AND bg.away_team_id = $1 AND bg.away_score < bg.home_score THEN 'L'
        ELSE NULL
      END as result
    FROM bbref_games bg
    JOIN teams ht ON bg.home_team_id = ht.team_id
    JOIN teams at ON bg.away_team_id = at.team_id
    WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
  `;

  if (season) {
    queryStr += ` AND bg.season = $${paramCount}`;
    queryParams.push(season);
    paramCount++;
  }

  if (status) {
    queryStr += ` AND bg.status = $${paramCount}`;
    queryParams.push(status);
    paramCount++;
  }

  queryStr += `
    ORDER BY 
      bg.game_date ASC,
      COALESCE(bg.start_time, bg.game_date::timestamptz) ASC
  `;

  const [team, schedule] = await Promise.all([
    getTeamInfo(teamId),
    query(queryStr, queryParams) as Promise<ScheduleGame[]>,
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

  // Separate games into past and upcoming
  const now = new Date();
  const pastGames = schedule.filter((game) => new Date(game.start_time) <= now);
  const upcomingGames = schedule.filter((game) => new Date(game.start_time) > now);

  // Calculate record
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
            {team.full_name} BBRef Schedule
          </h1>
          {pastGames.length > 0 && (
            <p className="text-zinc-600 dark:text-zinc-400">
              Record: <span className="font-bold text-black dark:text-zinc-50">{wins}-{losses}</span>
            </p>
          )}
        </div>

        {/* Upcoming Games */}
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
                    const gameDate = new Date(game.start_time);
                    const isToday = gameDate.toDateString() === now.toDateString();
                    
                    return (
                      <TableRow key={game.game_id}>
                        <TableCell>
                          <span className={isToday ? 'font-semibold' : ''}>
                            {gameDate.toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                              ...(gameDate.getFullYear() !== now.getFullYear() && {
                                year: 'numeric',
                              }),
                            })}
                          </span>
                        </TableCell>
                        <TableCell className="text-zinc-600 dark:text-zinc-400">
                          {gameDate.toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            timeZoneName: 'short',
                          })}
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
                            {game.status}
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

        {/* Past Games */}
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
                  {pastGames.reverse().map((game) => {
                    const margin = game.team_score !== null && game.opponent_score !== null
                      ? game.team_score - game.opponent_score
                      : null;

                    return (
                      <TableRow key={game.game_id}>
                        <TableCell>
                          {new Date(game.start_time).toLocaleDateString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            ...(new Date(game.start_time).getFullYear() !== now.getFullYear() && {
                              year: 'numeric',
                            }),
                          })}
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

