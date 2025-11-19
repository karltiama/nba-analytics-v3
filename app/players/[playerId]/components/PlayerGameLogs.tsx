import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface Game {
  game_id: string;
  start_time: string;
  status: string;
  season: string;
  team_abbr: string;
  team_name: string;
  opponent_id: string;
  opponent_abbr: string;
  opponent_name: string;
  location: 'home' | 'away';
  team_score: number | null;
  opponent_score: number | null;
  result: 'W' | 'L' | null;
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  field_goals_made: number | null;
  field_goals_attempted: number | null;
  three_pointers_made: number | null;
  three_pointers_attempted: number | null;
  free_throws_made: number | null;
  free_throws_attempted: number | null;
  plus_minus: number | null;
  started: boolean | null;
  dnp_reason: string | null;
}

interface PlayerGameLogsProps {
  games: Game[];
}

export function PlayerGameLogs({ games }: PlayerGameLogsProps) {
  if (games.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
        <p className="text-zinc-600 dark:text-zinc-400">
          No games found for this player.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
        Game Logs
      </h2>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Opponent</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>MIN</TableHead>
              <TableHead>PTS</TableHead>
              <TableHead>REB</TableHead>
              <TableHead>AST</TableHead>
              <TableHead>STL</TableHead>
              <TableHead>BLK</TableHead>
              <TableHead>TO</TableHead>
              <TableHead>FG</TableHead>
              <TableHead>3P</TableHead>
              <TableHead>FT</TableHead>
              <TableHead>+/-</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {games.map((game) => {
              const gameDate = new Date(game.start_time);
              const fgDisplay = game.field_goals_made !== null && game.field_goals_attempted !== null
                ? `${game.field_goals_made}/${game.field_goals_attempted}`
                : '-';
              const threeDisplay = game.three_pointers_made !== null && game.three_pointers_attempted !== null
                ? `${game.three_pointers_made}/${game.three_pointers_attempted}`
                : '-';
              const ftDisplay = game.free_throws_made !== null && game.free_throws_attempted !== null
                ? `${game.free_throws_made}/${game.free_throws_attempted}`
                : '-';

              if (game.dnp_reason) {
                return (
                  <TableRow key={game.game_id}>
                    <TableCell>
                      <Link
                        href={`/games/${game.game_id}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {gameDate.toLocaleDateString()}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/teams/${game.opponent_id}`}
                        className="hover:text-blue-600 dark:hover:text-blue-400"
                      >
                        {game.location === 'away' ? '@' : 'vs'} {game.opponent_abbr}
                      </Link>
                    </TableCell>
                    <TableCell colSpan={12} className="text-zinc-500 italic">
                      {game.dnp_reason}
                    </TableCell>
                  </TableRow>
                );
              }

              return (
                <TableRow key={game.game_id}>
                  <TableCell>
                    <Link
                      href={`/games/${game.game_id}`}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {gameDate.toLocaleDateString()}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/teams/${game.opponent_id}`}
                      className="hover:text-blue-600 dark:hover:text-blue-400"
                    >
                      {game.location === 'away' ? '@' : 'vs'} {game.opponent_abbr}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {game.result && (
                      <span className={`font-semibold ${
                        game.result === 'W' ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {game.result}
                      </span>
                    )}
                    {game.team_score !== null && game.opponent_score !== null && (
                      <span className="text-sm text-zinc-500 ml-1">
                        {game.team_score}-{game.opponent_score}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{game.minutes ? Number(game.minutes).toFixed(1) : '-'}</TableCell>
                  <TableCell className="font-medium">{game.points ?? '-'}</TableCell>
                  <TableCell>{game.rebounds ?? '-'}</TableCell>
                  <TableCell>{game.assists ?? '-'}</TableCell>
                  <TableCell>{game.steals ?? '-'}</TableCell>
                  <TableCell>{game.blocks ?? '-'}</TableCell>
                  <TableCell>{game.turnovers ?? '-'}</TableCell>
                  <TableCell className="text-sm">{fgDisplay}</TableCell>
                  <TableCell className="text-sm">{threeDisplay}</TableCell>
                  <TableCell className="text-sm">{ftDisplay}</TableCell>
                  <TableCell className={
                    game.plus_minus !== null && game.plus_minus !== undefined
                      ? (game.plus_minus > 0 ? 'text-green-600' : game.plus_minus < 0 ? 'text-red-600' : '')
                      : ''
                  }>
                    {game.plus_minus !== null && game.plus_minus !== undefined
                      ? (game.plus_minus > 0 ? '+' : '') + game.plus_minus
                      : '-'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

