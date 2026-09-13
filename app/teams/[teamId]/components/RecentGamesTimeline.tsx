'use client';

import Link from 'next/link';
import { Home, Plane } from 'lucide-react';
import { TeamLogo } from '@/components/nba/TeamLogo';
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
      <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-[#DCE9EA] rounded w-1/4" />
          <div className="h-48 bg-[#F8FBFA] rounded" />
        </div>
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-6">
        <h2 className="text-lg font-semibold text-[#063f46] mb-4">{title}</h2>
        <p className="text-sm text-[#4a6366]">No recent games found</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-[#063f46]">{title}</h2>
        <Link
          href={`/teams/${teamId}/schedule`}
          className="text-xs text-[#075B5C] hover:underline"
        >
          View full schedule &rarr;
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#DCE9EA]">
              <th className="text-left text-xs text-[#4a6366] py-2 px-2">Date</th>
              <th className="text-left text-xs text-[#4a6366] py-2 px-2">Opponent</th>
              <th className="text-center text-xs text-[#4a6366] py-2 px-2">Result</th>
              <th className="text-center text-xs text-[#4a6366] py-2 px-2">Score</th>
              <th className="text-center text-xs text-[#4a6366] py-2 px-2">Margin</th>
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
                  className="border-b border-[#DCE9EA] hover:bg-[#f7f9f7] transition-colors"
                >
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-1.5 text-xs text-[#4a6366]">
                      {formatDate(game.game_date)}
                      {game.is_home ? (
                        <Home className="w-3 h-3 text-[#075B5C]" />
                      ) : (
                        <Plane className="w-3 h-3 text-[#8aa0a3]" />
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-2">
                    <Link
                      href={`/teams/${game.opponent_team_id}`}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-[#063f46] hover:text-[#075B5C] transition-colors"
                    >
                      <TeamLogo team={game.opponent_abbr} size="xs" decorative />
                      {game.opponent_abbr}
                    </Link>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span
                      className={`text-sm font-bold ${
                        isWin ? 'text-[#20B95A]' : 'text-[#c2410c]'
                      }`}
                    >
                      {game.result ?? '—'}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className="text-sm font-mono font-semibold text-[#063f46]">
                      {game.team_points} - {game.points_allowed ?? '?'}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    {margin != null ? (
                      <span
                        className={`text-xs font-medium ${
                          margin > 0 ? 'text-[#20B95A]' : margin < 0 ? 'text-[#c2410c]' : 'text-[#063f46]'
                        }`}
                      >
                        {margin > 0 ? '+' : ''}{margin}
                      </span>
                    ) : (
                      <span className="text-xs text-[#8aa0a3]">—</span>
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
