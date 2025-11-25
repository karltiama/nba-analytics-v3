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

interface TeamScheduleProps {
  teamId: string;
  season?: string | null;
}

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

export async function TeamSchedule({ teamId, season }: TeamScheduleProps) {
  // Fetch BBRef schedule from bbref_games table
  const schedule = await query(`
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
      ${season ? 'AND bg.season = $2' : ''}
    ORDER BY 
      bg.game_date ASC,
      COALESCE(bg.start_time, bg.game_date::timestamptz) ASC
  `, season ? [teamId, season] : [teamId]);

  if (!schedule || schedule.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
        <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
          BBRef Schedule
        </h2>
        <p className="text-zinc-600 dark:text-zinc-400">
          No schedule data available yet.
        </p>
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
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold text-black dark:text-zinc-50">
          BBRef Schedule
        </h2>
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

      {/* Upcoming Games */}
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
                  const gameDate = new Date(game.start_time);
                  const isToday = gameDate.toDateString() === now.toDateString();
                  
                  return (
                    <TableRow key={game.game_id}>
                      <TableCell>
                        <span className={isToday ? 'font-semibold' : ''}>
                          {gameDate.toLocaleDateString('en-US', {
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
          {upcomingGames.length > 10 && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
              Showing next 10 of {upcomingGames.length} upcoming games
            </p>
          )}
        </div>
      )}

      {/* Past Games */}
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
                        {new Date(game.start_time).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
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

