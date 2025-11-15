import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface RecentFormProps {
  recentForm: {
    last_5?: {
      games?: any[];
      wins?: number;
      losses?: number;
      avg_points_for?: number;
      avg_points_against?: number;
    };
    last_10?: {
      games?: any[];
      wins?: number;
      losses?: number;
      avg_points_for?: number;
      avg_points_against?: number;
    };
  };
}

export function RecentForm({ recentForm }: RecentFormProps) {
  if (!recentForm.last_10?.games?.length) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
        Recent Form
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <h3 className="text-lg font-semibold mb-2">Last 5 Games</h3>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm text-zinc-600 dark:text-zinc-400">Record: </span>
            <span className="font-bold">
              {recentForm.last_5?.wins || 0}-{recentForm.last_5?.losses || 0}
            </span>
          </div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Avg Points: {recentForm.last_5?.avg_points_for 
              ? Number(recentForm.last_5.avg_points_for).toFixed(1) 
              : '-'} / {recentForm.last_5?.avg_points_against 
              ? Number(recentForm.last_5.avg_points_against).toFixed(1) 
              : '-'}
          </div>
        </div>
        <div>
          <h3 className="text-lg font-semibold mb-2">Last 10 Games</h3>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm text-zinc-600 dark:text-zinc-400">Record: </span>
            <span className="font-bold">
              {recentForm.last_10?.wins || 0}-{recentForm.last_10?.losses || 0}
            </span>
          </div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Avg Points: {recentForm.last_10?.avg_points_for 
              ? Number(recentForm.last_10.avg_points_for).toFixed(1) 
              : '-'} / {recentForm.last_10?.avg_points_against 
              ? Number(recentForm.last_10.avg_points_against).toFixed(1) 
              : '-'}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Opponent</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Margin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentForm.last_10?.games?.slice(0, 10).map((game: any, idx: number) => (
              <TableRow key={idx}>
                <TableCell>
                  {new Date(game.start_time).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </TableCell>
                <TableCell>
                  {game.opponent_team_id ? (
                    <Link
                      href={`/teams/${game.opponent_team_id}`}
                      className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                    >
                      {game.opponent_abbr || game.opponent_name || '-'}
                    </Link>
                  ) : (
                    '-'
                  )}
                </TableCell>
                <TableCell>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    game.result === 'W' 
                      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                      : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                  }`}>
                    {game.result}
                  </span>
                </TableCell>
                <TableCell>
                  {game.points_for} - {game.points_against}
                </TableCell>
                <TableCell className={game.margin > 0 ? 'text-green-600' : 'text-red-600'}>
                  {game.margin > 0 ? '+' : ''}{game.margin}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

