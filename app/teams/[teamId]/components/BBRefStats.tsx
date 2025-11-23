import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getBBRefTeamGameStats } from '@/lib/teams/bbref-queries';

interface BBRefStatsProps {
  teamId: string;
}

export async function BBRefStats({ teamId }: BBRefStatsProps) {
  // Fetch all games from BBRef source only (no limit)
  const stats = await getBBRefTeamGameStats(teamId, null);

  if (!stats || stats.length === 0) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
        BBRef Game Stats
      </h2>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Opponent</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>PTS</TableHead>
              <TableHead>FGM/FGA</TableHead>
              <TableHead>3PM/3PA</TableHead>
              <TableHead>FTM/FTA</TableHead>
              <TableHead>REB</TableHead>
              <TableHead>ORB</TableHead>
              <TableHead>DRB</TableHead>
              <TableHead>AST</TableHead>
              <TableHead>STL</TableHead>
              <TableHead>BLK</TableHead>
              <TableHead>TOV</TableHead>
              <TableHead>PF</TableHead>
              <TableHead>POSS</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.map((game: any) => {
              // Format date from YYYY-MM-DD string to prevent timezone issues
              // Adding T12:00:00 ensures it's parsed as noon local time, preventing day shift
              let dateStr: string;
              if (game.game_date_str) {
                // Use the formatted string from PostgreSQL
                const [year, month, day] = game.game_date_str.split('-');
                const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                dateStr = date.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                });
              } else if (game.game_date) {
                // Fallback: parse the date object/string
                const date = typeof game.game_date === 'string' 
                  ? new Date(game.game_date + 'T12:00:00')
                  : new Date(game.game_date);
                dateStr = date.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                });
              } else {
                dateStr = '-';
              }
              
              const opponent = game.is_home ? game.away_team : game.home_team;
              const location = game.is_home ? 'vs' : '@';
              const score = game.team_score && game.opponent_score
                ? `${game.team_score}-${game.opponent_score}`
                : '-';
              
              const resultColor = game.result === 'W' 
                ? 'text-green-600 dark:text-green-400' 
                : game.result === 'L'
                ? 'text-red-600 dark:text-red-400'
                : '';

              return (
                <TableRow key={game.game_id}>
                  <TableCell className="font-medium">{dateStr}</TableCell>
                  <TableCell>
                    {location} {opponent}
                  </TableCell>
                  <TableCell className={resultColor}>
                    {game.result || '-'} {score}
                  </TableCell>
                  <TableCell>{game.points ?? '-'}</TableCell>
                  <TableCell>
                    {game.fgm ?? '-'}/{game.fga ?? '-'}
                  </TableCell>
                  <TableCell>
                    {game['3pm'] ?? '-'}/{game['3pa'] ?? '-'}
                  </TableCell>
                  <TableCell>
                    {game.ftm ?? '-'}/{game.fta ?? '-'}
                  </TableCell>
                  <TableCell>{game.rebounds ?? '-'}</TableCell>
                  <TableCell>{game.orb ?? '-'}</TableCell>
                  <TableCell>{game.drb ?? '-'}</TableCell>
                  <TableCell>{game.assists ?? '-'}</TableCell>
                  <TableCell>{game.steals ?? '-'}</TableCell>
                  <TableCell>{game.blocks ?? '-'}</TableCell>
                  <TableCell>{game.turnovers ?? '-'}</TableCell>
                  <TableCell>{game.pf ?? '-'}</TableCell>
                  <TableCell>
                    {game.possessions 
                      ? Number(game.possessions).toFixed(1) 
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


