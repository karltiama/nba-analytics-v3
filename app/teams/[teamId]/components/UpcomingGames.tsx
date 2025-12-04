'use client';

import Link from 'next/link';
import { Calendar, Home, Plane, Clock } from 'lucide-react';

interface UpcomingGame {
  game_id: string;
  start_time: string;
  game_date: string;
  status: string;
  opponent_team_id?: string;
  opponent_abbr?: string;
  opponent_name?: string;
  is_home?: boolean;
  venue?: string | null;
}

interface UpcomingGamesProps {
  games: UpcomingGame[];
  teamId: string;
  loading?: boolean;
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    weekday: 'short',
    month: 'short', 
    day: 'numeric' 
  });
}

function formatTime(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', { 
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });
}

export function UpcomingGames({ games, teamId, loading }: UpcomingGamesProps) {
  // Only show next 5 games
  const next5Games = games.slice(0, 5);

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

  if (next5Games.length === 0) {
    return (
      <div className="glass-card rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Next 5 Games</h2>
        <p className="text-sm text-muted-foreground">No upcoming games scheduled</p>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Next 5 Games</h2>
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
              <th className="text-center text-xs text-muted-foreground py-2 px-2">Time</th>
              <th className="text-center text-xs text-muted-foreground py-2 px-2">Location</th>
            </tr>
          </thead>
          <tbody>
            {next5Games.map((game) => {
              const gameDate = formatDate(game.start_time || game.game_date);
              const gameTime = game.start_time ? formatTime(game.start_time) : 'TBD';
              
              return (
                <tr
                  key={game.game_id}
                  className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Calendar className="w-3 h-3" />
                      {gameDate}
                    </div>
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
                    <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {gameTime}
                    </div>
                  </td>
                  <td className="py-3 px-2 text-center">
                    {game.is_home !== undefined ? (
                      game.is_home ? (
                        <div className="flex items-center justify-center gap-1 text-xs text-[#00d4ff]">
                          <Home className="w-3 h-3" />
                          <span>Home</span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1 text-xs text-[#bf5af2]">
                          <Plane className="w-3 h-3" />
                          <span>Away</span>
                        </div>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
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











