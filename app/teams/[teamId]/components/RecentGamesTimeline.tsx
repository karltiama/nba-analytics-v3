'use client';

import Link from 'next/link';
import { Home, Plane } from 'lucide-react';

interface RecentGame {
  game_id: string;
  start_time: string;
  points_for: number;
  points_against: number;
  margin: number;
  result: 'W' | 'L';
  opponent_team_id?: string;
  opponent_abbr?: string;
  opponent_name?: string;
  is_home?: boolean;
}

interface RecentGamesTableProps {
  games: RecentGame[];
  teamId: string;
  loading?: boolean;
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric' 
  });
}

export function RecentGamesTable({ games, teamId, loading }: RecentGamesTableProps) {
  // Only show last 5 games
  const last5Games = games.slice(0, 5);

  if (loading) {
    return (
      <div className="glass-card rounded-xl p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-white/10 rounded w-1/4" />
          <div className="h-48 bg-white/10 rounded" />
        </div>
      </div>
    );
  }

  if (last5Games.length === 0) {
    return (
      <div className="glass-card rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Last 5 Games</h2>
        <p className="text-sm text-muted-foreground">No recent games found</p>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Last 5 Games</h2>
        <Link
          href={`/teams/${teamId}/schedule`}
          className="text-xs text-[#00d4ff] hover:underline"
        >
          View full schedule →
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left text-xs text-muted-foreground py-2 px-2">Date</th>
              <th className="text-left text-xs text-muted-foreground py-2 px-2">Opponent</th>
              <th className="text-center text-xs text-muted-foreground py-2 px-2">Result</th>
              <th className="text-center text-xs text-muted-foreground py-2 px-2">Score</th>
              <th className="text-center text-xs text-muted-foreground py-2 px-2">Margin</th>
            </tr>
          </thead>
          <tbody>
            {last5Games.map((game) => {
              const isWin = game.result === 'W';
              const gameDate = formatDate(game.start_time);
              
              return (
                <tr
                  key={game.game_id}
                  className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="py-3 px-2">
                    <Link
                      href={`/games/${game.game_id}`}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white transition-colors"
                    >
                      {gameDate}
                      {game.is_home !== undefined && (
                        game.is_home ? (
                          <Home className="w-3 h-3 text-[#00d4ff]" />
                        ) : (
                          <Plane className="w-3 h-3 text-[#bf5af2]" />
                        )
                      )}
                    </Link>
                  </td>
                  <td className="py-3 px-2">
                    {game.opponent_team_id ? (
                      <Link
                        href={`/teams/${game.opponent_team_id}`}
                        className="text-sm font-medium text-white hover:text-[#00d4ff] transition-colors"
                      >
                        {game.opponent_abbr || game.opponent_name || 'Opponent'}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium text-white">
                        {game.opponent_abbr || game.opponent_name || 'Opponent'}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className={`text-sm font-bold ${
                      isWin ? 'text-[#39ff14]' : 'text-[#ff4757]'
                    }`}>
                      {game.result}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <Link
                      href={`/games/${game.game_id}`}
                      className="text-sm font-mono font-semibold text-white hover:text-[#00d4ff] transition-colors"
                    >
                      {game.points_for} - {game.points_against}
                    </Link>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className={`text-xs font-medium ${
                      isWin ? 'text-[#39ff14]' : 'text-[#ff4757]'
                    }`}>
                      {isWin ? '+' : ''}{game.margin.toFixed(1)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

