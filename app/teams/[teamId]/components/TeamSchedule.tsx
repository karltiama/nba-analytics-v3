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
  // Fetch schedule from database
  // Deduplicate games that match on teams and are within 48 hours of each other
  // Prefer games with actual scores/data over midnight placeholder timestamps
  const schedule = await query(`
    with game_duplicates as (
      -- Find games that are duplicates (same teams, within 48 hours)
      -- Score each game and keep the better one
      select 
        g1.game_id as game1_id,
        g2.game_id as game2_id,
        -- Score game 1: prefer Final with scores, Final, actual times, NBA Stats IDs
        (case when g1.status = 'Final' and g1.home_score is not null and g1.away_score is not null then 10 else 0 end +
         case when g1.status = 'Final' then 5 else 0 end +
         case when extract(hour from g1.start_time at time zone 'America/New_York') != 0 
              or extract(minute from g1.start_time at time zone 'America/New_York') != 0 then 3 else 0 end +
         case when g1.game_id like '002%' then 2 else 0 end) as score1,
        -- Score game 2
        (case when g2.status = 'Final' and g2.home_score is not null and g2.away_score is not null then 10 else 0 end +
         case when g2.status = 'Final' then 5 else 0 end +
         case when extract(hour from g2.start_time at time zone 'America/New_York') != 0 
              or extract(minute from g2.start_time at time zone 'America/New_York') != 0 then 3 else 0 end +
         case when g2.game_id like '002%' then 2 else 0 end) as score2
      from games g1
      join games g2 on (
        g1.home_team_id = g2.home_team_id
        and g1.away_team_id = g2.away_team_id
        and g1.game_id < g2.game_id
        and abs(extract(epoch from (g1.start_time - g2.start_time))) < 172800  -- Within 48 hours
      )
      where (g1.home_team_id = $1 or g1.away_team_id = $1)
    )
    select 
      g.game_id,
      g.season,
      g.start_time,
      g.status,
      g.home_score,
      g.away_score,
      g.venue,
      -- Home team info
      ht.team_id as home_team_id,
      ht.abbreviation as home_team_abbr,
      ht.full_name as home_team_name,
      -- Away team info
      at.team_id as away_team_id,
      at.abbreviation as away_team_abbr,
      at.full_name as away_team_name,
      -- Determine if this team is home or away
      case 
        when g.home_team_id = $1 then 'home'
        else 'away'
      end as is_home,
      -- Opponent info
      case 
        when g.home_team_id = $1 then at.team_id
        else ht.team_id
      end as opponent_id,
      case 
        when g.home_team_id = $1 then at.abbreviation
        else ht.abbreviation
      end as opponent_abbr,
      case 
        when g.home_team_id = $1 then at.full_name
        else ht.full_name
      end as opponent_name,
      -- Team's score
      case 
        when g.home_team_id = $1 then g.home_score
        else g.away_score
      end as team_score,
      -- Opponent's score
      case 
        when g.home_team_id = $1 then g.away_score
        else g.home_score
      end as opponent_score,
      -- Win/Loss indicator (null if game not finished)
      case 
        when g.status = 'Final' and g.home_team_id = $1 and g.home_score > g.away_score then 'W'
        when g.status = 'Final' and g.home_team_id = $1 and g.home_score < g.away_score then 'L'
        when g.status = 'Final' and g.away_team_id = $1 and g.away_score > g.home_score then 'W'
        when g.status = 'Final' and g.away_team_id = $1 and g.away_score < g.home_score then 'L'
        else null
      end as result
    from games g
    join teams ht on g.home_team_id = ht.team_id
    join teams at on g.away_team_id = at.team_id
    left join game_duplicates gd on (
      (g.game_id = gd.game1_id and gd.score1 < gd.score2) or
      (g.game_id = gd.game2_id and gd.score2 < gd.score1)
    )
    where (g.home_team_id = $1 or g.away_team_id = $1)
      ${season ? 'and g.season = $2' : ''}
      and gd.game1_id is null  -- Exclude lower-scoring duplicates
    order by 
      (g.start_time at time zone 'America/New_York')::date,
      g.home_team_id,
      g.away_team_id,
      -- Prefer games with actual times (not midnight)
      case when extract(hour from g.start_time at time zone 'America/New_York') = 0 
           and extract(minute from g.start_time at time zone 'America/New_York') = 0 then 1 else 0 end,
      -- Prefer Final games with scores
      case when g.status = 'Final' and g.home_score is not null and g.away_score is not null then 0 else 1 end,
      -- Prefer Final games
      case when g.status = 'Final' then 0 else 1 end,
      -- Prefer NBA Stats IDs
      case when g.game_id like '002%' then 0 else 1 end,
      g.start_time asc
  `, season ? [teamId, season] : [teamId]);

  if (!schedule || schedule.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
        <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
          Schedule
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
          Schedule
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

