import Link from 'next/link';
import { TeamLogo } from '@/components/nba/TeamLogo';
import { PlayerHeadshot } from '@/components/nba/PlayerHeadshot';
import type { PlayerProfile, SeasonAverages } from '@/lib/players/types';

export interface PlayerTeamInfo {
  team_id: string;
  abbreviation: string;
  full_name: string;
}

interface PlayerHeaderProps {
  player: PlayerProfile;
  seasonAverages?: SeasonAverages;
  /** Current team (e.g. from most recent game). When set, shows team logo and link to team page. */
  team?: PlayerTeamInfo | null;
  /** Active analytics season start year shown in the header. */
  seasonLabel?: string | null;
}

export function PlayerHeader({ player, seasonAverages, team, seasonLabel }: PlayerHeaderProps) {
  const gp = seasonAverages?.games_active ?? seasonAverages?.games_played;

  return (
    <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-2.5 border-b border-[#DCE9EA] flex items-center justify-end bg-[#F8FBFA]">
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {seasonLabel && (
            <span className="type-badge px-2 py-0.5 bg-white border border-[#DCE9EA] text-[#4a6366] rounded-full">
              Season {seasonLabel}
            </span>
          )}
          {player.active !== null && (
            <span className="type-badge flex items-center gap-1.5 text-[#4a6366]">
              <span className={`w-1.5 h-1.5 rounded-full ${player.active ? 'bg-[#20B95A]' : 'bg-[#8aa0a3]'}`} />
              {player.active ? 'Active' : 'Inactive'}
            </span>
          )}
          {player.position && (
            <span className="type-badge px-2 py-0.5 bg-[#55ddb1]/25 text-[#075B5C] rounded-full">
              {player.position}
            </span>
          )}
        </div>
      </div>

      <div className="p-5">
        <div className="flex flex-col items-center md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex flex-col items-center md:flex-row md:items-center gap-4">
            <PlayerHeadshot nbaPlayerId={player.nba_player_id} name={player.full_name} />
            <div className="min-w-0 text-center md:text-left">
              <h1 className="text-2xl font-bold text-[#063f46]">
                {player.full_name}
              </h1>
              <div className="type-secondary flex flex-wrap items-center justify-center md:justify-start gap-2 mt-0.5">
                {player.height && <span>{player.height}</span>}
                {player.height && player.weight && <span className="text-[#DCE9EA]">•</span>}
                {player.weight && <span>{player.weight} lbs</span>}
              </div>
              {team && (
                <Link
                  href={`/teams/${team.team_id}`}
                  className="type-interactive inline-flex items-center justify-center md:justify-start gap-2 mt-2 text-[#075B5C] hover:text-[#063f46] transition-colors"
                >
                  <TeamLogo team={team.abbreviation} size="xs" decorative />
                  <span className="text-[#063f46]">{team.abbreviation}</span>
                  <span>{team.full_name}</span>
                </Link>
              )}
            </div>
          </div>

          {seasonAverages && gp && gp > 0 && (
            <div className="flex gap-3">
              <QuickStat label="PPG" value={seasonAverages.avg_points} />
              <QuickStat label="RPG" value={seasonAverages.avg_rebounds} />
              <QuickStat label="APG" value={seasonAverages.avg_assists} />
              <QuickStat label="GP" value={gp} decimals={0} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QuickStat({
  label,
  value,
  decimals = 1,
}: {
  label: string;
  value?: number;
  decimals?: number;
}) {
  if (value == null) return null;
  return (
    <div className="text-center px-3 py-2 rounded-lg bg-[#F8FBFA] border border-[#DCE9EA]">
      <div className="text-2xl font-bold font-mono text-[#063f46]">
        {Number(value).toFixed(decimals)}
      </div>
      <div className="type-metadata">{label}</div>
    </div>
  );
}
