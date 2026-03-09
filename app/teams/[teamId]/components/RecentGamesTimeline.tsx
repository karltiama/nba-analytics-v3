'use client';

import Link from 'next/link';
import { Home, Plane } from 'lucide-react';
import type { TeamGameStats } from '@/lib/teams/types';

interface RecentGamesTableProps {
  games: TeamGameStats[];
  teamId: string;
  title?: string;
  loading?: boolean;
}

const GAME_DISPLAY_TZ = 'America/New_York';

function formatDate(dateString: string) {
  const date = new Date(dateString + 'T12:00:00.000Z'); // noon UTC so calendar day is correct in ET
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: GAME_DISPLAY_TZ,
  });
}

export function RecentGamesTable({ games, teamId, title = 'Game Log', loading }: RecentGamesTableProps) {
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

  if (games.length === 0) {
    return (
      <div className="glass-card rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">{title}</h2>
        <p className="text-sm text-muted-foreground">No recent games found</p>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <Link
          href={`/teams/${teamId}/schedule`}
          className="text-xs text-[#00d4ff] hover:underline"
        >
          View full schedule &rarr;
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
            {games.map((game) => {
              const isWin = game.result === 'W';
              const margin = game.points_allowed != null
                ? game.team_points - game.points_allowed
                : null;

              return (
                <tr
                  key={game.game_id}
                  className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {formatDate(game.game_date)}
                      {game.is_home ? (
                        <Home className="w-3 h-3 text-[#00d4ff]" />
                      ) : (
                        <Plane className="w-3 h-3 text-[#bf5af2]" />
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-2">
                    <Link
                      href={`/teams/${game.opponent_team_id}`}
                      className="text-sm font-medium text-white hover:text-[#00d4ff] transition-colors"
                    >
                      {game.opponent_abbr}
                    </Link>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span
                      className={`text-sm font-bold ${
                        isWin ? 'text-[#39ff14]' : 'text-[#ff4757]'
                      }`}
                    >
                      {game.result ?? '—'}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className="text-sm font-mono font-semibold text-white">
                      {game.team_points} - {game.points_allowed ?? '?'}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    {margin != null ? (
                      <span
                        className={`text-xs font-medium ${
                          margin > 0 ? 'text-[#39ff14]' : margin < 0 ? 'text-[#ff4757]' : 'text-white'
                        }`}
                      >
                        {margin > 0 ? '+' : ''}{margin}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
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
